/**
 * Paying people: what is owed, who may authorise it, and sending it.
 *
 * -------------------------------------------------------------------------
 * WHAT IS OWED COMES FROM THE LEDGER
 * -------------------------------------------------------------------------
 * Not from a scan of orders. An order can be refunded, re-rated or archived
 * after the fact, and a figure re-derived from one changes underneath a
 * settlement that has already been paid. A ledger balance is what the platform
 * recorded at the time and cannot quietly restate itself.
 *
 * -------------------------------------------------------------------------
 * THE THREE CONTROLS BETWEEN A DRAFT AND MONEY LEAVING
 * -------------------------------------------------------------------------
 * The largest fraud risk in this whole system is an insider moving money out,
 * and the person best placed to do it is the person who operates the payouts
 * screen. So:
 *
 *   1. MAKER-CHECKER above a threshold. A second administrator, who is not the
 *      drafter, must approve. Below the threshold one person clears the daily
 *      queue, because two people on every Rs 300 rider payment is theatre that
 *      gets automated away within a week.
 *
 *   2. A DAILY CAP across everything, whoever approved it. Maker-checker stops
 *      one person acting alone; the cap bounds the damage when two people are
 *      involved, or when one person holds two accounts.
 *
 *   3. A VERIFIED ACCOUNT. Refused on the server, not hidden in the interface.
 *
 * None of these are advisory. Each is checked at the moment of execution, not
 * at the moment of drafting, because a draft can sit for a day and the rules
 * can change underneath it.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { ledger, accountFor } from './ledger.ts';
import { toPaise, toRupees, formatPaise } from './money.ts';
import { getActiveRates } from './pricingConfig.ts';
import { payableAccountFor, accountBlockReason } from './payeeAccounts.ts';
import { railFor, defaultRail } from './rails.ts';
import type { PayoutRailId, RailResultStatus, PayeeOwnerType } from '@quick-bites/shared-types';

export type PayoutState =
  /** Drafted. Nothing has moved and nothing is committed. */
  | 'DRAFT'
  /** Above the threshold and waiting for a second administrator. */
  | 'AWAITING_APPROVAL'
  /** Cleared to send. */
  | 'APPROVED'
  /** Sent, and the rail says it is done. */
  | 'PAID'
  /** The rail refused it outright. Nothing moved. */
  | 'FAILED'
  /**
   * The request left this process and its outcome is unknown. NEVER retried
   * automatically — reconciliation asks the gateway what actually happened.
   */
  | 'UNCERTAIN'
  /** Withdrawn before it was sent. */
  | 'CANCELLED';

export interface PayoutRecord {
  id: string;
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  /** Frozen at draft. What was owed when the decision was taken. */
  amountPaise: number;
  state: PayoutState;
  rail: PayoutRailId;
  /** Ledger entries this payout covers, so a settlement can be explained. */
  coversLedgerIds: string[];
  /** The idempotency key. Fixed at draft so a retry cannot generate a new one. */
  idempotencyKey: string;

  draftedByUserId: string;
  draftedAt: string;
  approvedByUserId?: string;
  approvedAt?: string;
  executedByUserId?: string;
  executedAt?: string;

  /** The payout id, UTR or link id. What proves the money moved. */
  reference?: string;
  claimUrl?: string;
  failureReason?: string;
  note?: string;
}

function rows(): PayoutRecord[] {
  return Array.from(memoryStore.payouts.values()).filter(
    (p: any) => p && typeof p.amountPaise === 'number'
  ) as PayoutRecord[];
}

/* ------------------------------------------------------------------ *
 *  WHAT IS OWED                                                       *
 * ------------------------------------------------------------------ */

export interface DueRow {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  /** Payable now: earned, and past the hold period. */
  payablePaise: number;
  /** Earned but still inside the hold period. */
  heldPaise: number;
  /** Everything not yet paid, whether or not it is released. */
  outstandingPaise: number;
  /** Cash of ours this rider is carrying. Blocks their payout entirely. */
  cashInHandPaise: number;
  /** Whether there is a verified account to pay into. */
  hasVerifiedAccount: boolean;
  /**
   * WHERE the money goes, on the row that offers to send it.
   *
   * Carried on the due itself rather than fetched by each screen, so Pay,
   * Settlements and the requests list cannot disagree about a destination while
   * all three show the same amount. Null when nothing is connected.
   *
   * Nobody should press Send having seen only a name and a number. The account
   * is the one part of a payout that cannot be undone afterwards.
   */
  destination: {
    method: 'BANK' | 'VPA';
    holderName: string;
    accountLast4?: string;
    ifsc?: string;
    vpa?: string;
  } | null;
  /** Why this row cannot be paid right now, in words. */
  blockedReason: string | null;
  /** Ledger entries making up the payable figure. */
  ledgerIds: string[];
}

/**
 * What a payee is owed, split into released and held.
 *
 * The hold period exists so a refund raised the day after delivery comes off a
 * settlement instead of becoming a debt to claw back. It is counted from when
 * each entry occurred, not from when the payout is drafted, so a long-standing
 * balance is not held hostage by one recent order.
 */
export function duesFor(
  ownerType: PayeeOwnerType,
  ownerId: string,
  ownerName: string
): DueRow {
  const rates = getActiveRates();
  const holdDays = ownerType === 'RESTAURANT' ? rates.partnerHoldDays : rates.riderHoldDays;
  const releasedBefore = new Date(Date.now() - holdDays * 86_400_000).toISOString();

  const kind = ownerType === 'RESTAURANT' ? 'PARTNER_PAYABLE' : 'RIDER_PAYABLE';
  const account = accountFor(kind as any, ownerId);
  const entries = ledger.query({ account });

  // Everything already covered by a payout that has not failed. A failed
  // payout releases its entries so the next draft picks them up again;
  // without that, a bounced bank transfer would quietly write the money off.
  const covered = new Set<string>();
  for (const payout of rows()) {
    if (payout.ownerType !== ownerType || payout.ownerId !== ownerId) continue;
    if (payout.state === 'FAILED' || payout.state === 'CANCELLED') continue;
    for (const id of payout.coversLedgerIds) covered.add(id);
  }

  let payablePaise = 0;
  let heldPaise = 0;
  const ledgerIds: string[] = [];

  for (const entry of entries) {
    if (covered.has(entry.id)) continue;
    // A credit increases what they are owed; a debit reduces it — an
    // adjustment for a refund, or a correction.
    const signed = entry.direction === 'CREDIT' ? entry.amountPaise : -entry.amountPaise;
    if (entry.occurredAt <= releasedBefore) {
      payablePaise += signed;
      ledgerIds.push(entry.id);
    } else {
      heldPaise += signed;
    }
  }

  const cashInHandPaise =
    ownerType === 'RIDER'
      ? toPaise(Number((memoryStore.riders.get(ownerId) as any)?.codCashInHand) || 0)
      : 0;

  const account_ = payableAccountFor(ownerType, ownerId);
  const hasVerifiedAccount = Boolean(account_);

  let blockedReason: string | null = null;
  if (payablePaise <= 0) {
    blockedReason = heldPaise > 0 ? 'Everything earned is still inside the hold period.' : 'Nothing owed.';
  } else if (cashInHandPaise > 0) {
    // The rule the owner asked for, and it is the right way round. A rider
    // holding Rs 2,000 of platform cash is not paid Rs 1,800 of earnings; that
    // is a net position, not a payment, and settling it by transfer means the
    // platform sending out money it is owed.
    blockedReason = `Holding ${formatPaise(cashInHandPaise)} of platform cash. It must be deposited before any payout.`;
  } else if (!hasVerifiedAccount) {
    blockedReason = 'No verified account to pay into.';
  } else if (payablePaise < toPaise(rates.minPayoutAmount)) {
    blockedReason = `Below the ${formatPaise(toPaise(rates.minPayoutAmount))} minimum. Carries to the next run.`;
  }

  return {
    ownerType,
    ownerId,
    ownerName,
    payablePaise: Math.max(0, payablePaise),
    heldPaise: Math.max(0, heldPaise),
    outstandingPaise: Math.max(0, payablePaise + heldPaise),
    cashInHandPaise,
    hasVerifiedAccount,
    destination: account_
      ? {
          method: account_.method,
          holderName: account_.holderName,
          accountLast4: account_.accountLast4,
          ifsc: account_.ifsc,
          vpa: account_.vpa
        }
      : null,
    blockedReason,
    ledgerIds
  };
}

/** Everybody with anything outstanding, most owed first. */
export function allDues(
  people: Array<{ ownerType: PayeeOwnerType; ownerId: string; ownerName: string }>
): DueRow[] {
  return people
    .map(p => duesFor(p.ownerType, p.ownerId, p.ownerName))
    .filter(row => row.outstandingPaise > 0 || row.cashInHandPaise > 0)
    .sort((a, b) => b.payablePaise - a.payablePaise);
}

/* ------------------------------------------------------------------ *
 *  THE DAILY CAP                                                      *
 * ------------------------------------------------------------------ */

/** Everything actually sent in the last 24 hours, by anybody, on any rail. */
export function paidInLast24hPaise(): number {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  return rows()
    .filter(p => (p.state === 'PAID' || p.state === 'UNCERTAIN') && (p.executedAt || '') >= since)
    .reduce((total, p) => total + p.amountPaise, 0);
}

/* ------------------------------------------------------------------ *
 *  DRAFTING                                                           *
 * ------------------------------------------------------------------ */

export function draftPayout(input: {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  actorUserId: string;
  rail?: PayoutRailId;
  note?: string;
}): PayoutRecord {
  const due = duesFor(input.ownerType, input.ownerId, input.ownerName);

  if (due.payablePaise <= 0 || due.blockedReason) {
    throw new AppError(
      due.blockedReason || 'Nothing is payable to them right now.',
      409,
      'NOTHING_PAYABLE'
    );
  }

  const rates = getActiveRates();
  const threshold = toPaise(rates.makerCheckerThreshold);
  const needsSecondApprover = due.payablePaise > threshold;

  const payout: PayoutRecord = {
    id: `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    amountPaise: due.payablePaise,
    state: needsSecondApprover ? 'AWAITING_APPROVAL' : 'APPROVED',
    rail: input.rail || defaultRail(),
    coversLedgerIds: due.ledgerIds,
    // Fixed at draft, never regenerated. A key that changes on retry is not an
    // idempotency key, it is a second payment with extra steps.
    idempotencyKey: `payout:${input.ownerType}:${input.ownerId}:${Date.now()}`,
    draftedByUserId: input.actorUserId,
    draftedAt: new Date().toISOString(),
    note: input.note
  };

  memoryStore.payouts.set(payout.id, payout);
  triggerAutoSave();
  return payout;
}

export function findPayout(id: string): PayoutRecord | null {
  const found = memoryStore.payouts.get(id);
  return found && typeof found.amountPaise === 'number' ? (found as PayoutRecord) : null;
}

export function listPayouts(filter: { state?: PayoutState; ownerId?: string } = {}): PayoutRecord[] {
  let list = rows();
  if (filter.state) list = list.filter(p => p.state === filter.state);
  if (filter.ownerId) list = list.filter(p => p.ownerId === filter.ownerId);
  return list.sort((a, b) => b.draftedAt.localeCompare(a.draftedAt));
}

/* ------------------------------------------------------------------ *
 *  APPROVAL                                                           *
 * ------------------------------------------------------------------ */

/**
 * The second signature.
 *
 * The drafter is refused explicitly and by name. Without that check the
 * threshold is decoration: the same person drafts and approves, and the
 * control that was supposed to require two people requires one person pressing
 * two buttons.
 */
export function approvePayout(id: string, actorUserId: string): PayoutRecord {
  const payout = findPayout(id);
  if (!payout) throw new AppError('No such payout.', 404, 'PAYOUT_NOT_FOUND');

  if (payout.state !== 'AWAITING_APPROVAL') {
    throw new AppError(
      `This payout is ${payout.state.toLowerCase().replace(/_/g, ' ')} and does not need approval.`,
      409,
      'PAYOUT_NOT_AWAITING_APPROVAL'
    );
  }

  if (payout.draftedByUserId === actorUserId) {
    throw new AppError(
      'A payout this size needs a second administrator. You drafted it, so somebody else must approve it.',
      403,
      'SECOND_APPROVER_REQUIRED'
    );
  }

  payout.state = 'APPROVED';
  payout.approvedByUserId = actorUserId;
  payout.approvedAt = new Date().toISOString();
  memoryStore.payouts.set(payout.id, payout);
  triggerAutoSave();
  return payout;
}

export function cancelPayout(id: string, actorUserId: string, reason: string): PayoutRecord {
  const payout = findPayout(id);
  if (!payout) throw new AppError('No such payout.', 404, 'PAYOUT_NOT_FOUND');
  if (payout.state === 'PAID' || payout.state === 'UNCERTAIN') {
    throw new AppError(
      'That payout has already been sent. Money cannot be un-sent; raise a correction instead.',
      409,
      'PAYOUT_ALREADY_SENT'
    );
  }
  payout.state = 'CANCELLED';
  payout.note = reason;
  payout.executedByUserId = actorUserId;
  memoryStore.payouts.set(payout.id, payout);
  triggerAutoSave();
  return payout;
}

/* ------------------------------------------------------------------ *
 *  EXECUTION — the moment money leaves                                *
 * ------------------------------------------------------------------ */

export async function executePayout(input: {
  id: string;
  actorUserId: string;
  manualReference?: string;
  payeePhone?: string;
}): Promise<PayoutRecord> {
  const payout = findPayout(input.id);
  if (!payout) throw new AppError('No such payout.', 404, 'PAYOUT_NOT_FOUND');

  if (payout.state === 'PAID' || payout.state === 'UNCERTAIN') {
    // Not an error to the caller's mind — they pressed a button twice, or a
    // request was retried. The money moved once and that is what matters.
    return payout;
  }

  if (payout.state !== 'APPROVED') {
    throw new AppError(
      payout.state === 'AWAITING_APPROVAL'
        ? 'This payout is still waiting for a second administrator to approve it.'
        : `A ${payout.state.toLowerCase()} payout cannot be sent.`,
      409,
      'PAYOUT_NOT_APPROVED'
    );
  }

  const rates = getActiveRates();

  /*
   * The cap is checked HERE, not at draft.
   *
   * A draft can sit for a day, and twenty drafts can each be under the cap
   * while their sum is far over it. Checking at the moment of sending is the
   * only check that bounds what actually leaves.
   */
  const capPaise = toPaise(rates.dailyPayoutCap);
  const alreadyPaid = paidInLast24hPaise();
  if (alreadyPaid + payout.amountPaise > capPaise) {
    throw new AppError(
      `This would take today's payouts past the ${formatPaise(capPaise)} daily limit — ` +
        `${formatPaise(alreadyPaid)} has already gone out. Raise the limit in Rates, or send it tomorrow.`,
      409,
      'DAILY_PAYOUT_CAP_REACHED'
    );
  }

  const rail = railFor(payout.rail);
  if (!rail.available()) {
    throw new AppError(
      rail.unavailableReason() || 'That payout method is not available.',
      503,
      'RAIL_UNAVAILABLE'
    );
  }

  // A verified account, resolved now rather than at draft — an account can be
  // withdrawn or rejected in between.
  const account = payableAccountFor(payout.ownerType, payout.ownerId);
  if (payout.rail === 'RAZORPAYX' && !account?.razorpayFundAccountId) {
    throw new AppError(
      accountBlockReason(payout.ownerType, payout.ownerId) ||
        'They have no verified account to pay into. Verify one, or use a recorded bank transfer.',
      409,
      'PAYEE_NOT_VERIFIED'
    );
  }

  /*
   * Marked in flight BEFORE the call.
   *
   * If this process dies between sending and recording, the payout must not
   * look like an untouched draft that somebody re-sends. UNCERTAIN is the
   * honest state for "we asked and do not know", and nothing retries it
   * automatically.
   */
  payout.state = 'UNCERTAIN';
  payout.executedByUserId = input.actorUserId;
  payout.executedAt = new Date().toISOString();
  memoryStore.payouts.set(payout.id, payout);
  triggerAutoSave();

  let result: { status: RailResultStatus; reference?: string; claimUrl?: string; reason?: string };
  try {
    result = await rail.send({
      amountPaise: payout.amountPaise,
      fundAccountId: account?.razorpayFundAccountId,
      payeeName: payout.ownerName,
      payeePhone: input.payeePhone,
      idempotencyKey: payout.idempotencyKey,
      referenceId: payout.id,
      narration: `Quick Bites ${payout.ownerType === 'RIDER' ? 'earnings' : 'settlement'}`,
      purpose: 'payout',
      manualReference: input.manualReference
    });
  } catch (error) {
    // A throw from a rail is a refusal it is sure about — a missing reference,
    // an unverified payee. Those never reached a bank, so the payout goes back
    // to APPROVED and can be corrected and sent again.
    payout.state = 'APPROVED';
    payout.executedAt = undefined;
    memoryStore.payouts.set(payout.id, payout);
    triggerAutoSave();
    throw error;
  }

  payout.reference = result.reference;
  payout.claimUrl = result.claimUrl;
  payout.failureReason = result.reason;

  if (result.status === 'SENT' || result.status === 'QUEUED') {
    payout.state = 'PAID';

    // The money is out. This is the entry that clears what they were owed.
    ledger.post({
      event: 'PAYOUT_SENT',
      postings: [
        {
          account: accountFor(
            (payout.ownerType === 'RESTAURANT' ? 'PARTNER_PAYABLE' : 'RIDER_PAYABLE') as any,
            payout.ownerId
          ),
          direction: 'DEBIT',
          amountPaise: payout.amountPaise
        },
        { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise: payout.amountPaise }
      ],
      idempotencyKey: `payout_sent:${payout.id}`,
      actorUserId: input.actorUserId,
      narration:
        `${formatPaise(payout.amountPaise)} paid to ${payout.ownerName} via ${rail.displayName}` +
        (result.reference ? ` (${result.reference})` : ''),
      payoutId: payout.id
    });
  } else if (result.status === 'FAILED') {
    // Definitely did not happen. The entries it covered are released by
    // `duesFor`, so the next draft picks them up rather than writing the money
    // off.
    payout.state = 'FAILED';
  } else {
    payout.state = 'UNCERTAIN';
  }

  memoryStore.payouts.set(payout.id, payout);
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'PAYOUT_EXECUTED',
      payoutId: payout.id,
      state: payout.state,
      rail: payout.rail,
      amountPaise: payout.amountPaise,
      ownerType: payout.ownerType,
      actorUserId: input.actorUserId
    })
  );

  return payout;
}

/** What a screen shows. Rupees alongside paise, because people read rupees. */
export function payoutView(payout: PayoutRecord) {
  /*
   * Where the money actually went, in words.
   *
   * The owner asked for this directly: *"it will show where the transaction is
   * happening, by whom, to which bank — if it's UPI it will show which UPI it
   * is sending to."*
   *
   * Resolved at read time from the payee's account rather than copied onto the
   * payout, because the payout already stores the one thing that must never
   * change — the amount — and a second copied field is a second thing to keep
   * in step. The last four digits and the UPI id are all that is kept anywhere
   * on this platform; the full account number was discarded at verification.
   */
  const account = payableAccountFor(payout.ownerType, payout.ownerId);
  const destination = account
    ? account.method === 'VPA'
      ? { kind: 'UPI' as const, label: account.vpa || 'UPI', holderName: account.holderName }
      : {
          kind: 'BANK' as const,
          label: account.accountLast4 ? `Account ending ${account.accountLast4}` : 'Bank account',
          ifsc: account.ifsc,
          holderName: account.holderName
        }
    : null;

  return {
    ...payout,
    amount: toRupees(payout.amountPaise),
    destination,
    /** One line a person can read out on a phone call. */
    destinationLine: destination
      ? `${formatPaise(payout.amountPaise)} to ${destination.holderName} — ${destination.label}`
      : 'No approved account on file for this payee.'
  };
}

export function resetPayoutsForTesting(): void {
  memoryStore.payouts.clear();
}
