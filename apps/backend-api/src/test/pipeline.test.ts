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
