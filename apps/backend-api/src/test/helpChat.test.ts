/**
 * Help chat (master plan B8, owner decision Q3, 18 Oct 2026).
 *
 * What must hold:
 *  - each app gets its own topics: partner and rider never see customer topics,
 *    and a topic from another app cannot be asked;
 *  - answers are fixed sentences filled with the asker's LIVE data (order
 *    status and arrival, refund state, money owed, cash carried);
 *  - a person only ever hears about their own orders: customer by account,
 *    rider by their rider record, partner by the kitchens they own; a
 *    customer-app session of a partner is a customer and nothing more;
 *  - "Talk to us" makes exactly one ticket, with the order and the answers the
 *    SERVER gave (rebuilt, never copied from the app); tickets are limited per
 *    person per hour;
 *  - a staff reply is pushed to the person; their own reply never looks like
 *    staff work, and reopens a solved ticket from any app.
 */
import assert from 'node:assert/strict';
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { refundRepository } from '../db/repositories/refundRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { recordOrderEarnings } from '../modules/payments/earnings.ts';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

(config as any).OTP_PROVIDER = 'fixed';
await seedDatabase();
const server = http.createServer(createApp());
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${(server.address() as any).port}/api`;
const pushes: any[] = [];
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  pushes.push(p);
  return { ...p, sentAt: new Date().toISOString() };
};

async function api(pathname: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
async function login(email: string) {
  resetAuthRateLimit();
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}

const HOME = { latitude: 12.70, longitude: 77.48 };
let seq = 0;
function putOrder(overrides: Record<string, any>) {
  seq++;
  const order = {
    id: `ord_help_${seq}`,
    orderNumber: `QB-HELP-${seq}`,
    customerId: 'usr_customer_01',
    customerName: 'Test Customer',
    restaurantId: 'rst_bbh_01',
    restaurantName: 'Bangalore Biryani House',
    status: 'PREPARING',
    items: [],
    bill: { totalAmount: 300 },
    paymentMethod: 'RAZORPAY_SANDBOX',
    paymentStatus: 'PAID',
    deliveryCoordinates: HOME,
    restaurantCoordinates: { latitude: 12.6802, longitude: 77.4734 },
    distanceKm: 3,
    createdAt: new Date(Date.now() - seq * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  memoryStore.orders.set(order.id, order);
  return order;
}
const ticket = (token: string, body: Record<string, any>) =>
  api('/support/tickets', { method: 'POST', body: { subject: 'Help chat', category: 'ORDER', ...body } }, token);

try {
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');
  const admin = await login('support@quickbite.app');
  const topicIds = (r: any) => (r.json?.data?.topics || []).map((t: any) => t.id);

  console.log('\n-- Each app has its own topics');
  const cMenu = await api('/support/help', {}, customer);
  it('Customer menu: late, missing, refund, payment, address, cancel, account, other', () =>
    assert.deepEqual(topicIds(cMenu), ['ORDER_LATE', 'ITEM_MISSING', 'REFUND_STATUS', 'PAYMENT', 'CHANGE_ADDRESS', 'CANCEL', 'ACCOUNT', 'OTHER']));
  it('...greets the person by first name', () => assert.match(String(cMenu.json?.data?.greeting), /^Hi \S+, what's this about\?$/));
  const pMenu = await api('/support/help', {}, partner);
  it('Partner menu has payouts, menu changes, orders, documents and no customer topic', () => {
    assert.deepEqual(topicIds(pMenu), ['PAYOUTS', 'MENU_CHANGES', 'ORDERS', 'DOCUMENTS', 'ACCOUNT', 'OTHER']);
  });
  const rMenu = await api('/support/help', {}, rider);
  it('Rider menu has payouts, cash deposit, trip, documents and no customer topic', () =>
    assert.deepEqual(topicIds(rMenu), ['PAYOUTS', 'CASH_DEPOSIT', 'TRIP_ISSUE', 'DOCUMENTS', 'ACCOUNT', 'OTHER']));
  it('Every topic carries the ticket category the app sends with "Talk to us"', () =>
    assert.ok([...cMenu.json.data.topics, ...pMenu.json.data.topics, ...rMenu.json.data.topics].every((t: any) =>
      ['ORDER', 'PAYMENT', 'DELIVERY', 'ACCOUNT', 'RESTAURANT', 'OTHER'].includes(t.category) && t.label)));
  const crossed = await api('/support/help/PAYOUTS', {}, customer);
  it('A customer cannot ask a partner/rider topic', () => assert.equal(crossed.json?.error?.code, 'TOPIC_NOT_FOUND', `status ${crossed.status}`));
  const crossed2 = await api('/support/help/REFUND_STATUS', {}, rider);
  it('...nor a rider a customer topic', () => assert.equal(crossed2.status, 404));
  const anon = await api('/support/help');
  it('Signed-out callers are refused', () => assert.equal(anon.status, 401));

  console.log('\n-- Answers from live data');
  const enRoute = putOrder({
    status: 'OUT_FOR_DELIVERY', riderId: 'rdr_vikram_01', riderName: 'Vikram Singh',
    riderCoordinates: { latitude: HOME.latitude - 0.0108, longitude: HOME.longitude } // ~1.2 km south
  });
  const late = await api(`/support/help/ORDER_LATE?orderId=${enRoute.id}`, {}, customer);
  it('"My order is late" names the order and its live status', () => {
    assert.equal(late.status, 200, JSON.stringify(late.json).slice(0, 200));
    assert.match(late.json.data.answer, new RegExp(`${enRoute.orderNumber}.*out for delivery`));
  });
  it('...with how far the rider is and the arrival time', () =>
    assert.match(late.json.data.answer, /rider is 1\.\d km away, arriving in about \d+ min/));
  it('...and the context card for the order', () =>
    assert.deepEqual(late.json.data.order, { id: enRoute.id, orderNumber: enRoute.orderNumber, status: 'OUT_FOR_DELIVERY', restaurantName: 'Bangalore Biryani House' }));
  const again = await api(`/support/help/ORDER_LATE?orderId=${enRoute.id}`, {}, customer);
  it('Fixed answers: the same data gives the same words', () => assert.equal(again.json.data.answer, late.json.data.answer));
  const latest = await api('/support/help/ORDER_LATE', {}, customer);
  it('Without an order id the latest live order is used', () => assert.equal(latest.json?.data?.order?.id, enRoute.id));

  const onTheWay = await api(`/support/help/CANCEL?orderId=${enRoute.id}`, {}, customer);
  it('"Cancel" on food already with the rider says it cannot be cancelled in the app', () =>
    assert.match(onTheWay.json.data.answer, /can no longer be cancelled in the app/));
  const cooking = putOrder({ status: 'PREPARING' });
  const cancelCooking = await api(`/support/help/CANCEL?orderId=${cooking.id}`, {}, customer);
  it('"Cancel" while cooking: not in the app any more, a person helps (owner, 21 Oct)', () =>
    assert.match(cancelCooking.json.data.answer, /already cooking .*can no longer be cancelled in the app.*Talk to a person/s));

  const delivered = putOrder({ status: 'DELIVERED', deliveredAt: new Date().toISOString() });
  const refund = await refundRepository.create({
    orderId: delivered.id, orderNumber: delivered.orderNumber, raisedByUserId: 'usr_customer_01', raisedByRole: 'customer',
    raisedByName: 'Test Customer', customerId: 'usr_customer_01', restaurantId: 'rst_bbh_01', reasonCode: 'ITEM_MISSING',
    description: 'The raita was missing', attachments: [], requestedAmount: 40, orderTotal: 300
  } as any);
  const rs = await api(`/support/help/REFUND_STATUS?orderId=${delivered.id}`, {}, customer);
  it('"Refund status" reads the live case: received, waiting for review', () =>
    assert.match(rs.json.data.answer, new RegExp(`${delivered.orderNumber}.*₹40.*received`)));
  const stored: any = memoryStore.refundRequests.get(refund.id);
  stored.status = 'REFUNDED';
  stored.approvedAmount = 40;
  stored.resolvedAt = new Date().toISOString();
  const rs2 = await api(`/support/help/REFUND_STATUS?orderId=${delivered.id}`, {}, customer);
  it('...and follows it to "sent back", with how long the bank takes', () =>
    assert.match(rs2.json.data.answer, /₹40\.00 was sent back.*UPI usually arrives within a day/s));
  // R2-7: a rejection reaches the customer; reopening a rejected case needs a note.
  const superAdmin = await login('admin@quickbite.app');
  const second = await refundRepository.create({
    orderId: delivered.id, orderNumber: delivered.orderNumber, raisedByUserId: 'usr_customer_01', raisedByRole: 'customer',
    raisedByName: 'Test Customer', customerId: 'usr_customer_01', restaurantId: 'rst_bbh_01', reasonCode: 'FOOD_QUALITY',
    description: 'The rice was cold', attachments: [], requestedAmount: 20, orderTotal: 300
  } as any);
  pushes.length = 0;
  await api(`/admin/refund-requests/${second.id}/decision`, { method: 'POST', body: { action: 'REJECT', note: 'Photo shows hot food' } }, superAdmin);
  it('R2-7: a rejected refund tells the customer why', () => {
    const push = pushes.find(p => p.data?.type === 'REFUND_REJECTED');
    assert.equal(push?.userId, 'usr_customer_01');
    assert.match(String(push?.body), /Photo shows hot food/);
  });
  const reopenRefund = await api(`/admin/refund-requests/${second.id}/decision`, { method: 'POST', body: { action: 'APPROVE' } }, superAdmin);
  it('R2-7: approving a rejected case without a note is refused', () => assert.equal(reopenRefund.json?.error?.code, 'REOPEN_NOTE_REQUIRED'));
  const missing = await api(`/support/help/ITEM_MISSING?orderId=${delivered.id}`, {}, customer);
  it('"Item missing" mentions the problem already reported on that order', () =>
    assert.match(missing.json.data.answer, /already reported/));

  // Real earnings: a delivered trip posts ₹440 to the kitchen and ₹40 to the rider (payouts suite).
  recordOrderEarnings(putOrder({
    status: 'DELIVERED', riderId: 'rdr_vikram_01', riderPayout: 40, razorpayPaymentId: 'pay_help_fixture',
    pickedUpAt: new Date(Date.now() - 86_400_000).toISOString(), deliveredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    bill: { itemsTotal: 500, gstAmount: 25, packagingFee: 20, deliveryFee: 30, platformFee: 5.9, couponDiscount: 0, tipAmount: 0,
      totalAmount: 580.9, restaurantNetPayout: 445, commissionPercent: 15, commissionAmount: 75, tdsAmount: 5 }
  }) as any);
  memoryStore.riders.get('rdr_vikram_01').codCashInHand = 850;
  const cash = await api('/support/help/CASH_DEPOSIT', {}, rider);
  it('Rider "Cash deposit" shows the cash they carry', () => assert.match(cash.json?.data?.answer, /₹850\.00/));
  const rPay = await api('/support/help/PAYOUTS', {}, rider);
  it('Rider "Payouts" shows what is owed, and why it cannot be sent while carrying cash', () => {
    assert.match(rPay.json?.data?.answer, /^₹40\.00 owed/);
    assert.match(rPay.json?.data?.answer, /Holding ₹850\.00 of platform cash/);
  });
  const pPay = await api('/support/help/PAYOUTS', {}, partner);
  it('Partner "Payouts" lists each kitchen they own', () => assert.match(pPay.json?.data?.answer, /Bangalore Biryani House: ₹440\.00 owed.*Udupi Sri Krishna Bhavan: Nothing is owed/));
  memoryStore.restaurants.get('rst_bbh_01').kycStatus = 'PENDING_APPROVAL';
  const docs = await api('/support/help/DOCUMENTS', {}, partner);
  it('Partner "Documents" reads the kitchen\'s live review state', () => assert.match(docs.json?.data?.answer, /Bangalore Biryani House.*being checked/));
  memoryStore.restaurants.get('rst_bbh_01').kycStatus = 'ACTIVE';

  console.log('\n-- Only your own orders');
  const stranger = putOrder({ customerId: 'usr_customer_legacy' });
  const peek = await api(`/support/help/ORDER_LATE?orderId=${stranger.id}`, {}, customer);
  it('A customer cannot ask about someone else\'s order', () => assert.equal(peek.json?.error?.code, 'NOT_YOUR_ORDER', `status ${peek.status}`));
  const nothing = await api('/support/help/ORDER_LATE?orderId=ord_does_not_exist', {}, customer);
  it('...an unknown order is 404', () => assert.equal(nothing.status, 404));
  const trip = await api(`/support/help/TRIP_ISSUE?orderId=${enRoute.id}`, {}, rider);
  it('The rider on the trip can ask about it (rider record, not user id)', () =>
    assert.match(String(trip.json?.data?.answer), new RegExp(enRoute.orderNumber)));
  const otherTrip = putOrder({ riderId: 'rdr_someone_else' });
  const peekTrip = await api(`/support/help/TRIP_ISSUE?orderId=${otherTrip.id}`, {}, rider);
  it('...but not about another rider\'s trip', () => assert.equal(peekTrip.status, 403));
  const kitchenOrder = await api(`/support/help/ORDERS?orderId=${cooking.id}`, {}, partner);
  it('A partner can ask about an order at their own kitchen', () => assert.equal(kitchenOrder.status, 200));
  memoryStore.restaurants.set('rst_help_other', { id: 'rst_help_other', ownerId: 'usr_partner_legacy', name: 'Other Kitchen' });
  const foreign = putOrder({ restaurantId: 'rst_help_other', restaurantName: 'Other Kitchen' });
  const peekKitchen = await api(`/support/help/ORDERS?orderId=${foreign.id}`, {}, partner);
  it('...but not at someone else\'s kitchen', () => assert.equal(peekKitchen.status, 403));

  resetAuthRateLimit();
  const partnerUser = (await userRepository.findByEmail('partner@quickbite.app'))!;
  await api('/auth/otp/request', { method: 'POST', body: { phone: partnerUser.phone, email: 'partner@quickbite.app' } });
  const scoped = (await api('/auth/otp/verify', { method: 'POST', body: { phone: partnerUser.phone, code: config.OTP_FIXED_CODE } })).json?.data?.token;
  const scopedMenu = await api('/support/help', {}, scoped);
  it('A partner signed in to the Customer app gets the customer menu', () => assert.deepEqual(topicIds(scopedMenu), topicIds(cMenu)));
  const scopedKitchen = await api(`/support/help/ORDER_LATE?orderId=${cooking.id}`, {}, scoped);
  it('...and cannot read their kitchen\'s orders through it', () => assert.equal(scopedKitchen.status, 403));
  const scopedTicket = await ticket(scoped, { message: 'Asking about a kitchen order', orderId: cooking.id });
  it('...nor attach one to a ticket', () => assert.equal(scopedTicket.status, 403));

  console.log('\n-- "Talk to us"');
  const before = memoryStore.supportTickets.size;
  const talk = await ticket(customer, {
    message: 'Still nothing after an hour, please help', orderId: enRoute.id, category: 'DELIVERY',
    helpTopics: ['ORDER_LATE', 'CANCEL'], appVersion: '1.5.0', platform: 'android'
  });
  const made = talk.json?.data?.ticket;
  it('Creates a ticket with the order attached', () => {
    assert.equal(talk.status, 201, JSON.stringify(talk.json).slice(0, 300));
    assert.equal(made.orderNumber, enRoute.orderNumber);
  });
  it('...the chat so far, rebuilt by the server', () => {
    assert.deepEqual(made.helpChat.map((m: any) => m.topic), ['ORDER_LATE', 'CANCEL']);
    assert.equal(made.helpChat[0].question, 'My order is late');
    assert.match(made.helpChat[0].answer, new RegExp(enRoute.orderNumber));
  });
  it('...and the person\'s app version and platform', () => {
    assert.equal(made.appVersion, '1.5.0');
    assert.equal(made.platform, 'android');
    assert.equal(made.raisedByRole, 'customer');
  });
  const twice = await ticket(customer, {
    message: 'Still nothing after an hour, please help', orderId: enRoute.id, category: 'DELIVERY', helpTopics: ['ORDER_LATE', 'CANCEL']
  });
  it('A double tap makes exactly one ticket', () => {
    assert.equal(twice.json?.data?.ticket?.id, made.id);
    assert.equal(memoryStore.supportTickets.size, before + 1);
  });
  const forged = await ticket(customer, { message: 'Asking about payouts', helpTopics: ['PAYOUTS'] });
  it('A topic from another app is refused', () => assert.equal(forged.json?.error?.code, 'UNKNOWN_TOPIC', `status ${forged.status}`));
  const riderTicket = await ticket(rider, { message: 'Customer is not answering the door', orderId: enRoute.id, category: 'DELIVERY' });
  it('A rider can raise a ticket about their own trip', () => assert.equal(riderTicket.status, 201, JSON.stringify(riderTicket.json).slice(0, 200)));
  const strangerTicket = await ticket(customer, { message: 'About this other order', orderId: stranger.id });
  it('...a customer still cannot attach someone else\'s order', () => assert.equal(strangerTicket.status, 403));
  const oldApp = await ticket(partner, { message: 'An old app sends only the old fields', category: 'OTHER' });
  it('Old apps (no help fields) still create tickets', () => assert.equal(oldApp.status, 201));

  console.log('\n-- Replies in the same thread');
  const own = await api(`/support/tickets/${made.id}/reply`, { method: 'POST', body: { body: 'Any news?' } }, customer);
  it('The person\'s own reply leaves the ticket OPEN (it is not staff work)', () => assert.equal(own.json?.data?.ticket?.status, 'OPEN'));
  pushes.length = 0;
  const staff = await api(`/admin/support/tickets/${made.id}/reply`, { method: 'POST', body: { body: 'The rider is two minutes away.' } }, admin);
  it('A staff reply moves it to IN_PROGRESS', () => assert.equal(staff.json?.data?.ticket?.status, 'IN_PROGRESS', `status ${staff.status}`));
  it('...and pushes the person who raised it', () => {
    const push = pushes.find(p => p.data?.type === 'SUPPORT_REPLY');
    assert.equal(push?.userId, 'usr_customer_01');
    assert.equal(push?.data?.ticketId, made.id);
  });
  const riderTkt = riderTicket.json.data.ticket;
  const riderOwn = await api(`/support/tickets/${riderTkt.id}/reply`, { method: 'POST', body: { body: 'Still waiting here' } }, rider);
  it('A rider\'s own reply does not mark their ticket as handled', () => assert.equal(riderOwn.json?.data?.ticket?.status, 'OPEN'));
  await api(`/admin/support/tickets/${riderTkt.id}/status`, { method: 'POST', body: { status: 'RESOLVED' } }, admin);
  const reopen = await api(`/support/tickets/${riderTkt.id}/reply`, { method: 'POST', body: { body: 'It happened again' } }, rider);
  it('A rider replying to a solved ticket reopens it', () => assert.equal(reopen.json?.data?.ticket?.status, 'IN_PROGRESS'));

  console.log('\n-- Typing in the chat (owner, 19 Oct: a real chat)');
  const typed = await api('/support/help/match', { method: 'POST', body: { text: 'I want a refund for my order' } }, customer);
  it('A typed question gets the matching ready answer', () => {
    assert.equal(typed.json?.data?.topic?.id, 'REFUND_STATUS');
    assert.ok(String(typed.json?.data?.answer || '').length > 10);
  });
  const whereRefund = await api('/support/help/match', { method: 'POST', body: { text: 'where is my refund' } }, customer);
  it('R2-6: "where is my refund" is about the refund, not a late order', () => assert.equal(whereRefund.json?.data?.topic?.id, 'REFUND_STATUS'));
  const riderTyped = await api('/support/help/match', { method: 'POST', body: { text: 'when is my payout coming' } }, rider);
  it('...from the rider\'s own topics', () => assert.equal(riderTyped.json?.data?.topic?.id, 'PAYOUTS'));
  const unknown = await api('/support/help/match', { method: 'POST', body: { text: 'hello there' } }, customer);
  it('Nothing matched: no answer, a person should read it', () => assert.equal(unknown.json?.data?.topic, null));
  const thread = await api(`/support/tickets/${made.id}`, {}, customer);
  it('The person reads their own ticket with the staff reply (the chat polls this)', () =>
    assert.ok(thread.json?.data?.ticket?.replies?.some((r: any) => r.body === 'The rider is two minutes away.')));
  const notMine = await api(`/support/tickets/${made.id}`, {}, rider);
  it('...and nobody else can', () => assert.equal(notMine.status, 404));

  console.log('\n-- New chats per hour');
  // One live chat at a time (round 6): a request while one is open joins it, so each chat is
  // solved before the next and the hourly limit on NEW chats is what is tested.
  const solveOpen = async () => {
    for (const t of (await api('/support/tickets', {}, customer)).json?.data?.tickets || []) {
      if (['OPEN', 'IN_PROGRESS'].includes(t.status)) await api(`/support/tickets/${t.id}/resolve`, { method: 'POST' }, customer);
    }
  };
  let flood: any = null;
  for (let i = 0; i < 6 && flood?.status !== 429; i++) {
    await solveOpen();
    flood = await ticket(customer, { message: `Another question number ${i}` });
  }
  it('More than 5 tickets in an hour is refused', () => assert.equal(flood.json?.error?.code, 'TOO_MANY_TICKETS', `status ${flood.status}`));
  it('...with 429', () => assert.equal(flood.status, 429));

} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
