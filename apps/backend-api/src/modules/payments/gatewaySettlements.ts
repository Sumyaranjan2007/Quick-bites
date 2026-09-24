/**
 * The gateway paying us, and the fee it keeps.
 *
 * -------------------------------------------------------------------------
 * TWO PROBLEMS, AND THEY ARE ONE PROBLEM
 * -------------------------------------------------------------------------
 * An online payment used to book straight to `PLATFORM_BANK`. Razorpay holds the
 * money for a day or more, so from the moment a customer paid, the books claimed
 * funds that were somebody else's to release.
 *
 * And Razorpay's fee — roughly 2% plus GST — was recorded NOWHERE. Not in
 * `src/`, not in `packages/`. So the ledger believed the platform received the
 * full amount the customer paid, and the gap between the books and the real bank
 * statement grew with every online order.
 *
 * They are one problem because the settlement is where both are resolved: the
 * money arrives, and the fee is what the gateway kept out of it. Fixing either
 * alone leaves the books wrong in a different way.
 *
 * -------------------------------------------------------------------------
 * WHY AN ADMINISTRATOR RECORDS IT
 * -------------------------------------------------------------------------
 * Razorpay's settlement API can be read, and should be one day. But the owner has
 * no live keys yet, and a feature that only works once they do is a feature that
 * does not work. The same decision §4.5 made for office cash: a person reads the
 * statement and records what actually landed, and the platform checks their
 * arithmetic rather than trusting it.
 *
 * -------------------------------------------------------------------------
 * THE THREE FIGURES ARE THE THREE THE STATEMENT PRINTS
 * -------------------------------------------------------------------------
 * This asked for "gross" and "net" and derived the fee by subtracting. It read
 * as the careful choice — two numbers, one subtraction, no third opinion — and it
 * was wrong, because "gross" is not a figure Razorpay's settlement row contains.
 * The row prints the amount settled, the fees, and the tax. What the dashboard
 * calls "collected" is something else again: payments BEFORE refunds. An
 * administrator reading that figure off the screen for a day with one refunded
 * order would have entered Rs 800 against a settlement of Rs 484 and booked a
 * Rs 316 fee on a Rs 16 charge.
 *
 * So the inputs are transcribed, never computed by the person typing: amount
 * settled, fees, tax. What the gateway discharged is derived from them. None of
 * the three can contradict another — they are three addends, not a claim and a
 * check — so there is still no third opinion to balance the books against, and
 * nobody has to do arithmetic in their head to use this screen.
 *
 * -------------------------------------------------------------------------
 * AND IT IS APPLIED FORWARD
 * -------------------------------------------------------------------------
 * Nothing here rewrites an existing entry. The ledger is append-only, and
 * restating what the platform believed last month would destroy the only record
 * of why last month's figures looked as they did. Orders paid before this change
 * hold their `PLATFORM_BANK` entry and are simply not part of any settlement.
 */
import { ledger } from './ledger.ts';
import { AppError } from '../../utils/AppError.ts';
import { formatPaise } from './money.ts';

export interface GatewaySettlementInput {
  /** "Amount settled" on the statement: what actually reached the bank, in paise. */
  netPaise: number;
  /** The statement's "Fees" column, in paise. */
  feesPaise: number;
  /** The statement's "Tax" column — GST on those fees — in paise. */
  taxPaise: number;
  /** The gateway's own settlement id, from the statement. */
  reference: string;
  actorUserId: string;
  note?: string;
}

export interface GatewaySettlementResult {
  netPaise: number;
  feesPaise: number;
  taxPaise: number;
  /** Fees plus tax. What the gateway kept. */
  feeTotalPaise: number;
  /** Derived: what the gateway discharged out of what it was holding. */
  dischargedPaise: number;
  reference: string;
}

/** What makes a settlement unique: the gateway's own id for it. */
export function settlementKeyFor(reference: string): string {
  return `gateway_settlement:${reference}`;
}

/**
 * What the gateway still owes the platform, in paise.
 *
 * The figure the pot panel calls "at Razorpay, not yet settled". Before this
 * existed it was invisible: the money was counted as bank, so there was nothing
 * to see.
 */
export function gatewayReceivablePaise(): number {
  return ledger.balanceOf('GATEWAY_RECEIVABLE');
}

/** Everything the gateway has kept in fees, in paise. */
export function gatewayFeesPaise(): number {
  return ledger.balanceOf('EXPENSE_GATEWAY_FEE');
}

/**
 * When the OLDEST money the gateway is still holding was taken, or null.
 *
 * -------------------------------------------------------------------------
 * WHY A BALANCE IS NOT ENOUGH TO ANSWER THIS
 * -------------------------------------------------------------------------
 * `gatewayReceivablePaise` says how much is there; it cannot say how long it has
 * been there, and the second question is the one that matters. Razorpay settles in
 * about two working days, so a positive balance is normal and a positive balance
 * that has not moved for a week is one of two problems: a settlement arrived and
 * nobody recorded it, or it never arrived. Nothing else on the platform would
 * surface either.
 *
 * -------------------------------------------------------------------------
 * FIFO, BECAUSE THAT IS HOW A GATEWAY SETTLES
 * -------------------------------------------------------------------------
 * Settlements are not linked to the individual payments they cover, so the age has
 * to be worked out rather than looked up. Captures are walked oldest-first and
 * accumulated, and the first one whose running total exceeds everything discharged
 * so far is the oldest rupee still held. That is exactly right for a gateway that
 * pays out in order, which Razorpay does.
 *
 * Discharges include refunds as well as settlements, which is correct: a reversal
 * comes out of the same balance, and counting only settlements would report money
 * as still held that the customer has already been given back.
 */
export function oldestUnsettledCaptureAt(): string | null {
  if (gatewayReceivablePaise() <= 0) return null;

  const entries = ledger.query({}).filter(e => e.account === 'GATEWAY_RECEIVABLE');

  const discharged = entries
    .filter(e => e.direction === 'CREDIT')
    .reduce((total, e) => total + e.amountPaise, 0);

  const captures = entries
    .filter(e => e.direction === 'DEBIT')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  let running = 0;
  for (const capture of captures) {
    running += capture.amountPaise;
    if (running > discharged) return capture.occurredAt;
  }

  /*
   * A positive balance with every capture accounted for. Arithmetically it should
   * not happen, and returning null rather than a guess is the point: an alert
   * built on a date this function invented would send somebody looking for a
   * payment that does not exist.
   */
  return null;
}

/** What a settlement recorded under this reference was, or null. */
function alreadyRecorded(
  reference: string
): { occurredAt: string; netPaise: number; feeTotalPaise: number } | null {
  const entries = ledger.entriesForKey(settlementKeyFor(reference));
  if (entries.length === 0) return null;

  const debitsOn = (account: string) =>
    entries
      .filter(e => e.account === account && e.direction === 'DEBIT')
      .reduce((total, e) => total + e.amountPaise, 0);

  return {
    occurredAt: entries[0].occurredAt,
    netPaise: debitsOn('PLATFORM_BANK'),
    feeTotalPaise: debitsOn('EXPENSE_GATEWAY_FEE')
  };
}

/**
 * Records a settlement: money moves from what the gateway owed us into the bank,
 * and their fee is recognised as the expense it has always silently been.
 *
 * Refuses rather than guesses on every input that could be wrong in a way the
 * books would then hide.
 */
export function recordGatewaySettlement(input: GatewaySettlementInput): GatewaySettlementResult {
  const netPaise = Math.round(Number(input.netPaise) || 0);
  const feesPaise = Math.round(Number(input.feesPaise) || 0);
  const taxPaise = Math.round(Number(input.taxPaise) || 0);
  const reference = (input.reference || '').trim();

  if (!reference) {
    /*
     * The reference is the idempotency key, so without it the same settlement can
     * be recorded twice — and a doubled settlement credits GATEWAY_RECEIVABLE
     * twice, leaving the gateway apparently owing the platform a negative amount
     * and the bank overstated by the whole settlement.
     */
    throw new AppError(
      'Enter the settlement reference from the statement. It is what stops the same settlement being recorded twice.',
      400,
      'SETTLEMENT_REFERENCE_REQUIRED'
    );
  }

  /*
   * CHECKED BEFORE ANYTHING ELSE, INCLUDING BEFORE THE AMOUNTS.
   *
   * `ledger.post` treats a repeated key as success and hands back the entries
   * that were already there. For a replayed webhook that is exactly right. For a
   * person submitting a form twice it is a lie: nothing new is written, an audit
   * line is added anyway, and the caller answers "X reached the bank" using the
   * SECOND request's figures, which were never recorded.
   *
   * And it has to come before the outstanding check, or a replay submitted after
   * the receivable has dropped is refused for the wrong reason — "the gateway is
   * only holding..." sends somebody looking for a missing payment instead of
   * telling them this settlement is already in the books.
   */
  const previous = alreadyRecorded(reference);
  if (previous) {
    throw new AppError(
      `Settlement ${reference} is already recorded — ${formatPaise(previous.netPaise)} to the bank and ` +
        `${formatPaise(previous.feeTotalPaise)} kept, on ${previous.occurredAt.slice(0, 10)}. ` +
        'Nothing has been recorded twice. If those figures are wrong, that is a correction rather than a new settlement.',
      409,
      'SETTLEMENT_ALREADY_RECORDED'
    );
  }

  if (netPaise <= 0) {
    throw new AppError(
      'Enter the amount settled, from the statement. A settlement of nothing is not a settlement.',
      400,
      'SETTLEMENT_NET_REQUIRED'
    );
  }

  if (feesPaise < 0 || taxPaise < 0) {
    throw new AppError(
      'Fees and tax cannot be negative. Copy them from the settlement row exactly as they are printed.',
      400,
      'SETTLEMENT_FEE_NEGATIVE'
    );
  }

  const feeTotalPaise = feesPaise + taxPaise;

  /*
   * What the gateway discharged out of the balance it was holding.
   *
   * Derived, and note what it is NOT: it is not the day's payments. A refund sent
   * back through the gateway has already reduced the receivable at the moment it
   * was sent, and Razorpay has already netted that same refund off this
   * settlement — so both sides account for it once, and neither has to know
   * anything about the other.
   */
  const dischargedPaise = netPaise + feeTotalPaise;

  const outstanding = gatewayReceivablePaise();
  if (dischargedPaise > outstanding) {
    /*
     * Refused rather than allowed to go negative.
     *
     * The gateway cannot settle more than it is holding. A figure above the
     * outstanding balance means either the wrong number was typed or this
     * settlement covers orders from before GATEWAY_RECEIVABLE was in use — and
     * the second is a real case with a real answer, which is that those orders
     * were already booked as bank and are not part of any settlement.
     *
     * Naming both numbers, because "that is too much" without them is a refusal
     * somebody cannot act on.
     */
    throw new AppError(
      `The gateway is only holding ${formatPaise(outstanding)}, so it cannot have settled ` +
        `${formatPaise(dischargedPaise)} (${formatPaise(netPaise)} to the bank plus ${formatPaise(
          feeTotalPaise
        )} kept). Orders paid before this was switched on were recorded straight to the bank and are not part of a settlement.`,
      409,
      'SETTLEMENT_ABOVE_OUTSTANDING'
    );
  }

  /*
   * THREE POSTINGS, AND ALL THREE MATTER.
   *
   * The bank goes up by what arrived. The receivable goes down by what the
   * gateway discharged. The difference is the fee, and it has to land somewhere
   * or the transaction does not balance — which is precisely why the fee could
   * not simply be ignored once the receivable existed. The ledger refuses a
   * one-sided transaction, so the books themselves force the fee to be recorded.
   *
   * That is the part worth noticing: this is not a fee we remembered to write
   * down. It is a fee the double-entry makes impossible to omit.
   */
  ledger.post({
    event: 'GATEWAY_SETTLED',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: netPaise },
      ...(feeTotalPaise > 0
        ? [{ account: 'EXPENSE_GATEWAY_FEE', direction: 'DEBIT' as const, amountPaise: feeTotalPaise }]
        : []),
      { account: 'GATEWAY_RECEIVABLE', direction: 'CREDIT', amountPaise: dischargedPaise }
    ],
    idempotencyKey: settlementKeyFor(reference),
    actorUserId: input.actorUserId,
    narration:
      `Gateway settled ${formatPaise(netPaise)} to the bank, keeping ${formatPaise(feeTotalPaise)} ` +
      `in fees and tax out of ${formatPaise(dischargedPaise)} (${reference})` +
      (input.note ? ` — ${input.note}` : '')
  });

  return { netPaise, feesPaise, taxPaise, feeTotalPaise, dischargedPaise, reference };
}
