/**
 * Losing access ends the connections already open (S11), and a password
 * change signs out every OTHER device while keeping this one (U2).
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';

const PORT = 5269;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  A BLOCK OR A NEW PASSWORD ENDS OTHER SESSIONS NOW  ');
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
initSocketServer(server);
await new Promise(r => setTimeout(r, 400));
const { io: ioClient } = await import('socket.io-client');

/** Opens a socket; resolves once connected (or refused). */
async function connect(token: string) {
  const sock = ioClient(`http://127.0.0.1:${PORT}`, { auth: { token }, transports: ['websocket'], reconnection: false });
  const ok = await new Promise<boolean>(resolve => {
    const t = setTimeout(() => resolve(false), 3000);
    sock.on('connect', () => { clearTimeout(t); resolve(true); });
    sock.on('connect_error', () => { clearTimeout(t); resolve(false); });
  });
  let dropped = false;
  sock.on('disconnect', () => { dropped = true; });
  return { sock, ok, dropped: () => dropped };
}
const settle = () => new Promise(r => setTimeout(r, 600));

try {
  const admin = await login('admin@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const rider = await login('rider@quickbite.app');
  const bystander = await login('rahul.sharma@quickbite.app');

  // ------------------------------------------------------------ S11
  console.log('-- Blocking an account closes its open connections (S11)');
  const cSock = await connect(customer.token);
  const rSock = await connect(rider.token);
  const bSock = await connect(bystander.token);
  it('Setup: three phones connected', () => {
    assert.equal(cSock.ok, true);
    assert.equal(rSock.ok, true);
    assert.equal(bSock.ok, true);
  });

  const blockC = await api(`/admin/customers/${customer.user.id}`, { method: 'PATCH', body: { isBlocked: true, blockReason: 'Refund abuse' } }, admin.token);
  const riderRow = (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === rider.user.id);
  const blockR = await api(`/admin/drivers/${riderRow.id}`, { method: 'PATCH', body: { isBlocked: true, blockReason: 'Cash fraud' } }, admin.token);
  await settle();
  it('A blocked customer\'s open connection is closed at once', () => {
    assert.equal(blockC.status, 200, JSON.stringify(blockC.json).slice(0, 200));
    assert.equal(cSock.dropped(), true);
  });
  it('and so is a blocked rider\'s', () => {
    assert.equal(blockR.status, 200, JSON.stringify(blockR.json).slice(0, 200));
    assert.equal(rSock.dropped(), true);
  });
  it('Control: somebody else stays connected', () => {
    assert.equal(bSock.dropped(), false);
  });
  const again = await connect(customer.token);
  it('and the blocked account cannot reconnect', () => {
    assert.equal(again.ok, false);
  });
  for (const s of [cSock, rSock, bSock, again]) s.sock.close();

  // ------------------------------------------------------------- U2
  console.log('\n-- A new password signs out the OTHER devices (U2)');
  const phoneA = await login('partner@quickbite.app');
  const phoneB = await login('partner@quickbite.app');
  const bLive = await connect(phoneB.token);
  const change = await api('/auth/change-password', { method: 'POST', body: { currentPassword: 'pass123', newPassword: 'newpass456' } }, phoneA.token);
  await settle();
  const fresh = change.json?.data?.token as string;
  const withFresh = await api('/auth/me', {}, fresh);
  const withOldA = await api('/auth/me', {}, phoneA.token);
  const withB = await api('/auth/me', {}, phoneB.token);
  it('The phone that changed it gets a new token that works', () => {
    assert.equal(change.status, 200, JSON.stringify(change.json).slice(0, 200));
    assert.ok(fresh);
    assert.equal(withFresh.status, 200);
  });
  it('and every older token, on this phone or another, stops working', () => {
    assert.equal(withOldA.status, 401);
    assert.equal(withB.status, 401);
  });
  it('and the other phone\'s live connection is closed', () => {
    assert.equal(bLive.ok, true);
    assert.equal(bLive.dropped(), true);
  });
  bLive.sock.close();
  const relogin = await login('partner@quickbite.app', 'newpass456');
  it('The new password signs in', () => {
    assert.ok(relogin.token);
  });

  // ------------------------------------------------------------- U6
  console.log('\n-- Deleting an account from the app (U6)');
  const again2 = await login('rahul.sharma@quickbite.app');
  memoryStore.orders.set('ord_u6_live', {
    id: 'ord_u6_live', orderNumber: 'QB-U6', customerId: again2.user.id, status: 'PREPARING',
    restaurantId: 'rst_bbh_01', items: [], bill: { totalAmount: 100 }, createdAt: new Date().toISOString()
  } as any);
  const tooSoon = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, again2.token);
  it('Refused while one of their orders is still on its way', () => {
    assert.equal(tooSoon.status, 409);
    assert.equal(tooSoon.json?.error?.code, 'ORDER_IN_PROGRESS');
  });
  (memoryStore.orders.get('ord_u6_live') as any).status = 'DELIVERED';
  const wrongPw = await api('/auth/me', { method: 'DELETE', body: { password: 'nope' } }, again2.token);
  const gone = await api('/auth/me', { method: 'DELETE', body: { password: 'pass123' } }, again2.token);
  it('Needs the password, then deletes the account', () => {
    assert.equal(wrongPw.status, 401);
    assert.equal(gone.status, 200, JSON.stringify(gone.json).slice(0, 200));
    assert.equal(memoryStore.users.get(again2.user.id), undefined);
  });
  const ghost = await login('rahul.sharma@quickbite.app');
  it('and signing in with it again fails', () => {
    assert.equal(ghost.token, undefined);
  });
} finally {
  closeSocketServer?.();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
