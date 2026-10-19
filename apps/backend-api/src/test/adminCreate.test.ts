/**
 * Operations creates a partner's or rider's account for them (owner item 8,
 * master plan B6, 18 Oct 2026). Same records as self sign-up; no password is
 * set or emailed: the person sets their own with a 24-hour code (security L11);
 * documents through the existing upload, approval through the existing review.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { banAccount } from '../modules/platform/blockedIdentifiers.ts';

const PORT = 5285;
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
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any, raw: '' };
}
const login = async (email: string, password = 'pass123') =>
  (await api('/auth/login', { method: 'POST', body: { email, password } })).json?.data?.token as string;

/** Off production the server logs the set-password code instead of needing an inbox. */
const setCodes = new Map<string, string>();
const log = console.log;
console.log = (...args: any[]) => {
  const line = String(args[0] ?? '');
  if (line.includes('"PASSWORD_RESET_CODE"')) {
    const e = JSON.parse(line);
    setCodes.set(e.email, e.code);
  }
  log(...args);
};

const kitchenBody = (email: string, phone: string, fssaiLicenseNumber = '11223344556677') => ({
  kind: 'restaurant', fullName: 'Meena Rao', email, phone, restaurantName: 'Meena Mess',
  addressLine: 'Main Road', city: 'Harohalli', pincode: '562112', fssaiLicenseNumber, latitude: 12.68, longitude: 77.47
});

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');
  const finance = await login('finance@quickbite.app');

  const byFinance = await api('/admin/accounts/create', { method: 'POST', body: kitchenBody('meena@example.com', '9100000001') }, finance);
  it('A role without the "manage" permission cannot create accounts', () => assert.equal(byFinance.status, 403));
  // A role that manages riders but not restaurants cannot create a kitchen account.
  const ops: any = Array.from(memoryStore.adminRoles.values()).find((r: any) => r.key === 'operations_admin');
  ops.permissions = ops.permissions.filter((p: string) => p !== 'users.restaurants.manage');
  const opsToken = await login('ops@quickbite.app');
  const byRiderManager = await api('/admin/accounts/create', { method: 'POST', body: kitchenBody('meena@example.com', '9100000001') }, opsToken);
  it('...nor one that manages riders but not restaurants (for a kitchen)', () => assert.equal(byRiderManager.status, 403, `status ${byRiderManager.status}`));

  const made = await api('/admin/accounts/create', { method: 'POST', body: kitchenBody('meena@example.com', '9100000001') }, admin);
  it('An admin creates a partner account with its restaurant', () => assert.equal(made.status, 201, JSON.stringify(made.json).slice(0, 300)));
  const kitchen: any = memoryStore.restaurants.get(made.json?.data?.restaurantId);
  it('...the restaurant waits for document review, like a self sign-up', () => {
    assert.equal(kitchen?.status, 'PENDING_APPROVAL');
    assert.equal(kitchen?.ownerId, made.json?.data?.userId);
  });
  it('...no password is set (none travels by email)', () => {
    assert.equal((memoryStore.users.get(made.json?.data?.userId) as any)?.passwordHash, undefined);
    assert.ok(setCodes.get('meena@example.com'), 'no set-password code was issued');
    assert.ok(!JSON.stringify(made.json).includes(String(setCodes.get('meena@example.com'))));
  });
  const set = await api('/auth/password/reset', {
    method: 'POST', body: { email: 'meena@example.com', code: setCodes.get('meena@example.com'), newPassword: 'MeenaMess#2026' }
  });
  const meena = await login('meena@example.com', 'MeenaMess#2026');
  it('...they set their own password with the emailed code, and sign in', () => {
    assert.equal(set.status, 200, JSON.stringify(set.json).slice(0, 200));
    assert.ok(meena, 'their chosen password does not work');
  });

  const again = await api('/admin/accounts/create', { method: 'POST', body: kitchenBody('MEENA@example.com', '9100000002') }, admin);
  it('An email that already has an account is refused', () => assert.equal(again.json?.error?.code, 'EMAIL_IN_USE'));

  banAccount('usr_rider_01');
  const rider: any = memoryStore.riders.get('rdr_vikram_01');
  const banned = await api('/admin/accounts/create', {
    method: 'POST',
    body: { kind: 'rider', fullName: 'Someone', email: 'someone.new@example.com', phone: '9100000003', vehicleType: 'BIKE', licenseNumber: rider.licenseNumber }
  }, admin);
  it("A blocked person's licence cannot be used for a new account", () => assert.equal(banned.json?.error?.code, 'IDENTITY_BLOCKED'));

  const newRider = await api('/admin/accounts/create', {
    method: 'POST',
    body: { kind: 'rider', fullName: 'Kiran', email: 'kiran.rider@example.com', phone: '9100000004', vehicleType: 'BIKE', licenseNumber: 'KA0520260077' }
  }, admin);
  it('An admin creates a rider account', () => assert.equal(newRider.status, 201, JSON.stringify(newRider.json).slice(0, 300)));
  const doc = await api('/kyc/submit', {
    method: 'POST',
    body: { entityType: 'RIDER', entityId: newRider.json?.data?.riderId, entityName: 'Kiran', documentType: 'DRIVING_LICENSE', fileUrl: 'data:image/png;base64,iVBORw0KGgo=' }
  }, admin);
  it('...and uploads their document for them (existing upload, admins allowed)', () =>
    assert.equal(doc.status < 300, true, `status ${doc.status} ${JSON.stringify(doc.json).slice(0, 200)}`));

  // Owner, 19 Oct: Operations may set the password; then no code is emailed.
  const withPassword = await api('/admin/accounts/create', {
    method: 'POST',
    body: { kind: 'rider', fullName: 'Ravi', email: 'ravi.rider@example.com', phone: '9100000005', vehicleType: 'BIKE', licenseNumber: 'KA0520260078', password: 'ravi-pass-77' }
  }, admin);
  it('A password set by Operations works at once, and no code is emailed', () => {
    assert.equal(withPassword.status, 201, JSON.stringify(withPassword.json).slice(0, 300));
    assert.equal(setCodes.has('ravi.rider@example.com'), false);
  });
  const raviToken = await login('ravi.rider@example.com', 'ravi-pass-77');
  it('...the rider signs in with it (token issued)', () => assert.ok(raviToken));
  const tooShort = await api('/admin/accounts/create', {
    method: 'POST',
    body: { kind: 'rider', fullName: 'Short', email: 'short@example.com', phone: '9100000006', vehicleType: 'BIKE', licenseNumber: 'KA0520260079', password: 'abc' }
  }, admin);
  it('A password under 8 characters is refused', () => assert.equal(tooShort.status, 400));
} finally {
  console.log = log;
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
