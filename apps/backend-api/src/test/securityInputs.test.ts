/**
 * Security pass, Stage F part 1 (master plan): what the server accepts and gives back.
 *
 *   L1  A crash answers the general error, never the internal message.
 *   L3  A Customer-app session of a partner cannot read the partner's kitchen record.
 *   L5  Documents are photos sent from the app: no links, no SVG.
 *   L6  Dish photos are a photo or an https link: no javascript:, no http:, no SVG.
 *   (L8, an old link document is not followed for the admin: personRecord.)
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { generateToken } from '../routes/authRouter.ts';

const PORT = 5317;
const API = `http://127.0.0.1:${PORT}/api`;
const KITCHEN = 'rst_bbh_01';
const OWNER = 'usr_partner_01';
const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

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

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');

  // L1: no route puts an internal error message in a 500 answer (comments stripped first).
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts')) {
        const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/status\(500\)\.json\([^;]*\b(err|error)\??\.message/.test(code)) leaks.push(path);
      }
    }
  };
  walk(fileURLToPath(new URL('../routes', import.meta.url)));
  it('L1: no route sends error.message in a 500', () => assert.deepEqual(leaks, []));

  // L3
  const own = await api(`/restaurants/owner/${OWNER}`, {}, partner);
  it('L3: the Partner session reads its own kitchen', () => assert.equal(own.status, 200, JSON.stringify(own.json).slice(0, 200)));
  // The partner also orders food: the Customer app granted them the customer role.
  const owner = memoryStore.users.get(OWNER) as any;
  owner.roles = [...new Set([...(owner.roles || [owner.role]), 'customer'])];
  const customerSession = generateToken(owner, 'customer', 'customer');
  const asCustomer = await api(`/restaurants/owner/${OWNER}`, {}, customerSession);
  it('L3: the same person on a Customer-app session is refused', () => assert.equal(asCustomer.status, 403));

  // L5
  const kitchenDoc = (fileUrl: string) =>
    api(`/restaurants/${KITCHEN}/documents`, { method: 'POST', body: { documentType: 'PAN', documentNumber: 'ABCPE1234F', fileUrl } }, partner);
  const link = await kitchenDoc('https://example.test/pan.jpg');
  it('L5: kitchen document as an https link: 400', () => assert.equal(link.status, 400));
  const svg = await kitchenDoc(SVG);
  it('L5: kitchen document as SVG: 400', () => assert.equal(svg.status, 400));
  const photo = await kitchenDoc(PHOTO);
  it('L5: kitchen document as a PNG photo: accepted', () => assert.equal(photo.status, 201, JSON.stringify(photo.json).slice(0, 200)));
  const riderLink = await api('/riders/documents', { method: 'POST', body: { documentType: 'DRIVING_LICENSE', documentNumber: 'KA05 2026 0009999', fileUrl: 'https://example.test/dl.jpg' } }, rider);
  it('L5: rider document as a link: 400', () => assert.equal(riderLink.status, 400));
  const kycLink = await api('/kyc/submit', { method: 'POST', body: { entityType: 'RESTAURANT', entityId: KITCHEN, entityName: 'x', documentType: 'GSTIN', fileUrl: 'http://example.test/g.jpg' } }, partner);
  it('L5: /kyc/submit with a link: 400', () => assert.equal(kycLink.status, 400));

  // L6
  const dish = (imageUrl: string) =>
    api(`/restaurants/${KITCHEN}/menu/items`, { method: 'POST', body: { name: 'Test dish', price: 100, isVeg: true, categoryName: 'Tests', imageUrl } }, partner);
  for (const bad of ['javascript:alert(1)', 'http://example.test/d.jpg', SVG]) {
    const res = await dish(bad);
    it(`L6: dish photo ${bad.slice(0, 22)}: 400`, () => assert.equal(res.status, 400));
  }
  for (const good of ['https://example.test/d.jpg', PHOTO]) {
    const res = await dish(good);
    it(`L6: dish photo ${good.slice(0, 22)}: accepted`, () => assert.ok(res.status < 300, `${res.status} ${JSON.stringify(res.json).slice(0, 200)}`));
  }
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
