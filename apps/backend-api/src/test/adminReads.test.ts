/**
 * The admin app reads what the server actually sends (QA #1, 26 Sep).
 *
 * Seven admin money screens showed "nothing" for four days because seventeen
 * loaders unwrapped `data` a second time. See helpers/adminReadScan.ts for the
 * whole story. Three checks:
 *
 *   1. The scanner still finds a planted double unwrap (so "none found" means
 *      none, not a scanner that stopped matching).
 *   2. The admin app has no double unwrap anywhere.
 *   3. Every typed admin loader, called against the real routes as the super
 *      administrator, gets a defined answer carrying every key its screen's
 *      type promises. This is the check that was missing.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { config } from '../config/env.ts';
import { doubleUnwraps, doubleUnwrapsIn, typedLoaders, typedLoadersIn } from './helpers/adminReadScan.ts';

const PORT = 5289;
const API = `http://127.0.0.1:${PORT}/api`;
const ADMIN_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../admin-mobile/src');

console.log('====================================================');
console.log('  THE ADMIN APP READS WHAT THE SERVER SENDS         ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 900)}`);
  }
}

// ---------------------------------------------------------------------
console.log('-- The scanner can still see the defect');

const planted = `
  // api.get('/x').then(r => r.data)  <- a comment, must not count
  const a = useResource<{ rows: Row[]; total?: number }>(() => api.get('/admin/a').then(r => r.data), []);
  const save = async () => {
    const result = await api.put('/admin/b', {});
    setData(result.data.flags);
  };
`;
it('A chained double unwrap is found, and a commented one is not', () => {
  const found = doubleUnwrapsIn('planted.tsx', planted);
  assert.equal(found.filter(f => f.text.includes('then')).length, 1, JSON.stringify(found));
});
it('An awaited result read as result.data is found', () => {
  assert.ok(doubleUnwrapsIn('planted.tsx', planted).some(f => f.text === 'result.data'));
});
it('A clean loader is not reported', () => {
  assert.deepEqual(doubleUnwrapsIn('clean.tsx', `const a = useResource<X>(() => api.get('/admin/a'), []);`), []);
});
it('A typed loader yields its path and its required keys, not the optional ones', () => {
  const clean = `const a = useResource<{ rows: Row[]; total?: number; nested: { x: number } }>(() => api.get('/admin/a'), []);`;
  const [loader] = typedLoadersIn('clean.tsx', clean);
  assert.equal(loader.path, '/admin/a');
  assert.deepEqual(loader.requiredKeys, ['rows', 'nested']);
});
it('A named interface is followed to its keys', () => {
  const src = `interface Payload {\n  dues: Row[];\n  summary: { a: number };\n  extra?: string;\n}\nconst d = useResource<Payload>(() => api.get('/admin/payouts/dues'), []);`;
  assert.deepEqual(typedLoadersIn('x.tsx', src)[0].requiredKeys, ['dues', 'summary']);
});

// ---------------------------------------------------------------------
console.log('\n-- The admin app');

const unwraps = doubleUnwraps(ADMIN_SRC);
it('No admin screen unwraps a client result a second time', () => {
  assert.deepEqual(unwraps.map(f => `${f.file}:${f.line} ${f.text}`), []);
});

const loaders = typedLoaders(ADMIN_SRC);
it('The scanner found the money screens (it is still reading the app)', () => {
  const paths = new Set(loaders.map(l => l.path));
  for (const p of ['/admin/payouts/dues', '/admin/cash/deposits', '/admin/payee-accounts', '/admin/settings', '/admin/rates/restaurants']) {
    assert.ok(paths.has(p), `no loader found for ${p}; found ${[...paths].join(', ')}`);
  }
});

// ---------------------------------------------------------------------
console.log('\n-- Each loader against the real route');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
const token = jwt.sign({ sub: 'usr_admin_01', role: 'super_admin' }, config.JWT_SECRET, {
  expiresIn: '1h',
  algorithm: 'HS256'
});

try {
  const seen = new Set<string>();
  for (const loader of loaders) {
    const key = `${loader.path}|${loader.requiredKeys.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const res = await fetch(`${API}${loader.path.replace(/^\/api/, '')}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000)
    });
    const payload: any = await res.json().catch(() => ({}));
    // Exactly what createClient hands the screen.
    const read = payload?.data ?? payload;
    it(`${loader.file}:${loader.line} GET ${loader.path} → ${loader.requiredKeys.join(', ') || '(defined)'}`, () => {
      assert.equal(res.status, 200, `status ${res.status}: ${JSON.stringify(payload).slice(0, 200)}`);
      assert.notEqual(read, undefined);
      for (const k of loader.requiredKeys) {
        assert.ok(read && k in read, `the screen reads "${k}", the route sent ${Object.keys(read || {}).join(', ')}`);
      }
    });
  }
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
