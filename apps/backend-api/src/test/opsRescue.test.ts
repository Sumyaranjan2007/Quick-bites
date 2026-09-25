/**
 * Operations can rescue a trip that went wrong on the road (A1, A2, A3).
 * Driven through the admin routes the admin app calls.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetConfigsForTesting, createVersion } from '../modules/payments/pricingConfig.ts';
import { resetLedgerForTesting, query as ledgerQuery } from '../modules/payments/ledger.ts';
import { lateCashCancels } from '../modules/orders/cancellationFee.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5266;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  OPERATIONS CAN RESCUE A TRIP ON THE ROAD          ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 800)}`);
  }
}
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
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}

await seedDatabase();

// A second rider, cloned from the seeded one so the password is the same.
const rider1 = (Array.from(memoryStore.riders.values()) as any[])[0];
const rider1User = memoryStore.users.get(rider1.userId) as any;
const rider2User = { ...rider1User, id: 'usr_rider_two', email: 'rider2@quickbite.app', fullName: 'Arjun Das', phone: '9000000077' };
memoryStore.users.set(rider2User.id, rider2User);
const rider2Id = 'rdr_arjun_02';
memoryStore.riders.set(rider2Id, {
  ...rider1,
  id: rider2Id,
  userId: rider2User.id,
  fullName: 'Arjun Das',
  phone: '9000000077',
  codCashInHand: 0,
  noShowCount: 0
});

const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
const pushes: any[] = [];
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  pushes.push(p);
  return { ...p, sentAt: new Date().toISOString() };
};

const riderOf = (id: string) => memoryStore.riders.get(id) as any;
const orderOf = (id: string) => memoryStore.orders.get(id) as any;
const earningsTxns = (orderId: string) =>
  new Set(ledgerQuery({ orderId }).filter(e => e.idempotencyKey === `order_earnings:${orderId}`).map(e => e.transactionId)).size;
const audits = (action: string, orderId: string) =>
  (Array.from(memoryStore.auditLogs.values()) as any[]).filter(a => a.action === action && a.entityId === orderId).length;

try {
  resetConfigsForTesting();
  resetLedgerForTesting();
  createVersion({ codCashCeiling: 100000 }, { userId: 'usr_admin_01' }, 'ops rescue');

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const r1 = await login(rider1User.email);
  const r2 = await login('rider2@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const supportStaff = await login('support@quickbite.app');
  const ops = await login('ops@quickbite.app');

  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, r1);
  await api('/riders/location', { method: 'POST', body: { lat: 12.689, lng: 77.48 } }, r1);
  // Rider 2's documents are not seeded; only their being on shift matters here.
  riderOf(rider2Id).isOnline = true;

  const place = async (paymentMethod = 'CASH_ON_DELIVERY') => {
    const res = await api('/orders', {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
        paymentMethod,
        idempotencyKey: crypto.randomUUID()
      }
    }, customer);
    return res.json?.data?.order ?? res.json?.data;
  };
  const status = (id: string, s: string) =>
    api(`/orders/${id}/status`, { method: 'PUT', body: { status: s, preparationMinutes: 15 } }, partner);
  /** Accepted, cooking, and claimed by rider 1. */
  const claimed = async () => {
    const o = await place();
    await status(o.id, 'ACCEPTED');
    await status(o.id, 'PREPARING');
    const c = await api(`/riders/orders/${o.id}/claim`, { method: 'POST', body: {} }, r1);
    if (c.status !== 200) console.log('   claim refused:', JSON.stringify(c.json).slice(0, 300));
    return o;
  };
  /** Collected by rider 1 and on the road. */
  const onTheRoad = async () => {
    const o = await claimed();
    await status(o.id, 'READY_FOR_PICKUP');
    await status(o.id, 'HANDED_TO_RIDER');
    const v = await api(`/riders/orders/${o.id}/verify-pickup`, { method: 'POST', body: { pickupCode: orderOf(o.id).pickupCode } }, r1);
    if (v.status !== 200) console.log('   pickup refused:', JSON.stringify(v.json).slice(0, 300));
    return o;
  };

  // ------------------------------------------------------------------ A1
  console.log('-- A1: take a trip off a rider before pickup');
  const a1 = await claimed();
  it('Setup: rider 1 holds the trip and the food is cooking', () => {
    assert.equal(orderOf(a1.id).riderId, rider1.id);
    assert.equal(orderOf(a1.id).status, 'PREPARING');
  });
  const noReason = await api(`/admin/orders/${a1.id}/unassign-rider`, { method: 'POST', body: {} }, ops);
  const bySupport = await api(`/admin/orders/${a1.id}/unassign-rider`, { method: 'POST', body: { reason: 'phone died' } }, supportStaff);
  it('Refused without a reason, and refused to a role without delivery control', () => {
    assert.equal(noReason.status, 400);
    assert.equal(bySupport.status, 403);
    assert.equal(orderOf(a1.id).riderId, rider1.id);
  });
  pushes.length = 0;
  const off = await api(`/admin/orders/${a1.id}/unassign-rider`, { method: 'POST', body: { reason: 'Rider phone died' } }, ops);
  it('Operations take it off: rider cleared, back on offer, food status unchanged', () => {
    assert.equal(off.status, 200, JSON.stringify(off.json));
    const o = orderOf(a1.id);
    assert.equal(o.riderId, undefined);
    assert.equal(o.riderStage, 'UNASSIGNED');
    assert.equal(o.status, 'PREPARING');
    assert.ok(o.declinedByRiderIds.includes(rider1.id));
  });
  it('one audit row, and rider 1 is told', () => {
    assert.equal(audits('ORDER_RIDER_UNASSIGNED', a1.id), 1);
    assert.ok(pushes.some(p => p.userId === rider1.userId && p.data?.type === 'RIDER_TRIP_TAKEN_OFF'));
  });
  it('and it is not counted against the rider unless staff say so', () => {
    assert.equal(riderOf(rider1.id).noShowCount || 0, 0);
  });
  const again = await api(`/admin/orders/${a1.id}/unassign-rider`, { method: 'POST', body: { reason: 'again' } }, ops);
  it('A second press says there is no rider, it does not fail silently', () => {
    assert.equal(again.status, 409);
    assert.equal(again.json?.error?.code ?? again.json?.code, 'NO_RIDER_ASSIGNED');
  });

  // ------------------------------------------------------------------ A2
  console.log('\n-- A2: give a trip to another rider after pickup');
  const a2 = await onTheRoad();
  it('Setup: rider 1 is carrying the food', () => {
    assert.equal(orderOf(a2.id).status, 'OUT_FOR_DELIVERY');
    assert.ok(orderOf(a2.id).pickedUpAt);
  });
  const offCollected = await api(`/admin/orders/${a2.id}/unassign-rider`, { method: 'POST', body: { reason: 'gone' } }, ops);
  it('A1 refuses once the food is collected, and names the right button', () => {
    assert.equal(offCollected.status, 409);
    assert.match(JSON.stringify(offCollected.json), /another rider/);
  });
  const noNote = await api(`/admin/orders/${a2.id}/reassign-rider`, { method: 'POST', body: { riderId: rider2Id, reason: 'Bike broke down' } }, ops);
  it('After pickup a handover note is required', () => {
    assert.equal(noNote.status, 400, JSON.stringify(noNote.json));
    assert.match(JSON.stringify(noNote.json), /HANDOVER_NOTE_REQUIRED/);
  });
  const blocker = await place();
  memoryStore.orders.set(blocker.id, { ...orderOf(blocker.id), riderId: rider2Id, riderStage: 'HEADING_TO_RESTAURANT' });
  const busy = await api(`/admin/orders/${a2.id}/reassign-rider`, { method: 'POST', body: { riderId: rider2Id, reason: 'Bike broke down', handoverNote: 'At the petrol pump on 5th Main' } }, ops);
  memoryStore.orders.set(blocker.id, { ...orderOf(blocker.id), riderId: undefined, riderStage: 'UNASSIGNED' });
  it('A rider already on a trip cannot be given a second one', () => {
    assert.equal(busy.status, 409);
    assert.match(JSON.stringify(busy.json), /RIDER_ALREADY_ON_TRIP/);
  });
  riderOf(rider2Id).isOnline = false;
  const offline = await api(`/admin/orders/${a2.id}/reassign-rider`, { method: 'POST', body: { riderId: rider2Id, reason: 'Bike broke down', handoverNote: 'At the petrol pump on 5th Main' } }, ops);
  riderOf(rider2Id).isOnline = true;
  it('An off-shift rider cannot be given the trip', () => {
    assert.equal(offline.status, 409);
    assert.match(JSON.stringify(offline.json), /RIDER_OFFLINE/);
  });
  riderOf(rider2Id).codCashInHand = 200000;
  const overCeiling = await api(`/admin/orders/${a2.id}/reassign-rider`, { method: 'POST', body: { riderId: rider2Id, reason: 'Bike broke down', handoverNote: 'At the petrol pump on 5th Main' } }, ops);
  riderOf(rider2Id).codCashInHand = 0;
  it('A cash order is refused to a rider over their cash ceiling, with its message', () => {
    assert.equal(overCeiling.status, 409);
    assert.match(JSON.stringify(overCeiling.json), /RIDER_CASH_CEILING/);
    assert.equal(orderOf(a2.id).riderId, rider1.id);
  });
  pushes.length = 0;
  const moved = await api(`/admin/orders/${a2.id}/reassign-rider`, { method: 'POST', body: { riderId: rider2Id, reason: 'Bike broke down', handoverNote: 'At the petrol pump on 5th Main' } }, ops);
  it('Under the ceiling it moves: rider 2 has it, pickup time kept', () => {
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const o = orderOf(a2.id);
    assert.equal(o.riderId, rider2Id);
    assert.ok(o.pickedUpAt);
    assert.equal(o.status, 'OUT_FOR_DELIVERY');
    assert.equal(o.riderReassignments.at(-1).handoverNote, 'At the petrol pump on 5th Main');
  });
  it('both riders are told, and rider 1 gets a no-show', () => {
    assert.ok(pushes.some(p => p.userId === rider2User.id && p.data?.type === 'RIDER_TRIP_GIVEN'));
    assert.ok(pushes.some(p => p.userId === rider1.userId && p.data?.type === 'RIDER_TRIP_TAKEN_OFF'));
    assert.equal(riderOf(rider1.id).noShowCount, 1);
    assert.equal(audits('ORDER_RIDER_REASSIGNED', a2.id), 1);
  });
  const r2Active = await api('/riders/orders/active', {}, r2);
  it('The new rider\'s app shows where to collect the bag', () => {
    assert.equal(r2Active.json?.data?.order?.id, a2.id, JSON.stringify(r2Active.json).slice(0, 300));
    assert.equal(r2Active.json?.data?.order?.handoverNote, 'At the petrol pump on 5th Main');
  });
  const r1Cash = Number(riderOf(rider1.id).codCashInHand) || 0;
  const oldRiderOtp = await api(`/riders/orders/${a2.id}/verify-otp`, { method: 'POST', body: { deliveryOtp: orderOf(a2.id).deliveryOtp } }, r1);
  const done = await api(`/riders/orders/${a2.id}/verify-otp`, { method: 'POST', body: { deliveryOtp: orderOf(a2.id).deliveryOtp } }, r2);
  it('Only the new rider can finish it, and the cash is booked to them', () => {
    assert.notEqual(oldRiderOtp.status, 200);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(orderOf(a2.id).status, 'DELIVERED');
    assert.equal(Number(riderOf(rider2Id).codCashInHand), Number(orderOf(a2.id).bill.totalAmount));
    assert.equal(Number(riderOf(rider1.id).codCashInHand) || 0, r1Cash);
  });

  // ------------------------------------------------------------------ A3
  console.log('\n-- A3: operations mark delivered when the customer cannot read the code');
  const notOut = await claimed();
  const early = await api(`/admin/orders/${notOut.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer confirmed on call', cashCollectedBy: 'RIDER' } }, ops);
  it('Food nobody has collected cannot be marked delivered', () => {
    assert.equal(early.status, 409);
    assert.notEqual(orderOf(notOut.id).status, 'DELIVERED');
  });
  await api(`/admin/orders/${notOut.id}/unassign-rider`, { method: 'POST', body: { reason: 'free rider 1' } }, ops);
  const a3 = await onTheRoad();
  const cashBefore = Number(riderOf(rider1.id).codCashInHand) || 0;
  const noWhy = await api(`/admin/orders/${a3.id}/mark-delivered`, { method: 'POST', body: { cashCollectedBy: 'RIDER' } }, ops);
  const noCash = await api(`/admin/orders/${a3.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer confirmed on call' } }, ops);
  it('Refused without a reason, and a cash order refused without saying who has the cash', () => {
    assert.equal(noWhy.status, 400);
    assert.equal(noCash.status, 400);
    assert.match(JSON.stringify(noCash.json), /CASH_COLLECTED_BY_REQUIRED/);
    assert.equal(orderOf(a3.id).status, 'OUT_FOR_DELIVERY');
  });
  const first = await api(`/admin/orders/${a3.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer confirmed on call', cashCollectedBy: 'RIDER' } }, ops);
  const second = await api(`/admin/orders/${a3.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer confirmed on call', cashCollectedBy: 'RIDER' } }, ops);
  it('Delivered, with who and why recorded', () => {
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const o = orderOf(a3.id);
    assert.equal(o.status, 'DELIVERED');
    assert.equal(o.deliveredByOperations.reason, 'Customer confirmed on call');
    assert.equal(o.deliveredByOperations.cashCollectedBy, 'RIDER');
    assert.equal(audits('ORDER_DELIVERED_BY_OPERATIONS', a3.id), 1);
  });
  it('Two presses: the second is refused, earnings posted exactly once, cash booked once', () => {
    assert.equal(second.status, 409);
    assert.equal(earningsTxns(a3.id), 1);
    assert.equal(Number(riderOf(rider1.id).codCashInHand), cashBefore + Number(orderOf(a3.id).bill.totalAmount));
  });

  const refused = await onTheRoad();
  const cashBeforeRefusal = Number(riderOf(rider1.id).codCashInHand) || 0;
  const cancelsBefore = lateCashCancels(orderOf(refused.id).customerId);
  const ticketsBefore = memoryStore.supportTickets.size;
  const none = await api(`/admin/orders/${refused.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer would not pay', cashCollectedBy: 'NONE' } }, ops);
  it('Cash refused at the door: the order closes as refused, not delivered', () => {
    assert.equal(none.status, 200, JSON.stringify(none.json));
    const o = orderOf(refused.id);
    assert.equal(o.status, 'CANCELLED');
    assert.equal(o.cancellationReasonCode, 'COD_REFUSED_AT_DOOR');
  });
  it('nothing is booked to the rider and nothing is earned', () => {
    assert.equal(Number(riderOf(rider1.id).codCashInHand) || 0, cashBeforeRefusal);
    assert.equal(earningsTxns(refused.id), 0);
  });
  it('a staff case is opened, and the refusal counts toward switching cash off', () => {
    assert.equal(memoryStore.supportTickets.size, ticketsBefore + 1);
    const ticket = (Array.from(memoryStore.supportTickets.values()) as any[]).find(t => t.orderId === refused.id);
    assert.equal(ticket.raisedByRole, 'admin');
    assert.equal(lateCashCancels(orderOf(refused.id).customerId), cancelsBefore + 1);
  });

  const prepaidAdmin = await api(`/admin/orders/${a1.id}/mark-delivered`, { method: 'POST', body: { reason: 'Customer confirmed on call' } }, admin);
  it('Control: the order A1 put back on offer cannot be marked delivered', () => {
    assert.equal(prepaidAdmin.status, 409);
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
