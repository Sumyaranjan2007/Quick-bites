/**
 * The moment the gateway takes the customer's money.
 *
 * -------------------------------------------------------------------------
 * WHY THIS HAS TO EXIST
 * -------------------------------------------------------------------------
 * Online money used to enter the books only at DELIVERY, inside
 * `recordOrderEarnings`. For an order that arrives, that is invisible: the money
 * comes in and is split up in one transaction, and nobody notices that the
 * platform never recorded receiving it.
 *
 * For an order that does NOT arrive, it is a hole. A customer pays Rs 300, the
 * restaurant rejects it, the refund goes back — and the refund was the FIRST
 * ledger entry about that money. Money left the books that had never entered
 * them.
 *
 * Before `GATEWAY_RECEIVABLE` came into use that showed up as a pure loss, which
 * is wrong but survivable. Afterwards it is worse, and it stops the platform
 * working. Take a single day:
 *
 *   Order A: Rs 500, delivered.
 *   Order B: Rs 300, paid, then cancelled and refunded.
 *
 * Razorpay holds Rs 800, sends the Rs 300 back to the customer out of that
 * balance, keeps about Rs 16 in fees and tax, and settles about Rs 484. Rs 500
 * of receivable has been discharged. But the ledger's receivable was 500 from A
 * minus 300 for the refund = Rs 200, so recording that settlement is refused for
 * being larger than the outstanding balance — and there is no figure the
 * administrator can type that is both true and accepted. One cancelled prepaid
 * order and the day can never be closed.
 *
 * So the payment is booked when the payment happens. Which is also just the
 * truthful order of events, and the reason the hole was never obvious is that
 * the books were telling the story backwards.
 *
 * -------------------------------------------------------------------------
 * WHERE IT GOES, AND WHY NOT TO REVENUE
 * -------------------------------------------------------------------------
 * DEBIT  GATEWAY_RECEIVABLE  - the gateway is now holding this money for us.
 * CREDIT CUSTOMER_PREPAID    - and we owe the customer food for it.
 *
 * `CUSTOMER_PREPAID` is a LIABILITY, not revenue. Nothing has been earned: the
 * customer can cancel and the money goes straight back. Booking a capture as
 * income would report a day of unfulfilled orders as a day of trading, and the
 * kitchen's share would appear as payable on food nobody cooked.
 *
 * At delivery, `recordOrderEarnings` discharges the liability instead of
 * debiting the receivable again — that is the ONE place the two halves meet, and
 * why `captureBooked` is exported.
 */
import { ledger } from './ledger.ts';
import { toPaise, formatPaise } from './money.ts';
import type { Order } from '@quick-bites/shared-types';

/**
 * What makes a capture unique.
 *
 * Keyed on the ORDER, not on the gateway's payment id, for two reasons. A door
 * payment can be confirmed without one — `checkDoorQr` returns `paymentId`
 * optionally — and an unkeyed transaction is a transaction that can be written
 * twice. And one order has exactly one payment on this platform, so the order id
 * dedupes everything the payment id would and the cases it cannot.
 *
 * The payment id is still recorded, in the narration, because it is what the
 * gateway's own statement is searched by.
 */
export function captureKeyFor(orderId: string): string {
  return `capture:order:${orderId}`;
}

/** Whether this order's payment has been booked as received. */
export function captureBooked(orderId: string): boolean {
  return ledger.hasTransaction(captureKeyFor(orderId));
}

/** What customers have paid for food that has not been delivered yet, in paise. */
export function customerPrepaidPaise(): number {
  return ledger.balanceOf('CUSTOMER_PREPAID');
}

/**
 * Records that the gateway took the customer's money.
 *
 * Called from every path that marks a gateway-paid order PAID. Safe to call
 * twice — and it will be, because a customer's device returning from checkout
 * and Razorpay's webhook routinely both report the same payment.
 *
 * NEVER THROWS. Every caller is in the middle of acknowledging a payment that
 * has already left the customer's account; a bookkeeping failure must not take
 * the kitchen's copy of the order down with it. A failure is logged as an ERROR
 * under its own event name so it is findable, and the consequence of the
 * fallback is only that delivery books the money the older way.
 */
export function bookCapture(
  order: Pick<Order, 'id' | 'orderNumber' | 'paymentMethod' | 'razorpayPaymentId' | 'bill'>,
  gatewayAmountPaise?: number
): void {
  try {
    if (!order?.id) return;

    if (order.paymentMethod === 'CASH_ON_DELIVERY') {
      // Cash has no gateway and no prepayment. Handing the food over IS the
      // payment, and `recordOrderEarnings` books it into the rider's pocket.
      return;
    }

    const orderTotalPaise = toPaise(Number(order.bill?.totalAmount) || 0);
    const fromGateway = Math.round(Number(gatewayAmountPaise) || 0);

    /*
     * The gateway's figure wins where there is one, because the receivable has
     * to match what Razorpay is actually holding or the settlement arithmetic is
     * checked against a number we invented.
     */
    const amountPaise = fromGateway > 0 ? fromGateway : orderTotalPaise;

    if (amountPaise <= 0) {
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'CAPTURE_NOT_BOOKED',
          reason: 'no amount',
          orderId: order.id,
          orderNumber: order.orderNumber
        })
      );
      return;
    }

    /*
     * A customer who paid an amount that is not the order total is a real
     * condition and a quiet one. It leaves a residue in CUSTOMER_PREPAID after
     * delivery, because delivery discharges the ORDER's total. That residue is a
     * true statement about a mismatch, so it is left standing and named here
     * rather than smoothed away.
     */
    if (fromGateway > 0 && orderTotalPaise > 0 && fromGateway !== orderTotalPaise) {
      console.log(
        JSON.stringify({
          level: 'WARN',
          timestamp: new Date().toISOString(),
          event: 'CAPTURE_AMOUNT_MISMATCH',
          orderId: order.id,
          orderNumber: order.orderNumber,
          gatewayPaise: fromGateway,
          orderTotalPaise
        })
      );
    }

    ledger.post({
      event: 'PAYMENT_CAPTURED',
      postings: [
        { account: 'GATEWAY_RECEIVABLE', direction: 'DEBIT', amountPaise },
        { account: 'CUSTOMER_PREPAID', direction: 'CREDIT', amountPaise }
      ],
      idempotencyKey: captureKeyFor(order.id),
      actorUserId: 'system',
      orderId: order.id,
      narration:
        `${formatPaise(amountPaise)} taken at the gateway for order #${order.orderNumber}` +
        (order.razorpayPaymentId ? ` (${order.razorpayPaymentId})` : '')
    });
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'CAPTURE_NOT_BOOKED',
        orderId: order?.id,
        reason: err instanceof Error ? err.message : String(err)
      })
    );
  }
}
