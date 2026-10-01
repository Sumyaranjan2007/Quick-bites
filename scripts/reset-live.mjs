#!/usr/bin/env node
/**
 * Fresh start for the live platform (owner, 1 Oct 2026).
 *
 * Deletes every restaurant, menu, order, rider, customer, address, coupon,
 * payout, ledger entry, document, ticket and device on the live server, through
 * the server's own guarded reset (POST /api/admin/platform/reset). What stays:
 * administrator accounts (so you can still sign in), the rates you set, and the
 * audit log, which records that the reset happened.
 *
 * Before running: Railway -> the backend service -> Variables -> add
 * ALLOW_PLATFORM_RESET = true, and wait for the redeploy. Afterwards set it back
 * to false (or delete it).
 *
 * You type your own email and password; nothing is stored or printed.
 *
 * Usage: node scripts/reset-live.mjs [api-url]
 */
import readline from 'node:readline';

const API = (process.argv[2] || 'https://quick-bites-production.up.railway.app/api').replace(/\/$/, '');
const PHRASE = 'DELETE ALL PLATFORM DATA';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = [];
const waiting = [];
rl.on('line', line => (waiting.length ? waiting.shift()(line) : lines.push(line)));
rl.on('close', () => waiting.splice(0).forEach(resolve => resolve('')));
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = text => (muted && !/\n/.test(text) ? write('*') : write(text));
function ask(q, hidden = false) {
  process.stdout.write(q);
  muted = hidden;
  return new Promise(resolve => {
    const done = line => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(line);
    };
    lines.length ? done(lines.shift()) : waiting.push(done);
  });
}

async function call(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

console.log(`\nFRESH START for ${API}`);
console.log('Deletes ALL restaurants, menus, orders, riders, customers, payouts and documents.');
console.log('Keeps: administrator accounts, rates, and the audit log. This cannot be undone.\n');

async function main() {
  const email = (await ask('Super admin email: ')).trim();
  const password = await ask('Password: ', true);
  const login = await call('/auth/login', { email, password });
  const token = login.json?.data?.token;
  if (!token) {
    console.log(`\nCould not sign in: ${login.json?.error?.message || `HTTP ${login.status}`}`);
    process.exitCode = 1;
    return;
  }
  const typed = (await ask(`\nType exactly  ${PHRASE}  to delete everything: `)).trim();
  if (typed !== PHRASE) {
    console.log('\nNot the phrase. Nothing was deleted.');
    process.exitCode = 1;
    return;
  }
  const reset = await call('/admin/platform/reset', { confirm: PHRASE }, token);
  if (reset.status !== 200) {
    const code = reset.json?.error?.code;
    console.log(`\nNothing was deleted: ${reset.json?.error?.message || `HTTP ${reset.status}`}`);
    if (code === 'PLATFORM_RESET_DISABLED') {
      console.log('Add ALLOW_PLATFORM_RESET = true in Railway Variables, wait for the redeploy, then run this again.');
    }
    process.exitCode = 1;
    return;
  }
  const removed = reset.json?.data?.removed || {};
  console.log('\nDone. Deleted:');
  for (const [what, n] of Object.entries(removed)) if (n) console.log(`  ${String(n).padStart(6)}  ${what}`);
  console.log('\nNow set ALLOW_PLATFORM_RESET back to false in Railway.');
}

await main().finally(() => rl.close());
