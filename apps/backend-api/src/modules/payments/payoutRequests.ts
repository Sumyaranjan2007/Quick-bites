/**
 * "I would like to be paid."
 *
 * -------------------------------------------------------------------------
 * WHAT A REQUEST IS, AND WHAT IT IS NOT
 * -------------------------------------------------------------------------
 * The owner put it exactly right: *"the money they earn they can raise so we
 * will get notified what to pay them with proofs why we paying how they earn
 * all those — still even they dont we will see all the payments we need to do
 * daily and clear everyone's payment."*
 *
 * So a request does two things and no more: it says somebody is waiting, and it
 * carries the statement that explains what they are waiting for. It does **not**
 * name an amount. The amount comes from the ledger at the moment an
 * administrator drafts the payout, exactly as it does for a payout nobody
 * asked for.
 *
 * That is the whole design. A request that carried an amount would be a
 * payee-supplied figure travelling towards a bank, and the only thing standing
 * between it and the money would be an administrator noticing. Here there is
 * nothing to notice, because there is nothing to tamper with: raising a request
 * changes who is waiting for whom, and nothing else.
 *
 * -------------------------------------------------------------------------
 * AND NOT BEING ABLE TO RAISE ONE IS NEVER A REASON NOT TO PAY
 * -------------------------------------------------------------------------
 * The daily dues run pays everybody who is owed, request or no request. This
 * module makes somebody VISIBLE sooner; it is not a gate they have to pass to
 * be paid. A platform where the quiet ones go unpaid is a platform that pays
 * the people who complain, and the owner asked for the opposite.
 */
import { randomUUID } from 'node:crypto';
import type { PayeeOwnerType } from '@quick-bites/shared-types';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { duesFor } from './payouts.ts';
import { formatPaise, toRupees } from './money.ts';

export type PayoutRequestStatus = 'OPEN' | 'SEEN' | 'SETTLED' | 'DECLINED' | 'WITHDRAWN';

export interface PayoutRequest {
  id: string;
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  /** The account that raised it, so an audit can name a person. */
  raisedByUserId: string;
  raisedAt: string;
  /**
   * What the ledger said was payable AT THE MOMENT IT WAS RAISED.
   *
   * A snapshot for context, never an instruction. It is deliberately not used
   * to size any payment: by the time an administrator acts, an order may have
   * been refunded and the real figure may be lower. Showing both is how a
   * partner finds out why.
   */
  payableAtRequestPaise: number;
  /** Their own words. Optional, and never acted on automatically. */
  note?: string;
  status: PayoutRequestStatus;
  /** Set when an administrator opens it. */
  seenByUserId?: string;
  seenAt?: string;
  /** The payout that answered it. */
  settledByPayoutId?: string;
  settledAt?: string;
  declinedByUserId?: string;
  declinedAt?: string;
  /** Required to decline. Somebody has to read this. */
  declineReason?: string;
}

function rows(): PayoutRequest[] {
  return Array.from(memoryStore.payoutRequests.values()).filter(
    (r: any) => r && typeof r.raisedAt === 'string'
  ) as PayoutRequest[];
}

const OPEN_STATES: PayoutRequestStatus[] = ['OPEN', 'SEEN'];

/** The request this payee is currently waiting on, if any. */
export function openRequestFor(ownerType: PayeeOwnerType, ownerId: string): PayoutRequest | null {
  return (
    rows().find(
      r => r.ownerType === ownerType && r.ownerId === ownerId && OPEN_STATES.includes(r.status)
    ) || null
  );
}

export function listRequests(
  filter: { status?: PayoutRequestStatus; open?: boolean; ownerId?: string } = {}
): PayoutRequest[] {
  let list = rows();
  if (filter.ownerId) list = list.filter(r => r.ownerId === filter.ownerId);
  if (filter.status) list = list.filter(r => r.status === filter.status);
  if (filter.open) list = list.filter(r => OPEN_STATES.includes(r.status));
  return list.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
}

/**
 * Raise one.
 *
 * Refused when there is nothing owed, and refused when one is already open.
 * Both refusals say why in the payee's own terms, because the alternative is a
 * partner tapping the button eleven times and an administrator opening eleven
 * identical rows.
 */
export function raiseRequest(input: {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  raisedByUserId: string;
  note?: string;
}): PayoutRequest {
  const existing = openRequestFor(input.ownerType, input.ownerId);
  if (existing) {
    throw new AppError(
      'You already have a request waiting. We will come back to you on that one.',
      409,
      'REQUEST_ALREADY_OPEN'
    );
  }

  const due = duesFor(input.ownerType, input.ownerId, input.ownerName);

  if (due.outstandingPaise <= 0) {
    throw new AppError(
      'There is nothing outstanding to request. Everything earned has been paid across.',
      409,
      'NOTHING_OWED'
    );
  }

  if (due.payablePaise <= 0) {
    throw new AppError(
      `Everything you have earned is still inside the ${
        input.ownerType === 'RESTAURANT' ? 'settlement' : 'payout'
      } hold period. ${formatPaise(due.heldPaise)} becomes payable shortly, and you do not need to ask for it.`,
      409,
      'STILL_HELD'
    );
  }

  /*
   * A rider carrying our cash is refused here rather than at the far end.
   *
   * They would be refused at drafting anyway, but discovering it then means an
   * administrator opens a request that was never actionable. Telling the rider
   * now, with the figure, is the version that gets the cash deposited.
   */
  if (due.cashInHandPaise > 0) {
    throw new AppError(
      `You are holding ${formatPaise(
        due.cashInHandPaise
      )} of cash collected for us. Deposit it at the office and your earnings can be paid straight away.`,
      409,
      'CASH_IN_HAND'
    );
  }

  if (!due.hasVerifiedAccount) {
    throw new AppError(
      'Add a bank account and let it be verified first. There is nowhere to send this yet.',
      409,
      'NO_VERIFIED_ACCOUNT'
    );
  }

  const request: PayoutRequest = {
    id: `pyr_${randomUUID().slice(0, 12)}`,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    raisedByUserId: input.raisedByUserId,
    raisedAt: new Date().toISOString(),
    payableAtRequestPaise: due.payablePaise,
    ...(input.note ? { note: input.note } : {}),
    status: 'OPEN'
  };

  memoryStore.payoutRequests.set(request.id, request);
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'PAYOUT_REQUEST_RAISED',
      requestId: request.id,
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      payablePaise: request.payableAtRequestPaise
    })
  );

  return request;
}

/** The payee changes their mind. Only they can, and only while it is open. */
export function withdrawRequest(id: string, ownerId: string): PayoutRequest {
  const request = memoryStore.payoutRequests.get(id) as PayoutRequest | undefined;
  if (!request || request.ownerId !== ownerId) {
    throw new AppError('No such request.', 404, 'REQUEST_NOT_FOUND');
  }
  if (!OPEN_STATES.includes(request.status)) {
    throw new AppError('That request has already been dealt with.', 409, 'REQUEST_CLOSED');
  }

  request.status = 'WITHDRAWN';
  memoryStore.payoutRequests.set(request.id, request);
  triggerAutoSave();
  return request;
}

/** An administrator has opened it. Recorded so "nobody looked" is answerable. */
export function markSeen(id: string, actorUserId: string): PayoutRequest {
  const request = memoryStore.payoutRequests.get(id) as PayoutRequest | undefined;
  if (!request) throw new AppError('No such request.', 404, 'REQUEST_NOT_FOUND');
  if (request.status !== 'OPEN') return request;

  request.status = 'SEEN';
  request.seenByUserId = actorUserId;
  request.seenAt = new Date().toISOString();
  memoryStore.payoutRequests.set(request.id, request);
  triggerAutoSave();
  return request;
}

/**
 * Declining one.
 *
 * A reason is compulsory, and it is shown to the payee verbatim. A request that
 * disappears without explanation is how a partner decides the platform is not
 * paying them — and they are entitled to that conclusion if nobody said
 * otherwise.
 *
 * Declining does not touch the money. What they are owed remains owed, remains
 * in the daily dues, and will be paid. This closes a conversation, not a debt.
 */
export function declineRequest(id: string, actorUserId: string, reason: string): PayoutRequest {
  const request = memoryStore.payoutRequests.get(id) as PayoutRequest | undefined;
  if (!request) throw new AppError('No such request.', 404, 'REQUEST_NOT_FOUND');
  if (!OPEN_STATES.includes(request.status)) {
    throw new AppError('That request has already been dealt with.', 409, 'REQUEST_CLOSED');
  }
  if (!reason || reason.trim().length < 4) {
    throw new AppError('Say why. It is shown to them exactly as written.', 400, 'REASON_REQUIRED');
  }

  request.status = 'DECLINED';
  request.declinedByUserId = actorUserId;
  request.declinedAt = new Date().toISOString();
  request.declineReason = reason.trim();
  memoryStore.payoutRequests.set(request.id, request);
  triggerAutoSave();
  return request;
}

/**
 * A payout went out; close whatever this payee was waiting on.
 *
 * Called from the payout path rather than by an administrator, because a
 * request that stays open after the money has landed is a request somebody
 * pays twice.
 */
export function settleRequestsFor(
  ownerType: PayeeOwnerType,
  ownerId: string,
  payoutId: string
): number {
  let closed = 0;
  for (const request of rows()) {
    if (request.ownerType !== ownerType || request.ownerId !== ownerId) continue;
    if (!OPEN_STATES.includes(request.status)) continue;

    request.status = 'SETTLED';
    request.settledByPayoutId = payoutId;
    request.settledAt = new Date().toISOString();
    memoryStore.payoutRequests.set(request.id, request);
    closed += 1;
  }
  if (closed > 0) triggerAutoSave();
  return closed;
}

/** With rupee figures alongside, for a screen. */
export function requestView(request: PayoutRequest) {
  return {
    ...request,
    payableAtRequest: toRupees(request.payableAtRequestPaise)
  };
}

export function resetPayoutRequestsForTesting(): void {
  memoryStore.payoutRequests.clear();
}
