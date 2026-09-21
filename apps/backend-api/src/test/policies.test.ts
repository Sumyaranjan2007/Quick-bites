/**
 * Payment policies, and the sweep that goes looking for money gone wrong.
 *
 * Two very different things in one suite because they share a theme: both are
 * about what the platform says when nobody is asking it a direct question.
 *
 * A policy is a promise. The failure mode is not a crash — it is a published
 * refund policy that says one thing while the code does another, or a named
 * grievance officer who does not exist. Both are worse than saying nothing,
 * because a person relies on them.
 *
 * The sweep's failure mode is worse still: retrying a payment whose outcome is
 * unknown pays somebody twice, and the second payment is far harder to recover
 * than the first was to send. Several tests below exist only to make that
 * regression impossible to ship quietly.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, formatPaise } from '../modules/payments/money.ts';
import { resetConfigsForTesting, createVersion, getActiveRates } from '../modules/payments/pricingConfig.ts';
import { resetPayoutsForTesting, listPayouts } from '../modules/payments/payouts.ts';
import { resetCashDepositsForTesting } from '../modules/payments/cashDeposits.ts';
import {
  paymentPolicies,
  policiesFor,
  findPaymentPolicy,
  policyGaps,
  getGrievanceContact,
  setGrievanceContact
} from '../modules/payments/paymentPolicies.ts';
import { runPaymentsHealthCheck } from '../modules/payments/paymentsHealth.ts';

console.log('====================================================');
console.log('  PAYMENT POLICIES AND THE HEALTH SWEEP             ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`[PASS] ${name}`);
    })
    .catch((err: any) => {
      failed++;
      console.log(`[FAIL] ${name}: ${err?.message || err}`);
    });
}

const ADMIN = 'usr_admin_policy';
const RIDER = 'rdr_policy_1';

/** Every section of every policy, as one searchable string. */
const allText = () =>
  paymentPolicies()
    .flatMap(p => p.sections.map(s => `${s.heading} ${s.body}`))
    .join(' ');

async function run() {
  resetLedgerForTesting();
  resetConfigsForTesting();
  resetPayoutsForTesting();
  resetCashDepositsForTesting();
  memoryStore.riders.clear();
  memoryStore.orders.clear();
  memoryStore.settings.delete('policy:grievance');

  /* ---------------------------------------------------------------- *
   *  THE POLICIES SAY WHAT THE CODE DOES                              *
   * ---------------------------------------------------------------- */

  await check('A firm has all six payment policies, each with a summary', () => {
    const policies = paymentPolicies();
    const ids = policies.map(p => p.id).sort();
    assert.deepEqual(ids, [
      'disputes-and-chargebacks',
      'partner-settlements',
      'payment-security',
      'payments-and-charges',
      'refunds-and-cancellations',
      'rider-earnings'
    ]);

    for (const policy of policies) {
      assert.ok(policy.title.length > 3, `${policy.id} has no title`);
      assert.ok(policy.summary.length > 20, `${policy.id} has no useful summary`);
      assert.ok(policy.sections.length >= 4, `${policy.id} has only ${policy.sections.length} sections`);
      assert.ok(policy.audiences.length > 0, `${policy.id} is addressed to nobody`);
    }
  });

  await check('Each app is given the policies that apply to it', () => {
    assert.ok(policiesFor('customer').some(p => p.id === 'refunds-and-cancellations'));
    assert.ok(policiesFor('partner').some(p => p.id === 'partner-settlements'));
    assert.ok(policiesFor('rider').some(p => p.id === 'rider-earnings'));

    // And is not handed somebody else's terms as though they were theirs.
    assert.equal(policiesFor('customer').some(p => p.id === 'rider-earnings'), false);
    assert.equal(policiesFor('rider').some(p => p.id === 'partner-settlements'), false);
  });

  await check('The figures in the prose come from the LIVE config, not from the text', () => {
    /*
     * The single most important property of these documents.
     *
     * A published policy stating a one-day hold, while the config holds three,
     * is a promise the platform demonstrably does not keep — and it is the
     * published version a partner would be entitled to rely on. Typing the
     * number into the prose is how that happens, so the number is interpolated
     * and this test is what stops anybody typing it back in.
     */
    const before = findPaymentPolicy('partner-settlements')!;
    const holdText = before.sections.find(s => s.heading === 'When you are paid')!.body;
    assert.ok(holdText.includes('one day'), `expected the default hold in: ${holdText}`);

    createVersion({ partnerHoldDays: 4, codCashCeiling: 9999 }, { userId: ADMIN }, 'Longer hold');

    const after = findPaymentPolicy('partner-settlements')!;
    const afterText = after.sections.find(s => s.heading === 'When you are paid')!.body;
    assert.ok(afterText.includes('4 days'), `the policy did not follow the config: ${afterText}`);

    const riderText = findPaymentPolicy('rider-earnings')!.sections.find(s => s.heading === 'The cash limit')!.body;
    assert.ok(riderText.includes('9,999'), `the cash ceiling did not follow the config: ${riderText}`);

    createVersion({ partnerHoldDays: 1, codCashCeiling: 3000 }, { userId: ADMIN }, 'Back');
  });

  await check('The commission rate quoted to partners is the configured one', () => {
    createVersion({ defaultCommissionPercent: 22 }, { userId: ADMIN }, 'New standard rate');
    const text = findPaymentPolicy('partner-settlements')!.sections.find(s => s.heading === 'Commission')!.body;
    assert.ok(text.includes('22%'), `the policy quotes a stale commission: ${text}`);
    createVersion({ defaultCommissionPercent: 15 }, { userId: ADMIN }, 'Back');
  });

  await check('The refund policy states the rule the code actually implements', () => {
    // Money goes back the way it came, and there is no wallet. Both are
    // properties of the refund module, and a policy that promised a wallet
    // credit would be promising something that cannot happen.
    const text = findPaymentPolicy('refunds-and-cancellations')!.sections
      .map(s => s.body)
      .join(' ')
      .toLowerCase();

    assert.ok(text.includes('back the way the money came'), 'the source-rail rule is not stated');
    assert.ok(text.includes('do not hold your money in a wallet'), 'the removal of the wallet is not stated');
    assert.ok(text.includes('cash'), 'the cash-order route is not covered');
  });

  await check('The rider policy states that cash is never netted off earnings', () => {
    // The owner's own rule, and the one a rider is most likely to dispute.
    const text = findPaymentPolicy('rider-earnings')!.sections
      .map(s => s.body)
      .join(' ')
      .toLowerCase();
    assert.ok(text.includes('never set against'), 'the no-netting rule is not stated');
    assert.ok(text.includes('counted amount, not by the declared one'), 'the counting rule is not stated');

    /*
     * And the OPPOSITE is not stated anywhere.
     *
     * A mutation run caught this: the promise and its contradiction lived in
     * adjacent sentences, so replacing the second one with "we deduct it from
     * what we owe you" left the first intact and the test passed. Asserting a
     * promise exists is not the same as asserting it is kept.
     */
    assert.ok(
      !/deduct it from what we owe|set against your earnings|taken off your earnings/i.test(text),
      'the policy promises no netting in one sentence and describes netting in another'
    );
    assert.ok(
      text.includes('your earnings are not paid out'),
      'the policy does not say what actually happens while a rider holds cash'
    );
  });

  await check('The anti-phishing warning is present, and names what we never ask for', () => {
    /*
     * The single most valuable sentence in a payments policy for an ordinary
     * person, and cheap to lose in a rewrite.
     *
     * Pinned to the policy it belongs to and to the specific things it names —
     * a mutation run showed that searching all policies for one loose phrase
     * passed even with the section gutted, because a similar phrase survived
     * elsewhere.
     */
    const security = findPaymentPolicy('payment-security')!;
    const section = security.sections.find(s => /asked for details/i.test(s.heading));
    assert.ok(section, 'the payment security policy has no anti-phishing section');

    for (const term of ['card number', 'PIN', 'OTP', 'password']) {
      assert.ok(
        section!.body.includes(term),
        `the warning does not mention "${term}", which is what people are actually asked for`
      );
    }
    assert.ok(/never ask you for/i.test(allText()));
  });

  /* ---------------------------------------------------------------- *
   *  AND THEY DO NOT INVENT A GRIEVANCE OFFICER                       *
   * ---------------------------------------------------------------- */

  await check('With nobody published, no policy names an officer', () => {
    assert.equal(getGrievanceContact(), null);
    assert.ok(policyGaps().length > 0, 'a missing grievance officer was not reported as a gap');

    for (const policy of paymentPolicies()) {
      const closing = policy.sections[policy.sections.length - 1];
      assert.equal(closing.heading, 'If you are not satisfied', `${policy.id} has no escalation section`);
      assert.ok(
        /not been published yet/i.test(closing.body),
        `${policy.id} does not admit the escalation route is incomplete`
      );
    }
  });

  await check('And it still gives a route that works', () => {
    // A document that says "we have not published this" and stops there has
    // told a complainant nothing they can act on.
    const closing = findPaymentPolicy('payments-and-charges')!.sections.slice(-1)[0];
    assert.ok(/help section/i.test(closing.body), 'no working route is offered');
  });

  await check('Once published, every policy names them with an address', () => {
    setGrievanceContact({
      officerName: 'Anita Desai',
      designation: 'Grievance Officer',
      email: 'grievance@quickbites.app',
      phone: '080 4000 1234',
      address: '4th Floor, 12 Residency Road, Bengaluru 560025',
      hours: 'Monday to Friday, 10am to 6pm'
    });

    assert.deepEqual(policyGaps(), []);

    for (const policy of paymentPolicies()) {
      const closing = policy.sections[policy.sections.length - 1];
      assert.ok(closing.body.includes('Anita Desai'), `${policy.id} does not name the officer`);
      assert.ok(closing.body.includes('grievance@quickbites.app'), `${policy.id} has no email`);
      assert.ok(closing.body.includes('Residency Road'), `${policy.id} has no postal address`);
      assert.ok(!/not been published yet/i.test(closing.body), `${policy.id} still says nobody is published`);
    }
  });

  await check('A published officer with no address is still reported as a gap', () => {
    // The postal address is required by the e-commerce rules, and an officer
    // with only an email address looks complete on screen.
    setGrievanceContact({
      officerName: 'Anita Desai',
      email: 'grievance@quickbites.app',
      address: ''
    } as any);
    assert.ok(
      policyGaps().some(g => /address/i.test(g)),
      'an officer with no postal address passed as complete'
    );

    setGrievanceContact({
      officerName: 'Anita Desai',
      email: 'grievance@quickbites.app',
      address: '4th Floor, 12 Residency Road, Bengaluru 560025'
    });
  });

  /* ---------------------------------------------------------------- *
   *  THE SWEEP                                                        *
   * ---------------------------------------------------------------- */

  await check('A clean platform produces no alerts', async () => {
    const report = await runPaymentsHealthCheck();
    assert.equal(report.alerts.length, 0, report.alerts.join(' | '));
    assert.equal(report.ledger.balanced, true);
  });

  await check('An UNCERTAIN payout is NEVER resolved by guessing', async () => {
    /*
     * The one that matters most.
     *
     * With no gateway configured there is no authority to ask, so the only safe
     * answer is "still unknown". A sweep that decided for itself — either way —
     * is a sweep that either pays somebody twice or writes off a debt nobody
     * agreed to write off.
     */
    memoryStore.payouts.set('pyt_uncertain_1', {
      id: 'pyt_uncertain_1',
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      amountPaise: toPaise(500),
      state: 'UNCERTAIN',
      rail: 'RAZORPAYX',
      coversLedgerIds: [],
      idempotencyKey: 'test_uncertain_1',
      draftedByUserId: ADMIN,
      draftedAt: new Date().toISOString(),
      executedAt: new Date().toISOString()
    });

    const report = await runPaymentsHealthCheck();

    assert.equal(report.uncertainPayouts.checked, 1);
    assert.equal(report.uncertainPayouts.resolvedPaid, 0, 'it decided a payout had paid with nothing to go on');
    assert.equal(report.uncertainPayouts.resolvedFailed, 0, 'it wrote off a payout with nothing to go on');
    assert.equal(report.uncertainPayouts.stillUnknown, 1);

    assert.equal(
      listPayouts({ ownerId: RIDER })[0].state,
      'UNCERTAIN',
      'the payout state was changed without evidence'
    );
  });

  await check('And the alert says out loud that it is not being retried', async () => {
    const report = await runPaymentsHealthCheck();
    const alert = report.alerts.find(a => /unknown outcome/i.test(a));
    assert.ok(alert, 'an unresolved payout raised no alert at all');
    assert.ok(/NOT being retried/i.test(alert!), `the alert does not warn against resending: ${alert}`);
  });

  await check('"No record at the gateway" is UNKNOWN, never FAILED', async () => {
    /*
     * The branch that decides whether somebody is paid twice.
     *
     * An empty result means one of two things — the request never arrived, or
     * the gateway is not answering properly — and they are indistinguishable
     * from here. Treating it as "did not happen" releases the money to be sent
     * again, and if the first one did land, it goes out twice.
     */
    const report = await runPaymentsHealthCheck({ lookup: async () => [] });
    assert.equal(report.uncertainPayouts.resolvedFailed, 0, 'an empty answer was read as a failure');
    assert.equal(report.uncertainPayouts.resolvedPaid, 0, 'an empty answer was read as a success');
    assert.equal(report.uncertainPayouts.stillUnknown, 1);
  });

  await check('A status the gateway does not recognise is also UNKNOWN', async () => {
    const report = await runPaymentsHealthCheck({
      lookup: async () => [{ id: 'pout_x', status: 'something_new' }]
    });
    assert.equal(report.uncertainPayouts.stillUnknown, 1, 'an unrecognised status was acted on');
  });

  await check('A gateway that throws leaves the payout alone', async () => {
    const report = await runPaymentsHealthCheck({
      lookup: async () => {
        throw new Error('connection reset');
      }
    });
    assert.equal(report.uncertainPayouts.stillUnknown, 1);
    assert.equal(listPayouts({ ownerId: RIDER })[0].state, 'UNCERTAIN');
  });

  await check('A payout the gateway says was processed is confirmed, and the ledger catches up', async () => {
    /*
     * The entry was deliberately NOT written when the payout went uncertain —
     * writing it then would have recorded money leaving that might never have
     * left. It is written here, once the gateway has confirmed it.
     */
    const before = ledger.query({ payoutId: 'pyt_uncertain_1' }).length;
    assert.equal(before, 0, 'an entry existed before confirmation');

    const report = await runPaymentsHealthCheck({
      lookup: async () => [{ id: 'pout_real', status: 'processed' }]
    });

    assert.equal(report.uncertainPayouts.resolvedPaid, 1);
    assert.equal(listPayouts({ ownerId: RIDER })[0].state, 'PAID');

    const entries = ledger.query({ payoutId: 'pyt_uncertain_1' });
    assert.equal(entries.length, 2, 'the confirmation did not write a balanced pair');
    assert.equal(ledger.audit().balanced, true);
  });

  await check('Confirming it twice does not send the money twice', async () => {
    // The same idempotency key the ordinary path uses. If the original call
    // had in fact completed and posted, this is refused rather than doubled.
    const before = ledger.query({ payoutId: 'pyt_uncertain_1' }).length;
    memoryStore.payouts.get('pyt_uncertain_1')!.state = 'UNCERTAIN';

    await runPaymentsHealthCheck({ lookup: async () => [{ id: 'pout_real', status: 'processed' }] });

    assert.equal(
      ledger.query({ payoutId: 'pyt_uncertain_1' }).length,
      before,
      'a second confirmation posted the payment again'
    );
    assert.equal(ledger.audit().balanced, true);
  });

  await check('A reversed payout is marked failed and the money is owed again', async () => {
    memoryStore.payouts.set('pyt_uncertain_2', {
      id: 'pyt_uncertain_2',
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      amountPaise: toPaise(300),
      state: 'UNCERTAIN',
      rail: 'RAZORPAYX',
      coversLedgerIds: [],
      idempotencyKey: 'test_uncertain_2',
      draftedByUserId: ADMIN,
      draftedAt: new Date().toISOString(),
      executedAt: new Date().toISOString()
    });

    const report = await runPaymentsHealthCheck({
      lookup: async () => [{ id: 'pout_gone', status: 'reversed' }]
    });

    assert.equal(report.uncertainPayouts.resolvedFailed, 1);
    const failed = listPayouts({ ownerId: RIDER }).find(p => p.id === 'pyt_uncertain_2')!;
    assert.equal(failed.state, 'FAILED');
    assert.ok((failed.failureReason || '').length > 10, 'a failed payout with no reason');

    // And nothing was posted for it: the money never left.
    assert.equal(ledger.query({ payoutId: 'pyt_uncertain_2' }).length, 0);

    memoryStore.payouts.delete('pyt_uncertain_2');
    memoryStore.payouts.get('pyt_uncertain_1')!.state = 'UNCERTAIN';
  });

  await check('The sweep never posts a ledger entry for a payout it could not confirm', async () => {
    // The entry is the record that money left. Writing one for a payout whose
    // outcome is unknown would make the books assert something nobody knows.
    memoryStore.payouts.set('pyt_uncertain_3', {
      id: 'pyt_uncertain_3',
      ownerType: 'RIDER',
      ownerId: RIDER,
      ownerName: 'Rahul Sharma',
      amountPaise: toPaise(700),
      state: 'UNCERTAIN',
      rail: 'RAZORPAYX',
      coversLedgerIds: [],
      idempotencyKey: 'test_uncertain_3',
      draftedByUserId: ADMIN,
      draftedAt: new Date().toISOString(),
      executedAt: new Date().toISOString()
    });

    await runPaymentsHealthCheck({ lookup: async () => [] });
    assert.equal(ledger.query({ payoutId: 'pyt_uncertain_3' }).length, 0);

    // With no gateway and no stub either, which is the deployment this
    // platform is on today.
    await runPaymentsHealthCheck();
    assert.equal(ledger.query({ payoutId: 'pyt_uncertain_3' }).length, 0);

    memoryStore.payouts.delete('pyt_uncertain_3');
  });

  await check('A rider holding cash for days is chased by name and by amount', async () => {
    memoryStore.riders.set(RIDER, {
      id: RIDER,
      fullName: 'Rahul Sharma',
      codCashInHand: 2400
    });

    const report = await runPaymentsHealthCheck();

    assert.equal(report.cash.ridersHolding, 1);
    assert.equal(report.cash.totalPaise, toPaise(2400));
    assert.equal(report.cash.staleRiders.length, 1, 'a rider who has never deposited was not flagged');

    const alert = report.alerts.find(a => a.includes('Rahul Sharma'));
    assert.ok(alert, 'the rider was not named');
    // Checked against the formatter rather than a hand-typed string, so this
    // asserts that the amount is NAMED and not that it is grouped a particular
    // way — a grouping change is a formatting decision, not a regression.
    assert.ok(alert!.includes(formatPaise(toPaise(2400))), `the amount was not named: ${alert}`);
    assert.ok(/never deposited/i.test(alert!), `it did not say what is wrong: ${alert}`);
  });

  await check('A rider over the ceiling is counted as such', async () => {
    const rates = getActiveRates();
    memoryStore.riders.set('rdr_over', {
      id: 'rdr_over',
      fullName: 'Over Limit',
      codCashInHand: rates.codCashCeiling + 500
    });
    const report = await runPaymentsHealthCheck();
    assert.equal(report.cash.overCeiling, 1);
  });

  await check('An unbalanced ledger is the loudest thing the sweep can say', async () => {
    /*
     * Forced by writing a one-sided transaction directly into the store — the
     * ledger's own `post` refuses this, which is the point, so the only way to
     * test the detector is to bypass the thing that prevents it.
     */
    memoryStore.ledgerEntries.set('led_broken', {
      id: 'led_broken',
      transactionId: 'ltx_broken',
      occurredAt: new Date().toISOString(),
      event: 'CORRECTION',
      account: accountFor('RIDER_PAYABLE', RIDER),
      direction: 'CREDIT',
      amountPaise: toPaise(100),
      idempotencyKey: 'broken:1',
      actorUserId: 'test',
      narration: 'A deliberately one-sided entry',
      createdAt: new Date().toISOString()
    });

    const report = await runPaymentsHealthCheck();

    assert.equal(report.ledger.balanced, false);
    const alert = report.alerts.find(a => /DOES NOT BALANCE/.test(a));
    assert.ok(alert, 'an unbalanced ledger produced no alert');
    assert.ok(/[Ss]top sending payouts/.test(alert!), `the alert does not say what to do: ${alert}`);
    assert.ok(
      /[Nn]othing has been corrected/.test(alert!),
      `the alert does not say it left the books alone: ${alert}`
    );
  });

  await check('And it does NOT try to fix it', async () => {
    // A job that silently rebalanced the books would destroy the only evidence
    // of which assumption was wrong.
    await runPaymentsHealthCheck();
    assert.ok(
      memoryStore.ledgerEntries.has('led_broken'),
      'the sweep deleted the entry rather than reporting it'
    );
    assert.equal((await runPaymentsHealthCheck()).ledger.balanced, false, 'the sweep quietly rebalanced');

    memoryStore.ledgerEntries.delete('led_broken');
  });

  await check('The sweep says the same thing every run until somebody acts', async () => {
    // An alert raised once, at 3am, into a log nobody reads, is not an alert.
    const first = await runPaymentsHealthCheck();
    const second = await runPaymentsHealthCheck();
    assert.equal(second.alerts.length, first.alerts.length);
    assert.ok(first.alerts.length > 0, 'nothing was outstanding, so this proves nothing');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Policy tests crashed:', err);
  process.exit(1);
});
