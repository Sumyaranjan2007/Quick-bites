/**
 * Payout accounts: whose account is it, and can the platform prove it?
 *
 * The expensive failure this guards against is not subtle. One wrong digit in
 * an account number sends a settlement to a stranger who did not ask for it and
 * will not return it, and the platform finds out weeks later from the partner
 * who was never paid. Every check below exists because some version of that
 * costs somebody real money.
 *
 * The single most important assertion in this file is that a full account
 * number is never persisted anywhere. It is checked against the raw store, not
 * against an API response, because an API that hides a field it is storing is
 * exactly the shape this claim has to be able to disprove.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import {
  addAccount,
  verifyAccount,
  reviewAccount,
  listFor,
  findById,
  payableAccountFor,
  reviewQueue,
  archiveAccount,
  publicView,
  compareNames,
  statusForScore,
  resetPayeeAccountsForTesting,
  NAME_MATCH_ACCEPT,
  NAME_MATCH_REVIEW
} from '../modules/payments/payeeAccounts.ts';

console.log('====================================================');
console.log('  PAYOUT ACCOUNTS AND VERIFICATION                  ');
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

async function rejects(name: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  return check(name, async () => {
    try {
      await fn();
    } catch (err: any) {
      assert.equal(err?.code ?? err?.errorCode, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
      return;
    }
    assert.fail(`expected this to be refused with ${code}, and it was allowed`);
  });
}

const OWNER = {
  ownerType: 'RIDER' as const,
  ownerId: 'rdr_test_1',
  ownerUserId: 'usr_rider_1',
  createdByUserId: 'usr_rider_1',
  kycName: 'Rahul Sharma'
};

async function run() {
  resetPayeeAccountsForTesting();

  /* ---------------------------------------------------------------- *
   *  NAME COMPARISON — the thing that decides who gets paid           *
   * ---------------------------------------------------------------- */

  await check('An exact name matches completely', () => {
    assert.equal(compareNames('Rahul Sharma', 'Rahul Sharma'), 100);
    assert.equal(compareNames('rahul sharma', 'RAHUL SHARMA'), 100);
  });

  await check('An initial stands for the name it begins', () => {
    // The common honest case. Banks hold initials constantly, and refusing
    // these would lock out partners who have done nothing wrong and give them
    // no way to find out why.
    assert.ok(compareNames('Rahul Sharma', 'R Sharma') >= NAME_MATCH_REVIEW);
  });

  await check('and in the other direction too', () => {
    // Found by mutation testing. The first assertion passed against a build
    // with half the rule deleted, because the two clauses cover opposite
    // directions and only one of them was being exercised.
    //
    // Both really happen: a bank that holds the full name against a KYC
    // carrying an initial, and the reverse. Covering one and calling it done
    // locks out every partner on the wrong side of it.
    assert.ok(compareNames('R Sharma', 'Rahul Sharma') >= NAME_MATCH_REVIEW);
    assert.ok(compareNames('Rahul K Sharma', 'Rahul Kumar Sharma') >= NAME_MATCH_REVIEW);
  });

  await check('An honorific is not part of the name', () => {
    assert.equal(compareNames('Rahul Sharma', 'Mr Rahul Sharma'), 100);
    assert.equal(compareNames('Nandini Kitchen', 'M/S Nandini Kitchen'), 100);
  });

  await check('Punctuation and spacing do not decide who is paid', () => {
    assert.equal(compareNames('Nandini  Kitchen.', 'NANDINI KITCHEN'), 100);
  });

  await check('A completely different name scores low', () => {
    assert.ok(compareNames('Rahul Sharma', 'Priya Verma') < NAME_MATCH_REVIEW);
    assert.equal(compareNames('Rahul Sharma', ''), 0);
  });

  await check('An empty name never matches anything', () => {
    assert.equal(compareNames('', 'Rahul Sharma'), 0);
    assert.equal(compareNames('', ''), 0);
  });

  /* ---------------------------------------------------------------- *
   *  THE THREE BANDS                                                  *
   * ---------------------------------------------------------------- */

  await check('A high score verifies', () => {
    assert.equal(statusForScore(100, 'active').status, 'VERIFIED');
    assert.equal(statusForScore(NAME_MATCH_ACCEPT, 'active').status, 'VERIFIED');
  });

  await check('The middle band goes to a human, not to a guess', () => {
    // Both an honest married-name mismatch and somebody being paid into a
    // relative's account land here and look identical to a score. Deciding
    // either way automatically is a decision nobody made.
    assert.equal(statusForScore(NAME_MATCH_ACCEPT - 1, 'active').status, 'NAME_MISMATCH');
    assert.equal(statusForScore(NAME_MATCH_REVIEW, 'active').status, 'NAME_MISMATCH');
  });

  await check('A low score is refused outright', () => {
    assert.equal(statusForScore(NAME_MATCH_REVIEW - 1, 'active').status, 'INVALID');
    assert.equal(statusForScore(0, 'active').status, 'INVALID');
  });

  await check('An account the bank does not recognise is refused whatever the name says', () => {
    assert.equal(statusForScore(100, 'invalid').status, 'INVALID');
  });

  await check('No score at all is a human decision, never an acceptance', () => {
    assert.equal(statusForScore(undefined, 'active').status, 'NAME_MISMATCH');
  });

  await check('Every refusal says something the payee can act on', () => {
    for (const score of [0, 50, 75, 100, undefined]) {
      const { message } = statusForScore(score, 'active');
      assert.ok(message.length > 20, `message for ${score} is too short to act on: "${message}"`);
    }
    assert.match(statusForScore(100, 'invalid').message, /account number and IFSC/i);
  });

  /* ---------------------------------------------------------------- *
   *  INPUT — the form where a typo costs real money                   *
   * ---------------------------------------------------------------- */

  await rejects('An account number with letters is refused', 'INVALID_ACCOUNT_NUMBER', () =>
    addAccount({ ...OWNER, method: 'BANK', holderName: 'Rahul Sharma', accountNumber: '12345ABC', ifsc: 'HDFC0001234' })
  );

  await rejects('A too-short account number is refused', 'INVALID_ACCOUNT_NUMBER', () =>
    addAccount({ ...OWNER, method: 'BANK', holderName: 'Rahul Sharma', accountNumber: '123', ifsc: 'HDFC0001234' })
  );

  await rejects('A malformed IFSC is refused', 'INVALID_IFSC', () =>
    addAccount({ ...OWNER, method: 'BANK', holderName: 'Rahul Sharma', accountNumber: '12345678901', ifsc: 'HDFC123' })
  );

  await rejects('An IFSC without the mandatory zero is refused', 'INVALID_IFSC', () =>
    addAccount({ ...OWNER, method: 'BANK', holderName: 'Rahul Sharma', accountNumber: '12345678901', ifsc: 'HDFC1001234' })
  );

  await rejects('A one-character holder name is refused', 'INVALID_HOLDER_NAME', () =>
    addAccount({ ...OWNER, method: 'BANK', holderName: 'R', accountNumber: '12345678901', ifsc: 'HDFC0001234' })
  );

  await rejects('A malformed UPI id is refused', 'INVALID_VPA', () =>
    addAccount({ ...OWNER, method: 'VPA', holderName: 'Rahul Sharma', vpa: 'not-a-upi-id' })
  );

  await check('Nothing was stored by any of those refusals', () => {
    assert.equal(memoryStore.payeeAccounts.size, 0, 'a refused account was written anyway');
  });

  /* ---------------------------------------------------------------- *
   *  WITHOUT A GATEWAY, NOTHING CLAIMS TO BE VERIFIED                 *
   * ---------------------------------------------------------------- */

  let account: Awaited<ReturnType<typeof addAccount>>;

  await check('An account can be added with no gateway configured', async () => {
    account = await addAccount({
      ...OWNER,
      method: 'BANK',
      holderName: 'Rahul Sharma',
      accountNumber: '50100123456789',
      ifsc: 'hdfc0001234'
    });
    assert.ok(account.id);
    assert.equal(account.ifsc, 'HDFC0001234', 'the IFSC was not normalised to upper case');
  });

  await check('and it is UNVERIFIED rather than quietly accepted', () => {
    // The important direction. An account marked verified because nothing was
    // able to disagree is worse than one that admits it has not been checked.
    assert.equal(account.validationStatus, 'UNVERIFIED');
    assert.ok(account.validationMessage!.length > 20);
  });

  await check('and it is NOT payable', () => {
    assert.equal(payableAccountFor('RIDER', OWNER.ownerId), null);
    assert.equal(publicView(account).isPayable, false);
  });

  /* ---------------------------------------------------------------- *
   *  THE ACCOUNT NUMBER IS NEVER STORED                               *
   * ---------------------------------------------------------------- */

  await check('The full account number is nowhere in the stored record', () => {
    const stored = memoryStore.payeeAccounts.get(account.id);
    const serialised = JSON.stringify(stored);
    assert.ok(
      !serialised.includes('50100123456789'),
      `the account number was persisted: ${serialised}`
    );
  });

  await check('The full account number is nowhere in the ENTIRE store', () => {
    // Checked against every collection rather than the one row, because the
    // claim is about the platform and not about a repository. A copy written
    // into an audit entry or a user record would be just as bad and would pass
    // the narrower check.
    const everything = JSON.stringify(
      Object.fromEntries(Object.entries(memoryStore).map(([k, v]) => [k, Array.from((v as Map<string, any>).values())]))
    );
    assert.ok(!everything.includes('50100123456789'), 'the account number survives somewhere in the store');
  });

  await check('Only the last four digits are kept, so a human can recognise the row', () => {
    assert.equal(account.accountLast4, '6789');
  });

  await check('Nothing the payee is shown carries the number either', () => {
    const view = JSON.stringify(publicView(account));
    assert.ok(!view.includes('50100123456789'));
    assert.ok(view.includes('6789'), 'the payee cannot tell which account this is');
  });

  await rejects('Re-verifying refuses without the number, because there is none to read', 'ACCOUNT_NUMBER_REQUIRED', async () => {
    // Proves the storage claim from the other direction: if the number were
    // being kept, this call would have been able to find it.
    process.env.RAZORPAYX_KEY_ID = 'rzp_test_fake';
    process.env.RAZORPAYX_KEY_SECRET = 'fake_secret_not_dev_only';
    process.env.RAZORPAYX_ACCOUNT_NUMBER = '2323230000000000';
    const { config } = await import('../config/env.ts');
    (config as any).RAZORPAYX_KEY_ID = 'rzp_test_fake';
    (config as any).RAZORPAYX_KEY_SECRET = 'fake_secret_not_dev_only';
    (config as any).RAZORPAYX_ACCOUNT_NUMBER = '2323230000000000';
    return verifyAccount(account.id, OWNER.kycName);
  });

  /* ---------------------------------------------------------------- *
   *  REPLACING AN ACCOUNT                                             *
   * ---------------------------------------------------------------- */

  await check('Adding a second account archives the first', async () => {
    const second = await addAccount({
      ...OWNER,
      method: 'VPA',
      holderName: 'Rahul Sharma',
      vpa: 'rahul@okhdfcbank'
    });
    const live = listFor('RIDER', OWNER.ownerId);
    assert.equal(live.length, 1, 'two live accounts at once — a payout would not know which');
    assert.equal(live[0].id, second.id);
  });

  await check('but the archived one still exists, because a past payout points at it', () => {
    const old = findById(account.id);
    assert.ok(old, 'the previous account was deleted rather than archived');
    assert.ok(old!.archivedAt);
    assert.equal(old!.isDefault, false);
  });

  /* ---------------------------------------------------------------- *
   *  THE REVIEW QUEUE                                                 *
   * ---------------------------------------------------------------- */

  await check('An account in the middle band appears in the review queue', () => {
    const current = listFor('RIDER', OWNER.ownerId)[0];
    current.validationStatus = 'NAME_MISMATCH';
    current.registeredName = 'R Sharma';
    current.nameMatchScore = 75;
    current.razorpayFundAccountId = 'fa_test_1';
    memoryStore.payeeAccounts.set(current.id, current);

    const queue = reviewQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, current.id);
  });

  await check('The queue carries both names and the score, or the decision cannot be made', () => {
    const row = reviewQueue()[0];
    assert.equal(row.registeredName, 'R Sharma');
    assert.equal(row.holderName, 'Rahul Sharma');
    assert.equal(row.nameMatchScore, 75);
  });

  await check('An administrator approving it makes the rider payable', () => {
    const row = reviewQueue()[0];
    const decided = reviewAccount(row.id, 'APPROVE', { userId: 'usr_admin' }, 'Checked against the PAN on file.');
    assert.equal(decided.validationStatus, 'VERIFIED');
    assert.ok(payableAccountFor('RIDER', OWNER.ownerId), 'the rider still cannot be paid after approval');
    assert.equal(reviewQueue().length, 0, 'the case is still in the queue after being decided');
  });

  await rejects('The same case cannot be decided twice', 'PAYEE_ACCOUNT_NOT_IN_REVIEW', async () =>
    reviewAccount(listFor('RIDER', OWNER.ownerId)[0].id, 'REJECT', { userId: 'usr_admin' }, 'Changed my mind')
  );

  await check('An administrator cannot approve an account the bank refused', () => {
    const rejected = listFor('RIDER', OWNER.ownerId)[0];
    rejected.validationStatus = 'INVALID';
    memoryStore.payeeAccounts.set(rejected.id, rejected);
    let refused = false;
    try {
      reviewAccount(rejected.id, 'APPROVE', { userId: 'usr_admin' }, 'Overriding the bank');
    } catch (err: any) {
      refused = err?.code === 'PAYEE_ACCOUNT_NOT_IN_REVIEW';
    }
    assert.ok(refused, 'a person was able to override the bank, which makes the penny drop advisory');
  });

  await rejects('Reviewing an account that does not exist is refused', 'PAYEE_ACCOUNT_NOT_FOUND', async () =>
    reviewAccount('pay_acct_nope', 'APPROVE', { userId: 'usr_admin' }, 'Nothing here')
  );

  /* ---------------------------------------------------------------- *
   *  ISOLATION BETWEEN PAYEES                                         *
   * ---------------------------------------------------------------- */

  await check('One rider cannot see or be paid through another rider’s account', async () => {
    resetPayeeAccountsForTesting();
    await addAccount({ ...OWNER, method: 'VPA', holderName: 'Rahul Sharma', vpa: 'rahul@okhdfcbank' });
    await addAccount({
      ownerType: 'RIDER',
      ownerId: 'rdr_test_2',
      ownerUserId: 'usr_rider_2',
      createdByUserId: 'usr_rider_2',
      kycName: 'Priya Verma',
      method: 'VPA',
      holderName: 'Priya Verma',
      vpa: 'priya@okaxis'
    });

    const first = listFor('RIDER', 'rdr_test_1');
    const second = listFor('RIDER', 'rdr_test_2');
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].id, second[0].id);
    assert.equal(first[0].vpa, 'rahul@okhdfcbank');
    assert.equal(second[0].vpa, 'priya@okaxis');
  });

  await check('A restaurant and a rider sharing an id are different payees', async () => {
    // `ownerId` is a restaurant id in one case and a rider id in the other.
    // Keying on the id alone would merge them, and a kitchen would be paid a
    // rider's earnings.
    await addAccount({
      ownerType: 'RESTAURANT',
      ownerId: 'rdr_test_1',
      ownerUserId: 'usr_owner_1',
      createdByUserId: 'usr_owner_1',
      kycName: 'Nandini Kitchen',
      method: 'VPA',
      holderName: 'Nandini Kitchen',
      vpa: 'nandini@okicici'
    });
    assert.equal(listFor('RIDER', 'rdr_test_1')[0].vpa, 'rahul@okhdfcbank');
    assert.equal(listFor('RESTAURANT', 'rdr_test_1')[0].vpa, 'nandini@okicici');
  });

  await check('Archiving the only account leaves the payee unpayable, not paid elsewhere', () => {
    archiveAccount(listFor('RIDER', 'rdr_test_2')[0].id);
    assert.equal(listFor('RIDER', 'rdr_test_2').length, 0);
    assert.equal(payableAccountFor('RIDER', 'rdr_test_2'), null);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Payout account tests crashed:', err);
  process.exit(1);
});
