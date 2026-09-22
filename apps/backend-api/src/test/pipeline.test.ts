/**
 * End-to-end order pipeline across all four portals.
 *
 * Every earlier test exercised one layer at a time. This one drives the whole
 * journey the way the four apps do - over HTTP, with four separate logins and
 * live socket subscriptions - so a break in the hand-off between portals fails
 * here rather than on a customer's phone.
 *
 * Customer places -> restaurant sees it and accepts -> kitchen marks it ready ->
 * rider is offered it, claims it, picks it up -> customer watches it move ->
 * rider closes it with the customer's OTP.
 */
import { createApp } from '../app.ts';
import { setIncentiveSettings } from '../modules/payments/incentiveConfig.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';
import { seedDatabase } from '../db/seed.ts';
import { io as ioClient, type Socket } from 'socket.io-client';
import crypto from 'crypto';

const PORT = 5187;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(email: string, password = 'pass123') {
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

/** Resolves with the first matching socket event, or rejects on timeout. */
function waitFor(socket: Socket, event: string, timeoutMs = 6000, predicate: (p: any) => boolean = () => true) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    function handler(payload: any) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', err => reject(new Error(`socket connect failed: ${err.message}`)));
    setTimeout(() => reject(new Error('socket connect timed out')), 6000);
  });
}

async function run() {
  console.log('====================================================');
  console.log('   END-TO-END ORDER PIPELINE - ALL FOUR PORTALS     ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  initSocketServer(server);
  await new Promise(r => server.once('listening', r as any));

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');
  check('All four portals log in with their own credentials', true);

  const customerSock = await connect(customer.token);
  const partnerSock = await connect(partner.token);
  const adminSock = await connect(admin.token);
  const riderSock = await connect(rider.token);

  const RESTAURANT_ID = 'rst_bbh_01';
  partnerSock.emit('join:restaurant', { restaurantId: RESTAURANT_ID });
  adminSock.emit('join:admin');
  riderSock.emit('join:riders');
  await new Promise(r => setTimeout(r, 300));

  // --- 0. The rider goes on shift ---
  // Nothing is offered to a rider who is off shift, so the dispatch half of the
  // pipeline only exists once the toggle has actually been written down.
  const shiftOn = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);
  check('Delivery partner can go Online', shiftOn.status === 200 && shiftOn.json?.data?.rider?.isOnline === true,
    `status ${shiftOn.status} ${JSON.stringify(shiftOn.json).slice(0, 200)}`);

  const shiftReadBack = await api('/riders/me', {}, rider.token);
  check('Online status is what the server reports back, not just local state',
    shiftReadBack.json?.data?.rider?.isOnline === true,
    JSON.stringify(shiftReadBack.json?.data?.rider).slice(0, 160));
  check('Rider profile is complete enough to ride',
    shiftReadBack.json?.data?.profile?.complete === true,
    JSON.stringify(shiftReadBack.json?.data?.profile?.missing));

  // --- 1. Customer places the order; the restaurant is told without asking ---
  const orderCreated = waitFor(partnerSock, 'order:created');
  const adminSawOrder = waitFor(adminSock, 'order:created');

  const placed = await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: RESTAURANT_ID,
      deliveryAddressId: 'addr_sample_01',
      items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: crypto.randomUUID(),
      distanceKm: 3.2
    }
  }, customer.token);

  check('Customer places an order', placed.status === 201 || placed.status === 200,
    `status ${placed.status} ${JSON.stringify(placed.json).slice(0, 200)}`);
  const order = placed.json?.data?.order ?? placed.json?.data;
  const orderId = order?.id;
  if (!orderId) throw new Error('No order id returned; cannot continue.');
  const customerOtp = order?.deliveryOtp;
  check('Customer is given the doorstep OTP', typeof customerOtp === 'string' && customerOtp.length === 4,
    `got ${JSON.stringify(customerOtp)}`);

  customerSock.emit('join:order', { orderId });
  await new Promise(r => setTimeout(r, 200));

  await orderCreated;
  check('Restaurant portal is pushed the new order live', true);
  await adminSawOrder;
  check('Admin control tower sees the same order', true);

  // The restaurant's own order list must contain it too (the polling path).
  const partnerOrders = await api(`/restaurants/${RESTAURANT_ID}/orders`, {}, partner.token);
  const inList = (partnerOrders.json?.data?.orders ?? []).some((o: any) => o.id === orderId);
  check('Order appears in the restaurant order list', inList);

  // --- 2. Restaurant accepts and cooks; the customer is told ---
  let statusHeard = waitFor(customerSock, 'order:status_update', 6000, p => p.status === 'PREPARING');
  const accept = await api(`/orders/${orderId}/status`, {
    method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 }
  }, partner.token);
  check('Restaurant accepts the order and starts cooking', accept.status === 200,
    `status ${accept.status} ${JSON.stringify(accept.json).slice(0, 200)}`);
  await statusHeard;
  check('Customer app is pushed "preparing" without polling', true);

  // --- 3. Kitchen marks it ready; it reaches the rider broadcast ---
  statusHeard = waitFor(customerSock, 'order:status_update', 6000, p => p.status === 'READY_FOR_PICKUP');
  const riderOffered = waitFor(riderSock, 'order:available', 6000, p => p.orderId === orderId);
  const ready = await api(`/orders/${orderId}/status`, {
    method: 'PUT', body: { status: 'READY_FOR_PICKUP' }
  }, partner.token);
  check('Restaurant marks the order ready for pickup', ready.status === 200,
    `status ${ready.status} ${JSON.stringify(ready.json).slice(0, 200)}`);
  await statusHeard;
  check('Customer app is pushed "ready for pickup"', true);
  await riderOffered;
  check('Delivery partner is offered the pickup live, without refreshing', true);

  const broadcast = await api('/riders/orders/broadcast', {}, rider.token);
  const offered = (broadcast.json?.data?.broadcasts ?? []).some((o: any) => o.id === orderId);
  check('Order is offered to the delivery partner', offered,
    JSON.stringify(broadcast.json).slice(0, 200));

  // A rider must never be handed the customer's doorstep OTP.
  check('Delivery partner is not shown the doorstep OTP',
    !JSON.stringify(broadcast.json).includes(String(customerOtp)));

  // --- 4. Rider claims it; both the customer and the kitchen see it ---
  statusHeard = waitFor(customerSock, 'order:status_update', 6000, p => p.status === 'RIDER_ASSIGNED');
  const kitchenHeard = waitFor(partnerSock, 'order:status_update', 6000, p => p.status === 'RIDER_ASSIGNED');
  const claim = await api(`/riders/orders/${orderId}/claim`, { method: 'POST', body: {} }, rider.token);
  check('Delivery partner claims the order', claim.status === 200,
    `status ${claim.status} ${JSON.stringify(claim.json).slice(0, 200)}`);
  await statusHeard;
  check('Customer app is pushed "rider assigned"', true);
  await kitchenHeard;
  check('Restaurant screen is pushed "rider assigned" too', true);

  // --- 5. Rider picks up, quoting the code the restaurant is showing ---
  const partnerView = await api(`/orders/${orderId}`, {}, partner.token);
  const pickupCode = partnerView.json?.data?.order?.pickupCode ?? partnerView.json?.data?.pickupCode;
  check('Restaurant is shown a pickup code to hand over',
    typeof pickupCode === 'string' && pickupCode.length === 4, `got ${JSON.stringify(pickupCode)}`);

  statusHeard = waitFor(customerSock, 'order:status_update', 6000, p => p.status === 'OUT_FOR_DELIVERY');
  const pickup = await api(`/riders/orders/${orderId}/verify-pickup`, {
    method: 'POST', body: { pickupCode }
  }, rider.token);
  check('Delivery partner confirms pickup', pickup.status === 200,
    `status ${pickup.status} ${JSON.stringify(pickup.json).slice(0, 200)}`);
  await statusHeard;
  check('Customer app is pushed "out for delivery"', true);

  // --- 6. Live location reaches the customer ---
  const locationHeard = waitFor(customerSock, 'rider:location_update', 8000);
  const telemetry = await api('/riders/telemetry', {
    method: 'POST',
    body: { orderId, lat: 12.6830, lng: 77.4760, bearing: 90 }
  }, rider.token);
  check('Delivery partner reports GPS position', telemetry.status === 200,
    `status ${telemetry.status} ${JSON.stringify(telemetry.json).slice(0, 200)}`);
  const loc = await locationHeard;
  check('Customer app receives the rider position live',
    Math.abs((loc.lat ?? loc.latitude) - 12.6830) < 0.001);

  // --- 6b. Customer and rider can talk while the delivery is in flight ---
  const chatHeard = waitFor(customerSock, 'order:message', 6000);
  const sent = await api(`/orders/${orderId}/messages`, {
    method: 'POST', body: { body: 'Please leave it at the gate.' }
  }, customer.token);
  check('Customer can message the rider about the order', sent.status === 201,
    `status ${sent.status} ${JSON.stringify(sent.json).slice(0, 160)}`);
  await chatHeard;
  check('The message is pushed live to the order thread', true);

  const thread = await api(`/orders/${orderId}/messages`, {}, rider.token);
  check('Rider can read the thread', (thread.json?.data?.messages ?? []).length >= 1);

  const outsider = await login('sunita.partner@quickbite.app').catch(() => null);
  if (outsider) {
    const peek = await api(`/orders/${orderId}/messages`, {}, outsider.token);
    check('Someone outside the order cannot read its chat', peek.status === 403,
      `status ${peek.status}`);
  }

  const tracking = await api(`/orders/${orderId}/tracking`, {}, customer.token);
  check('Tracking endpoint returns the stored rider position',
    tracking.status === 200 && JSON.stringify(tracking.json).includes('12.68'),
    JSON.stringify(tracking.json).slice(0, 200));

  // --- 7. Delivery closes with the customer's OTP ---
  const wrongOtp = await api(`/riders/orders/${orderId}/verify-otp`, {
    method: 'POST', body: { deliveryOtp: customerOtp === '0000' ? '1111' : '0000' }
  }, rider.token);
  check('A wrong doorstep OTP is rejected', wrongOtp.status >= 400,
    `status ${wrongOtp.status}`);

  statusHeard = waitFor(customerSock, 'order:status_update', 6000, p => p.status === 'DELIVERED');
  const delivered = await api(`/riders/orders/${orderId}/verify-otp`, {
    method: 'POST', body: { deliveryOtp: customerOtp }
  }, rider.token);
  check('Correct doorstep OTP completes the delivery', delivered.status === 200,
    `status ${delivered.status} ${JSON.stringify(delivered.json).slice(0, 200)}`);
  await statusHeard;
  check('Customer app is pushed "delivered"', true);

  const final = await api(`/orders/${orderId}`, {}, customer.token);
  check('Order is recorded as delivered', final.json?.data?.order?.status === 'DELIVERED' || final.json?.data?.status === 'DELIVERED',
    JSON.stringify(final.json).slice(0, 200));

  // --- 7b. Profile edit and rating, after the order is complete ---
  const profile = await api('/auth/me', {
    method: 'PATCH', body: { fullName: 'Rahul S.', preferredLanguage: 'kn' }
  }, customer.token);
  check('Customer can edit their own profile', profile.status === 200 &&
    profile.json?.data?.user?.fullName === 'Rahul S.',
    `status ${profile.status} ${JSON.stringify(profile.json).slice(0, 160)}`);

  const rated = await api(`/orders/${orderId}/rating`, {
    method: 'POST', body: { rating: 5, comment: 'Hot and on time.', riderRating: 5, riderComment: 'Polite and quick.' }
  }, customer.token);
  check('Delivered order can be rated', rated.status === 200,
    `status ${rated.status} ${JSON.stringify(rated.json).slice(0, 160)}`);

  // --- 7c. The completed trip moves every number on the rider's dashboard ---
  const dashboard = await api('/riders/dashboard', {}, rider.token);
  const metrics = dashboard.json?.data?.metrics;
  check('Rider dashboard counts the completed trip',
    metrics?.todayTrips === 1 && metrics?.weekTrips === 1 && metrics?.totalTrips === 1,
    JSON.stringify(metrics).slice(0, 200));
  check('Rider dashboard credits the trip to today\'s earnings',
    typeof metrics?.todayEarnings === 'number' && metrics.todayEarnings > 0,
    JSON.stringify(metrics).slice(0, 200));
  check('Rider dashboard reports an acceptance rate',
    metrics?.acceptanceRate === 100,
    `acceptanceRate ${metrics?.acceptanceRate} of ${metrics?.offersAccepted}/${metrics?.offersReceived}`);
  check('Rider dashboard clears the active order once delivered',
    dashboard.json?.data?.activeOrder === null,
    JSON.stringify(dashboard.json?.data?.activeOrder).slice(0, 120));

  const riderRatings = await api('/riders/ratings', {}, rider.token);
  check('Rider sees the rating the customer left them',
    riderRatings.json?.data?.average === 5 && riderRatings.json?.data?.reviews?.[0]?.comment === 'Polite and quick.',
    JSON.stringify(riderRatings.json?.data).slice(0, 200));

  /*
   * Incentives are now switched OFF until an administrator turns one on.
   *
   * This check used to assert that a rider always saw the ladder, which was
   * true while five bonuses were hardcoded and unconditional — and that is
   * precisely the behaviour the owner objected to, having found a Rs 700 bonus
   * on a payout nobody approved. So the contract is inverted rather than
   * loosened: by default a rider sees NOTHING, and turning one on is what makes
   * it appear.
   *
   * Asserting both halves matters. "The list is empty" alone would also pass if
   * incentives had stopped working altogether.
   */
  const incentivesOff = await api('/riders/incentives', {}, rider.token);
  check('With no bonus switched on, a rider is shown none',
    Array.isArray(incentivesOff.json?.data?.incentives) &&
      incentivesOff.json.data.incentives.length === 0,
    JSON.stringify(incentivesOff.json?.data?.incentives || []).slice(0, 200));

  setIncentiveSettings([{ code: 'DAILY_8', enabled: true }], 'usr_admin_pipeline');
  const incentives = await api('/riders/incentives', {}, rider.token);
  check('Switching one on makes it appear, with real progress against it',
    Array.isArray(incentives.json?.data?.incentives) && incentives.json.data.incentives.length > 0 &&
      incentives.json.data.incentives.some((i: any) => i.code === 'DAILY_8' && i.progress === 1),
    JSON.stringify(incentives.json?.data?.incentives?.[0] || {}).slice(0, 200));
  setIncentiveSettings([{ code: 'DAILY_8', enabled: false }], 'usr_admin_pipeline');

  const weekly = await api('/riders/trips?range=week', {}, rider.token);
  check('Weekly trips list the delivery just completed',
    weekly.json?.data?.totals?.trips === 1 && weekly.json?.data?.byDay?.length === 7,
    JSON.stringify(weekly.json?.data?.totals).slice(0, 160));

  // --- 7d. Safety and sign-out ---
  const sos = await api('/riders/sos', {
    method: 'POST', body: { category: 'VEHICLE_BREAKDOWN', note: 'Puncture on Kanakapura Road.', lat: 12.683, lng: 77.476 }
  }, rider.token);
  check('Rider can raise an SOS', sos.status === 201 && sos.json?.data?.alert?.status === 'OPEN',
    `status ${sos.status} ${JSON.stringify(sos.json).slice(0, 160)}`);

  const signedOut = await api('/riders/logout', { method: 'POST', body: {} }, rider.token);
  const afterLogout = await api('/riders/profile/usr_rider_01', {}, rider.token);
  check('Signing out takes the rider off shift',
    signedOut.status === 200 && afterLogout.json?.data?.rider?.isOnline === false,
    JSON.stringify(afterLogout.json?.data?.rider?.isOnline));

  const twice = await api(`/orders/${orderId}/rating`, {
    method: 'POST', body: { rating: 1 }
  }, customer.token);
  check('The same order cannot be rated twice', twice.status === 409, `status ${twice.status}`);

  const closedChat = await api(`/orders/${orderId}/messages`, {
    method: 'POST', body: { body: 'hello?' }
  }, customer.token);
  check('Chat closes once the order is delivered', closedChat.status === 409, `status ${closedChat.status}`);

  // --- 8. A menu change reaches a customer who is browsing that restaurant ---
  const browsingSock = await connect(customer.token);
  browsingSock.emit('join:menu', { restaurantId: RESTAURANT_ID });
  await new Promise(r => setTimeout(r, 300));

  // A customer in the menu room must not be able to see the kitchen's orders.
  let leaked = false;
  browsingSock.on('order:created', () => { leaked = true; });

  const menuHeard = waitFor(browsingSock, 'menu:updated', 6000);
  const soldOut = await api(`/restaurants/${RESTAURANT_ID}/menu/toggle-stock`, {
    method: 'POST', body: { dishId: 'dish_ck_biryani', isAvailable: false }
  }, partner.token);
  check('Restaurant marks a dish sold out', soldOut.status === 200,
    `status ${soldOut.status} ${JSON.stringify(soldOut.json).slice(0, 200)}`);
  await menuHeard;
  check('Customer browsing the restaurant is pushed the menu change', true);

  // Place another order so something would be emitted to the kitchen's room.
  await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: RESTAURANT_ID,
      deliveryAddressId: 'addr_sample_01',
      items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: crypto.randomUUID(),
      distanceKm: 3.2
    }
  }, customer.token);
  await new Promise(r => setTimeout(r, 500));
  check('Customers in the menu room are not shown other people\'s orders', !leaked);

  browsingSock.close();
  // --- A rider cannot collect food the kitchen has not finished -------------
  //
  // Reported by the owner: the customer was told their order was out for
  // delivery as soon as a rider accepted it.
  //
  // The main flow above cannot catch this, because there the kitchen marks the
  // food ready BEFORE a rider claims. But the rider broadcast offers orders
  // that are merely ACCEPTED or PREPARING - deliberately, so a rider can set
  // off towards the restaurant while the food cooks - so claiming before ready
  // is a real and ordinary sequence, and it is the one that was broken.
  //
  // `verifyPickup` checked the rider's code and nothing else. The status could
  // not be consulted either: claiming overwrites `status` with RIDER_ASSIGNED,
  // so by the time the rider reaches the counter nothing remains to say whether
  // the kitchen ever finished. `readyAt` is stamped when the food is marked
  // ready and never cleared, which is what makes this answerable.
  console.log('\n-- Collecting before the food is ready');

  // An earlier step in this suite marks this dish out of stock to prove the
  // stock check works. Put it back, or the order below is refused for a
  // reason that has nothing to do with what is being tested here.
  await api(`/restaurants/${RESTAURANT_ID}/menu/toggle-stock`, {
    method: 'POST', body: { dishId: 'dish_ck_biryani', isAvailable: true }
  }, partner.token);

  const early = await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: RESTAURANT_ID,
      deliveryAddressId: 'addr_sample_01',
      items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: crypto.randomUUID()
    }
  }, customer.token);
  const earlyId = early.json?.data?.order?.id;
  check('A second order is placed', early.status === 201,
    `status ${early.status} ${JSON.stringify(early.json?.error || early.json || {}).slice(0, 200)}`);

  // Back on shift. An earlier step in this suite takes the rider off, and a
  // rider who is off shift is refused with RIDER_OFFLINE long before any of
  // the pickup logic below is reached.
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);

  await api(`/orders/${earlyId}/status`, {
    method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 }
  }, partner.token);

  // Claimed while still cooking, which the broadcast explicitly allows.
  const earlyClaim = await api(`/riders/orders/${earlyId}/claim`, { method: 'POST', body: {} }, rider.token);
  check('A rider can claim an order that is still cooking', earlyClaim.status === 200,
    // The code, not just the status: three different guards return 409 here
    // and "status 409" alone does not say which one refused.
    `status ${earlyClaim.status} ${JSON.stringify(earlyClaim.json?.error || {}).slice(0, 160)}`);

  const earlyView = await api(`/orders/${earlyId}`, {}, partner.token);
  const earlyCode = earlyView.json?.data?.order?.pickupCode;
  check('and the restaurant has a pickup code for it', typeof earlyCode === 'string');

  const tooEarly = await api(`/riders/orders/${earlyId}/verify-pickup`, {
    method: 'POST', body: { pickupCode: earlyCode }
  }, rider.token);
  /*
   * Asserting the REASON, not just the status.
   *
   * A missing `pickupCode` also returns 400, and an earlier version of this
   * check passed on precisely that - the setup was broken, the request never
   * reached the guard, and the suite reported the guard as working. Status
   * alone cannot tell a refusal from a different refusal.
   */
  const tooEarlyBody = JSON.stringify(tooEarly.json || {});
  check(
    'but collecting it is REFUSED while the kitchen is still cooking',
    tooEarly.status === 400 && /still being prepared|not marked it ready/i.test(tooEarlyBody),
    `status ${tooEarly.status} ${tooEarlyBody.slice(0, 160)}`
  );

  const notMoved = await api(`/orders/${earlyId}`, {}, partner.token);
  check(
    'so the customer is never told it is on the way',
    notMoved.json?.data?.order?.status !== 'OUT_FOR_DELIVERY',
    notMoved.json?.data?.order?.status
  );

  // The kitchen finishes. The same code now works, unchanged.
  await api(`/orders/${earlyId}/status`, {
    method: 'PUT', body: { status: 'READY_FOR_PICKUP' }
  }, partner.token);

  const nowAllowed = await api(`/riders/orders/${earlyId}/verify-pickup`, {
    method: 'POST', body: { pickupCode: earlyCode }
  }, rider.token);
  check(
    'and once the food is ready the SAME code is accepted',
    nowAllowed.status === 200,
    `status ${nowAllowed.status} ${JSON.stringify(nowAllowed.json).slice(0, 160)}`
  );

  // --- Connected calling, without either party learning a number ------------
  //
  // A phone call has to be carried by a licensed operator, so masked calling
  // cannot be proven end to end here — that needs an Exotel account and a
  // per-minute bill. What IS proven is everything that decides whether it is
  // safe: who may open a line, when, and that no real number comes back.
  //
  // The authorisation is the whole risk. An unguarded version of this endpoint
  // dials any customer on the platform for anybody who can guess an order id,
  // from our own rented number.
  console.log('\n-- Connected calling');

  const callAsStranger = await api(`/orders/${orderId}/call`, { method: 'POST', body: {} }, partner.token);
  check(
    'The restaurant cannot open a line to the customer, though the order is theirs',
    callAsStranger.status === 403,
    `status ${callAsStranger.status}`
  );

  // orderId was DELIVERED earlier in this suite.
  const callAfterDelivery = await api(`/orders/${orderId}/call`, { method: 'POST', body: {} }, rider.token);
  check(
    'and the rider who delivered it cannot ring that address afterwards',
    callAfterDelivery.status === 409,
    `status ${callAfterDelivery.status} ${JSON.stringify(callAfterDelivery.json?.error || {}).slice(0, 120)}`
  );

  /*
   * With no operator configured the endpoint REFUSES rather than pretending.
   * Faking a masked call would be worse than not having one: the direct number
   * is still on the screen and everybody believes it is hidden. The apps read
   * this code and fall back to the number they are already allowed to show for
   * the life of the trip.
   */
  const callLive = await api(`/orders/${earlyId}/call`, { method: 'POST', body: {} }, rider.token);
  check(
    'On a live order it reaches the masking layer rather than an authorisation error',
    callLive.status === 503,
    `status ${callLive.status} ${JSON.stringify(callLive.json?.error || {}).slice(0, 120)}`
  );
  check(
    'and says plainly that connected calling is not switched on',
    String(callLive.json?.error?.code) === 'CALL_MASKING_NOT_CONFIGURED',
    callLive.json?.error?.code
  );
  check(
    'and no phone number appears anywhere in the response',
    !/\b[6-9]\d{9}\b/.test(JSON.stringify(callLive.json || {})),
    JSON.stringify(callLive.json || {}).slice(0, 160)
  );

  // --- The same order must never reach a kitchen twice --------------------
  //
  // Reported by the owner: the restaurant received the same order twice, with
  // different ids and different OTPs. Different ids means two DIFFERENT
  // idempotency keys were sent — the server's duplicate check had nothing to
  // match on and was working exactly as designed.
  //
  // The customer app was minting a fresh key inside the submit handler, and
  // its only re-entry guard was React state, which updates asynchronously. A
  // second tap, or a retry after a timeout, produced a second key.
  //
  // The app now holds one key per checkout and reuses it on retry. These
  // checks prove the guarantee the app is relying on.
  console.log('\n-- Placing the same order twice');

  const sameKey = crypto.randomUUID();
  const orderBody = {
    restaurantId: RESTAURANT_ID,
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: sameKey
  };

  const firstSend = await api('/orders', { method: 'POST', body: orderBody }, customer.token);
  check('The order is placed', firstSend.status === 201, `status ${firstSend.status}`);

  // Exactly what a double tap or a retry after a timeout sends.
  const secondSend = await api('/orders', { method: 'POST', body: orderBody }, customer.token);
  check(
    'Sending it again with the same key does not create a second order',
    secondSend.json?.data?.order?.id === firstSend.json?.data?.order?.id,
    `${firstSend.json?.data?.order?.id} vs ${secondSend.json?.data?.order?.id}`
  );
  check(
    'and the delivery OTP is the same one, not a second code',
    secondSend.json?.data?.order?.deliveryOtp === firstSend.json?.data?.order?.deliveryOtp ||
      !secondSend.json?.data?.order?.deliveryOtp,
    'OTPs differ between the two responses'
  );

  const kitchenList = await api(`/restaurants/${RESTAURANT_ID}/orders`, {}, partner.token);
  const matching = (kitchenList.json?.data?.orders || []).filter(
    (o: any) => o.id === firstSend.json?.data?.order?.id
  );
  check('and the kitchen sees it exactly once', matching.length === 1, `${matching.length} copies`);

  /*
   * A DIFFERENT key must still create a different order. Without this the
   * check above would also pass against a server that had stopped accepting
   * orders altogether.
   */
  const genuinelyNew = await api(
    '/orders',
    { method: 'POST', body: { ...orderBody, idempotencyKey: crypto.randomUUID() } },
    customer.token
  );
  check(
    'but a genuinely new order is still accepted',
    genuinelyNew.status === 201 &&
      genuinelyNew.json?.data?.order?.id !== firstSend.json?.data?.order?.id,
    `status ${genuinelyNew.status}`
  );

  customerSock.close(); partnerSock.close(); adminSock.close(); riderSock.close();
  closeSocketServer();
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('   PIPELINE COMPLETE - ALL PORTALS INTERCONNECTED   ');
    console.log('====================================================\n');
    process.exit(0);
  }
  console.log(`   PIPELINE BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Pipeline aborted:', err.message);
  process.exit(1);
});
