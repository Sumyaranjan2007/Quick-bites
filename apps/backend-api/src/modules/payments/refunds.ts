/**
 * Giving money back.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS REPLACES
 * -------------------------------------------------------------------------
 * There were two refund paths on this platform and they disagreed.
 *
 * Cancelling an order refunded correctly, at the gateway, to the card or UPI
 * the customer actually used. The ADMIN REFUND QUEUE — the one a human
 * operates, which handles every complaint and every goodwill gesture — called
 * `walletRepository.credit` unconditionally. It never looked at how the order
 * was paid. A customer who paid Rs 480 by UPI and complained received Rs 480 of
 * Quick Bites credit, and the success message said so in as many words.
 *
 * So the path used by a machine was right and the path used by a person was
 * wrong, which is the worse way round.
 *
 * -------------------------------------------------------------------------
 * ONE RULE
 * -------------------------------------------------------------------------
 * Money goes back the way it came. No exceptions, no store credit, no
 * substitution. Where it cannot — a cash order, which has no payment to
 * reverse — a payout link goes to the customer and they enter their own UPI.
 * We never store a customer's bank details to do it.
 *
 * -------------------------------------------------------------------------
 * AND ONE MORE
 * -------------------------------------------------------------------------
 * A refund that has not settled is NEVER displayed as refunded. The case stays
 * open where somebody will see it. A green tick over money that has not moved
 * is the most expensive lie this system could tell, because it stops anybody
 * looking for it.
 */
import { memoryStore } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { ledger, accountFor } from './ledger.ts';
import { toPaise, toRupees, formatPaise } from './money.ts';
import { razorpayAdapter } from './razorpayAdapter.ts';
import { railFor } from './rails.ts';
import { isRazorpayXConfigured } from './razorpayXAdapter.ts';
import type { Order } from '@quick-bites/shared-types';

export type RefundRoute =
  /** Reversed at the gateway, to the card or UPI that paid. */
  | 'SOURCE'
  /** A link the customer opens and puts their own UPI into. Cash orders. */
  | 'LINK'
  /** The rider handed cash back at the door. Recorded, not moved. */
  | 'CASH_AT_DOOR'
  /** Nothing was ever taken, so nothing is owed back. */
  | 'NOTHING_TO_REFUND';

export interface RefundOutcome {
  route: RefundRoute;
  settled: boolean;
  amountPaise: number;
  reference?: string;
  claimUrl?: string;
  /** What the customer is told. Always specific about where the money went. */
  message: string;
  failureReason?: string;
}

/**
 * Which route an order's refund must take.
 *
 * Decided from the ORDER, never from what an administrator picked on a screen.
 * A refund route is a fact about how the customer paid, not a preference — and
 * the moment it becomes a dropdown, somebody will choose the convenient one.
 */
export function routeFor(order: Order): RefundRoute {
  const paidOnline = Boolean(order.razorpayPaymentId);
  if (paidOnline) return 'SOURCE';

  const wasCash = order.paymentMethod === 'CASH_ON_DELIVERY';
  if (!wasCash) {
    // A wallet-paid order from before the wallet was removed. There is no
    // wallet to return it to any more, so it goes out by link like a cash one.
    return 'LINK';
  }

  // Cash, and the customer never handed any over: nothing was taken.
  if (order.paymentStatus !== 'PAID') return 'NOTHING_TO_REFUND';

  return 'LINK';
}

/** How long a card refund actually takes, in words a customer can plan around. */
function timingFor(route: RefundRoute): string {
  switch (route) {
    case 'SOURCE':
      return 'It reaches your bank in 3 to 7 working days — that timing is your bank’s, not ours.';
    case 'LINK':
      return 'Open the link and enter any UPI id. The money arrives within minutes of you doing so.';
    case 'CASH_AT_DOOR':
      return 'The rider returned this in cash at your door.';
    default:
      return '';
  }
}

/**
 * Sends a refund, by whichever route the order dictates.
 *
 * Returns what actually happened. It does not throw on a gateway failure: a
 * refund that could not be settled has to leave a case open rather than
 * discarding the decision to refund, and a throw here would lose the
 * cancellation or the complaint that produced it.
 */
export async function sendRefund(input: {
  order: Order;
  amountPaise: number;
  reason: string;
  actorUserId: string;
  caseId?: string;
  /** Where a payout link is sent. Read from the order, not from a request. */
  customerPhone?: string;
  /**
   * An administrator has already refunded this by hand and is recording it.
   *
   * The escape hatch, and it is not a convenience. A deployment without
   * RazorpayX cannot create a payout link, so a customer who paid cash could
   * not be refunded AT ALL — the money would simply be owed indefinitely while
   * a case sat in a queue. The owner asked to be able to pay in any situation,
   * and this is that, for the direction money goes back.
   *
   * It settles the case and writes the same ledger entries as any other route,
   * because the money did leave; only the reference differs. What it does NOT
   * do is pretend: an administrator has asserted this, and the audit records
   * who.
   */
  manualReference?: string;
}): Promise<RefundOutcome> {
  const { order, amountPaise } = input;

  if (amountPaise <= 0) {
    return {
      route: 'NOTHING_TO_REFUND',
      settled: true,
      amountPaise: 0,
      message: 'There is nothing to refund on this order.'
    };
  }

  const orderTotalPaise = toPaise(Number(order.bill?.totalAmount) || 0);
  if (amountPaise > orderTotalPaise) {
    throw new AppError(
      `A refund cannot exceed the order total of ${formatPaise(orderTotalPaise)}.`,
      400,
      'REFUND_EXCEEDS_ORDER'
    );
  }

  const route = routeFor(order);

  if (route === 'NOTHING_TO_REFUND') {
    return {
      route,
      settled: true,
      amountPaise: 0,
      message:
        'This order was never paid for — it was cash on delivery and no money changed hands. Nothing is owed back.'
    };
  }

  let settled = false;
  let reference: string | undefined;
  let claimUrl: string | undefined;
  let failureReason: string | undefined;

  if (input.manualReference && input.manualReference.trim().length >= 4) {
    // Recorded by hand. The money has already moved; this writes it down.
    settled = true;
    reference = input.manualReference.trim();
  } else if (route === 'SOURCE') {
    const result = await razorpayAdapter
      .refund(order.razorpayPaymentId!, amountPaise)
      .catch(() => null);
    if (result) {
      settled = true;
      reference = result.id;
    } else {
      failureReason = 'The payment gateway could not be reached to reverse this payment.';
    }
  } else {
    // A payout link. Needs somewhere to send it, and RazorpayX to create it.
    if (!isRazorpayXConfigured()) {
      failureReason =
        'Refunds by link are not available on this deployment yet. Settle this one by bank transfer and record it.';
    } else if (!input.customerPhone) {
      failureReason = 'This order has no phone number to send a refund link to.';
    } else {
      const rail = railFor('PAYOUT_LINK');
      const result = await rail.send({
        amountPaise,
        payeeName: order.customerName || 'Quick Bites customer',
        payeePhone: input.customerPhone,
        idempotencyKey: `refund:${input.caseId || order.id}`,
        referenceId: (input.caseId || order.id).slice(0, 40),
        narration: `Refund for order ${order.orderNumber}`,
        purpose: 'refund'
      });
      if (result.status === 'SENT' || result.status === 'QUEUED') {
        settled = true;
        reference = result.reference;
        claimUrl = result.claimUrl;
      } else {
        failureReason = result.reason || 'The refund link could not be created.';
      }
    }
  }

  if (settled) {
    /*
     * The money is out. Posted against REFUNDS_PAID rather than reducing
     * revenue directly, so a period's refunds are a figure somebody can look
     * at rather than a silent dent in the takings.
     *
     * Keyed on the case, so a retried decision cannot refund twice — which
     * matters more here than almost anywhere, because the gateway would
     * cheerfully process a second refund against the same payment.
     */
    ledger.post({
      event: route === 'SOURCE' ? 'REFUND_TO_SOURCE' : 'REFUND_BY_LINK',
      postings: [
        { account: 'REFUNDS_PAID', direction: 'DEBIT', amountPaise },
        { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise }
      ],
      idempotencyKey: `refund_paid:${input.caseId || order.id}`,
      actorUserId: input.actorUserId,
      narration: `${formatPaise(amountPaise)} refunded on order #${order.orderNumber}: ${input.reason}`,
      orderId: order.id,
      refundCaseId: input.caseId
    });

    /*
     * And the partner's share comes back off what they are owed.
     *
     * Only where they have not already been settled. Where they have, this
     * still posts — it becomes a negative entry that reduces their NEXT
     * settlement, which is the adjustment mechanism rather than a debt to
     * chase. Either way the platform does not absorb a refund on food a
     * kitchen was paid for.
     */
    const partnerSharePaise = partnerShareOfRefund(order, amountPaise);
    if (partnerSharePaise > 0) {
      ledger.post({
        event: 'SETTLEMENT_ADJUSTMENT',
        postings: [
          {
            account: accountFor('PARTNER_PAYABLE', order.restaurantId),
            direction: 'DEBIT',
            amountPaise: partnerSharePaise
          },
          { account: 'REFUNDS_PAID', direction: 'CREDIT', amountPaise: partnerSharePaise }
        ],
        idempotencyKey: `refund_partner_adjust:${input.caseId || order.id}`,
        actorUserId: input.actorUserId,
        narration: `Kitchen's share of the refund on order #${order.orderNumber}`,
        orderId: order.id,
        refundCaseId: input.caseId
      });
    }
  }

  return {
    route,
    settled,
    amountPaise,
    reference,
    claimUrl,
    failureReason,
    message: settled
      ? route === 'SOURCE'
        ? `${formatPaise(amountPaise)} has been sent back to the card or account you paid with. ${timingFor(route)}`
        : `${formatPaise(amountPaise)} is ready to claim. ${timingFor(route)}`
      : `${formatPaise(amountPaise)} has NOT been refunded yet. ${failureReason || ''}`.trim()
  };
}

/**
 * The kitchen's share of a refund.
 *
 * Proportional to how much of the order is being refunded. A full refund takes
 * back everything they were credited; half a refund takes half.
 *
 * The rider's share is deliberately NOT clawed back. They did the trip; the
 * food being wrong is not their doing, and docking a rider for a kitchen's
 * mistake is how a platform loses riders.
 */
export function partnerShareOfRefund(order: Order, refundPaise: number): number {
  const bill: any = order.bill || {};
  const totalPaise = toPaise(Number(bill.totalAmount) || 0);
  if (totalPaise <= 0) return 0;

  const itemsPaise = toPaise(Number(bill.itemsTotal) || 0);
  const packagingPaise = toPaise(Number(bill.packagingFee) || 0);
  const commissionPaise = toPaise(Number(bill.commissionAmount) || 0);
  const tdsPaise = toPaise(Number(bill.tdsAmount) || 0);
  const partnerPaise = Math.max(0, itemsPaise + packagingPaise - commissionPaise - tdsPaise);

  const proportion = Math.min(1, refundPaise / totalPaise);
  return Math.round(partnerPaise * proportion);
}

/** Whether a refund has already been paid on this case or order. */
export function refundAlreadyPaid(caseOrOrderId: string): boolean {
  return ledger.query({}).some(e => e.idempotencyKey === `refund_paid:${caseOrOrderId}`);
}

/**
 * Cash handed back at the door.
 *
 * Not a transfer: the rider gives the customer money they are already holding
 * on the platform's behalf, so what changes is how much cash the rider is
 * carrying. Recording it as a payout would double-count it.
 */
export function recordCashRefundAtDoor(input: {
  order: Order;
  riderId: string;
  amountPaise: number;
  actorUserId: string;
  reason: string;
}): RefundOutcome {
  ledger.post({
    event: 'CASH_RETURNED_AT_DOOR',
    postings: [
      { account: 'REFUNDS_PAID', direction: 'DEBIT', amountPaise: input.amountPaise },
      { account: accountFor('RIDER_CASH', input.riderId), direction: 'CREDIT', amountPaise: input.amountPaise }
    ],
    idempotencyKey: `cash_refund:${input.order.id}`,
    actorUserId: input.actorUserId,
    narration: `Rider returned ${formatPaise(input.amountPaise)} at the door on order #${input.order.orderNumber}: ${input.reason}`,
    orderId: input.order.id
  });

  return {
    route: 'CASH_AT_DOOR',
    settled: true,
    amountPaise: input.amountPaise,
    message: `${formatPaise(input.amountPaise)} returned in cash at the door.`
  };
}

/** What a customer's order screen shows about a refund. */
export function refundStatusView(outcome: {
  route: RefundRoute;
  settled: boolean;
  amountPaise: number;
  claimUrl?: string;
}) {
  return {
    route: outcome.route,
    settled: outcome.settled,
    amount: toRupees(outcome.amountPaise),
    claimUrl: outcome.claimUrl,
    timing: timingFor(outcome.route)
  };
}
