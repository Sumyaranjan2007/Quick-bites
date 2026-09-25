/**
 * A new address needs a map pin once the owner switches unpinned addresses off (U3).
 * Accepted by default, because older apps cannot send one.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';

const PORT = 5267;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  A NEW ADDRESS CARRIES A PIN WHEN THE OWNER SAYS   ');
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
async function login(email: string) {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const customer = await login('customer@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const unpinned = { label: 'Other', addressLine: '12 Old App Street', city: 'Bengaluru', pincode: '560001' };
  const pinned = { ...unpinned, coordinates: { latitude: 12.97, longitude: 77.59 } };

  const before = await api('/addresses', { method: 'POST', body: unpinned }, customer);
  it('Switch on (default): an address without a pin is still saved, so old apps keep working', () => {
    assert.equal(before.status, 201, JSON.stringify(before.json));
  });

  const flip = await api('/admin/settings/flags/unpinned_addresses', { method: 'PUT', body: { enabled: false, note: 'app shipped' } }, admin);
  const refused = await api('/addresses', { method: 'POST', body: unpinned }, customer);
  const ok = await api('/addresses', { method: 'POST', body: pinned }, customer);
  it('Switch off: an address without a pin is refused, in words the customer can act on', () => {
    assert.equal(flip.status, 200, JSON.stringify(flip.json));
    assert.equal(refused.status, 400);
    assert.equal(refused.json?.error?.code, 'ADDRESS_PIN_REQUIRED');
    assert.match(refused.json?.error?.message, /Pin the delivery spot/);
  });
  it('and one with a pin is saved', () => {
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
  });
  const oldId = before.json?.data?.address?.id;
  const edit = await api(`/addresses/${oldId}`, { method: 'PUT', body: { landmark: 'Near the temple' } }, customer);
  it('An old address without a pin can still be edited', () => {
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
  });
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
