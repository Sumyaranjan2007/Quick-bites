/**
 * Every request body the four phone apps send matches what its route accepts.
 *
 * The route contract proves the paths exist; it could not see that the admin
 * app's "Save these rates" sent `{ changes }` to a route that only took
 * `{ rates }`, so every platform-rate save from the shipped app was refused.
 * This reads each route's REAL body schema from the running server (the
 * `validate()` middleware carries it) and each app's body from the TypeScript
 * AST, and reports a key the server would drop or refuse, and a required key
 * the app never sends.
 *
 * Same discipline as routeContract (brain-sync §3): planted probes prove each
 * kind of finding is reported and a correct call is not; floors are measured,
 * not guessed; and the counts the scan CANNOT check (unreadable bodies,
 * unvalidated routes) are pinned, so a new blind spot fails instead of passing.
 *
 * Plan: platform-inventory.md S5.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import {
  routeBodies,
  appBodies,
  compareBodies,
  findingId,
  type RouteBody
} from './helpers/bodyContract.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.resolve(HERE, '../../..');

console.log('====================================================');
console.log('  EVERY BODY THE APPS SEND IS ONE THE SERVER TAKES  ');
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

await seedDatabase();
const app: any = await createApp();
const server = routeBodies(app);

const APPS = ['admin-mobile', 'restaurant-mobile', 'delivery-mobile', 'customer-mobile'] as const;
const scanned = APPS.map(name => ({ name, ...appBodies(name, path.join(APPS_DIR, name, 'src')) }));
const allBodies = scanned.flatMap(s => s.bodies);
const { findings, matched } = compareBodies(allBodies, server.routes);

console.log(
  `Read ${server.routes.length} validated body routes (${server.unvalidated} unvalidated), ` +
    `${allBodies.length} app bodies (${scanned.reduce((t, s) => t + s.unreadable, 0)} unreadable), ${matched} matched.\n`
);

// ---------------------------------------------------------------------------
console.log('-- The real apps');

it('EVERY BODY THE PHONE APPS SEND MATCHES ITS ROUTE', () => {
  assert.equal(
    findings.length,
    0,
    `these bodies disagree with the route they are sent to:\n  ${findings
      .map(f => `${findingId(f)}   <- ${f.call.file}:${f.call.line}`)
      .join('\n  ')}`
  );
});

it('and the scan actually read both sides (floors, measured 25 Sep)', () => {
  // Measured: 196 routes with a body schema, 111 app bodies, 101 matched.
  assert.ok(server.routes.length >= 180, `only ${server.routes.length} validated body routes were read`);
  assert.ok(matched >= 95, `only ${matched} app bodies matched a validated route`);
  const floors: Record<string, number> = {
    'admin-mobile': 50,
    'restaurant-mobile': 10,
    'delivery-mobile': 14,
    'customer-mobile': 17
  };
  for (const s of scanned) {
    assert.ok(s.bodies.length >= floors[s.name], `only ${s.bodies.length} bodies read in ${s.name}`);
  }
});

it('and what it cannot read is pinned, so a new blind spot fails', () => {
  /*
   * Each of these is checked by hand and listed so the number can only fall.
   *   delivery PATCH /riders/me          body is `Record<string, unknown>`
   *   delivery POST /riders/logout       no body the server reads
   *   delivery POST /riders/orders/:id/claim, /decline   no body the server reads
   *   customer POST /addresses (checkout) built in another scope
   */
  const unreadable = scanned.flatMap(s => s.unreadableAt.map(u => `${s.name} ${u}`));
  assert.ok(unreadable.length <= 5, `more bodies than before cannot be read:\n  ${unreadable.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
console.log('\n-- Planted probes: each kind of finding is reported, a correct call is not');

const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-bodies-'));
const probeSrc = path.join(probeDir, 'src');
fs.mkdirSync(probeSrc);
const plant = (name: string, text: string) => fs.writeFileSync(path.join(probeSrc, name), text);

plant(
  'Dropped.ts',
  `export const a = (api: any) => api.put('/admin/pricing/config', { rates: {}, note: 'raise it', bogus: 1 });\n`
);
plant('Missing.ts', `export const b = (api: any) => api.post('/admin/coupons', { code: 'PROBE' });\n`);
plant(
  'Good.ts',
  `export const c = (api: any) => api.post('/admin/coupons', { code: 'PROBE', discountType: 'FLAT', discountValue: 10 });\n`
);
plant(
  'Variable.ts',
  [
    `export async function d(apiUrl: string) {`,
    `  const payload = { code: 'PROBE', discountType: 'FLAT', discountValue: 10, surprise: true };`,
    `  return apiFetch(\`\${apiUrl}/admin/coupons\`, { method: 'POST', body: JSON.stringify(payload) });`,
    `}`,
    `declare function apiFetch(u: string, i: any): any;`
  ].join('\n')
);
plant(
  'TypedParam.ts',
  [
    `export function e(ctx: any, body: { lat: number; lng: number; altitude?: number }) {`,
    `  return request(ctx, '/riders/location', { method: 'POST', body: JSON.stringify(body) });`,
    `}`,
    `declare function request(c: any, p: string, i: any): any;`
  ].join('\n')
);
plant(
  'Spread.ts',
  `export const f = (api: any, x: boolean) => api.post('/admin/coupons', { code: 'P', discountType: 'FLAT', discountValue: 1, ...(x ? { hidden: 1 } : {}) });\n`
);
plant('Opaque.ts', `export const g = (api: any, body: any) => api.post('/admin/coupons', body);\n`);

const probe = appBodies('probe', probeSrc);
const probeFindings = compareBodies(probe.bodies, server.routes).findings;
const has = (file: string, kind: string, key: string) =>
  probeFindings.some(f => f.call.file.endsWith(file) && f.kind === kind && f.key === key);

it('a key the route drops is reported (DROPPED)', () => {
  assert.ok(has('Dropped.ts', 'DROPPED', 'bogus'), JSON.stringify(probeFindings.map(findingId)));
});
it('a required key never sent is reported (MISSING)', () => {
  assert.ok(has('Missing.ts', 'MISSING', 'discountType') && has('Missing.ts', 'MISSING', 'discountValue'));
});
it('a body built in a variable is read', () => {
  assert.ok(has('Variable.ts', 'DROPPED', 'surprise'));
});
it('a body typed as a parameter is read', () => {
  assert.ok(has('TypedParam.ts', 'DROPPED', 'altitude'));
});
it('a conditional spread is read', () => {
  assert.ok(has('Spread.ts', 'DROPPED', 'hidden'));
});
it('an opaque body is counted as unreadable, never as matching', () => {
  assert.equal(probe.unreadable, 1, `unreadable ${probe.unreadable}`);
  assert.ok(!probeFindings.some(f => f.call.file.endsWith('Opaque.ts')));
});
it('Control: a correct call produces no finding', () => {
  assert.ok(!probeFindings.some(f => f.call.file.endsWith('Good.ts')), JSON.stringify(probeFindings.map(findingId)));
});

// No live route has a strict body at its top level, so strictness is proved
// against a synthetic route: the same comparison, with `strict: true`.
const strictRoute: RouteBody = {
  method: 'POST',
  path: '/api/probe/strict',
  keys: { a: { optional: false } },
  strict: true,
  aliases: {}
};
const strictFindings = compareBodies(
  [{ app: 'probe', file: 'Strict.ts', line: 1, method: 'POST', path: '/probe/strict', keys: ['a', 'extra'], opaqueSpread: false }],
  [strictRoute]
).findings;
it('a key a .strict() schema rejects is reported as REFUSED', () => {
  assert.ok(strictFindings.some(f => f.kind === 'REFUSED' && f.key === 'extra'));
});

// The alias the pricing route declares must be honoured, or the shipped admin
// app's `{ changes }` would be reported for ever after it was made to work.
const pricing = server.routes.find(r => r.method === 'PUT' && r.path === '/api/admin/pricing/config');
it('a route-declared alias ({ changes } -> rates) is honoured', () => {
  assert.equal(pricing?.aliases.changes, 'rates');
});

fs.rmSync(probeDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
