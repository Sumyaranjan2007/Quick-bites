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
import { memoryStore, nextFlushDelayMs } from '../db/client.ts';

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

  // ----------------------------------------------------------------
  console.log('\n-- The diagnostic: what the server actually holds');

  /*
   * Written because a real submission on the live deployment never reached the
   * admin console while every layer read as correct. It reports observations
   * rather than conclusions, from the submitter's own session, so nobody has to
   * hand over an administrator password to debug their own bank details.
   */
  const diag = await api('/payee-accounts/me/diagnostic', {}, rider.token);
  check('A rider can read their own diagnostic', diag.status === 200,
    `status ${diag.status}: ${JSON.stringify(diag.json).slice(0, 200)}`);

  const d = diag.json?.data;
  check('It says who the server resolved them to', d?.youAre?.resolvedTo?.ownerType === 'RIDER',
    JSON.stringify(d?.youAre));
  check('and it FINDS the accounts they submitted', d?.yourAccounts?.foundByYourUserId >= 2,
    `found ${d?.yourAccounts?.foundByYourUserId}`);
  check('filed under the owner id the screens look them up by',
    d?.yourAccounts?.foundByYourResolvedOwnerId === d?.yourAccounts?.foundByYourUserId,
    JSON.stringify(d?.yourAccounts));
  check('so nothing is reported as filed under a different owner id',
    Array.isArray(d?.yourAccounts?.filedUnderADifferentOwnerId) &&
      d.yourAccounts.filedUnderADifferentOwnerId.length === 0);
  check('It reports whether the store is durable',
    typeof d?.theStore?.durable === 'boolean');

  /*
   * The fields that tell one server from two. The owner sees a badge on the
   * Bank nav and nothing on the screen behind it, and within one process that
   * is a contradiction -- the badge counts a subset of what the list returns.
   * Asserted here as an invariant so the contradiction is impossible to
   * reproduce in a single process, which is what makes it evidence of more than
   * one when the owner's own run shows it.
   */
  check('It names the process that answered',
    typeof d?.whoAnswered?.pid === 'number' && !!d?.whoAnswered?.startedAt,
    JSON.stringify(d?.whoAnswered));
  check('THE BADGE NEVER EXCEEDS THE LIST IN ONE PROCESS',
    d?.whatTheAdminWouldSee?.badgeCount <= d?.whatTheAdminWouldSee?.listCount,
    JSON.stringify(d?.whatTheAdminWouldSee));
  check('and both counts see the account that was just submitted',
    d?.whatTheAdminWouldSee?.listCount >= 1,
    JSON.stringify(d?.whatTheAdminWouldSee));
  /*
   * Adding an account archives the previous one -- replace semantics, decided
   * in addAccount and documented there, because a payout already sent points
   * at the old row and a history that cannot say where money went is not one.
   *
   * So exactly one row is live, and it is the newest. Asserted rather than
   * assumed: the first version of this check asked whether EVERY row would
   * appear, which is a claim about a system that keeps them all, and it failed
   * honestly. The diagnostic is what showed the real rule.
   */
  const live = (d?.yourAccounts?.rows || []).filter((r: any) => r.wouldAppearInAdminList);
  check('Exactly one account is live, the rest are archived by replacement',
    live.length === 1, JSON.stringify(d?.yourAccounts?.rows));
  check('and the live one is the newest submission',
    live[0]?.id === secondId, `live is ${live[0]?.id}, newest is ${secondId}`);

  /*
   * The leak check. A diagnostic that answers "where is my account" by
   * returning everybody's is a worse problem than the one it was written for.
   * The partner shares this deployment with the rider whose accounts are above.
   */
  const partner = await login('partner@quickbite.app');
  const partnerDiag = await api('/payee-accounts/me/diagnostic', {}, partner.token);
  const pd = partnerDiag.json?.data;
  check('A partner resolves to their restaurant', pd?.youAre?.resolvedTo?.ownerType === 'RESTAURANT',
    JSON.stringify(pd?.youAre));
  check('THE PARTNER SEES NONE OF THE RIDER ROWS', (pd?.yourAccounts?.rows || []).length === 0,
    JSON.stringify(pd?.yourAccounts?.rows));
  check('and no account number reaches it at all',
    !JSON.stringify(partnerDiag.json).includes('50100234567890'));
  // It still reports the shape of the store, which is what tells "nothing was
  // ever written" apart from "something was written and it is not yours".
  check('but it still counts what exists on the deployment',
    pd?.theStore?.totalAccountsOnThisDeployment >= 2,
    JSON.stringify(pd?.theStore));

  // ----------------------------------------------------------------
  console.log('\n-- The detector has to be able to FIRE, not only stay quiet');

  /*
   * Everything above asserts the mismatch detector reports nothing, which is
   * exactly what a detector that can never fire also does. This is the whole
   * reason the endpoint was written -- an account that exists but is filed
   * under an owner id no screen looks up -- so the condition is created
   * deliberately and the detector has to find it.
   *
   * The row is edited in the store directly because there is no API that can
   * produce this state. That is the point: if there were, it would be a bug
   * with a route attached rather than one nobody can explain.
   */
  const victim = memoryStore.payeeAccounts.get(secondId) as any;
  const realOwnerId = victim.ownerId;
  victim.ownerId = 'rdr_not_the_one_any_screen_looks_up';
  memoryStore.payeeAccounts.set(secondId, victim);

  const broken = await api('/payee-accounts/me/diagnostic', {}, rider.token);
  const bd = broken.json?.data;

  check('It still finds the account by USER id when the owner id is wrong',
    bd?.yourAccounts?.foundByYourUserId >= 1, JSON.stringify(bd?.yourAccounts));
  check('THE DETECTOR REPORTS THE ACCOUNT AS FILED ELSEWHERE',
    (bd?.yourAccounts?.filedUnderADifferentOwnerId || []).some((r: any) => r.id === secondId),
    JSON.stringify(bd?.yourAccounts?.filedUnderADifferentOwnerId));
  check('and the lookup every screen uses no longer finds it',
    bd?.yourAccounts?.foundByYourResolvedOwnerId < bd?.yourAccounts?.foundByYourUserId,
    JSON.stringify(bd?.yourAccounts));

  // Put it back, so nothing after this runs against a deliberately broken row.
  victim.ownerId = realOwnerId;
  memoryStore.payeeAccounts.set(secondId, victim);

  // ----------------------------------------------------------------
  console.log('\n-- A write that is never flushed is a write that was never made');

  /*
   * The autosave debounce had no ceiling. Every write cleared the timer and
   * started it again, so continuous traffic could defer persistence
   * indefinitely and everything since the last flush lived only in memory. On a
   * host that restarts, that is silent data loss which looks exactly like a
   * record that was never written -- acknowledged to the caller, counted by the
   * process still holding it, absent afterwards.
   *
   * Asserted as arithmetic rather than by waiting on a real timer, because a
   * test that sleeps for the ceiling is a test nobody keeps.
   */
  const t0 = 1_000_000;
  check('A quiet store waits the full debounce', nextFlushDelayMs(null, t0) === 300,
    String(nextFlushDelayMs(null, t0)));
  check('A burst still coalesces while the ceiling is far away',
    nextFlushDelayMs(t0, t0 + 100) === 300, String(nextFlushDelayMs(t0, t0 + 100)));
  check('THE DELAY SHRINKS AS THE OLDEST WRITE AGES',
    nextFlushDelayMs(t0, t0 + 1900) === 100, String(nextFlushDelayMs(t0, t0 + 1900)));
  check('and a write can NEVER be deferred past the ceiling',
    nextFlushDelayMs(t0, t0 + 2000) === 0 && nextFlushDelayMs(t0, t0 + 999_999) === 0);

  // ----------------------------------------------------------------
  console.log('\n-- The whole chain the owner described, for a restaurant');

  /*
   * Their words: the bank option "should really be connected to the admin bank
   * section and all details will appear there after verification it will be
   * added to their profile which is available in the admin portal so they can
   * pay everything as settlement".
   *
   * So: submit from the partner app, appear in the admin queue, an
   * administrator verifies, it attaches to that partner's PROFILE, and the row
   * they settle from shows where the money goes. Asserted as one movement,
   * because each half passing separately is what lets a partner be connected on
   * one screen and absent on the next.
   */
  const restaurantId = pd?.youAre?.resolvedTo?.ownerId;
  check('The partner resolves to a restaurant to attach an account to', !!restaurantId);

  const profileBefore = await api(`/admin/restaurants/${restaurantId}`, {}, admin.token);
  const destBefore = profileBefore.json?.data?.payoutDestination;
  check('Their profile starts with no account connected', destBefore?.connected === false,
    JSON.stringify(destBefore));
  check('and says so in words rather than showing a blank',
    typeof destBefore?.reason === 'string' && destBefore.reason.length > 10,
    destBefore?.reason);
  check('and is explicitly not payable', destBefore?.payableNow === false);

  const partnerSubmit = await api('/payee-accounts/me', {
    method: 'POST',
    body: {
      method: 'BANK',
      holderName: 'Spice Garden Foods',
      accountNumber: '918273645500',
      accountNumberConfirm: '918273645500',
      ifsc: 'ICIC0004321'
    }
  }, partner.token);
  const partnerAccountId = partnerSubmit.json?.data?.account?.id;
  check('A partner can submit a bank account', partnerSubmit.status === 201 && !!partnerAccountId,
    `status ${partnerSubmit.status}: ${JSON.stringify(partnerSubmit.json).slice(0, 200)}`);

  const queue = await adminAccounts(admin.token);
  check('It appears in the admin bank queue', queue.accounts.some(a => a.id === partnerAccountId));

  // Still not on the profile: submitting is not connecting. This is the step the
  // owner asked for -- "after verification" -- and the profile must not jump
  // ahead of their tap.
  const profileMid = await api(`/admin/restaurants/${restaurantId}`, {}, admin.token);
  check('Submitting alone does NOT connect it to the profile',
    profileMid.json?.data?.payoutDestination?.connected === false);

  const verify = await api(`/admin/payee-accounts/${partnerAccountId}/review`, {
    method: 'POST',
    body: { decision: 'APPROVE', note: 'Checked against the cancelled cheque.' }
  }, admin.token);
  check('An administrator verifies it', verify.status === 200,
    `status ${verify.status}: ${JSON.stringify(verify.json).slice(0, 200)}`);

  const profileAfter = await api(`/admin/restaurants/${restaurantId}`, {}, admin.token);
  const destAfter = profileAfter.json?.data?.payoutDestination;
  check('THE ACCOUNT IS NOW ON THEIR PROFILE', destAfter?.connected === true,
    JSON.stringify(destAfter));
  check('with the holder name and the last four to check against a document',
    destAfter?.account?.holderName === 'Spice Garden Foods' &&
      destAfter?.account?.accountLast4 === '5500',
    JSON.stringify(destAfter?.account));
  check('and it records WHO connected it, not just that somebody did',
    !!destAfter?.account?.appliedAt && !!destAfter?.appliedByName,
    JSON.stringify({ at: destAfter?.account?.appliedAt, by: destAfter?.appliedByName }));
  check('and the profile now says they can be paid', destAfter?.payableNow === true,
    destAfter?.reason);

  // A profile must never print a full account number. It is the screen most
  // likely to be shown to somebody standing beside the desk.
  check('The profile does not carry the full account number',
    !JSON.stringify(profileAfter.json).includes('918273645500'));

  const settlements = await api('/admin/settlements', {}, admin.token);
  const theirRow = (settlements.json?.data?.settlements || [])
    .find((r: any) => r.restaurantId === restaurantId);
  check('THE SETTLEMENT ROW SHOWS WHERE THE MONEY GOES',
    theirRow?.willPayInto?.accountLast4 === '5500',
    JSON.stringify(theirRow?.willPayInto));
  check('so paying and seeing the destination is one screen, not two',
    theirRow?.willPayInto?.holderName === 'Spice Garden Foods');
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
