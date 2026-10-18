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
import { canonical, banAccount } from '../modules/platform/blockedIdentifiers.ts';
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

  console.log('\n-- Review G1, G3 and security M2');
  // G1: removed first, blocked later: the real email is still banned.
  await customerSignIn('9000901001', 'removed.then.blocked@example.com');
  const rtb: any = userByEmail('removed.then.blocked@example.com');
  await api(`/admin/accounts/${rtb.id}/remove`, { method: 'POST', body: { confirmName: rtb.fullName, reason: 'test' } }, admin);
  await api(`/admin/customers/${rtb.id}`, { method: 'PATCH', body: { isBlocked: true } }, admin);
  const comebackAfterRemove = await customerSignIn('9000901002', 'removed.then.blocked@example.com');
  it('Removed then blocked: their real email cannot sign up again (G1)', () =>
    assert.equal(errCode(comebackAfterRemove), 'IDENTITY_BLOCKED', `status ${comebackAfterRemove.status} ${errCode(comebackAfterRemove)}`));
  it('A "+tag" is ignored only for Gmail (G3)', () =>
    assert.notEqual(canonical('email', 'john+shop@company.in'), canonical('email', 'john@company.in')));

  // M2: a banned number cannot come back on a document, and numbers held only on documents are banned.
  memoryStore.users.set('usr_ban_src', { id: 'usr_ban_src', email: 'ban.src@example.com', role: 'restaurant_owner' } as any);
  memoryStore.restaurants.set('rst_ban_src', { id: 'rst_ban_src', ownerId: 'usr_ban_src', fssaiLicenseNumber: '99887766554433' } as any);
  memoryStore.riders.set('rdr_ban_src', { id: 'rdr_ban_src', userId: 'usr_ban_src', licenseNumber: 'KA0700000001' } as any);
  memoryStore.kycDocuments.set('kyc_ban_pan', { id: 'kyc_ban_pan', entityType: 'RESTAURANT', entityId: 'rst_ban_src', documentType: 'PAN', documentNumber: 'ABCPE1234F' } as any);
  banAccount('usr_ban_src');
  const partner = await login('partner@quickbite.app');
  const ownKitchen: any = Array.from(memoryStore.restaurants.values()).find((r: any) => r.ownerId === userByEmail('partner@quickbite.app').id);
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const fssaiDoc = await api(`/restaurants/${ownKitchen.id}/documents`, { method: 'POST', body: { documentType: 'FSSAI', documentNumber: '99887766554433', fileUrl: img } }, partner);
  it("A banned FSSAI uploaded as another kitchen's document is refused (M2)", () =>
    assert.equal(errCode(fssaiDoc), 'IDENTITY_BLOCKED', `status ${fssaiDoc.status} ${errCode(fssaiDoc)}`));
  const panDoc = await api(`/restaurants/${ownKitchen.id}/documents`, { method: 'POST', body: { documentType: 'PAN', documentNumber: 'abcpe 1234 f', fileUrl: img } }, partner);
  it('...and a PAN that was only on a document is banned too', () =>
    assert.equal(errCode(panDoc), 'IDENTITY_BLOCKED', `status ${panDoc.status} ${errCode(panDoc)}`));
  const riderToken = await login('rider@quickbite.app');
  const dlDoc = await api('/riders/documents', { method: 'POST', body: { documentType: 'DRIVING_LICENSE', documentNumber: 'KA07 0000 0001', fileUrl: img } }, riderToken);
  it("A banned driving licence uploaded by another rider is refused", () =>
    assert.equal(errCode(dlDoc), 'IDENTITY_BLOCKED', `status ${dlDoc.status} ${errCode(dlDoc)}`));

  console.log('\n-- A deletion request does not hide or lift a block');
  // F-13: a banned licence cannot come back through a profile edit, at submit or at approval.
  const bannedEdit = await api(`/restaurants/${ownKitchen.id}/profile`, { method: 'PUT', body: { fssaiLicenseNumber: '9988 7766 5544 33' } }, partner);
  it('A banned FSSAI sent as a profile edit is refused (F-13)', () =>
    assert.equal(errCode(bannedEdit), 'IDENTITY_BLOCKED', `status ${bannedEdit.status} ${errCode(bannedEdit)}`));
  const gstEdit = await api(`/restaurants/${ownKitchen.id}/profile`, { method: 'PUT', body: { gstin: '29pqrsx6789k1z3' } }, partner);
  it('A clean GSTIN is sent for review, upper-cased', () =>
    assert.equal(gstEdit.json?.data?.edit?.changes?.gstin, '29PQRSX6789K1Z3', JSON.stringify(gstEdit.json).slice(0, 200)));
  memoryStore.users.set('usr_ban_gst', { id: 'usr_ban_gst', email: 'ban.gst@example.com', role: 'restaurant_owner' } as any);
  memoryStore.restaurants.set('rst_ban_gst', { id: 'rst_ban_gst', ownerId: 'usr_ban_gst', gstin: '29PQRSX6789K1Z3' } as any);
  banAccount('usr_ban_gst');
  const approveBanned = await api(`/admin/profile-edits/${gstEdit.json?.data?.edit?.id}/review`, { method: 'POST', body: { approve: ['gstin'], reject: [] } }, admin);
  it('...and approving it after that GSTIN was blocked is refused; the kitchen keeps its old GSTIN', () => {
    assert.equal(errCode(approveBanned), 'IDENTITY_BLOCKED', `status ${approveBanned.status} ${errCode(approveBanned)}`);
    assert.notEqual((memoryStore.restaurants.get(ownKitchen.id) as any).gstin, '29PQRSX6789K1Z3');
  });

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
