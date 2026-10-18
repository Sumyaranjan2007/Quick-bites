/**
 * Remove and Block (owner Q1, 18 Oct 2026; master plan B6).
 *
 *   - BLOCK: the account is locked, and the person cannot come back under a new
 *     email (however written), number or licence. Unblocking frees them again.
 *   - REMOVE: the account is closed for good, data kept, and the person may
 *     register again from scratch with the same email and number. Needs the
 *     account name typed, a reason, and the "manage" permission for that kind
 *     of account; refused while one of its orders is in progress.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { canonical } from '../modules/platform/blockedIdentifiers.ts';
import { requestStaffDeletion } from '../modules/platform/staffDeletion.ts';

const PORT = 5284;
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}
async function api(pathname: string, init: any = {}, token?: string) {
  resetAuthRateLimit();
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const login = async (email: string) =>
  (await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } })).json?.data?.token as string;
/** A Customer-app sign-in with the shared test code. */
async function customerSignIn(phone: string, email: string) {
  await api('/auth/otp/request', { method: 'POST', body: { phone, email } });
  return api('/auth/otp/verify', { method: 'POST', body: { phone, code: config.OTP_FIXED_CODE } });
}
const errCode = (r: { json: any }) => r.json?.error?.code;
const userByEmail = (email: string): any => Array.from(memoryStore.users.values()).find((u: any) => u.email === email);

(config as any).OTP_PROVIDER = 'fixed';
await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');
  const finance = await login('finance@quickbite.app');

  console.log('\n-- Canonical forms (review D6)');
  it('Gmail dots and +tags are the same inbox', () =>
    assert.equal(canonical('email', 'A.Sha.Rao+promo@GMAIL.com'), canonical('email', 'asharao@gmail.com')));
  it('A licence written with spaces and dashes is the same licence', () =>
    assert.equal(canonical('license', 'ka-03 2021 008899'), canonical('license', 'KA032021008899')));

  console.log('\n-- Block: the rider cannot come back with a new email and number');
  const blocked = await api('/admin/drivers/rdr_vikram_01', { method: 'PATCH', body: { isBlocked: true, blockReason: 'fraud check' } }, admin);
  it('An admin blocks the rider', () => assert.equal(blocked.status, 200, JSON.stringify(blocked.json).slice(0, 200)));
  const riderBody = (licenseNumber: string) => ({
    fullName: 'New Name', email: 'brand.new.rider@example.com', phone: '9000600601', password: 'RiderPass#26', vehicleType: 'BIKE', licenseNumber
  });
  const comeback = await api('/auth/register/rider', { method: 'POST', body: riderBody('ka-03 2021 008899') });
  it('...and a new sign-up with their licence (written differently) is refused', () =>
    assert.equal(errCode(comeback), 'IDENTITY_BLOCKED', `status ${comeback.status} ${errCode(comeback)}`));
  await api('/admin/drivers/rdr_vikram_01', { method: 'PATCH', body: { isBlocked: false } }, admin);
  const afterUnblock = await api('/auth/register/rider', { method: 'POST', body: riderBody('ka-03 2021 008899') });
  it('Unblocked, the licence is no longer refused for being blocked', () =>
    assert.notEqual(errCode(afterUnblock), 'IDENTITY_BLOCKED', `status ${afterUnblock.status}`));

  console.log('\n-- Block: a customer cannot come back under a Gmail variant');
  const signed = await customerSignIn('9000700701', 'asha.rao@gmail.com');
  it('PRECONDITION: a customer signs up', () => assert.equal(signed.status, 200, JSON.stringify(signed.json).slice(0, 200)));
  const asha = userByEmail('asha.rao@gmail.com');
  await api(`/admin/customers/${asha.id}`, { method: 'PATCH', body: { isBlocked: true } }, admin);
  const variant = await customerSignIn('9000700702', 'a.sharao+new@gmail.com');
  it('A new number with a dotted/+tag version of their Gmail is refused', () =>
    assert.equal(errCode(variant), 'IDENTITY_BLOCKED', `status ${variant.status} ${errCode(variant)}`));

  console.log('\n-- Remove: closed for good, may register again');
  const removable = await customerSignIn('9000800801', 'remove.me@example.com');
  const oldToken = removable.json?.data?.token;
  const target = userByEmail('remove.me@example.com');
  const byFinance = await api(`/admin/accounts/${target.id}/remove`, { method: 'POST', body: { confirmName: target.fullName, reason: 'test' } }, finance);
  it('A role without the "manage" permission cannot remove', () => assert.equal(byFinance.status, 403, `status ${byFinance.status}`));
  const wrongName = await api(`/admin/accounts/${target.id}/remove`, { method: 'POST', body: { confirmName: 'someone else', reason: 'test' } }, admin);
  it('The account name must be typed exactly', () => assert.equal(errCode(wrongName), 'CONFIRM_NAME_MISMATCH'));
  const removed = await api(`/admin/accounts/${target.id}/remove`, { method: 'POST', body: { confirmName: target.fullName, reason: 'asked to leave' } }, admin);
  it('With the name and a reason, the account is removed', () => assert.equal(removed.status, 200, JSON.stringify(removed.json).slice(0, 200)));
  const stillIn = await api('/auth/me', {}, oldToken);
  it('...its open session stops working', () => assert.notEqual(stillIn.status, 200));
  it('...the data is kept, with who removed it and why', () => {
    const kept: any = memoryStore.users.get(target.id);
    assert.equal(kept.removedReason, 'asked to leave');
    assert.equal(kept.removedIdentity.email, 'remove.me@example.com');
  });
  const again = await customerSignIn('9000800801', 'remove.me@example.com');
  it('...and the person can register again from scratch with the same number and email', () => {
    assert.equal(again.status, 200, JSON.stringify(again.json).slice(0, 200));
    assert.notEqual(userByEmail('remove.me@example.com')?.id, target.id);
  });

  const rider: any = memoryStore.riders.get('rdr_vikram_01');
  memoryStore.orders.set('ord_live_trip', { id: 'ord_live_trip', orderNumber: 'QB-LIVE', riderId: rider.id, status: 'OUT_FOR_DELIVERY', restaurantId: 'rst_x', customerId: 'usr_x' } as any);
  const riderUser: any = memoryStore.users.get(rider.userId);
  const busy = await api(`/admin/accounts/${riderUser.id}/remove`, { method: 'POST', body: { confirmName: riderUser.fullName, reason: 'test' } }, admin);
  it('A rider with a trip in progress is not removed', () => assert.equal(errCode(busy), 'ORDER_IN_PROGRESS', `status ${busy.status}`));
  const adminUser: any = userByEmail('ops@quickbite.app');
  const staff = await api(`/admin/accounts/${adminUser.id}/remove`, { method: 'POST', body: { confirmName: adminUser.fullName, reason: 'test' } }, admin);
  it('Administrator accounts are never removed from here', () => assert.equal(errCode(staff), 'STAFF_NOT_REMOVABLE'));

  console.log('\n-- A deletion request does not hide or lift a block');
  await customerSignIn('9000900901', 'blocked.leaver@example.com');
  const leaver: any = userByEmail('blocked.leaver@example.com');
  await api(`/admin/customers/${leaver.id}`, { method: 'PATCH', body: { isBlocked: true } }, admin);
  await requestStaffDeletion(leaver.id);
  const cancelled = await api(`/admin/deletion-requests/${leaver.id}/cancel`, { method: 'POST', body: {} }, admin);
  it('Cancelling the deletion request of a blocked account keeps it blocked', () => {
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json).slice(0, 200));
    assert.equal((memoryStore.users.get(leaver.id) as any).isBlocked, true);
  });
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
