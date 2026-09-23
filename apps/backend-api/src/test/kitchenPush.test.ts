/**
 * The kitchen gets told, on a phone that is not open.
 *
 * Nothing has ever been sent to a restaurant by this platform. Not
 * misconfigured -- absent. `fcmDispatcher` had eight methods, seven addressed
 * to a customer and one to a rider, and the partner app has been registering
 * device tokens correctly into a table nobody read. The owner reported this as
 * "the firebase one is not working", which is the right symptom and the wrong
 * diagnosis, and there was no failing test because there was no code to fail.
 *
 * Two classes of mistake are checked here, because both fail SILENTLY and both
 * look identical to the bug being fixed -- a kitchen that is not told:
 *
 *   ADDRESSED TO THE WRONG THING. Device tokens are keyed by user id. A push
 *   sent to a restaurant id matches no device, returns no error, and is
 *   indistinguishable from a partner who never installed the app.
 *
 *   SENT TO A CHANNEL THAT DOES NOT EXIST. The partner app creates an Android
 *   channel with MAX importance and its own alarm sound. On Android 8 and
 *   above a message naming a channel the app never created is DROPPED, not
 *   quietly delivered. The server was sending `new_orders`; the partner app
 *   creates `kitchen-orders` and the rider app creates `new-orders`, so the
 *   loud channel matched neither and the alert could never ring.
 *
 * That second one is why the channel ids are asserted against the app source
 * itself rather than against a copy of the string. A constant compared with
 * itself is the assertion shape that let this survive in the first place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';

const PORT = 5209;
const API = `http://127.0.0.1:${PORT}/api`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

console.log('====================================================');
console.log('  THE KITCHEN GETS TOLD                             ');
console.log('====================================================\n');

let failed = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failed++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  /*
   * A caller-side deadline, because one check here deliberately hangs the push
   * transport. Without it, a regression that makes delivery block order
   * placement does not FAIL this suite -- it stops it, with no message and no
   * failing line, and whoever is looking has to work out why the run died.
   * A test that hangs is worse than one that fails.
   */
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  }).catch((err: any) => ({ status: 0, __error: err?.name || String(err) }) as any);

  if (!('json' in res)) return { status: 0, json: { error: (res as any).__error } };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

/** The channel id an app actually creates, read out of the app's own source. */
function channelInApp(relativePath: string): string | null {
  const source = fs.readFileSync(path.join(REPO, relativePath), 'utf8');
  const match = source.match(/const NEW_ORDER_CHANNEL\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

/** The channel id the server sends, read out of the dispatcher's own source. */
function channelOnServer(key: string): string | null {
  const source = fs.readFileSync(
    path.join(REPO, 'apps/backend-api/src/notifications/fcmDispatcher.ts'),
    'utf8'
  );
  const match = source.match(new RegExp(`${key}:\\s*'([^']+)'`));
  return match ? match[1] : null;
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  // ----------------------------------------------------------------
  console.log('\n-- The channel ids have to match across two codebases');

  const kitchenInApp = channelInApp('apps/restaurant-mobile/src/lib/orderAlert.ts');
  const riderInApp = channelInApp('apps/delivery-mobile/src/lib/orderAlert.ts');
  const kitchenOnServer = channelOnServer('KITCHEN');
  const riderOnServer = channelOnServer('RIDER');

  check('The partner app still declares a new-order channel', !!kitchenInApp);
  check('The rider app still declares a new-order channel', !!riderInApp);

  /*
   * These two are the whole reason this file exists. They compare what the
   * server sends against what the app creates, read from the app. If either
   * side is renamed, this fails and names both strings -- which is the only
   * warning anybody gets before a kitchen stops being woken up.
   */
  check('THE KITCHEN CHANNEL MATCHES WHAT THE PARTNER APP CREATES',
    !!kitchenOnServer && kitchenOnServer === kitchenInApp,
    `server sends '${kitchenOnServer}', partner app creates '${kitchenInApp}'`);
  check('THE RIDER CHANNEL MATCHES WHAT THE RIDER APP CREATES',
    !!riderOnServer && riderOnServer === riderInApp,
    `server sends '${riderOnServer}', rider app creates '${riderInApp}'`);

  // ----------------------------------------------------------------
  console.log('\n-- Placing an order tells the kitchen, and still tells the customer');

  const customer = await login('customer@quickbite.app');
  const feed = await api('/restaurants?latitude=12.6802&longitude=77.4734', {}, customer.token);
  const restaurant = feed.json?.data?.restaurants?.[0];
  const menu = await api(`/restaurants/${restaurant.id}/menu`, {}, customer.token);
  const dish = (menu.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.isAvailable !== false);
  const addresses = await api('/addresses', {}, customer.token);
  const address = addresses.json?.data?.addresses?.[0];
  check('There is a restaurant, a dish and an address to order with',
    !!restaurant && !!dish && !!address);

  const owner = await restaurantRepository.findById(restaurant.id);
  check('and the restaurant has an owner user id to notify', !!owner?.ownerId);

  fcmDispatcher.clearHistory();

  const placed = await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: restaurant.id,
      deliveryAddressId: address.id,
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: `kitchen-push-${Date.now()}`,
      items: [{ dishId: dish.id, quantity: 1 }]
    }
  }, customer.token);

  const order = placed.json?.data?.order;
  check('The order is placed', !!order?.id,
    `status ${placed.status}: ${JSON.stringify(placed.json).slice(0, 200)}`);

  const sent = fcmDispatcher.getSentNotifications();
  const toKitchen = sent.find(n => n.data?.type === 'RESTAURANT_NEW_ORDER');
  const toCustomer = sent.find(n => n.data?.type === 'ORDER_PLACED');

  check('THE KITCHEN IS NOTIFIED WHEN AN ORDER IS PLACED', !!toKitchen,
    `dispatched: ${sent.map(n => n.data?.type).join(', ') || 'nothing'}`);

  /*
   * Addressed to the owner's USER id. Asserted against all three ids that are
   * in scope at the call site, because "it is a string that is present" passes
   * for whichever of them is wrong.
   */
  check('addressed to the owner USER id', toKitchen?.userId === owner?.ownerId,
    `sent to '${toKitchen?.userId}', owner is '${owner?.ownerId}'`);
  check('NOT to the restaurant id, which matches no device',
    toKitchen?.userId !== restaurant.id);
  check('and NOT to the customer', toKitchen?.userId !== order?.customerId);

  // Adding a channel must not have removed one. The customer's notification is
  // the thing most likely to be broken by this change and least likely to be
  // noticed by somebody testing the kitchen.
  check('The customer is still notified by the same order', !!toCustomer);
  check('and the customer notification still goes to the customer',
    toCustomer?.userId === order?.customerId);

  // ----------------------------------------------------------------
  console.log('\n-- What the kitchen is allowed to learn from a lock screen');

  /*
   * The customer's total includes our markup. A kitchen that can read it can
   * derive what we keep by subtracting its own menu prices, and a notification
   * body is readable by anyone standing near the pass.
   */
  const total = order?.bill?.totalAmount;
  const body = toKitchen?.body || '';
  check('The kitchen push does not carry the customer total',
    total === undefined || !body.includes(String(total)),
    `body was: ${body}`);
  check('but it does say how big the order is', /\d+\s+items?/.test(body), body);

  // ----------------------------------------------------------------
  console.log('\n-- Cancelling tells the kitchen too');

  // The reason code is fetched rather than guessed. The catalogue is served for
  // exactly this purpose, and a hardcoded code turns a rejected cancellation
  // into "the kitchen was not told", which is a different bug.
  const reasons = await api('/orders/cancellation-reasons', {}, customer.token);
  const reasonCode = reasons.json?.data?.reasons?.[0]?.code;
  check('There is a cancellation reason a customer may choose', !!reasonCode,
    JSON.stringify(reasons.json).slice(0, 200));

  fcmDispatcher.clearHistory();
  const cancelled = await api(`/orders/${order.id}/status`, {
    method: 'PUT',
    body: { status: 'CANCELLED', cancellationReasonCode: reasonCode }
  }, customer.token);

  const afterCancel = fcmDispatcher.getSentNotifications();
  const cancelToKitchen = afterCancel.find(n => n.data?.type === 'RESTAURANT_ORDER_CANCELLED');
  check('The kitchen is told when an order is cancelled', !!cancelToKitchen,
    `status ${cancelled.status}, dispatched: ${afterCancel.map(n => n.data?.type).join(', ') || 'nothing'}`);

  /*
   * Not written as `!cancelToKitchen || ...`. That guard makes the assertion
   * pass when no notification was sent at all, which is precisely the state it
   * is supposed to detect -- and it did pass that way on the first run of this
   * file, while the cancellation above was returning 404.
   */
  check('and that one is addressed to the owner too',
    cancelToKitchen?.userId === owner?.ownerId,
    `sent to '${cancelToKitchen?.userId}', owner is '${owner?.ownerId}'`);

  // ----------------------------------------------------------------
  console.log('\n-- A push that never answers must not hold up an order');

  /*
   * fcmTransport makes two bare fetch() calls to Google with no timeout, and
   * Node's undici defaults to five minutes before it gives up on a connection
   * that blackholes rather than refuses. Placing an order now dispatches two
   * pushes instead of one, so if delivery were awaited here, a slow Google
   * would leave a customer on a spinner for an order that HAS been placed --
   * and the obvious thing they do next is press it again.
   *
   * The file already carries that rule twelve lines above, explaining why
   * payment initiation was moved out of order placement. It applies to Google
   * exactly as it applied to Razorpay.
   *
   * So this asserts WHEN, not whether. "The push was sent" passes with an
   * unbounded timeout, because it does eventually get sent. Delivery is
   * replaced with a promise that never settles, which is what a blackholed
   * connection actually looks like -- not an error, silence.
   */
  const dispatcher = fcmDispatcher as any;
  const realDeliver = dispatcher.deliver;
  dispatcher.deliver = () => new Promise(() => {});

  try {
    const startedAt = Date.now();
    const hung = await api('/orders', {
      method: 'POST',
      body: {
        restaurantId: restaurant.id,
        deliveryAddressId: address.id,
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: `push-hang-${Date.now()}`,
        items: [{ dishId: dish.id, quantity: 1 }]
      },
      timeoutMs: 4000
    }, customer.token);
    const elapsed = Date.now() - startedAt;

    check('An order is still placed while push delivery hangs', !!hung.json?.data?.order?.id,
      `status ${hung.status}: ${JSON.stringify(hung.json).slice(0, 200)}`);
    check('AND THE CUSTOMER IS NOT LEFT WAITING ON IT', elapsed < 2000,
      `placing the order took ${elapsed}ms with delivery hung`);
  } finally {
    dispatcher.deliver = realDeliver;
  }

  // ----------------------------------------------------------------
  console.log('\n-- The in-app alarm is a separate channel and must not have moved');

  /*
   * A source assertion, and deliberately so. The owner has said twice not to
   * break the sound when a portal receives an order; the socket emit is what
   * rings a tablet that is already awake, and push is a second, independent
   * path for a phone that is closed. This does not prove the sound plays --
   * only a real device does that -- but it does fail if the emit is ever
   * removed while wiring push in beside it, which is the specific way this
   * change could break it.
   */
  const orderService = fs.readFileSync(
    path.join(REPO, 'apps/backend-api/src/modules/orders/orderService.ts'),
    'utf8'
  );
  check('emitOrderCreated still fires where the order is created',
    orderService.includes('emitOrderCreated(order.restaurantId, order)'));
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
/*
 * The exit is deferred by a tick, as the other suites here do.
 *
 * One check above leaves push delivery hung on purpose, so this process reaches
 * the end holding a promise that will never settle. Calling process.exit()
 * straight into that raced libuv's handle teardown on Windows and aborted with
 * "!(handle->flags & UV_HANDLE_CLOSING)" -- exit code 127, AFTER printing ALL
 * CHECKS PASSED.
 *
 * Which is the worst possible shape: the runner reads the exit code, so a suite
 * whose every check passed is reported as a failure, and the log says the
 * opposite of the result. Found by checking the exit code rather than the
 * output.
 */
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
