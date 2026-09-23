/**
 * The bank chain, end to end, over HTTP: a partner adds an account, an
 * administrator sees it, applies it, and only then can money go anywhere.
 *
 * This suite exists because the owner reported "nothing is coming up" on the
 * admin Bank screen while every module test for payout accounts passed. Those
 * tests call `payeeAccounts.ts` directly. A route that is mounted twice, guarded
 * by a permission nobody holds, or filtered by a condition no account meets is
 * invisible to all of them -- the module is correct and the screen is empty.
 *
 * So every assertion here goes through the assembled app, with a real token,
 * against the route the screen actually calls.
 *
 * The shape of each check is deliberate: assert the value MOVES. "The account is
 * not payable" passes just as well when the account does not exist, when the
 * list is empty, and when the whole endpoint is broken. Only "it was not payable,
 * and after this one tap it is" can tell those apart.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { payableAccountFor } from '../modules/payments/payeeAccounts.ts';

const PORT = 5197;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  THE BANK CHAIN, OVER HTTP                         ');
console.log('====================================================\n');

let failed = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failed++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

/** The admin screen's own call. If this shape changes, the screen goes blank. */
async function adminAccounts(token: string) {
  const { status, json } = await api('/admin/payee-accounts', {}, token);
  return { status, accounts: (json?.data?.accounts || []) as any[] };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');
  const rider = await login('rider@quickbite.app');

  // ----------------------------------------------------------------
  console.log('\n-- The route the screen calls');

  const baseline = await adminAccounts(admin.token);
  check('An administrator can read the payout accounts endpoint', baseline.status === 200,
    `status ${baseline.status}`);

  /*
   * The distinction the owner could not make from the screen. A 200 carrying an
   * empty list is a working system with nothing in it; every other status is a
   * fault. They need opposite responses, and the screen currently renders both
   * as the same blank card.
   */
  console.log(`       (baseline: ${baseline.accounts.length} account(s) already on file)`);

  // ----------------------------------------------------------------
  console.log('\n-- A rider adds an account, with no RazorpayX keys configured');

  const submit = await api('/payee-accounts/me', {
    method: 'POST',
    body: {
      method: 'BANK',
      holderName: 'Ravi Kumar',
      accountNumber: '50100234567890',
      accountNumberConfirm: '50100234567890',
      ifsc: 'HDFC0001234'
    }
  }, rider.token);

  check('A rider can submit a bank account without a payout gateway', submit.status === 201,
    `status ${submit.status}: ${JSON.stringify(submit.json).slice(0, 200)}`);

  const accountId = submit.json?.data?.account?.id;
  check('and the submission comes back with an account id', !!accountId);

  const afterSubmit = await adminAccounts(admin.token);
  const mine = afterSubmit.accounts.find(a => a.id === accountId);

  /*
   * The assertion that answers the owner's report. The account was not on the
   * admin endpoint a moment ago and is now, which no amount of empty-list
   * behaviour can fake.
   */
  check('THE SUBMITTED ACCOUNT APPEARS ON THE ADMIN ENDPOINT', !!mine,
    `${afterSubmit.accounts.length} account(s) returned, none with id ${accountId}`);
  check('and it is waiting, not already applied', !!mine && !mine.appliedAt);

  const ownerId = mine?.ownerId;

  // ----------------------------------------------------------------
  console.log('\n-- Nothing is payable until a person applies it');

  const payableBefore = payableAccountFor('RIDER', ownerId);
  check('An account nobody has applied cannot receive money', payableBefore === null,
    `got ${payableBefore?.id}`);

  const apply = await api(`/admin/payee-accounts/${accountId}/review`, {
    method: 'POST',
    body: { decision: 'APPROVE', note: 'Checked against the passbook in the office.' }
  }, admin.token);

  check('An administrator can apply an account with no gateway configured', apply.status === 200,
    `status ${apply.status}: ${JSON.stringify(apply.json).slice(0, 200)}`);

  const payableAfter = payableAccountFor('RIDER', ownerId);
  check('THE SAME ACCOUNT BECOMES PAYABLE AFTER ONE TAP', payableAfter?.id === accountId,
    `payable is now ${payableAfter?.id ?? 'nothing'}`);

  const afterApply = await adminAccounts(admin.token);
  const applied = afterApply.accounts.find(a => a.id === accountId);
  check('and the endpoint reports who applied it and when',
    !!applied?.appliedAt && !!applied?.appliedByAdminId,
    JSON.stringify({ at: applied?.appliedAt, by: applied?.appliedByAdminId }));

  // ----------------------------------------------------------------
  console.log('\n-- A second account replaces the first, it does not join it');

  const second = await api('/payee-accounts/me', {
    method: 'POST',
    body: { method: 'VPA', holderName: 'Ravi Kumar', vpa: 'ravi.kumar@okhdfcbank' }
  }, rider.token);
  const secondId = second.json?.data?.account?.id;
  check('A rider can add a second account', second.status === 201 && !!secondId,
    `status ${second.status}: ${JSON.stringify(second.json).slice(0, 200)}`);

  await api(`/admin/payee-accounts/${secondId}/review`, {
    method: 'POST',
    body: { decision: 'APPROVE', note: 'Rider asked to be paid by UPI instead.' }
  }, admin.token);

  const payableFinal = payableAccountFor('RIDER', ownerId);
  check('THE NEWLY APPLIED ACCOUNT TAKES OVER', payableFinal?.id === secondId,
    `payable is ${payableFinal?.id}`);
  check('and the previous one STOPS being payable', payableFinal?.id !== accountId);

  // ----------------------------------------------------------------
  console.log('\n-- What the screen needs in order to say anything useful');

  const row = afterApply.accounts.find(a => a.id === accountId);
  for (const field of ['ownerType', 'ownerId', 'ownerName', 'validationStatus']) {
    check(`Every row carries ${field}, so the screen can section and label it`,
      row?.[field] !== undefined, JSON.stringify(Object.keys(row || {})));
  }

  // A full account number leaving the server would put it in a log, a crash
  // report and a screenshot. The administrator needs it to check a document,
  // and that is a deliberate, separate decision -- not something to discover
  // here by accident.
  const serialized = JSON.stringify(afterApply.accounts);
  check('No full account number is broadcast by the list endpoint',
    !serialized.includes('50100234567890'));
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
