/**
 * Changing your mobile number or email with a code (owner item 18, master plan
 * B6, 18 Oct 2026). Email: code to the new address. Phone: code to the
 * account's current email until SMS is live. Same limits as password reset.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { normalizeIndianPhone } from '../utils/phone.ts';
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
/** Off production the server logs the code instead of needing an inbox. */
const codes: string[] = [];
const log = console.log;
console.log = (...args: any[]) => {
  const line = String(args[0] ?? '');
  if (line.includes('"CONTACT_CHANGE_CODE"')) codes.push(JSON.parse(line).code);
  log(...args);
};
const request = (body: any, token: string) => api('/auth/contact/request', { method: 'POST', body }, token);
const confirm = (code: string, token: string) => api('/auth/contact/confirm', { method: 'POST', body: { code } }, token);
const me = () => memoryStore.users.get('usr_customer_01') as any;
const allowResend = () => {
  if (me().contactChange) me().contactChange.sentAt = new Date(Date.now() - 120_000).toISOString();
};

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const token = (await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } })).json?.data?.token;

  console.log('\n-- Change the mobile number');
  const taken = await request({ kind: 'phone', value: '9876511223' }, token);
  it("Another account's number is refused before any code is sent", () => {
    assert.equal(taken.json?.error?.code, 'PHONE_IN_USE');
    assert.equal(codes.length, 0);
  });
  const asked = await request({ kind: 'phone', value: '+91 91234 00099' }, token);
  it('A free number: a code goes to the account email', () => {
    assert.equal(asked.status, 200, JSON.stringify(asked.json).slice(0, 200));
    assert.equal(asked.json?.data?.sentTo, 'current');
    assert.equal(codes.length, 1);
  });
  const soon = await request({ kind: 'phone', value: '9123400098' }, token);
  it('Another code within a minute is refused', () => assert.equal(soon.status, 429));
  // The route that returns the stored record (GET /auth/me only echoes the token's claims).
  const accountView = await api('/auth/me/usr_customer_01', {}, token);
  it('The pending code is never in the account view', () => assert.ok(!JSON.stringify(accountView.json).includes('contactChange')));
  const wrong = await confirm(codes[0] === '000000' ? '111111' : '000000', token);
  it('A wrong code changes nothing', () => {
    assert.equal(wrong.json?.error?.code, 'INVALID_CONTACT_CODE');
    assert.notEqual(normalizeIndianPhone(me().phone), '9123400099');
  });
  const ok = await confirm(codes[0], token);
  it('The right code changes the number', () => {
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
    assert.equal(normalizeIndianPhone(me().phone), '9123400099');
  });
  it('...and the reply carries no secrets', () => assert.ok(!/passwordHash|contactChange|codeHash/.test(JSON.stringify(ok.json))));
  const reused = await confirm(codes[0], token);
  it('The code works once', () => assert.equal(reused.json?.error?.code, 'INVALID_CONTACT_CODE'));

  console.log('\n-- Change the email');
  allowResend();
  const toNew = await request({ kind: 'email', value: 'New.Address@Example.com' }, token);
  it('A new email: the code goes to the new address', () => assert.equal(toNew.json?.data?.sentTo, 'new'));
  allowResend();
  me().contactChange.expiresAt = new Date(Date.now() - 1000).toISOString();
  const late = await confirm(codes[1], token);
  it('An expired code is refused', () => assert.equal(late.json?.error?.code, 'INVALID_CONTACT_CODE'));
  allowResend();
  await request({ kind: 'email', value: 'New.Address@Example.com' }, token);
  const emailed = await confirm(codes[2], token);
  it('The right code changes the email (stored lower-case)', () => {
    assert.equal(emailed.status, 200, JSON.stringify(emailed.json).slice(0, 200));
    assert.equal(me().email, 'new.address@example.com');
  });

  console.log('\n-- Blocked identities');
  // A blocked person whose account no longer holds the address (e.g. removed): the ban still holds.
  memoryStore.users.set('usr_banned_tmp', { id: 'usr_banned_tmp', email: 'banned.person@gmail.com', role: 'customer' } as any);
  banAccount('usr_banned_tmp');
  memoryStore.users.delete('usr_banned_tmp');
  allowResend();
  const banned = await request({ kind: 'email', value: 'Banned.Person+new@gmail.com' }, token);
  it("A blocked person's email (any Gmail spelling) cannot be taken this way", () =>
    assert.equal(banned.json?.error?.code, 'IDENTITY_BLOCKED', `status ${banned.status} ${banned.json?.error?.code}`));
} finally {
  console.log = log;
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
