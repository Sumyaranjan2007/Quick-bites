/**
 * The owner's QA pass on v8 (26 Sep), server half: #4 #5 #6 #7 #8.
 *
 *   #5  A kitchen sees only its own prices — order card, history, dashboard,
 *       Statement — never the customer's marked-up bill.
 *   #6  The live new-order alert to a kitchen carries neither the doorstep code
 *       nor the customer's bill.
 *   #7  The partner Payouts tab reads the same figure as the Statement.
 *   #8  Search is filled at start-up and kept current as the catalogue changes.
 *   #4  A customer who signed up by phone code can delete their account.
 *
 * Every check drives the route an installed app calls, and every refusal has a
 * control that must still succeed. The markup is real (20%) and so is the hold
 * period (7 days): a zero markup would make "the kitchen's price" and "the
 * customer's price" the same number and prove nothing.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { setCharges } from '../modules/payments/restaurantCharges.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { syncService } from '../modules/search/syncService.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { otpService } from '../modules/auth/otpService.ts';
import { initSocketServer, closeSocketServer, emitOrderCreated } from '../sockets/socketServer.ts';

const PORT = 5287;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const DISH_PRICE = 320;
const MARKUP = 20;
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  OWN PRICES, LIVE ALERT, OWED FIGURE, SEARCH, DELETE');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 600)}`);
  }
}

async function api(pathname: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await sleep(400);
initSocketServer(server);

(fcmDispatcher as any).sendPushNotification = async (payload: any) => ({ ...payload, sentAt: new Date().toISOString() });

try {
  resetLedgerForTesting();
  resetConfigsForTesting();
  createVersion(
    { partnerHoldDays: 7, riderHoldDays: 7, minPayoutAmount: 1, codCashCeiling: 100000 },
    { userId: 'usr_admin_01' },
    'QA fixes: a real hold period'
  );
  setCharges(RESTAURANT_ID, { foodMarkupPercent: MARKUP }, 'usr_admin_01', 'QA fixes: a real markup');

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  // Minted, as the socket suites do: the seeded administrator's password is
  // not something a suite should depend on.
  const admin = { token: jwt.sign({ sub: 'usr_admin_01', role: 'super_admin' }, config.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' }) };

  const placed = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 2, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
        distanceKm: 3.2
      }
    },
    customer.token
  );
  const order = placed.json?.data?.order ?? placed.json?.data;
  assert.ok(order?.id, `could not place an order: ${JSON.stringify(placed.json).slice(0, 300)}`);
  const stored: any = memoryStore.orders.get(order.id);
  const partnerFood = DISH_PRICE * 2;
  const partnerPackaging = Number(stored.bill.partnerPackagingFee ?? stored.bill.packagingFee) || 0;

  // -------------------------------------------------------------------
  console.log('\n-- #5: the kitchen sees its own prices');

  it('Control: the markup is real — the customer pays more than the kitchen charges', () => {
    assert.ok(stored.items[0].unitPrice > DISH_PRICE, `customer unit ${stored.items[0].unitPrice}`);
    assert.ok(stored.bill.itemsTotal > partnerFood, `customer items ${stored.bill.itemsTotal}`);
  });

  const live = await api(`/restaurants/${RESTAURANT_ID}/orders`, {}, partner.token);
  const card = (live.json?.data?.orders || []).find((o: any) => o.id === order.id);

  it('The kitchen order card shows the kitchen price per line, not the customer price', () => {
    assert.ok(card, 'order missing from the kitchen queue');
    assert.equal(card.items[0].unitPrice, DISH_PRICE);
    assert.equal(card.items[0].totalPrice, partnerFood);
    assert.equal('partnerUnitPrice' in card.items[0], false);
  });

  it('The card total is the kitchen food plus its packaging, not the customer bill', () => {
    assert.equal(card.bill.totalAmount, round2(partnerFood + partnerPackaging));
    assert.notEqual(card.bill.totalAmount, stored.bill.totalAmount);
    assert.equal(card.bill.itemsTotal, partnerFood);
  });

  it('Nothing on the kitchen bill reveals the customer side', () => {
    for (const key of ['deliveryFee', 'platformFee', 'gstAmount', 'couponDiscount', 'tipAmount', 'partnerItemsTotal', 'partnerPackagingFee']) {
      assert.equal(key in card.bill, false, `kitchen bill carries ${key}`);
    }
    const text = JSON.stringify(card);
    assert.equal(text.includes(String(stored.bill.totalAmount)), false, 'customer total appears in the card');
  });

  it('The kitchen still gets its own earnings figure and the pickup code', () => {
    assert.equal(card.bill.restaurantNetPayout, stored.bill.restaurantNetPayout);
    assert.ok(card.pickupCode, 'pickup code missing');
    assert.equal('deliveryOtp' in card, false);
  });

  const asCustomer = await api(`/orders/${order.id}`, {}, customer.token);
  it('Control: the customer still sees the price they pay', () => {
    const o = asCustomer.json?.data?.order;
    assert.equal(o.items[0].unitPrice, stored.items[0].unitPrice);
    assert.equal(o.bill.totalAmount, stored.bill.totalAmount);
  });

  const asKitchenById = await api(`/orders/${order.id}`, {}, partner.token);
  it('The order detail route gives the kitchen the same own-price view', () => {
    const o = asKitchenById.json?.data?.order;
    assert.equal(o.items[0].unitPrice, DISH_PRICE);
    assert.equal(o.bill.totalAmount, round2(partnerFood + partnerPackaging));
  });

  // -------------------------------------------------------------------
  console.log('\n-- #6: the live new-order alert');

  const { io: ioClient } = await import('socket.io-client');
  const socketFor = (token: string) =>
    ioClient(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], auth: { token }, reconnection: false });
  const heard = (sock: any) =>
    new Promise<any>(resolve => {
      const t = setTimeout(() => resolve(null), 1500);
      sock.once('order:created', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });

  const kitchenSock = socketFor(partner.token);
  const towerSock = socketFor(admin.token);
  await sleep(400);
  kitchenSock.emit('join:restaurant', { restaurantId: RESTAURANT_ID });
  towerSock.emit('join:admin');
  await sleep(400);
  const kitchenHeard = heard(kitchenSock);
  const towerHeard = heard(towerSock);
  emitOrderCreated(RESTAURANT_ID, stored);
  const kitchenPayload = await kitchenHeard;
  const towerPayload = await towerHeard;

  it('The kitchen hears the new order', () => {
    assert.ok(kitchenPayload?.order?.id, 'no order:created reached the kitchen');
  });
  it('...without the customer doorstep code', () => {
    assert.ok(stored.deliveryOtp, 'fixture: the stored order has a doorstep code');
    assert.equal('deliveryOtp' in kitchenPayload.order, false);
    assert.equal(JSON.stringify(kitchenPayload).includes(`"${stored.deliveryOtp}"`), false);
  });
  it('...and without the customer bill', () => {
    assert.equal(kitchenPayload.order.bill.totalAmount, round2(partnerFood + partnerPackaging));
    assert.equal('deliveryFee' in kitchenPayload.order.bill, false);
  });
  it('Control: the control tower still gets the whole order', () => {
    assert.ok(towerPayload, `tower heard nothing; admin token ${Boolean(admin.token)}`);
    assert.equal(towerPayload?.order?.deliveryOtp, stored.deliveryOtp);
    assert.equal(towerPayload?.order?.bill?.totalAmount, stored.bill.totalAmount);
  });
  kitchenSock.close();
  towerSock.close();

  // -------------------------------------------------------------------
  console.log('\n-- #7: one owed figure for a kitchen');

  // Delivered ten days ago (outside the 7-day hold) and one delivered now
  // (inside it), so both buckets are exercised.
  const deliver = (o: any, daysAgo: number) => {
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    o.status = 'DELIVERED';
    o.deliveredAt = at;
    o.updatedAt = at;
    o.pickedUpAt = new Date(Date.parse(at) - 20 * 60_000).toISOString();
    memoryStore.orders.set(o.id, o);
    recordOrderEarnings(o, { byUserId: 'usr_admin_01', note: 'QA fixture' });
  };
  deliver(stored, 10);

  const second = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
        distanceKm: 3.2
      }
    },
    customer.token
  );
  const secondOrder: any = memoryStore.orders.get((second.json?.data?.order ?? second.json?.data).id);
  deliver(secondOrder, 0);

  const statement = (await api('/earnings/statement', {}, partner.token)).json?.data?.statement;
  const settlements = (await api(`/restaurants/${RESTAURANT_ID}/settlements`, {}, partner.token)).json?.data;

  it('The Payouts tab owes exactly what the Statement owes', () => {
    assert.ok(statement?.summary, 'no statement');
    assert.ok(settlements?.summary, 'no settlements');
    assert.equal(settlements.summary.netPending, statement.summary.outstanding);
  });
  it('...split into payable now and on hold, which add up', () => {
    assert.ok(settlements.summary.payableNow > 0, 'the old order should be payable');
    assert.ok(settlements.summary.onHold > 0, 'the new order should be on hold');
    assert.equal(round2(settlements.summary.payableNow + settlements.summary.onHold), settlements.summary.netPending);
  });
  it('The Payouts lines use the kitchen prices, and each line nets to the ledger', () => {
    const line = settlements.pendingOrders.find((l: any) => l.orderId === stored.id);
    assert.ok(line, 'order missing from pending');
    assert.equal(line.grossSales, round2(partnerFood + partnerPackaging));
    assert.equal(round2(line.grossSales - line.commission - line.tds), line.net);
  });
  it('The Statement shows the kitchen food total, and every order is fully explained', () => {
    const o = statement.orders.find((x: any) => x.orderId === stored.id);
    const food = o.lines.find((l: any) => l.label === 'Food total');
    assert.equal(food.amount, partnerFood);
    for (const row of statement.orders) assert.equal(row.unexplained, 0, `order ${row.orderNumber} unexplained`);
  });

  const dashboard = (await api(`/restaurants/${RESTAURANT_ID}/dashboard`, {}, partner.token)).json?.data?.dashboard;
  it('The partner dashboard reports kitchen-price sales, not the customer bill', () => {
    const expected = round2(partnerFood + partnerPackaging + DISH_PRICE + partnerPackaging);
    assert.equal(dashboard.revenue.grossSales, expected);
    const dish = dashboard.topDishes?.find?.((d: any) => d.dishId === DISH) ?? null;
    if (dish) assert.equal(dish.revenue, DISH_PRICE * 3);
  });

  const history = (await api(`/restaurants/${RESTAURANT_ID}/orders/history?scope=completed`, {}, partner.token)).json?.data?.orders;
  it('Order history shows the kitchen total', () => {
    const row = history.find((o: any) => o.id === stored.id);
    assert.equal(row.bill.totalAmount, round2(partnerFood + partnerPackaging));
  });

  // -------------------------------------------------------------------
  console.log('\n-- #8: search is filled and kept current');

  await syncService.startIndexing();

  const byRestaurant = (await api('/search?q=Bangalore%20Biryani')).json?.data;
  it('A restaurant is found by its name', () => {
    assert.ok(byRestaurant.restaurants.some((r: any) => r.id === RESTAURANT_ID), JSON.stringify(byRestaurant).slice(0, 300));
  });
  const byCuisine = (await api('/search?q=Mughlai')).json?.data;
  it('A restaurant is found by its cuisine', () => {
    assert.ok(byCuisine.restaurants.some((r: any) => r.id === RESTAURANT_ID));
  });
  const byDish = (await api('/search?q=Dum%20Biryani')).json?.data;
  const dishHit = byDish.dishes.find((d: any) => d.id === DISH);
  it('A dish is found, at the customer price the menu shows', () => {
    assert.ok(dishHit, 'dish not found');
    const menu = (memoryStore.menus.get(RESTAURANT_ID) as any);
    assert.ok(menu, 'menu');
    assert.equal(dishHit.price, Math.round(DISH_PRICE * (1 + MARKUP / 100)));
  });
  const suggestions = (await api('/search/suggestions?q=biry')).json?.data?.suggestions || [];
  it('Suggestions are offered', () => {
    assert.ok(suggestions.length > 0, 'no suggestions');
  });

  // A new dish arrives by the path an approval takes: the menu is written.
  const menu: any = memoryStore.menus.get(RESTAURANT_ID);
  const fresh = { ...menu.categories[0].items[0], id: 'dish_qa_fresh', name: 'Zafrani Qorma Special', price: 400 };
  menu.categories[0].items.push(fresh);
  memoryStore.menus.set(RESTAURANT_ID, menu);
  await sleep(2500);
  const afterAdd = (await api('/search?q=Zafrani')).json?.data;
  it('A dish added to a menu is searchable without anyone re-syncing by hand', () => {
    assert.ok(afterAdd.dishes.some((d: any) => d.id === 'dish_qa_fresh'), JSON.stringify(afterAdd).slice(0, 300));
  });
  // Suggestions and cuisines come from the index alone — no menu walk behind
  // them — so these fail if the index was not rebuilt. The dish search above
  // can be answered by the fallback and would pass either way.
  const suggestAfterAdd = (await api('/search/suggestions?q=zafrani')).json?.data?.suggestions || [];
  it('...and suggested, which only a rebuilt index can do', () => {
    assert.ok(suggestAfterAdd.some((s: any) => s.text === 'Zafrani Qorma Special'), JSON.stringify(suggestAfterAdd));
  });
  const kitchen: any = memoryStore.restaurants.get(RESTAURANT_ID);
  memoryStore.restaurants.set(RESTAURANT_ID, { ...kitchen, cuisineTags: [...(kitchen.cuisineTags || []), 'Awadhi'] });
  await sleep(2500);
  const byNewCuisine = (await api('/search?q=Awadhi')).json?.data;
  it('A cuisine an approval adds to a restaurant is searchable at once', () => {
    assert.ok(byNewCuisine.restaurants.some((r: any) => r.id === RESTAURANT_ID), JSON.stringify(byNewCuisine).slice(0, 300));
  });

  // Sold out: gone at once, even before the rebuild.
  fresh.isAvailable = false;
  const soldOut = (await api('/search?q=Zafrani%20Qorma&limit=21')).json?.data;
  it('A dish that sells out leaves search immediately', () => {
    assert.equal(soldOut.dishes.some((d: any) => d.id === 'dish_qa_fresh'), false);
  });

  const restaurant: any = memoryStore.restaurants.get(RESTAURANT_ID);
  restaurant.status = 'SUSPENDED';
  const suspended = (await api('/search?q=Mughlai&limit=22')).json?.data;
  it('A suspended restaurant leaves search immediately', () => {
    assert.equal(suspended.restaurants.some((r: any) => r.id === RESTAURANT_ID), false);
  });
  restaurant.status = 'ACTIVE';
  syncService.stopIndexing();

  // -------------------------------------------------------------------
  console.log('\n-- #4: a phone-code customer can delete their account');

  resetAuthRateLimit();
  const phone = '9813' + String(Math.floor(100000 + Math.random() * 899999));
  otpService.forget(phone);
  await api('/auth/otp/request', { method: 'POST', body: { phone } });
  const signedUp = await api('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code: process.env.OTP_FIXED_CODE || '123456', fullName: 'Phone Only' }
  });
  const phoneToken = signedUp.json?.data?.token as string;
  const phoneUserId = signedUp.json?.data?.user?.id as string;

  it('The app is told this account has no password', () => {
    assert.equal(signedUp.json?.data?.user?.hasPassword, false);
  });

  const withPassword = await api('/auth/me', { method: 'DELETE', body: { password: 'anything' } }, phoneToken);
  it('A password cannot delete a password-less account, and the reason says to use a code', () => {
    assert.equal(withPassword.status, 401);
    assert.match(JSON.stringify(withPassword.json), /code/i);
  });

  otpService.forget(phone);
  await api('/auth/otp/request', { method: 'POST', body: { phone } });
  const wrongCode = await api('/auth/me', { method: 'DELETE', body: { code: '000000' } }, phoneToken);
  it('A wrong code deletes nothing', () => {
    assert.equal(wrongCode.status, 401);
    assert.ok(memoryStore.users.get(phoneUserId), 'the account was deleted on a wrong code');
  });

  otpService.forget(phone);
  await api('/auth/otp/request', { method: 'POST', body: { phone } });
  const rightCode = await api(
    '/auth/me',
    { method: 'DELETE', body: { code: process.env.OTP_FIXED_CODE || '123456' } },
    phoneToken
  );
  it('The code sent to their phone deletes the account', () => {
    assert.equal(rightCode.status, 200, JSON.stringify(rightCode.json).slice(0, 300));
    assert.equal(rightCode.json?.data?.deleted, true);
  });

  const neither = await api('/auth/me', { method: 'DELETE', body: {} }, customer.token);
  it('Neither a password nor a code is refused before anything happens', () => {
    assert.equal(neither.status, 400);
  });

  // Control: an email-and-password account still deletes with its password.
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email: `qa${Date.now()}@example.com`, password: 'LongEnough1!', fullName: 'Has Password', phone: '9' + String(Date.now()).slice(-9) }
  });
  const regToken = reg.json?.data?.token as string;
  const regDelete = await api('/auth/me', { method: 'DELETE', body: { password: 'LongEnough1!' } }, regToken);
  it('Control: a password account still deletes with its password', () => {
    assert.ok(regToken, `register failed: ${JSON.stringify(reg.json).slice(0, 300)}`);
    assert.equal(regDelete.status, 200, JSON.stringify(regDelete.json).slice(0, 300));
  });
} finally {
  closeSocketServer?.();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
