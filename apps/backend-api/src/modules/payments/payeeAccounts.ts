/**
 * Where a partner's or a rider's money is sent, and how the platform knows it
 * is really theirs.
 *
 * -------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * -------------------------------------------------------------------------
 * There was no bank account anywhere in this platform. The only banking detail
 * it held was a photograph of a bank proof in the KYC queue, read by a human
 * with their eyes, and a payout was a record of a decision rather than a
 * transfer.
 *
 * Typing an account number is the single most dangerous form in a delivery
 * platform. One wrong digit sends a settlement to a stranger who did not ask
 * for it and will not return it, and the platform finds out weeks later from
 * the partner who was never paid. So no account is payable until a penny drop
 * has confirmed both that it exists and whose name is on it.
 *
 * -------------------------------------------------------------------------
 * AND THEN THE NUMBER IS THROWN AWAY
 * -------------------------------------------------------------------------
 * Verification returns a `fund_account_id`, and that id is what payouts are
 * sent to afterwards. The account number is never persisted — it exists in
 * memory for the length of one request and then it is gone, leaving the last
 * four digits so a human can recognise the row.
 *
 * Quick Bites therefore stores no full bank account number for anybody. That is
 * not a nicety; it is the difference between a breach of this database being
 * embarrassing and being a fraud campaign against every rider on the platform.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { razorpayXAdapter, isRazorpayXConfigured } from './razorpayXAdapter.ts';
import type {
  PayeeAccount,
  PayeeMethod,
  PayeeOwnerType,
  PayeeValidationStatus
} from '@quick-bites/shared-types';

/* ------------------------------------------------------------------ *
 *  NAME MATCHING                                                      *
 * ------------------------------------------------------------------ */

/**
 * How close the bank's name has to be to ours.
 *
 * Razorpay returns a 0–100 score. The bands are deliberately three rather than
 * two, because the middle one is real and common:
 *
 *   - Banks hold initials, expansions and married names that a person would
 *     recognise instantly and a string comparison would not. "R Sharma" against
 *     "Rahul Sharma" is the same person and scores badly.
 *   - Somebody entering a relative's account is also a partial match, and looks
 *     very similar.
 *
 * Only a human can separate those two, so the middle band goes to a queue
 * instead of being guessed at in either direction. Auto-approving it would pay
 * strangers; auto-rejecting it would lock out honest partners over a middle
 * initial, and they would have no idea why.
 */
export const NAME_MATCH_ACCEPT = 90;
export const NAME_MATCH_REVIEW = 70;

/**
 * Our own comparison, for when Razorpay does not return a score.
 *
 * Deliberately crude and deliberately pessimistic: it can promote nothing to
 * VERIFIED on its own that the bands above would not, and where it is unsure it
 * produces a low number, which sends the case to a human. A clever fuzzy match
 * here would be a way to quietly approve the thing the score exists to catch.
 */
export function compareNames(ours: string, theirs: string): number {
  const normalise = (s: string) =>
    s
      .toUpperCase()
      .replace(/\b(MR|MRS|MS|DR|SHRI|SMT|M\/S)\b/g, '')
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const a = normalise(ours);
  const b = normalise(theirs);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(' ') === b.join(' ')) return 100;

  // Every word of the shorter name appearing in the longer one, allowing a
  // single letter to stand for a word it begins — which is what an initial is.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let matched = 0;
  for (const word of shorter) {
    const hit = longer.some(other =>
      other === word ||
      (word.length === 1 && other.startsWith(word)) ||
      (other.length === 1 && word.startsWith(other))
    );
    if (hit) matched++;
  }
  return Math.round((matched / shorter.length) * 100);
}

/** What a score means, and what the payee should be told. */
export function statusForScore(
  score: number | undefined,
  accountStatus: string | undefined
): { status: PayeeValidationStatus; message: string } {
  if (accountStatus === 'invalid') {
    return {
      status: 'INVALID',
      message: 'The bank does not recognise that account number and IFSC. Check both and try again.'
    };
  }
  if (typeof score !== 'number') {
    return {
      status: 'NAME_MISMATCH',
      message: 'The bank did not return a name for this account, so it needs a manual check before it can be paid.'
    };
  }
  if (score >= NAME_MATCH_ACCEPT) {
    return { status: 'VERIFIED', message: 'Verified against the bank.' };
  }
  if (score >= NAME_MATCH_REVIEW) {
    return {
      status: 'NAME_MISMATCH',
      message: 'The name on the account is close but not identical to your registered name. Our team will check it.'
    };
  }
  return {
    status: 'INVALID',
    message: 'The name on that account does not match your registered name. An account must be in your own name.'
  };
}

/* ------------------------------------------------------------------ *
 *  READING                                                            *
 * ------------------------------------------------------------------ */

function rows(): PayeeAccount[] {
  return Array.from(memoryStore.payeeAccounts.values()) as PayeeAccount[];
}

export function listFor(ownerType: PayeeOwnerType, ownerId: string): PayeeAccount[] {
  return rows()
    .filter(a => a.ownerType === ownerType && a.ownerId === ownerId && !a.archivedAt)
    .sort((a, b) => (a.isDefault === b.isDefault ? b.createdAt.localeCompare(a.createdAt) : a.isDefault ? -1 : 1));
}

export function findById(id: string): PayeeAccount | null {
  return (memoryStore.payeeAccounts.get(id) as PayeeAccount) || null;
}

/**
 * The account a payout should go to, or null.
 *
 * Only ever returns a VERIFIED one. A payout to an unverified account is
 * refused by the server rather than merely hidden in the interface — the
 * interface is a convenience, and this is the control.
 */
export function payableAccountFor(ownerType: PayeeOwnerType, ownerId: string): PayeeAccount | null {
  const accounts = listFor(ownerType, ownerId).filter(a => a.validationStatus === 'VERIFIED');
  return accounts.find(a => a.isDefault) || accounts[0] || null;
}

/** Everything waiting on a human, newest first. */
export function reviewQueue(): PayeeAccount[] {
  return rows()
    .filter(a => !a.archivedAt && a.validationStatus === 'NAME_MISMATCH')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ------------------------------------------------------------------ *
 *  WRITING                                                            *
 * ------------------------------------------------------------------ */

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const VPA_PATTERN = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/;
const ACCOUNT_PATTERN = /^[0-9]{6,20}$/;

export interface AddAccountInput {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerUserId: string;
  method: PayeeMethod;
  holderName: string;
  /** Present for BANK. Never persisted. */
  accountNumber?: string;
  ifsc?: string;
  vpa?: string;
  /** The name on their KYC, which is what the bank's answer is compared against. */
  kycName: string;
  contactPhone?: string;
  createdByUserId: string;
}

/**
 * Adds an account and immediately tries to verify it.
 *
 * Verification is not a separate step the payee has to remember. An account
 * sitting UNVERIFIED because somebody did not press a second button is an
 * account that silently cannot be paid, and the first anybody hears of it is a
 * settlement that did not arrive.
 */
export async function addAccount(input: AddAccountInput): Promise<PayeeAccount> {
  const holderName = input.holderName.trim();
  if (holderName.length < 3 || holderName.length > 120) {
    // Razorpay's own limit. Checked here so the payee is told by us, in their
    // own screen, rather than by a gateway error they cannot interpret.
    throw new AppError('Enter the account holder name as it appears at the bank.', 400, 'INVALID_HOLDER_NAME');
  }

  if (input.method === 'BANK') {
    if (!input.accountNumber || !ACCOUNT_PATTERN.test(input.accountNumber)) {
      throw new AppError('An account number is 6 to 20 digits, with no spaces.', 400, 'INVALID_ACCOUNT_NUMBER');
    }
    if (!input.ifsc || !IFSC_PATTERN.test(input.ifsc.toUpperCase())) {
      throw new AppError(
        'That IFSC does not look right. It is eleven characters, like HDFC0001234.',
        400,
        'INVALID_IFSC'
      );
    }
  } else {
    if (!input.vpa || !VPA_PATTERN.test(input.vpa)) {
      throw new AppError('That UPI id does not look right. It looks like name@bank.', 400, 'INVALID_VPA');
    }
  }

  // Replacing an account is normal — people change banks. The old one is
  // archived rather than deleted, because a payout already sent points at it
  // and a settlement history that cannot say where money went is not a history.
  for (const existing of listFor(input.ownerType, input.ownerId)) {
    existing.archivedAt = new Date().toISOString();
    existing.isDefault = false;
    memoryStore.payeeAccounts.set(existing.id, existing);
  }

  const account: PayeeAccount = {
    id: `pay_acct_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    ownerUserId: input.ownerUserId,
    method: input.method,
    holderName,
    accountLast4: input.accountNumber ? input.accountNumber.slice(-4) : undefined,
    ifsc: input.ifsc ? input.ifsc.toUpperCase() : undefined,
    vpa: input.vpa,
    validationStatus: 'PENDING',
    isDefault: true,
    createdAt: new Date().toISOString(),
    createdByUserId: input.createdByUserId
  };

  memoryStore.payeeAccounts.set(account.id, account);
  triggerAutoSave();

  return verifyAccount(account.id, input.kycName, input.accountNumber, input.contactPhone);
}

/**
 * Runs the penny drop and records what the bank said.
 *
 * Takes the account number as an ARGUMENT rather than reading it back off the
 * record, because it was never written to the record. That is the whole point:
 * there is no code path in this platform that can read a stored account number,
 * because there is nothing stored to read.
 */
export async function verifyAccount(
  accountId: string,
  kycName: string,
  accountNumber?: string,
  contactPhone?: string
): Promise<PayeeAccount> {
  const account = findById(accountId);
  if (!account) throw new AppError('No such payout account.', 404, 'PAYEE_ACCOUNT_NOT_FOUND');

  if (!isRazorpayXConfigured()) {
    // No gateway. The account stays unverified and says so honestly, rather
    // than being marked verified because nothing was able to disagree.
    account.validationStatus = 'UNVERIFIED';
    account.validationMessage =
      'Bank verification is not switched on for this deployment yet. Our team will verify this account by hand before your first payout.';
    memoryStore.payeeAccounts.set(account.id, account);
    triggerAutoSave();
    return account;
  }

  let result: Awaited<ReturnType<typeof razorpayXAdapter.validateBankAccount>>;

  if (account.method === 'BANK') {
    if (!accountNumber) {
      throw new AppError(
        'Re-enter the account number to verify it. It is not stored after verification.',
        400,
        'ACCOUNT_NUMBER_REQUIRED'
      );
    }
    result = await razorpayXAdapter.validateBankAccount({
      holderName: account.holderName,
      accountNumber,
      ifsc: account.ifsc!,
      contact: {
        name: kycName,
        phone: contactPhone,
        type: account.ownerType === 'RIDER' ? 'employee' : 'vendor'
      },
      referenceId: account.id
    });
  } else {
    const vpa = await razorpayXAdapter.createVpaFundAccount({
      contactName: kycName,
      contactPhone,
      vpa: account.vpa!,
      type: account.ownerType === 'RIDER' ? 'employee' : 'vendor'
    });
    result = {
      completed: Boolean(vpa.fundAccountId),
      accountStatus: vpa.fundAccountId ? 'active' : 'invalid',
      // A VPA registration returns no name to compare, so it cannot clear the
      // automatic bar. It goes to a human, which is the honest answer rather
      // than a convenient one.
      registeredName: undefined,
      fundAccountId: vpa.fundAccountId,
      contactId: vpa.contactId,
      reason: vpa.reason
    };
  }

  if (!result.completed) {
    account.validationStatus = 'UNVERIFIED';
    account.validationMessage = result.reason || 'Verification could not be completed. Try again shortly.';
    memoryStore.payeeAccounts.set(account.id, account);
    triggerAutoSave();
    return account;
  }

  // Razorpay's score where it gave one; ours where it did not. Ours cannot
  // promote anything the bands would not, and where it is unsure it produces a
  // low number, which sends the case to a human.
  const score =
    typeof result.nameMatchScore === 'number'
      ? result.nameMatchScore
      : result.registeredName
      ? compareNames(kycName, result.registeredName)
      : undefined;

  const { status, message } = statusForScore(score, result.accountStatus);

  account.validationStatus = status;
  account.registeredName = result.registeredName;
  account.nameMatchScore = score;
  account.validationMessage = message;
  account.validatedAt = new Date().toISOString();
  account.razorpayFundAccountId = result.fundAccountId;
  account.razorpayContactId = result.contactId;

  memoryStore.payeeAccounts.set(account.id, account);
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'PAYEE_ACCOUNT_VALIDATED',
      accountId: account.id,
      ownerType: account.ownerType,
      ownerId: account.ownerId,
      status,
      // The score, never the name and never the digits.
      nameMatchScore: score
    })
  );

  return account;
}

/**
 * A human's decision on an account the automatic check could not settle.
 *
 * Deliberately only reachable for `NAME_MISMATCH`. An administrator cannot
 * approve an account the bank said does not exist, and cannot approve one that
 * was never checked — those are not judgement calls, and letting a person
 * override them would make the penny drop advisory.
 */
export function reviewAccount(
  accountId: string,
  decision: 'APPROVE' | 'REJECT',
  actor: { userId: string },
  note: string
): PayeeAccount {
  const account = findById(accountId);
  if (!account) throw new AppError('No such payout account.', 404, 'PAYEE_ACCOUNT_NOT_FOUND');

  if (account.validationStatus !== 'NAME_MISMATCH') {
    throw new AppError(
      `Only an account awaiting review can be decided. This one is ${account.validationStatus}.`,
      409,
      'PAYEE_ACCOUNT_NOT_IN_REVIEW'
    );
  }

  if (decision === 'APPROVE' && !account.razorpayFundAccountId && isRazorpayXConfigured()) {
    // Approving an account with nothing to pay to would create a row that says
    // VERIFIED and fails at the first payout.
    throw new AppError(
      'This account has no verified destination at the gateway, so it cannot be approved.',
      409,
      'PAYEE_ACCOUNT_NOT_REGISTERED'
    );
  }

  account.validationStatus = decision === 'APPROVE' ? 'VERIFIED' : 'INVALID';
  account.validationMessage =
    decision === 'APPROVE'
      ? `Checked and approved by our team. ${note}`.trim()
      : note;
  account.validatedAt = new Date().toISOString();

  memoryStore.payeeAccounts.set(account.id, account);
  triggerAutoSave();
  return account;
}

/** Removes an account. Archived, never deleted — a past payout points at it. */
export function archiveAccount(accountId: string): PayeeAccount {
  const account = findById(accountId);
  if (!account) throw new AppError('No such payout account.', 404, 'PAYEE_ACCOUNT_NOT_FOUND');
  account.archivedAt = new Date().toISOString();
  account.isDefault = false;
  memoryStore.payeeAccounts.set(account.id, account);
  triggerAutoSave();
  return account;
}

/** What a payee is shown. Never carries anything that could identify an account. */
export function publicView(account: PayeeAccount) {
  return {
    id: account.id,
    method: account.method,
    holderName: account.holderName,
    accountLast4: account.accountLast4,
    ifsc: account.ifsc,
    vpa: account.vpa,
    validationStatus: account.validationStatus,
    validationMessage: account.validationMessage,
    registeredName: account.registeredName,
    nameMatchScore: account.nameMatchScore,
    validatedAt: account.validatedAt,
    isDefault: account.isDefault,
    createdAt: account.createdAt,
    /** So a screen can say "you can be paid" without re-deriving the rule. */
    isPayable: account.validationStatus === 'VERIFIED'
  };
}

export function resetPayeeAccountsForTesting(): void {
  memoryStore.payeeAccounts.clear();
}
