/**
 * What a customer pays for cancelling late, and who it goes to.
 *
 * A customer could cancel at every stage up to out-for-delivery and get 100%
 * back. The order never reached DELIVERED, so the kitchen was paid nothing for
 * food it had cooked, and on a cash order the customer could refuse at the door
 * as often as they liked at no cost.
 *
 * Two owner-set percentages (both 0 = free, today's behaviour) decide the fee:
 * one once the kitchen has accepted, one once the food is ready or moving. The
 * kitchen is compensated from the fee first, up to what it would have earned on
 * the order; anything left is platform revenue. Cash orders cannot be charged
 * (nothing was collected), so they count towards `codCancelLimit` instead.
 */
import type { Order } from '@quick-bites/shared-types';
import { getActiveRates } from '../payments/pricingConfig.ts';
import { ledger, accountFor } from '../payments/ledger.ts';
import { captureBooked } from '../payments/capture.ts';
import { toPaise, formatPaise } from '../payments/money.ts';
import { memoryStore } from '../../db/client.ts';

const AFTER_ACCEPT = ['ACCEPTED', 'PREPARING'];
const AFTER_READY = ['READY_FOR_PICKUP', 'HANDED_TO_RIDER', 'OUT_FOR_DELIVERY'];

export interface CancellationQuote {
  /** Share of the bill kept, 0-100. */
  percent: number;
  /** Rupees kept. */
  fee: number;
  /** Rupees that go back to the customer. */
  refund: number;
  /** Plain sentence for the customer, shown before they confirm. */
  message: string;
}

/** The fee a CUSTOMER would pay to cancel this order now. Other roles pay nothing. */
export function quoteCancellation(order: Order): CancellationQuote {
  const rates = getActiveRates();
  const total = Number(order.bill?.totalAmount) || 0;
  const paid = order.paymentStatus === 'PAID';

  let percent = 0;
  if (AFTER_ACCEPT.includes(order.status)) percent = Number(rates.cancelFeePercentAfterAccept) || 0;
  if (AFTER_READY.includes(order.status)) percent = Number(rates.cancelFeePercentAfterReady) || 0;
  percent = Math.min(100, Math.max(0, percent));

  // Only money actually held can be kept: a prepaid order whose capture is on
  // the books. A cash order has collected nothing to keep.
  const chargeable = paid && captureBooked(order.id);
  const fee = chargeable ? Math.round(total * percent) / 100 : 0;
  const refund = paid ? Math.round((total - fee) * 100) / 100 : 0;

  let message = 'You can cancel this order free of charge.';
  if (fee > 0) {
    message =
      `The restaurant has already started on this order, so Rs ${fee} (${percent}%) is kept ` +
      `to pay for the food. Rs ${refund} will be refunded.`;
  } else if (!paid && percent > 0 && order.paymentMethod === 'CASH_ON_DELIVERY') {
    message =
      'The restaurant has already started on this order. Cancelling cash orders after they are ' +
      'accepted can switch off cash on delivery for your account.';
  }
  return { percent, fee, refund, message };
}

/**
 * Books a kept fee: out of the customer's prepaid money, to the kitchen up to
 * what it would have earned, and the rest to platform revenue. Idempotent per
 * order.
 */
export function bookCancellationFee(order: Order, feeRupees: number): { kitchenShare: number } {
  const feePaise = toPaise(feeRupees);
  if (feePaise <= 0) return { kitchenShare: 0 };

  const kitchenEarnsPaise = toPaise(Number(order.bill?.restaurantNetPayout) || 0);
  const kitchenPaise = Math.max(0, Math.min(feePaise, kitchenEarnsPaise));
  const platformPaise = feePaise - kitchenPaise;

  const postings: Array<{ account: string; direction: 'DEBIT' | 'CREDIT'; amountPaise: number }> = [
    { account: 'CUSTOMER_PREPAID', direction: 'DEBIT', amountPaise: feePaise }
  ];
  if (kitchenPaise > 0) {
    postings.push({ account: accountFor('PARTNER_PAYABLE', order.restaurantId), direction: 'CREDIT', amountPaise: kitchenPaise });
  }
  if (platformPaise > 0) {
    postings.push({ account: 'REVENUE_FEES', direction: 'CREDIT', amountPaise: platformPaise });
  }

  ledger.post({
    event: 'CANCELLATION_FEE_KEPT',
    postings,
    idempotencyKey: `cancellation_fee:${order.id}`,
    actorUserId: 'system',
    orderId: order.id,
    narration:
      `Cancellation fee of ${formatPaise(feePaise)} kept on order #${order.orderNumber}; ` +
      `${formatPaise(kitchenPaise)} to the kitchen for food it had started`
  });
  return { kitchenShare: kitchenPaise / 100 };
}

/** Cash orders this customer cancelled after the kitchen accepted them. */
export function lateCashCancels(customerId: string): number {
  let count = 0;
  for (const o of memoryStore.orders.values() as Iterable<Order>) {
    if (o.customerId !== customerId) continue;
    if (o.paymentMethod !== 'CASH_ON_DELIVERY') continue;
    if (o.status !== 'CANCELLED') continue;
    // A refusal at the door is the customer's cancel even though staff record it.
    if (o.cancellationReasonCode === 'COD_REFUSED_AT_DOOR') { count++; continue; }
    if (o.cancelledByRole !== 'customer') continue;
    if (!o.cancelledFromStatus || !(AFTER_ACCEPT.includes(o.cancelledFromStatus) || AFTER_READY.includes(o.cancelledFromStatus))) continue;
    count++;
  }
  return count;
}

/** True when this customer has used up their late cash cancels. */
export function cashSwitchedOffFor(customerId: string): boolean {
  const limit = Number(getActiveRates().codCancelLimit) || 0;
  return limit > 0 && lateCashCancels(customerId) >= limit;
}
