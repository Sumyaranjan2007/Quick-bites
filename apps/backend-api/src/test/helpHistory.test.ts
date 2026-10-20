/**
 * Help chat history (round 3, item 6): the person can mark their own chat solved
 * (it moves to history), never someone else's; Operations sees who closed it.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';

const PORT = 5283;
const API = `http://127.0.0.1:${PORT}/api`;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
};
async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const login = async (email: string) =>
  (await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } })).json?.data?.token as string;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));
resetAuthRateLimit();

try {
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const raise = (token: string, message: string) =>
    api('/support/tickets', { method: 'POST', body: { subject: 'Help with an order', category: 'OTHER', message } }, token);

  const mine = (await raise(customer, 'My food has not arrived yet, please check.')).json?.data?.ticket;
  const theirs = (await raise(partner, 'A question about my payout this week.')).json?.data?.ticket;

  const stranger = await api(`/support/tickets/${theirs.id}/resolve`, { method: 'POST' }, customer);
  check("A customer cannot close someone else's chat", () => assert.equal(stranger.status, 404));

  const solved = await api(`/support/tickets/${mine.id}/resolve`, { method: 'POST' }, customer);
  check('The person marks their own chat solved', () => {
    assert.equal(solved.status, 200);
    assert.equal(solved.json?.data?.ticket?.status, 'RESOLVED');
    assert.equal(solved.json?.data?.ticket?.resolvedBy, 'USER');
  });
  const list = (await api('/support/tickets', {}, customer)).json?.data?.tickets || [];
  check('...and it is in their list as solved (their history)', () =>
    assert.equal(list.find((t: any) => t.id === mine.id)?.status, 'RESOLVED'));

  await api(`/admin/support/tickets/${theirs.id}/status`, { method: 'POST', body: { status: 'RESOLVED' } }, admin);
  const view = (await api(`/admin/support/tickets/${theirs.id}`, {}, admin)).json?.data;
  check('Staff closing it is recorded as Operations', () => assert.equal(view?.ticket?.resolvedBy, 'STAFF'));
  check('Operations sees the kitchen of a partner who asked', () => assert.ok(view?.raiser?.kitchens?.length > 0, JSON.stringify(view?.raiser)));

  // R3-9: a name set after sign-in is the one help uses, not the token's.
  await api('/auth/me', { method: 'PATCH', body: { fullName: 'Asha Renamed' } }, customer);
  const help = (await api('/support/help', {}, customer)).json?.data;
  check('Help greets the name the person set after signing in', () => assert.match(String(help?.greeting), /^Hi Asha,/));
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL HELP HISTORY CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
