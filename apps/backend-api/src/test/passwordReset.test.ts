/**
 * Forgot password (master plan B6, owner 18 Oct 2026): a 6-digit code to the
 * account's email, then a new password, for partners, riders and staff.
 *
 *   - "Send me a code" answers the same for every email (review D8).
 *   - The code is stored only as a hash, never in any response.
 *   - Five wrong tries and the code is gone; an expired code does nothing.
 *   - A new password signs out every other device.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';

const PORT = 5283;
const API = `http://127.0.0.1:${PORT}/api`;
const PARTNER = 'partner@quickbite.app';

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

/** Off production the server logs the code instead of needing an inbox (as for confirm links). */
const codes: string[] = [];
const log = console.log;
console.log = (...args: any[]) => {
  const line = String(args[0] ?? '');
  if (line.includes('"PASSWORD_RESET_CODE"')) codes.push(JSON.parse(line).code);
  log(...args);
};
const userOf = (email: string): any => Array.from(memoryStore.users.values()).find((u: any) => u.email === email);
/** The reply comes first and the code is made after it (same timing for every email): wait for it. */
const forgot = async (email: string) => {
  const r = await api('/auth/password/forgot', { method: 'POST', body: { email } });
  await new Promise(done => setTimeout(done, 300));
  return r;
};
/** Emails the server sends (Brevo is answered here, never called). */
const emails: Array<{ to: string; text: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).includes('api.brevo.com')) {
    const body = JSON.parse(init.body);
    emails.push({ to: body.to[0].email, text: body.textContent });
    return new Response(JSON.stringify({ messageId: `m${emails.length}` }), { status: 201 });
  }
  return realFetch(url, init);
}) as any;
process.env.BREVO_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'noreply@example.com';
const reset = (email: string, code: string, newPassword = 'NewKitchen#2026') =>
  api('/auth/password/reset', { method: 'POST', body: { email, code, newPassword } });

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const before = await api('/auth/login', { method: 'POST', body: { email: PARTNER, password: 'pass123' } });
  const oldToken = before.json?.data?.token;

  console.log('\n-- One answer for every email');
  const known = await forgot(PARTNER);
  const unknown = await forgot('nobody-here@example.com');
  it('A partner asking for a code gets the standard reply', () => assert.equal(known.status, 200));
  it('...and an unknown email gets exactly the same reply (review D8)', () =>
    assert.deepEqual(unknown.json, known.json));
  it('A code was sent for the partner only', () => assert.equal(codes.length, 1));
  it('The code is stored as a hash, not the code', () =>
    assert.ok(userOf(PARTNER).passwordReset?.codeHash && !JSON.stringify(userOf(PARTNER)).includes(`"${codes[0]}"`)));
  const me = await api('/auth/me', {}, oldToken);
  it('...and never sent back in the account', () => assert.ok(!JSON.stringify(me.json).includes('passwordReset')));
  await forgot(PARTNER);
  it('Asking again within a minute sends no second email', () => assert.equal(codes.length, 1));

  console.log('\n-- Wrong codes and old codes do nothing');
  const wrong = codes[0] === '000000' ? '111111' : '000000';
  const firstWrong = await reset(PARTNER, wrong);
  it('A wrong code is refused', () => assert.equal(firstWrong.json?.error?.code, 'INVALID_RESET_CODE'));
  for (let i = 0; i < 4; i++) await reset(PARTNER, wrong);
  const afterFive = await reset(PARTNER, codes[0]);
  it('After five wrong tries even the right code is refused', () =>
    assert.equal(afterFive.json?.error?.code, 'INVALID_RESET_CODE', `status ${afterFive.status}`));

  it('...because five wrong tries delete the code', () => assert.equal(userOf(PARTNER).passwordReset, undefined));
  await forgot(PARTNER);
  userOf(PARTNER).passwordReset.expiresAt = new Date(Date.now() - 1000).toISOString();
  const expired = await reset(PARTNER, codes[1]);
  it('An expired code is refused', () => assert.equal(expired.json?.error?.code, 'INVALID_RESET_CODE'));

  console.log('\n-- The right code sets the password and signs out old devices');
  userOf(PARTNER).passwordReset = undefined;
  await forgot(PARTNER);
  const done = await reset(PARTNER, codes[2]);
  it('The right code sets the new password', () => assert.equal(done.status, 200, JSON.stringify(done.json).slice(0, 200)));
  const fresh = await api('/auth/login', { method: 'POST', body: { email: PARTNER, password: 'NewKitchen#2026' } });
  const stale = await api('/auth/login', { method: 'POST', body: { email: PARTNER, password: 'pass123' } });
  it('...signing in works with it', () => assert.equal(fresh.status, 200));
  it('...the old password no longer does', () => assert.equal(stale.status, 401));
  const oldSession = await api('/auth/me', {}, oldToken);
  it('...and the device signed in before is signed out', () =>
    assert.equal(oldSession.json?.error?.code, 'SESSION_REVOKED', `status ${oldSession.status}`));
  const reused = await reset(PARTNER, codes[2], 'Another#2026');
  it('The code works once', () => assert.equal(reused.json?.error?.code, 'INVALID_RESET_CODE'));
  it('The owner is emailed that the password changed (review P3)', () =>
    assert.ok(emails.some(e => e.to === PARTNER && /was just changed/.test(e.text)), JSON.stringify(emails.map(e => e.to))));

  console.log('\n-- A daily limit on codes and guesses (review P1)');
  const SUNITA = 'sunita.partner@quickbite.app';
  const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
  for (let round = 0; round < 2; round++) {
    if (userOf(SUNITA).passwordReset) userOf(SUNITA).passwordReset.sentAt = new Date(Date.now() - 120_000).toISOString();
    await forgot(SUNITA);
    for (let i = 0; i < 5; i++) await reset(SUNITA, wrongFor(codes[codes.length - 1]));
  }
  const issuedBefore = codes.length;
  await forgot(SUNITA);
  it('After 10 wrong guesses in a day, no new code is sent', () => assert.equal(codes.length, issuedBefore));
  const capped = await forgot(SUNITA);
  it('...and the reply is still the standard one', () => assert.deepEqual(capped.json, known.json));

  console.log('\n-- Accounts this is not for');
  // A Customer-app account signs in with a phone code and has no password.
  memoryStore.users.set('usr_codeonly', { id: 'usr_codeonly', email: 'codeonly@example.com', fullName: 'Code Only', role: 'customer', roles: ['customer'], phone: '9800077711' } as any);
  const sentBefore = codes.length;
  const asCustomer = await forgot('codeonly@example.com');
  it('A customer-only account (no password) gets the same reply and no email', () => {
    assert.deepEqual(asCustomer.json, known.json);
    assert.equal(codes.length, sentBefore);
  });
} finally {
  console.log = log;
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
// A moment for Node to finish closing handles: exiting mid-close crashes it on Windows.
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
