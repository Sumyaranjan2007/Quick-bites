/**
 * Changing your email with a code (owner item 18, master plan B6, 18 Oct 2026),
 * as settled with the security reviewer:
 *   - proof of the account's owner (current password, or for a password-less
 *     account a code to the OLD email) AND of the new inbox (code to the NEW email);
 *   - every other session signed out, old address told;
 *   - mobile numbers are changed by support until SMS codes are live (M1);
 *   - riders: the number customers call follows the same rule, and once approved
 *     the licence and vehicle are changed by operations only.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { banAccount } from '../modules/platform/blockedIdentifiers.ts';

const PORT = 5286;
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
/** Off production the server logs the codes instead of needing an inbox. */
const codes: Array<{ code: string; ownerCode: string | null }> = [];
const log = console.log;
console.log = (...args: any[]) => {
  const line = String(args[0] ?? '');
  if (line.includes('"CONTACT_CHANGE_CODE"')) {
    const e = JSON.parse(line);
    codes.push({ code: e.code, ownerCode: e.ownerCode });
  }
  log(...args);
};
const request = (body: any, token: string) => api('/auth/contact/request', { method: 'POST', body }, token);
const confirm = (body: any, token: string) => api('/auth/contact/confirm', { method: 'POST', body }, token);
const user = (id: string) => memoryStore.users.get(id) as any;
const allowResend = (id: string) => {
  if (user(id).contactChange) user(id).contactChange.sentAt = new Date(Date.now() - 120_000).toISOString();
};
const last = () => codes[codes.length - 1];

(config as any).OTP_PROVIDER = 'fixed';
await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const token = (await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const ME = 'usr_customer_01';

  console.log('\n-- Mobile numbers: support only until SMS');
  const phone = await request({ kind: 'phone', value: '9123400099' }, token);
  it('A phone change is sent to support', () => assert.equal(phone.json?.error?.code, 'PHONE_CHANGE_VIA_SUPPORT'));

  console.log('\n-- Email, account with a password');
  const noPassword = await request({ kind: 'email', value: 'new.address@example.com' }, token);
  it('Without the current password nothing is sent', () => {
    assert.equal(noPassword.json?.error?.code, 'INVALID_PASSWORD');
    assert.equal(codes.length, 0);
  });
  const taken = await request({ kind: 'email', value: 'partner@quickbite.app', currentPassword: 'pass123' }, token);
  it("Another account's email is refused", () => assert.equal(taken.json?.error?.code, 'EMAIL_IN_USE'));
  const asked = await request({ kind: 'email', value: 'New.Address@Example.com', currentPassword: 'pass123' }, token);
  it('With the password, a code goes to the new email only', () => {
    assert.equal(asked.status, 200, JSON.stringify(asked.json).slice(0, 200));
    assert.equal(asked.json?.data?.needsOwnerCode, false);
  });
  const record = await api(`/auth/me/${ME}`, {}, token);
  it('The pending codes are never in the account record', () => assert.ok(!JSON.stringify(record.json).includes('contactChange')));
  const wrong = await confirm({ code: last().code === '000000' ? '111111' : '000000' }, token);
  it('A wrong code changes nothing', () => {
    assert.equal(wrong.json?.error?.code, 'INVALID_CONTACT_CODE');
    assert.equal(user(ME).email, 'customer@quickbite.app');
  });
  const ok = await confirm({ code: last().code }, token);
  it('The right code changes the email (stored lower-case)', () => {
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
    assert.equal(user(ME).email, 'new.address@example.com');
  });
  it('...the reply carries a fresh token and no secrets', () => {
    assert.ok(ok.json?.data?.token);
    assert.ok(!/passwordHash|contactChange|codeHash/.test(JSON.stringify(ok.json)));
  });
  const oldSession = await api('/auth/me', {}, token);
  it('...and the sessions opened before are signed out', () => assert.equal(oldSession.json?.error?.code, 'SESSION_REVOKED'));

  console.log('\n-- Email, account without a password (Customer app)');
  await api('/auth/otp/request', { method: 'POST', body: { phone: '9000444001', email: 'codeonly@example.com' } });
  const signed = await api('/auth/otp/verify', { method: 'POST', body: { phone: '9000444001', code: config.OTP_FIXED_CODE } });
  const codeToken = signed.json?.data?.token;
  const codeUser: any = Array.from(memoryStore.users.values()).find((u: any) => u.email === 'codeonly@example.com');
  const two = await request({ kind: 'email', value: 'codeonly.new@example.com' }, codeToken);
  it('A code goes to the new email AND one to the current email', () => {
    assert.equal(two.json?.data?.needsOwnerCode, true, JSON.stringify(two.json).slice(0, 200));
    assert.ok(last().ownerCode);
  });
  const onlyNew = await confirm({ code: last().code }, codeToken);
  it('The new-email code alone is not enough', () => {
    assert.equal(onlyNew.json?.error?.code, 'INVALID_CONTACT_CODE');
    assert.equal(user(codeUser.id).email, 'codeonly@example.com');
  });
  const both = await confirm({ code: last().code, ownerCode: last().ownerCode }, codeToken);
  it('Both codes change it', () => {
    assert.equal(both.status, 200, JSON.stringify(both.json).slice(0, 200));
    assert.equal(user(codeUser.id).email, 'codeonly.new@example.com');
  });

  console.log('\n-- Blocked identities');
  memoryStore.users.set('usr_banned_tmp', { id: 'usr_banned_tmp', email: 'banned.person@gmail.com', role: 'customer' } as any);
  banAccount('usr_banned_tmp');
  memoryStore.users.delete('usr_banned_tmp');
  allowResend(codeUser.id);
  const banned = await request({ kind: 'email', value: 'Banned.Person+new@gmail.com' }, both.json?.data?.token);
  it("A blocked person's email (any Gmail spelling) cannot be taken this way", () =>
    assert.equal(banned.json?.error?.code, 'IDENTITY_BLOCKED', `status ${banned.status} ${banned.json?.error?.code}`));

  console.log('\n-- Riders: the number customers call, and what was reviewed');
  const riderToken = (await api('/auth/login', { method: 'POST', body: { email: 'rider@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const riderRec: any = memoryStore.riders.get('rdr_vikram_01');
  const directPhone = await api('/riders/me', { method: 'PATCH', body: { phone: '9123400055' } }, riderToken);
  it('A rider cannot change their number from the profile form', () =>
    assert.equal(directPhone.json?.error?.code, 'PHONE_CHANGE_NEEDS_CODE', `status ${directPhone.status}`));
  const licence = await api('/riders/me', { method: 'PATCH', body: { licenseNumber: 'KA0999999999' } }, riderToken);
  it('An approved rider cannot change their own licence number', () =>
    assert.equal(licence.json?.error?.code, 'REVIEWED_FIELD_LOCKED', `status ${licence.status} (kyc ${riderRec.kycStatus})`));
  const sameName = await api('/riders/me', { method: 'PATCH', body: { fullName: 'Vikram Singh' } }, riderToken);
  it('...while ordinary fields still save', () => assert.equal(sameName.status, 200, `status ${sameName.status}`));
} finally {
  console.log = log;
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
