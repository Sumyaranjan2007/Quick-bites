/**
 * Live tracking data path (master plan B11, #21/#22 server; review D1).
 *
 * What must hold:
 *  - a fix from the rider carrying the order is KEPT (on the order and the
 *    rider) whichever way it arrives, socket or REST, with heading and speed;
 *    the socket used to relay it and throw it away;
 *  - speed is the phone's when sent, else worked out from the previous fix;
 *  - the customer's tracking says when the last fix is older than 30 s
 *    ("updating…"), and shows no position before pickup (unchanged);
 *  - only the customer, the rider on the trip and staff can read tracking;
 *    any other rider account used to count as staff;
 *  - nonsense coordinates are refused on REST as on the socket.
 */
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';

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

await seedDatabase();
const server = http.createServer(createApp());
initSocketServer(server);
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${(server.address() as any).port}`;
const API = `${ORIGIN}/api`;

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
  return (await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } })).json?.data?.token as string;
}
const socketFor = (userId: string, role: string) =>
  ioClient(ORIGIN, { auth: { token: jwt.sign({ sub: userId, role }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' }) }, transports: ['websocket'], reconnection: false });
const connected = (s: Socket) => new Promise<void>((resolve, reject) => { s.on('connect', () => resolve()); s.on('connect_error', reject); });
const next = (s: Socket, event: string, ms = 1500) => new Promise<any>(resolve => {
  const t = setTimeout(() => resolve(null), ms);
  s.once(event, (p: any) => { clearTimeout(t); resolve(p); });
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const HOME = { latitude: 12.70, longitude: 77.48 };
const order: any = {
  id: 'ord_track_1', orderNumber: 'QB-TRACK-1', customerId: 'usr_customer_01', customerName: 'Test',
  restaurantId: 'rst_bbh_01', restaurantName: 'Bangalore Biryani House', riderId: 'rdr_vikram_01', riderName: 'Vikram Singh',
  status: 'OUT_FOR_DELIVERY', pickedUpAt: new Date().toISOString(), items: [], bill: { totalAmount: 300 },
  deliveryCoordinates: HOME, restaurantCoordinates: { latitude: 12.6802, longitude: 77.4734 }, distanceKm: 3,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
};
memoryStore.orders.set(order.id, order);

const sockets: Socket[] = [];
try {
  const rider = await login('rider@quickbite.app');
  const customer = await login('customer@quickbite.app');

  console.log('\n-- REST fallback keeps the fix, with heading and speed');
  const rest = await api('/riders/telemetry', { method: 'POST', body: { orderId: order.id, lat: 12.69, lng: 77.479, bearing: 45, speed: 8.4 } }, rider);
  it('The carrying rider\'s fix is accepted', () => assert.equal(rest.status, 200, JSON.stringify(rest.json)));
  it('...kept on the order: position, heading, speed, time', () => {
    assert.deepEqual(order.riderCoordinates, { latitude: 12.69, longitude: 77.479 });
    assert.equal(order.riderBearing, 45);
    assert.equal(order.riderSpeed, 8.4);
    assert.ok(order.riderLocationUpdatedAt);
  });
  it('...and on the rider', () => assert.deepEqual(memoryStore.riders.get('rdr_vikram_01').currentCoordinates, { latitude: 12.69, longitude: 77.479 }));
  const silly = await api('/riders/telemetry', { method: 'POST', body: { orderId: order.id, lat: 95, lng: 77.48 } }, rider);
  it('A latitude of 95 is refused on REST too', () => assert.equal(silly.status, 400));
  const fast = await api('/riders/telemetry', { method: 'POST', body: { orderId: order.id, lat: 12.69, lng: 77.479, speed: 900 } }, rider);
  it('An impossible speed is refused', () => assert.equal(fast.status, 400));

  // ~111 m north of the last fix, 10 s later: about 11 m/s.
  order.riderCoordinates = { latitude: 12.690, longitude: 77.479 };
  order.riderLocationUpdatedAt = new Date(Date.now() - 10_000).toISOString();
  await api('/riders/telemetry', { method: 'POST', body: { orderId: order.id, lat: 12.691, lng: 77.479 } }, rider);
  it('Without a speed from the phone, it is worked out from the previous fix', () =>
    assert.ok(order.riderSpeed > 9 && order.riderSpeed < 13, `speed ${order.riderSpeed}`));

  console.log('\n-- The socket keeps the fix too, and relays it');
  const riderSocket = socketFor('usr_rider_01', 'rider');
  const watcher = socketFor('usr_customer_01', 'customer');
  sockets.push(riderSocket, watcher);
  await Promise.all([connected(riderSocket), connected(watcher)]);
  watcher.emit('join:order', { orderId: order.id });
  await wait(200);
  const relayed = next(watcher, 'rider:location_update');
  riderSocket.emit('rider:location', { orderId: order.id, lat: 12.695, lng: 77.48, bearing: 90, speed: 6 });
  const payload = await relayed;
  await wait(100);
  it('The customer gets the position with heading, speed and the live arrival estimate', () => {
    assert.equal(payload?.lat, 12.695);
    assert.equal(payload?.bearing, 90);
    assert.equal(payload?.speed, 6);
    assert.ok(payload?.eta, 'no eta');
  });
  it('...and the fix is now kept on the order (it used to be relayed and dropped)', () => {
    assert.deepEqual(order.riderCoordinates, { latitude: 12.695, longitude: 77.48 });
    assert.equal(order.riderSpeed, 6);
  });

  console.log('\n-- "Updating…" when the last fix is old');
  const fresh = (await api(`/orders/${order.id}/tracking`, {}, customer)).json?.data;
  it('A fix under 30 s old is not stale', () => {
    assert.equal(fresh?.riderLocationStale, false);
    assert.equal(fresh?.riderSpeed, 6);
  });
  order.riderLocationUpdatedAt = new Date(Date.now() - 31_000).toISOString();
  const old = (await api(`/orders/${order.id}/tracking`, {}, customer)).json?.data;
  it('A fix over 30 s old is flagged stale', () => assert.equal(old?.riderLocationStale, true));
  order.pickedUpAt = undefined;
  order.status = 'PREPARING';
  const early = (await api(`/orders/${order.id}/tracking`, {}, customer)).json?.data;
  it('Before pickup there is still no position (and nothing to call stale)', () => {
    assert.equal(early?.riderCoordinates, null);
    assert.equal(early?.riderLocationStale, null);
  });
  const earlyFix = await api('/riders/telemetry', { method: 'POST', body: { orderId: order.id, lat: 12.69, lng: 77.479 } }, rider);
  it('...and the rider\'s position before pickup is not taken for the customer\'s map', () => assert.equal(earlyFix.status, 409));
  order.status = 'OUT_FOR_DELIVERY';
  order.pickedUpAt = new Date().toISOString();

  console.log('\n-- Who can read tracking');
  const own = await api(`/orders/${order.id}/tracking`, {}, rider);
  it('The rider on the trip can', () => assert.equal(own.status, 200));
  memoryStore.orders.set('ord_track_2', { ...order, id: 'ord_track_2', riderId: 'rdr_someone_else' });
  const other = await api('/orders/ord_track_2/tracking', {}, rider);
  it('Another rider cannot (a rider account is not staff)', () => assert.equal(other.status, 403));
  const staff = await api(`/orders/${order.id}/tracking`, {}, await login('ops@quickbite.app'));
  it('Staff can', () => assert.equal(staff.status, 200));
} finally {
  for (const s of sockets) s.close();
  await closeSocketServer();
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
