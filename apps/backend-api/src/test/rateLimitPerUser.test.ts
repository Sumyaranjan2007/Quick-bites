/**
 * The request limit is per account, not per address (N15 / S4).
 *
 * Indian carriers put thousands of phones behind one IP. With one bucket per
 * IP, two people on the same tower shared 100 requests a minute; one rider
 * streaming a trip could lock everyone else out. The middleware is driven
 * directly, with the IP the test chooses, so "behind one address" is exact.
 */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import { rateLimiterMiddleware, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';

console.log('====================================================');
console.log('  ONE BUSY PHONE DOES NOT LOCK OUT ITS NEIGHBOURS   ');
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

const token = (sub: string) => jwt.sign({ sub, role: 'customer' }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

/** Sends one request through the limiter; true when it was let through. */
function hit(ip: string, auth?: string): boolean {
  let through = false;
  const req: any = { ip, socket: {}, headers: auth ? { authorization: `Bearer ${auth}` } : {} };
  const res: any = {
    statusCode: 200,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    json() { return this; }
  };
  rateLimiterMiddleware(req, res, () => { through = true; });
  return through;
}

const TOWER = '100.64.0.1';

resetRequestRateLimit();
const alice = token('usr_alice');
const bob = token('usr_bob');
let aliceOk = 0;
for (let i = 0; i < 130; i++) if (hit(TOWER, alice)) aliceOk++;
const bobFirst = hit(TOWER, bob);

it('One account is throttled at its own allowance', () => {
  assert.equal(aliceOk, 100, `alice got ${aliceOk} of 130 through`);
});
it('and a second account on the SAME address is not locked out by it', () => {
  assert.equal(bobFirst, true, 'bob was refused because alice used up the address');
});

resetRequestRateLimit();
let anonOk = 0;
for (let i = 0; i < 400; i++) if (hit(TOWER)) anonOk++;
it('Anonymous requests still have a per-address limit', () => {
  assert.equal(anonOk, 300, `${anonOk} anonymous requests got through`);
});

resetRequestRateLimit();
const floodTokens = Array.from({ length: 40 }, (_, i) => token(`usr_flood_${i}`));
let floodOk = 0;
const floodStarted = Date.now();
for (let i = 0; i < 2000; i++) if (hit('203.0.113.9', floodTokens[i % 40])) floodOk++;
// The address bucket refills at 25 a second while the loop runs.
const refill = Math.ceil(((Date.now() - floodStarted) / 1000) * 25) + 1;
it('and one address cannot flood the server with many accounts', () => {
  assert.ok(floodOk >= 1500 && floodOk <= 1500 + refill, `${floodOk} requests got through from one address`);
});

resetRequestRateLimit();
const forged = jwt.sign({ sub: 'usr_forged' }, 'not-the-secret', { algorithm: 'HS256' });
let forgedOk = 0;
for (let i = 0; i < 400; i++) if (hit('198.51.100.7', forged)) forgedOk++;
it('A forged token is treated as anonymous, not as its own account', () => {
  assert.equal(forgedOk, 300, `${forgedOk} requests with a forged token got through`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
