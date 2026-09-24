/**
 * WHAT WE PROMISE ABOUT MONEY ARRIVING, AND THE CONTROL THAT USED TO IMPLY
 * ASKING WAS PART OF IT.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS SUITE EXISTS FOR
 * -------------------------------------------------------------------------
 * One promise was written out by hand in four places: the partner policy, the
 * rider policy, and the statement screen of each app. The policy module derived
 * its two from `payoutCadenceDays`. The apps could not -- an app has no access
 * to the pricing config -- so both wrote "our daily run" into the JSX, and both
 * were still saying it after the cadence was changed to weekly.
 *
 * So the two groups of people with the most at stake in the answer were being
 * told, by our own apps, that money arrives the next day when it arrives up to
 * eight days later. A rider planning around that is not making a mistake.
 *
 * -------------------------------------------------------------------------
 * WHY THIS SUITE READS THE APPS' SOURCE
 * -------------------------------------------------------------------------
 * A backend check cannot catch a sentence hardcoded in a screen, and that is
 * precisely where this defect lived. So the checks below grep the app files, the
 * way kitchenPush.test.ts reads the channel ids out of the apps rather than
 * comparing a constant with itself -- a copy of the string on both sides of an
 * assertion is what let three spellings of one channel survive.
 *
 * -------------------------------------------------------------------------
 * AND THE RIDER'S CASH
 * -------------------------------------------------------------------------
 * `/riders/settlements` kept its own second copy of two things it had no
 * business computing: our cash in the rider's bag, added up from unsettled
 * orders rather than read from the rider's record, and a "you will receive"
 * figure with that cash SUBTRACTED from it.
 *
 * Both were wrong. The cash figure stopped agreeing with every other screen the
 * moment an administrator counted cash in at the office, because a return moves
 * the rider's record and does not touch the orders. And the platform does not
 * net: `duesFor` blocks a payout outright while any of our cash is in the bag,
 * which the payment policy states in as many words. A rider holding Rs 500
 * against Rs 1,800 of earnings was shown "you will receive Rs 1,300" and would
 * have received nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { createVersion } from '../modules/payments/pricingConfig.ts';
import {
  arrivalSentence,
  noRequestNeededSentence,
  payoutWindow,
  runCadence
} from '../modules/payments/payoutPromise.ts';
import { paymentPolicies } from '../modules/payments/paymentPolicies.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { duesFor } from '../modules/payments/payouts.ts';
import { ledger, accountFor } from '../modules/payments/ledger.ts';

const PORT = 5217;
const API = `http://127.0.0.1:${PORT}/api`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ADMIN = 'usr_admin_promise';

let failed = 0;
let passed = 0;

function check(name: string, fn: () => void) {
  /*
   * THIS RUNNER DOES NOT AWAIT, SO AN ASYNC CHECK COULD NEVER FAIL.
   *
   * An `async` body returns a promise the moment it hits its first await, the
   * assertions run after this function has already logged [PASS], and a rejected
   * assertion becomes an unhandled rejection nobody reads. A check of mine passed
   * that way, then passed again when I mutated the route it was testing to break
   * the exact thing it asserted. Refuse the shape rather than trusting nobody
   * writes it.
   */
  const result: any = fn();
  if (result && typeof result.then === 'function') {
    failed++;
    console.log(
      `[FAIL] ${name}: this check is async and this runner does not await, so its assertions could never fail. Await outside the check and assert synchronously inside it.`
    );
    return;
  }
  passed++;
  console.log(`[PASS] ${name}`);
}

/** Wraps check() so a throw is reported rather than killing the run. */
function it(name: string, fn: () => void) {
  try {
    check(name, fn);
  } catch (err: any) {
    failed++;
    passed--;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

async function api(route: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${route}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  }).catch((err: any) => ({ status: 0, __error: err?.name || String(err) }) as any);
  if (!('json' in res)) return { status: 0, json: { error: (res as any).__error } };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const rawSource = (relative: string) => fs.readFileSync(path.join(REPO, relative), 'utf8');

/**
 * An app file with its comments stripped.
 *
 * THE FIRST VERSION OF THESE CHECKS FAILED ON MY OWN PROSE. The screens carry a
 * header comment explaining why "Ask to be paid" and "our daily run" were
 * removed -- which is worth keeping, and which contains both strings. A grep of
 * the raw file therefore reported the button as still present in a file that no
 * longer has one.
 *
 * Deleting the explanation to satisfy the grep would be the wrong way round: the
 * comment is the only thing that stops somebody re-adding the control in six
 * months. So the check is made to assert what it claims to assert -- about the
 * CODE -- rather than the prose being trimmed to fit a weak check.
 */
const appSource = (relative: string) =>
  rawSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const RIDER_STATEMENT = 'apps/delivery-mobile/src/screens/EarningsStatementScreen.tsx';
const PARTNER_STATEMENT = 'apps/restaurant-mobile/src/screens/EarningsStatementScreen.tsx';
const RIDER_API = 'apps/delivery-mobile/src/lib/api.ts';
const PARTNER_API = 'apps/restaurant-mobile/src/lib/partnerApi.ts';
const RIDER_SETTLEMENT = 'apps/delivery-mobile/src/screens/SettlementScreen.tsx';

console.log('====================================================');
console.log('  WHEN THE MONEY ARRIVES, AND NOTHING TO ASK FOR     ');
console.log('====================================================\n');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');

try {
  /* ---------------------------------------------------------------- *
   *  THE WINDOW IS ARITHMETIC, NOT A ROUNDED GUESS                   *
   * ---------------------------------------------------------------- */
  console.log('-- The window a payee actually experiences');

  createVersion({ payoutCadenceDays: 7, partnerHoldDays: 1, riderHoldDays: 0 }, { userId: ADMIN }, 'Weekly run');

  it('A weekly run with a one-day hold is eight days, not seven', () => {
    /*
     * The whole reason the window is stated at all. "Payments run weekly" is
     * true and is not the answer to the question being asked: an order delivered
     * the day after a run waits the hold AND the full cadence. A partner
     * counting seven days from the delivery is counting the wrong thing, and we
     * told them to.
     */
    const w = payoutWindow('RESTAURANT');
    assert.equal(w.cadenceDays, 7);
    assert.equal(w.holdDays, 1);
    assert.equal(w.longestDraftDays, 8, 'hold plus cadence');
  });

  it('and with the bank leg it rounds up to two weeks, which is what the owner said', () => {
    // 8 days to draft + 2 working days at the bank = 10, which is inside two
    // weeks and outside one. The owner's "1-2 weeks" is correct and is now
    // DERIVED rather than typed in, so it follows the rates instead of going
    // stale beside them.
    assert.equal(payoutWindow('RESTAURANT').outerWeeks, 2);
    assert.equal(payoutWindow('RIDER').outerWeeks, 2, 'a zero hold plus a weekly run is still two weeks');
  });

  it('A daily run comes back inside one week', () => {
    createVersion({ payoutCadenceDays: 1 }, { userId: ADMIN }, 'Daily');
    assert.equal(payoutWindow('RIDER').longestDraftDays, 1);
    assert.equal(payoutWindow('RIDER').outerWeeks, 1, 'a daily run must not claim a two-week window');
  });

  it('A fortnightly run says so, and the window grows with it', () => {
    createVersion({ payoutCadenceDays: 14, partnerHoldDays: 2 }, { userId: ADMIN }, 'Fortnightly');
    assert.equal(runCadence(14), 'every fortnight');
    assert.equal(payoutWindow('RESTAURANT').longestDraftDays, 16);
    assert.equal(payoutWindow('RESTAURANT').outerWeeks, 3, '16 days plus the bank leg is three weeks');
  });

  it('An unconfigured cadence never becomes "every 0 days"', () => {
    // A zero here would read as "payments run every 0 days", which is the kind
    // of sentence a partner screenshots.
    assert.equal(runCadence(0), 'daily');
    assert.equal(runCadence(Number.NaN), 'daily');
  });

  /* ---------------------------------------------------------------- *
   *  THE POLICY AND THE APPS READ ONE FUNCTION                       *
   * ---------------------------------------------------------------- */
  console.log('\n-- One source for the sentence');

  createVersion({ payoutCadenceDays: 7, partnerHoldDays: 1, riderHoldDays: 0 }, { userId: ADMIN }, 'Back to weekly');

  const riderPolicy = () => paymentPolicies().find(p => p.id === 'rider-earnings')!;
  const partnerPolicy = () => paymentPolicies().find(p => p.id === 'partner-settlements')!;
  const bodyOf = (doc: any, heading: string) =>
    (doc.sections.find((s: any) => s.heading === heading)?.body as string) || '';

  it('The rider policy has a section on when they are paid', () => {
    assert.ok(bodyOf(riderPolicy(), 'When you are paid').length > 0, 'the heading moved or vanished');
  });

  it('and it says weekly while the cadence is weekly', () => {
    const body = bodyOf(riderPolicy(), 'When you are paid');
    assert.ok(body.includes('weekly'), body.slice(0, 300));
    assert.ok(!body.includes('daily'), `the policy still says daily: ${body.slice(0, 300)}`);
  });

  it('THE CADENCE CHANGING CHANGES THE POLICY', () => {
    /*
     * The check that would have caught the original defect. Not "the policy says
     * weekly" -- a hardcoded sentence passes that -- but "the policy follows the
     * rate", which only a derived one can.
     */
    const before = bodyOf(riderPolicy(), 'When you are paid');
    createVersion({ payoutCadenceDays: 1 }, { userId: ADMIN }, 'Daily for the check');
    const after = bodyOf(riderPolicy(), 'When you are paid');
    assert.notEqual(before, after, 'the policy did not move when the cadence did');
    assert.ok(after.includes('daily'), after.slice(0, 300));
    createVersion({ payoutCadenceDays: 7 }, { userId: ADMIN }, 'Back to weekly');
  });

  it('Neither policy still tells anybody to raise a request', () => {
    /*
     * §9.1. The controls are gone from both apps, so a policy pointing at one is
     * describing a button that does not exist -- and it is the sentence a partner
     * would quote back when a settlement is late.
     */
    for (const doc of [riderPolicy(), partnerPolicy()]) {
      const all = doc.sections.map((s: any) => `${s.heading} ${s.body}`).join(' ');
      assert.ok(!all.includes('raise a request'), `${doc.id} still says "raise a request"`);
      assert.ok(!all.includes('raise a payout request'), `${doc.id} still says "raise a payout request"`);
      assert.ok(!all.includes('Asking to be paid'), `${doc.id} still has the "Asking to be paid" heading`);
    }
  });

  it('and both say instead that there is nothing to ask for', () => {
    for (const doc of [riderPolicy(), partnerPolicy()]) {
      const all = doc.sections.map((s: any) => `${s.heading} ${s.body}`).join(' ');
      assert.ok(all.includes('nothing to ask for'), `${doc.id} does not say it`);
      assert.ok(all.includes('paid automatically'), `${doc.id} does not say the payment is automatic`);
    }
  });

  it('The window is stated in both policies, in days and in weeks', () => {
    // Not "weekly" alone. The span a partner is counting is delivery to money
    // in the account, and every version of this that quoted only the cadence was
    // read as a promise about that span.
    for (const doc of [riderPolicy(), partnerPolicy()]) {
      const body = bodyOf(doc, 'When you are paid');
      assert.ok(/\d+ days/.test(body), `${doc.id} does not give the ceiling in days: ${body.slice(0, 200)}`);
      assert.ok(body.includes('two weeks'), `${doc.id} does not give the outer window: ${body.slice(0, 200)}`);
    }
  });

  /* ---------------------------------------------------------------- *
   *  THE APPS ARE TOLD RATHER THAN GUESSING                          *
   * ---------------------------------------------------------------- */
  console.log('\n-- The apps carry no sentence of their own');

  it('NEITHER STATEMENT SCREEN HARDCODES THE RUN', () => {
    /*
     * The defect, read out of the files it lived in. Both screens said "our
     * daily run" in JSX while the configured cadence was weekly, and no backend
     * check could see it.
     */
    for (const file of [RIDER_STATEMENT, PARTNER_STATEMENT]) {
      const src = appSource(file);
      assert.ok(!src.includes('daily run'), `${file} still hardcodes "daily run"`);
      assert.ok(!src.includes('weekly run'), `${file} hardcodes "weekly run", which goes stale the same way`);
    }
  });

  it('and both render the sentence the server sends', () => {
    for (const file of [RIDER_STATEMENT, PARTNER_STATEMENT]) {
      const src = appSource(file);
      assert.ok(
        src.includes('payoutPromise.arrival'),
        `${file} does not render the arrival sentence from the statement`
      );
      assert.ok(
        src.includes('payoutPromise.noRequestNeeded'),
        `${file} does not render the no-request sentence from the statement`
      );
    }
  });

  it('The ask-to-be-paid control is gone from both apps', () => {
    for (const file of [RIDER_STATEMENT, PARTNER_STATEMENT]) {
      const src = appSource(file);
      assert.ok(!src.includes('Ask to be paid'), `${file} still has the button`);
      assert.ok(!src.includes('Send the request'), `${file} still has the request form`);
      assert.ok(!src.includes('Withdraw the request'), `${file} still has the withdraw control`);
    }
  });

  it('and so are the client functions behind it', () => {
    /*
     * A working call left behind a removed control is how the control comes
     * back: the next person to want one finds a ready-made function and a route
     * that still answers, and nothing says the removal was deliberate rather
     * than unfinished.
     */
    const rider = appSource(RIDER_API);
    assert.ok(!rider.includes('raiseRequest('), 'the rider app can still raise a request');
    assert.ok(!rider.includes('withdrawRequest('), 'the rider app can still withdraw one');
    const partner = appSource(PARTNER_API);
    assert.ok(!partner.includes('export function raisePayoutRequest'), 'the partner app can still raise a request');
    assert.ok(
      !partner.includes('export function withdrawPayoutRequest'),
      'the partner app can still withdraw one'
    );
  });

  it('The rider settlement screen no longer shows cash as a deduction', () => {
    const src = appSource(RIDER_SETTLEMENT);
    assert.ok(!src.includes('(deducted)'), 'cash is still presented as a deduction from earnings');
    assert.ok(src.includes('payoutBlockedBy'), 'the screen does not state the block');
  });

  /* ---------------------------------------------------------------- *
   *  THE STATEMENT CARRIES IT                                        *
   * ---------------------------------------------------------------- */
  console.log('\n-- The statement is what carries the words to an app');

  const login = async (email: string) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
    return res.json?.data?.token as string;
  };

  const partnerToken = await login('partner@quickbite.app');
  const partnerStatement = await api('/earnings/statement', {}, partnerToken);

  it('A partner statement carries both sentences', () => {
    assert.equal(partnerStatement.status, 200, JSON.stringify(partnerStatement.json).slice(0, 250));
    const promise = partnerStatement.json?.data?.statement?.payoutPromise;
    assert.ok(promise, `no payoutPromise on the statement: ${JSON.stringify(partnerStatement.json).slice(0, 250)}`);
    assert.equal(typeof promise.arrival, 'string');
    assert.ok(promise.arrival.includes('weekly'), promise.arrival);
    assert.ok(promise.noRequestNeeded.includes('nothing to ask for'), promise.noRequestNeeded);
  });

  it('and it is the SAME sentence the policy uses, not a second copy', () => {
    const promise = partnerStatement.json.data.statement.payoutPromise;
    assert.equal(promise.arrival, arrivalSentence('RESTAURANT'));
    assert.equal(promise.noRequestNeeded, noRequestNeededSentence('RESTAURANT'));
    assert.ok(
      bodyOf(partnerPolicy(), 'When you are paid').includes(arrivalSentence('RESTAURANT')),
      'the policy and the statement are saying different things'
    );
  });

  it('A rider statement gets the rider window, not the partner one', () => {
    /*
     * The holds differ -- a restaurant waits a day, a rider does not -- so one
     * shared sentence would be wrong for one of them. It is per audience.
     */
    assert.notEqual(
      arrivalSentence('RIDER'),
      arrivalSentence('RESTAURANT'),
      'both audiences are being given one sentence despite different holds'
    );
    assert.ok(arrivalSentence('RIDER').includes('a trip is completed'), arrivalSentence('RIDER'));
    assert.ok(arrivalSentence('RESTAURANT').includes('an order is delivered'), arrivalSentence('RESTAURANT'));
  });

  /* ---------------------------------------------------------------- *
   *  THE RIDER'S CASH, FROM ONE SOURCE                               *
   * ---------------------------------------------------------------- */
  console.log('\n-- Our cash in the bag: one number, and it is not a deduction');

  const riderRow = Array.from(memoryStore.riders.values() as any).find((r: any) => r.userId) as any;
  const riderUser = memoryStore.users.get(riderRow.userId) as any;
  const riderToken = await login(riderUser.email);

  /*
   * A PRECONDITION, AND IT HALTS RATHER THAN QUIETLY WEAKENING THE CHECKS.
   *
   * `duesFor` reports NOTHING_OWED before it ever looks at cash, which is the
   * right precedence -- a rider owed nothing is not "blocked", they are simply
   * owed nothing. But it means that on a seeded rider with no ledger entries,
   * every check below about the CASH block would pass by testing a rider who
   * could not be blocked by anything.
   *
   * That is the shape that has cost this project the most: a check that is true
   * for a reason unrelated to the thing it is named after. So the earnings are
   * posted here, and the assertion that they landed throws.
   */
  ledger.post({
    event: 'ORDER_PAID_ONLINE',
    occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: 180000 },
      { account: accountFor('RIDER_PAYABLE', riderRow.id), direction: 'CREDIT', amountPaise: 180000 }
    ],
    idempotencyKey: `promise_suite_earnings:${riderRow.id}`,
    actorUserId: ADMIN,
    narration: 'Earnings for the payout-promise suite'
  });

  await riderRepository.update(riderRow.id, { codCashInHand: 0 } as any);

  /*
   * AND A DELIVERED TRIP, FOR THE SAME REASON.
   *
   * The settlement summary is built from unsettled DELIVERED orders, not from
   * the ledger, so the entry above does not move it. The seed leaves this rider
   * with none, which would make every "cash did not change what is owed" check
   * below compare 0 with 0. Owning the numbers a check depends on is the rule I
   * have broken most often on this project; here they are owned outright.
   */
  const anyOrder = Array.from(memoryStore.orders.values() as any)[0] as any;
  const tripId = `ord_promise_suite_${riderRow.id}`;
  memoryStore.orders.set(tripId, {
    ...anyOrder,
    id: tripId,
    orderNumber: 'QB-PROMISE-1',
    riderId: riderRow.id,
    status: 'DELIVERED',
    payoutId: undefined,
    paymentMethod: 'ONLINE',
    riderPayout: 65,
    deliveredAt: new Date(Date.now() - 2 * 86_400_000).toISOString()
  });

  const payableBefore = duesFor('RIDER', riderRow.id, riderRow.fullName || 'Rider');
  if (payableBefore.payablePaise <= 0) {
    throw new Error(
      `PRECONDITION: the rider has nothing payable (${payableBefore.payablePaise} paise, ${payableBefore.blockedReason}). ` +
        'Every cash-block check below would pass against a rider who cannot be blocked by anything.'
    );
  }
  const cleanSettlement = await api('/riders/settlements', {}, riderToken);

  it('A rider can read their settlement', () => {
    assert.equal(cleanSettlement.status, 200, JSON.stringify(cleanSettlement.json).slice(0, 250));
    assert.ok(cleanSettlement.json?.data?.summary, 'no summary came back');
  });

  it('With no cash held, nothing about cash is in the way', () => {
    const s = cleanSettlement.json.data.summary;
    assert.equal(s.cashInHand, 0);
    assert.ok(!/cash/i.test(s.payoutBlockedBy || ''), `blocked on cash while holding none: ${s.payoutBlockedBy}`);
  });

  it('but an unverified bank account IS surfaced, because that is also theirs to fix', () => {
    /*
     * §7.3 asked for this from the other direction: a rider whose account is
     * sitting unverified should learn it from their app rather than from an
     * unpaid payday. The seeded rider has no verified account, so the block
     * reads that way -- and it is the right thing to show, not noise.
     */
    const blocked = cleanSettlement.json.data.summary.payoutBlockedBy;
    assert.ok(blocked, 'a rider with nowhere to be paid was told nothing');
    assert.ok(/account/i.test(blocked), blocked);
  });

  const owedWithoutCash = cleanSettlement.json.data.summary.netPending;

  /*
   * A PRECONDITION FOR THE TWO CHECKS BELOW, AND IT HALTS.
   *
   * They compare what is owed before and after cash lands in the bag. If this
   * rider is owed NOTHING, both comparisons are 0 against 0 -- they pass, they
   * pass under the mutation that puts the subtraction back, and they are worth
   * nothing. That exact shape has cost this project a day already.
   */
  if (!(owedWithoutCash > 0)) {
    throw new Error(
      `PRECONDITION: this rider is owed ${owedWithoutCash}, so "cash did not change what is owed" would compare 0 with 0 ` +
        'and would pass with the subtraction restored.'
    );
  }

  await riderRepository.update(riderRow.id, { codCashInHand: 500 } as any);
  const withCash = await api('/riders/settlements', {}, riderToken);

  it('CASH IN THE BAG DOES NOT SHRINK WHAT IS OWED', () => {
    /*
     * The defect. `netPending` was `earnings + incentives - cash`, which is a net
     * position and not a payment, and the platform does not do it: `duesFor`
     * blocks the payout outright. A rider holding Rs 500 against Rs 1,800 was
     * shown "you will receive Rs 1,300" and would have received nothing.
     */
    const s = withCash.json.data.summary;
    assert.equal(
      s.netPending,
      owedWithoutCash,
      `holding Rs 500 changed what is owed from ${owedWithoutCash} to ${s.netPending}`
    );
  });

  it('and it is never a negative payout', () => {
    // The other direction of the same subtraction: Rs 2,000 of cash against
    // Rs 1,800 of earnings used to render "you will receive -Rs 200".
    assert.ok(withCash.json.data.summary.netPending >= 0, String(withCash.json.data.summary.netPending));
  });

  it('The cash figure is the rider record, not a sum of orders', () => {
    /*
     * §7.2, literally: the same number from the same source. This used to add up
     * the cash orders in the unsettled list, which no admin action can move.
     */
    assert.equal(withCash.json.data.summary.cashInHand, 500, 'the screen is not reading the rider record');
  });

  it('and the block is stated instead, in the words the admin console uses', () => {
    const blocked = withCash.json.data.summary.payoutBlockedBy;
    assert.ok(blocked, 'nothing told the rider why they will not be paid');
    assert.ok(/cash/i.test(blocked), blocked);
    assert.ok(blocked.includes('500'), `the block did not name the amount: ${blocked}`);
  });

  await riderRepository.update(riderRow.id, { codCashInHand: 120 } as any);
  const afterReturn = await api('/riders/settlements', {}, riderToken);

  it('AN ADMIN COUNTING CASH IN MOVES THE RIDER SCREEN', () => {
    /*
     * The consequence of the old second source, and the reason §7.2 was asked
     * for. A rider who had just handed Rs 380 over at the office went on being
     * shown the old figure by the same app that told them a payout was blocked
     * because of it.
     */
    assert.equal(afterReturn.json.data.summary.cashInHand, 120, 'the rider screen did not follow the return');
    assert.notEqual(afterReturn.json.data.summary.cashInHand, 500, 'the old figure is still being shown');
  });

  it('and while any of it is ours the block stands', () => {
    assert.ok(afterReturn.json.data.summary.payoutBlockedBy, 'Rs 120 is still our cash and still blocks');
  });

  /* ---------------------------------------------------------------- *
   *  THE BLOCK CODE                                                  *
   * ---------------------------------------------------------------- */
  console.log('\n-- The block, as something code can branch on');

  const riderName = (riderRow.fullName as string) || 'Rider';

  it('A cash block is CASH_IN_HAND rather than a string to match on', () => {
    /*
     * The words are for a screen. A caller needing to know WHICH block this is
     * would otherwise match on the prose, and then the prose cannot be improved
     * without silently breaking the caller. The rider route needs exactly this
     * distinction: a block somebody can act on is worth telling them about, while
     * "below the minimum" is a statement about an amount they can already see.
     */
    const dues = duesFor('RIDER', riderRow.id, riderName);
    assert.equal(dues.blockedCode, 'CASH_IN_HAND', `code was ${dues.blockedCode}: ${dues.blockedReason}`);
    assert.ok(dues.blockedReason, 'the words went missing when the code arrived');
  });

  await riderRepository.update(riderRow.id, { codCashInHand: 0 } as any);

  it('and a rider holding nothing is not blocked on cash', () => {
    const clean = duesFor('RIDER', riderRow.id, riderName);
    assert.notEqual(clean.blockedCode, 'CASH_IN_HAND', clean.blockedReason || '');
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] the suite itself threw: ${err?.stack || err}`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
