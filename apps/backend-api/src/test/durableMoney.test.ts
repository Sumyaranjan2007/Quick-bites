/**
 * A money route answers only once its write is in the database (N19 / S2).
 *
 * A stand-in database whose save takes 300 ms is installed through the same
 * seam production uses (`setPersistenceBackend`). A money write must not answer
 * before that save finishes; if the save fails, it must answer "not saved"
 * (503), never success. Controls: a GET on the same router and a non-money
 * write are not held up.
 */
import assert from 'node:assert/strict';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { setPersistenceBackend } from '../db/client.ts';

const PORT = 5263;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  MONEY IS SAVED BEFORE ANYONE IS TOLD IT HAPPENED  ');
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
  const started = Date.now();
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json, answeredAt: Date.now(), took: Date.now() - started };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

const SAVE_MS = 300;
let saves: number[] = [];
let failing = false;
setPersistenceBackend({
  save: async () => {
    await new Promise(r => setTimeout(r, SAVE_MS));
    // The outage lasts for the whole request: a background flush that ran
    // first would otherwise absorb a one-shot failure and hide the case.
    if (failing) throw new Error('database unreachable');
    saves.push(Date.now());
  }
});

try {
  const { json } = await api('/auth/login', { method: 'POST', body: { email: 'admin@quickbite.app', password: 'pass123' } });
  const admin = json?.data?.token as string;

  // The pricing config sits behind `durable` and always succeeds, so it is the
  // cleanest money write to time.
  saves = [];
  const money = await api(
    '/admin/pricing/config',
    { method: 'PUT', body: { rates: { packagingFeeDefault: 21 }, note: 'durability check' } },
    admin
  );
  it('A money write answers only after the database save finished', () => {
    assert.equal(money.status, 200, `status ${money.status}: ${JSON.stringify(money.json).slice(0, 200)}`);
    assert.ok(saves.length >= 1, 'no save happened before the answer');
    assert.ok(saves[0] <= money.answeredAt, 'the answer arrived before the save completed');
    assert.ok(money.took >= SAVE_MS - 20, `answered in ${money.took} ms, faster than a ${SAVE_MS} ms save`);
  });

  failing = true;
  const lost = await api(
    '/admin/pricing/config',
    { method: 'PUT', body: { rates: { packagingFeeDefault: 22 }, note: 'durability failure check' } },
    admin
  );
  failing = false;
  it('If the save fails, the caller is told it was NOT saved (503), not success', () => {
    assert.equal(lost.status, 503, `status ${lost.status}`);
    assert.equal(lost.json?.error?.code, 'NOT_SAVED');
  });

  // Concurrent money writes share saves (B's condition on S2): a queued save
  // that has not started serves everyone who arrives before it does.
  await new Promise(r => setTimeout(r, SAVE_MS + 50));
  saves = [];
  const burstStarted = Date.now();
  const burst = await Promise.all(
    [23, 24, 25, 26, 27].map(fee =>
      api('/admin/pricing/config', { method: 'PUT', body: { rates: { packagingFeeDefault: fee }, note: `burst ${fee}` } }, admin)
    )
  );
  const burstTook = Date.now() - burstStarted;
  it('Five concurrent money writes share saves instead of queuing five', () => {
    assert.ok(burst.every(b => b.status === 200), `statuses ${burst.map(b => b.status)}`);
    assert.ok(saves.length <= 2, `${saves.length} saves for 5 concurrent writes`);
    assert.ok(burstTook < SAVE_MS * 4, `the burst took ${burstTook} ms, as if the saves were queued one by one`);
    assert.ok(burst.every(b => saves.some(t => t <= b.answeredAt)), 'a write answered before any save covering it finished');
  });

  const read = await api('/admin/pricing/config', {}, admin);
  it('Control: a GET on the same router is not held up', () => {
    assert.equal(read.status, 200);
    assert.ok(read.took < SAVE_MS, `a read took ${read.took} ms`);
  });

  const profile = await api('/auth/me', { method: 'PATCH', body: { fullName: 'Admin Durable' } }, admin);
  it('Control: a non-money write is not held up', () => {
    assert.equal(profile.status, 200, `status ${profile.status}`);
    assert.ok(profile.took < SAVE_MS, `a profile edit took ${profile.took} ms`);
  });
  // Every money surface carries `durable`: a new money route mounted without it
  // would answer before its write is saved, and nothing else would notice.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const routes = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../routes');
  const code = (f: string) =>
    fs.readFileSync(path.join(routes, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const wholeRouters = [
    ['cashRouter.ts', 'cashRouter'],
    ['membershipRouter.ts', 'membershipRouter'],
    ['payeeAccountRouter.ts', 'payeeAccountRouter'],
    ['paymentRouter.ts', 'paymentRouter'],
    ['adminRouter.ts', 'adminRouter']
  ];
  it('Every money router is mounted behind durable', () => {
    for (const [file, name] of wholeRouters) {
      assert.ok(code(file).includes(`${name}.use(durable)`), `${file} does not use durable`);
    }
  });
  const perRoute = [
    ['orderRouter.ts', "'/:id/confirm-payment', authMiddleware(), durable"],
    ['orderRouter.ts', "'/:id/status', authMiddleware(), durable"],
    ['riderRouter.ts', "'/orders/:id/verify-otp', durable"],
    ['riderRouter.ts', "'/orders/:id/verify-pickup', durable"]
  ];
  it('and so is every money route on a mixed router', () => {
    for (const [file, marker] of perRoute) {
      assert.ok(code(file).includes(marker), `${file}: ${marker} is missing durable`);
    }
  });
} finally {
  setPersistenceBackend(null);
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
