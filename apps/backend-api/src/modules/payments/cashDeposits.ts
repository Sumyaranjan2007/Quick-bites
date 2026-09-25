/**
 * Cash a rider is carrying, and getting it back.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS IS ACTUALLY ABOUT
 * -------------------------------------------------------------------------
 * A rider who takes cash at the door is holding the platform's money. Until
 * they hand it in, the platform owns an asset that is in somebody's pocket,
 * moving around a city on a motorbike.
 *
 * The owner's rule: the rider deposits it at the office, an administrator
 * confirms what was received, and only then can that rider be paid. Not netted
 * off — a rider holding Rs 2,000 of our cash is not paid Rs 1,800 of earnings,
 * because that is a net position rather than a payment, and settling it by
 * transfer means the platform sending out money it is owed.
 *
 * -------------------------------------------------------------------------
 * TWO NUMBERS, NOT ONE
 * -------------------------------------------------------------------------
 * The rider DECLARES what they are bringing; an administrator CONFIRMS what
 * was counted. Both are kept even when they differ.
 *
 * That is the whole design. A single number recorded by one party is that
 * party's word, and when a bag is Rs 500 light there is no way to tell whether
 * it was short when it left or short when it arrived. Two numbers and two
 * timestamps mean a disagreement is visible and attributable, and — far more
 * often — that an honest miscount is obviously an honest miscount.
 *
 * -------------------------------------------------------------------------
 * AND A CEILING
 * -------------------------------------------------------------------------
 * Above `codCashCeiling` a rider stops being offered cash orders. Online-paid
 * orders still reach them, so they keep earning, and the platform's exposure to
 * any one rider is bounded by a number an administrator sets rather than by how
 * long it has been since anybody checked.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { ledger, accountFor } from './ledger.ts';
import { toPaise, toRupees, formatPaise } from './money.ts';
import { getActiveRates } from './pricingConfig.ts';
import type { CashDeposit, CashDepositStatus } from '@quick-bites/shared-types';

function rows(): CashDeposit[] {
  return Array.from(memoryStore.cashDeposits.values()) as CashDeposit[];
}

export function listDeposits(filter: { riderId?: string; status?: CashDepositStatus } = {}): CashDeposit[] {
  let list = rows();
  if (filter.riderId) list = list.filter(d => d.riderId === filter.riderId);
  if (filter.status) list = list.filter(d => d.status === filter.status);
  return list.sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
}

export function findDeposit(id: string): CashDeposit | null {
  return (memoryStore.cashDeposits.get(id) as CashDeposit) || null;
}

/** Cash this rider is carrying, in paise, from their own record. */
export function cashInHandPaise(riderId: string): number {
  const rider = memoryStore.riders.get(riderId) as { codCashInHand?: number } | undefined;
  return toPaise(Number(rider?.codCashInHand) || 0);
}

export interface CashStanding {
  cashInHandPaise: number;
  ceilingPaise: number;
  warnAtPaise: number;
  /** Whether they may still be offered cash orders. */
  canTakeCod: boolean;
  /** Whether they are close enough that they should be told. */
  shouldWarn: boolean;
  /** An open declaration awaiting confirmation, if there is one. */
  pendingDeposit: CashDeposit | null;
  /** What the rider is told, in words. */
  message: string | null;
}

/**
 * Where a rider stands on cash.
 *
 * One function so the dispatcher, the rider's screen and the admin queue cannot
 * disagree about who is over the line — three implementations of one threshold
 * is how a rider gets blocked on one screen and offered work on another.
 */
export function cashStanding(riderId: string): CashStanding {
  const rates = getActiveRates();
  const held = cashInHandPaise(riderId);
  const ceilingPaise = toPaise(rates.codCashCeiling);
  const warnAtPaise = Math.round((ceilingPaise * rates.codCashWarnPercent) / 100);
  const pendingDeposit = listDeposits({ riderId, status: 'DECLARED' })[0] || null;

  const canTakeCod = held < ceilingPaise;
  const shouldWarn = held >= warnAtPaise;

  let message: string | null = null;
  if (!canTakeCod) {
    message =
      `You are carrying ${formatPaise(held)} of Quick Bites cash, which is the limit. ` +
      `Cash orders will not be offered until you deposit it. Online-paid orders still come to you.`;
  } else if (shouldWarn) {
    message =
      `You are carrying ${formatPaise(held)}. At ${formatPaise(ceilingPaise)} cash orders stop being offered, ` +
      `so deposit it when you can.`;
  }

  return { cashInHandPaise: held, ceilingPaise, warnAtPaise, canTakeCod, shouldWarn, pendingDeposit, message };
}

/**
 * The rider says what they are bringing in.
 *
 * Nothing moves. This is a statement of intent, and its value is that it exists
 * before the counting does — a declaration made after a bag has been counted is
 * not evidence of anything.
 */
export function declareDeposit(input: {
  riderId: string;
  riderUserId: string;
  riderName?: string;
  amountPaise: number;
  proofUrl?: string;
}): CashDeposit {
  const held = cashInHandPaise(input.riderId);

  if (input.amountPaise <= 0) {
    throw new AppError('Enter the amount you are bringing in.', 400, 'INVALID_DEPOSIT_AMOUNT');
  }
  if (input.amountPaise > held) {
    // Refused rather than accepted as a credit. A rider cannot deposit money
    // the platform does not believe they have, and a miscount here would
    // otherwise create a balance owed TO the rider out of thin air.
    throw new AppError(
      `You are carrying ${formatPaise(held)}. You cannot deposit more than that.`,
      400,
      'DEPOSIT_EXCEEDS_CASH_IN_HAND'
    );
  }

  const existing = listDeposits({ riderId: input.riderId, status: 'DECLARED' })[0];
  if (existing) {
    throw new AppError(
      `You have already declared ${formatPaise(existing.declaredPaise)}. Bring that in first, or cancel it.`,
      409,
      'DEPOSIT_ALREADY_DECLARED'
    );
  }

  const deposit: CashDeposit = {
    id: `csh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    riderId: input.riderId,
    riderUserId: input.riderUserId,
    riderName: input.riderName,
    declaredPaise: input.amountPaise,
    status: 'DECLARED',
    proofUrl: input.proofUrl,
    declaredAt: new Date().toISOString(),
    cashInHandAtDeclarationPaise: held
  };

  memoryStore.cashDeposits.set(deposit.id, deposit);
  triggerAutoSave();
  return deposit;
}

/** The rider changes their mind before coming in. */
export function cancelDeposit(id: string, riderId: string): CashDeposit {
  const deposit = findDeposit(id);
  if (!deposit || deposit.riderId !== riderId) {
    throw new AppError('No such deposit.', 404, 'DEPOSIT_NOT_FOUND');
  }
  if (deposit.status !== 'DECLARED') {
    throw new AppError('That deposit has already been dealt with.', 409, 'DEPOSIT_ALREADY_SETTLED');
  }
  deposit.status = 'CANCELLED';
  memoryStore.cashDeposits.set(deposit.id, deposit);
  triggerAutoSave();
  return deposit;
}

/**
 * An administrator counts it and confirms what arrived.
 *
 * The cash-in-hand is reduced by what was ACTUALLY RECEIVED, never by what was
 * declared. That distinction is the whole control: reducing by the declaration
 * would let a rider write off any amount by saying they had brought it.
 */
export function confirmDeposit(input: {
  depositId: string;
  receivedPaise: number;
  actorUserId: string;
  varianceNote?: string;
}): { deposit: CashDeposit; variancePaise: number; remainingPaise: number } {
  const deposit = findDeposit(input.depositId);
  if (!deposit) throw new AppError('No such deposit.', 404, 'DEPOSIT_NOT_FOUND');
  if (deposit.status !== 'DECLARED') {
    throw new AppError('That deposit has already been dealt with.', 409, 'DEPOSIT_ALREADY_SETTLED');
  }
  if (input.receivedPaise < 0) {
    throw new AppError('A received amount cannot be negative.', 400, 'INVALID_RECEIVED_AMOUNT');
  }

  const held = cashInHandPaise(deposit.riderId);
  if (input.receivedPaise > held) {
    // A credit is never created by a miscount. If somebody genuinely handed
    // over more than the platform thinks they hold, that is a discrepancy to
    // investigate, not money to book.
    throw new AppError(
      `This rider is only carrying ${formatPaise(held)}. Receiving more than that needs investigating, ` +
        `not recording.`,
      400,
      'RECEIVED_EXCEEDS_CASH_IN_HAND'
    );
  }

  const variancePaise = input.receivedPaise - deposit.declaredPaise;

  if (variancePaise !== 0 && !input.varianceNote) {
    throw new AppError(
      `The rider declared ${formatPaise(deposit.declaredPaise)} and you counted ` +
        `${formatPaise(input.receivedPaise)}. Record why before confirming — this is the only account of ` +
        `what happened.`,
      400,
      'VARIANCE_NOTE_REQUIRED'
    );
  }

  deposit.receivedPaise = input.receivedPaise;
  deposit.status = variancePaise === 0 ? 'CONFIRMED' : 'VARIANCE';
  deposit.confirmedAt = new Date().toISOString();
  deposit.confirmedByUserId = input.actorUserId;
  deposit.varianceNote = input.varianceNote;
  memoryStore.cashDeposits.set(deposit.id, deposit);

  /*
   * The money moves from the rider's pocket into the OFFICE, not the bank.
   *
   * This used to debit PLATFORM_BANK, which said the platform held bank money
   * from the moment a rider reached the desk -- for however many days passed
   * before somebody walked to the branch. Banking it is a separate physical act
   * and is now a separate posting; see bankOfficeCash below.
   *
   * Note what does NOT appear here: any REVENUE account. Our profit on a cash
   * order was recognised at DELIVERY, when the gross was split and the whole of
   * it debited to the rider. Crediting revenue again when the notes are counted
   * would book every cash order twice and show a profit near double the truth,
   * on a screen that adds up perfectly. This posting changes the money's
   * LOCATION, never its ownership.
   */
  if (input.receivedPaise > 0) {
    ledger.post({
      event: 'CASH_DEPOSIT_CONFIRMED',
      postings: [
        { account: 'PLATFORM_CASH', direction: 'DEBIT', amountPaise: input.receivedPaise },
        {
          account: accountFor('RIDER_CASH', deposit.riderId),
          direction: 'CREDIT',
          amountPaise: input.receivedPaise
        }
      ],
      idempotencyKey: `cash_deposit:${deposit.id}`,
      actorUserId: input.actorUserId,
      narration:
        `${formatPaise(input.receivedPaise)} cash received from ${deposit.riderName || deposit.riderId}` +
        (variancePaise === 0 ? '' : ` (declared ${formatPaise(deposit.declaredPaise)})`),
      cashDepositId: deposit.id
    });
  }

  // And the rider's own record comes down by the same amount. The difference,
  // if there was one, stays against them — it is still the platform's money and
  // it is still in somebody's pocket.
  const rider = memoryStore.riders.get(deposit.riderId) as { codCashInHand?: number } | undefined;
  if (rider) {
    const remaining = Math.max(0, held - input.receivedPaise);
    rider.codCashInHand = toRupees(remaining);
    memoryStore.riders.set(deposit.riderId, rider);
  }

  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: variancePaise === 0 ? 'INFO' : 'WARN',
      timestamp: new Date().toISOString(),
      event: variancePaise === 0 ? 'CASH_DEPOSIT_CONFIRMED' : 'CASH_DEPOSIT_VARIANCE',
      depositId: deposit.id,
      riderId: deposit.riderId,
      declaredPaise: deposit.declaredPaise,
      receivedPaise: input.receivedPaise,
      variancePaise,
      actorUserId: input.actorUserId
    })
  );

  return { deposit, variancePaise, remainingPaise: cashInHandPaise(deposit.riderId) };
}

/**
 * A rider walks in with cash and has tapped nothing in the app.
 *
 * Every existing path needs a deposit the RIDER declared first, so somebody
 * standing at the desk holding four thousand rupees could not be cleared by
 * anyone. That was the defect: the office is where this actually happens, and
 * the app was the only way in.
 *
 * Deliberately built as declare-then-confirm through the SAME functions rather
 * than as a second cash path with its own arithmetic. This platform has already
 * removed one payout system that adjusted a balance without a ledger entry; a
 * second cash route doing its own posting is that mistake wearing a different
 * hat. The rules come along for free: it cannot exceed what they are holding,
 * it reduces cash-in-hand by what was RECEIVED, and it posts one movement.
 */
export function recordCashReturn(input: {
  riderId: string;
  amountPaise: number;
  actorUserId: string;
  note?: string;
}): { deposit: CashDeposit; variancePaise: number; remainingPaise: number } {
  const rider = memoryStore.riders.get(input.riderId) as any;
  if (!rider) {
    throw new AppError('No such delivery partner.', 404, 'RIDER_NOT_FOUND');
  }

  const held = cashInHandPaise(input.riderId);
  if (input.amountPaise <= 0) {
    throw new AppError('Enter the amount you counted.', 400, 'INVALID_DEPOSIT_AMOUNT');
  }
  if (input.amountPaise > held) {
    // Named amounts, not "invalid amount". Whoever is at the desk needs to know
    // what the platform thinks this rider is carrying in order to argue with it.
    throw new AppError(
      `${rider.fullName || input.riderId} is carrying ${formatPaise(held)}. ` +
        `You cannot record a return of ${formatPaise(input.amountPaise)}.`,
      400,
      'RETURN_EXCEEDS_CASH_IN_HAND'
    );
  }

  /*
   * An open declaration is absorbed rather than refused.
   *
   * A rider who declared Rs 4,000 in the app and then arrived is the NORMAL
   * case, and refusing it would send the person at the desk to cancel the
   * rider's declaration first, which is a rule nobody will remember at a
   * counter with somebody waiting.
   */
  const open = listDeposits({ riderId: input.riderId, status: 'DECLARED' })[0];
  const deposit =
    open ??
    declareDeposit({
      riderId: input.riderId,
      riderUserId: rider.userId,
      riderName: rider.fullName || rider.driverCode,
      amountPaise: input.amountPaise
    });

  (deposit as any).declaredBy = open ? 'RIDER' : 'ADMIN';
  memoryStore.cashDeposits.set(deposit.id, deposit);

  return confirmDeposit({
    depositId: deposit.id,
    receivedPaise: input.amountPaise,
    actorUserId: input.actorUserId,
    // A variance note is required when the counted amount differs from the
    // declaration, and an admin-recorded return against an open declaration is
    // exactly where that happens.
    varianceNote:
      input.note ||
      (open && open.declaredPaise !== input.amountPaise
        ? 'Counted at the office by an administrator.'
        : undefined)
  });
}

/** What the office is holding and has not banked. */
export function officeCashPaise(): number {
  return ledger.balanceOf('PLATFORM_CASH');
}

/**
 * The walk to the branch. Office cash becomes bank cash.
 *
 * Separate from the handover because they are separate physical acts, days
 * apart, and collapsing them is what made the platform believe it could pay
 * people out of money that was in a drawer.
 */
export function bankOfficeCash(input: {
  amountPaise: number;
  actorUserId: string;
  reference: string;
  depositedOn?: string;
}): { bankedPaise: number; officeRemainingPaise: number } {
  const available = officeCashPaise();

  if (input.amountPaise <= 0) {
    throw new AppError('Enter how much was paid into the bank.', 400, 'INVALID_BANK_DEPOSIT');
  }
  if (input.amountPaise > available) {
    throw new AppError(
      `The office is holding ${formatPaise(available)}. You cannot bank ${formatPaise(input.amountPaise)}.`,
      400,
      'BANK_DEPOSIT_EXCEEDS_OFFICE_CASH'
    );
  }
  if (!input.reference?.trim()) {
    // The slip number is the only thing tying this entry to a real bank
    // statement line. Without it the two can never be reconciled, and an
    // unreconcilable cash movement is indistinguishable from a missing one.
    throw new AppError(
      'Record the deposit slip or reference number.',
      400,
      'BANK_DEPOSIT_REFERENCE_REQUIRED'
    );
  }

  ledger.post({
    event: 'CASH_BANKED',
    postings: [
      { account: 'PLATFORM_BANK', direction: 'DEBIT', amountPaise: input.amountPaise },
      { account: 'PLATFORM_CASH', direction: 'CREDIT', amountPaise: input.amountPaise }
    ],
    // Same slip twice is the same deposit, not two.
    idempotencyKey: `cash_banked:${input.reference.trim()}`,
    actorUserId: input.actorUserId,
    narration:
      `${formatPaise(input.amountPaise)} office cash paid into the bank` +
      ` (ref ${input.reference.trim()}${input.depositedOn ? `, ${input.depositedOn}` : ''})`
  });

  return { bankedPaise: input.amountPaise, officeRemainingPaise: officeCashPaise() };
}

/**
 * Riders carrying cash, worst first.
 *
 * The ageing report. A rider quietly accumulating cash and never coming in is
 * not visible from any single order, and this is the screen where that becomes
 * obvious before it becomes expensive.
 */
export function cashAgeing(): Array<{
  riderId: string;
  riderName: string;
  cashInHandPaise: number;
  cashInHand: number;
  overCeiling: boolean;
  lastDepositAt: string | null;
  pendingDeclarationPaise: number | null;
}> {
  const rates = getActiveRates();
  const ceilingPaise = toPaise(rates.codCashCeiling);

  const out: ReturnType<typeof cashAgeing> = [];
  for (const [riderId, rider] of memoryStore.riders) {
    const held = toPaise(Number((rider as any)?.codCashInHand) || 0);
    if (held <= 0) continue;

    const deposits = listDeposits({ riderId });
    const lastConfirmed = deposits.find(d => d.status === 'CONFIRMED' || d.status === 'VARIANCE');
    const pending = deposits.find(d => d.status === 'DECLARED');

    out.push({
      riderId,
      riderName: (rider as any)?.fullName || (rider as any)?.driverCode || riderId,
      cashInHandPaise: held,
      cashInHand: toRupees(held),
      overCeiling: held >= ceilingPaise,
      lastDepositAt: lastConfirmed?.confirmedAt || null,
      pendingDeclarationPaise: pending?.declaredPaise ?? null
    });
  }

  return out.sort((a, b) => b.cashInHandPaise - a.cashInHandPaise);
}

export function resetCashDepositsForTesting(): void {
  memoryStore.cashDeposits.clear();
}
