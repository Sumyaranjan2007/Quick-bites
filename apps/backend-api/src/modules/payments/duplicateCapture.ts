/**
 * A customer charged twice for one order.
 *
 * -------------------------------------------------------------------------
 * HOW IT HAPPENS
 * -------------------------------------------------------------------------
 * Razorpay allows more than one payment against a single checkout. A customer
 * whose payment seemed to hang presses Pay again; both went through, and both
 * are captured. The first marks the order paid. The second used to arrive, find
 * the order already PAID, and be dropped: the webhook route skipped it, and
 * `markPaidByGateway` returned early for good measure. The money stayed at the
 * gateway, recorded nowhere, and the customer was out of pocket by the price of
 * a meal with nobody on the platform able to see it.
 *
 * -------------------------------------------------------------------------
 * WHAT HAPPENS NOW
 * -------------------------------------------------------------------------
 * The second payment is booked (the gateway IS holding it, and the settlement
 * will include it), then reversed against its OWN payment id at once, through
 * the same `sendRefund` every other refund uses. A refund case records it, and
 * operations are told. The order and its first payment are not touched.
 *
 * Everything is keyed on the second payment's id. Its capture is booked once,
 * and its refund is sent once, however many times the gateway reports it.
 */
import { ledger } from './ledger.ts';
import { duplicateCaptureKeyFor } from './capture.ts';
import { sendRefund } from './refunds.ts';
import { toPaise, toRupees, formatPaise } from './money.ts';
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import type { Order } from '@quick-bites/shared-types';

const SYSTEM = { userId: 'system', name: 'Quick Bites' };

/**
 * Books and returns a second captured payment on an order that was already paid.
 *
 * Returns what it did, for the caller's log: `already-handled` for a payment it
 * has seen before, so a redelivered webhook does nothing.
 */
export async function refundDuplicateCapture(
  order: Order,
  paymentId: string,
  gatewayAmountPaise?: number
): Promise<'refunded' | 'refund-pending' | 'already-handled' | 'not-booked'> {
  const captureKey = duplicateCaptureKeyFor(paymentId);
  if (ledger.hasTransaction(captureKey)) return 'already-handled';

  const fromGateway = Math.round(Number(gatewayAmountPaise) || 0);
  const amountPaise = fromGateway > 0 ? fromGateway : toPaise(Number(order.bill?.totalAmount) || 0);

  /*
   * Checked and booked with no await in between, so two deliveries of the same
   * payment cannot both get past the check above.
   */
  try {
    if (amountPaise <= 0) throw new Error('no amount');
    ledger.post({
      event: 'PAYMENT_CAPTURED',
      postings: [
        { account: 'GATEWAY_RECEIVABLE', direction: 'DEBIT', amountPaise },
        { account: 'CUSTOMER_PREPAID', direction: 'CREDIT', amountPaise }
      ],
      idempotencyKey: captureKey,
      actorUserId: 'system',
      orderId: order.id,
      narration:
        `${formatPaise(amountPaise)} taken at the gateway a SECOND time for order ` +
        `#${order.orderNumber} (${paymentId}); being returned`
    });
  } catch (err) {
    // Not booked means not refunded either: sending money back that the books
    // never took in is the hole `capture.ts` exists to close. A person has to
    // look at this one, so they are told exactly what to look for.
    emitOpsAlert({
      kind: 'DUPLICATE_PAYMENT',
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      detail:
        `Order #${order.orderNumber} was paid a second time (${paymentId}) and it could not be ` +
        `recorded (${err instanceof Error ? err.message : String(err)}). Refund it from the Razorpay dashboard.`,
      raisedAt: new Date().toISOString()
    });
    return 'not-booked';
  }

  const request = await refundRepository.create({
    orderId: order.id,
    orderNumber: order.orderNumber,
    raisedByUserId: SYSTEM.userId,
    raisedByRole: 'admin',
    raisedByName: SYSTEM.name,
    customerId: order.customerId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    riderId: order.riderId,
    riderName: order.riderName,
    reasonCode: 'PAYMENT_ISSUE',
    description:
      `The customer was charged twice. Payment ${paymentId} was a second payment for this order ` +
      `and is being returned in full. The order's own payment` +
      `${order.razorpayPaymentId ? ` (${order.razorpayPaymentId})` : ''} is not affected.`,
    attachments: [],
    requestedAmount: toRupees(amountPaise),
    orderTotal: Number(order.bill?.totalAmount) || toRupees(amountPaise),
    duplicatePaymentId: paymentId
  });

  const outcome = await sendRefund({
    order,
    amountPaise,
    reason: `Charged twice; second payment ${paymentId} returned`,
    actorUserId: SYSTEM.userId,
    caseId: request.id,
    customerPhone: order.customerPhone,
    duplicatePaymentId: paymentId
  });

  if (outcome.settled) {
    await refundRepository.transition(request.id, 'REFUNDED', SYSTEM, {
      note: 'The second payment was returned automatically.',
      approvedAmount: toRupees(amountPaise),
      refundTransactionId: outcome.reference
    });
  } else {
    // Left open, never shown as refunded; `sendRefund` has already told an
    // administrator the money is stuck.
    await refundRepository.transition(request.id, 'PROCESSING', SYSTEM, {
      note: `The second payment could not be returned automatically: ${outcome.failureReason || 'no reason given'}`,
      approvedAmount: toRupees(amountPaise)
    });
  }

  emitOpsAlert({
    kind: 'DUPLICATE_PAYMENT',
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId,
    detail:
      `Order #${order.orderNumber} was paid twice. The second payment (${paymentId}, ` +
      `${formatPaise(amountPaise)}) ${outcome.settled ? 'has been refunded' : 'could NOT be refunded yet'}.`,
    raisedAt: new Date().toISOString()
  });

  return outcome.settled ? 'refunded' : 'refund-pending';
}

/*
 * -------------------------------------------------------------------------
 * A DOOR-QR PAYMENT REPORTED ON AN ORDER ALREADY MARKED PAID
 * -------------------------------------------------------------------------
 * Two routes see a door payment: the rider's poll and the qr_code.credited
 * webhook. Whichever comes first marks the order paid; the other then finds it
 * PAID and must decide what the payment it is holding IS.
 *
 * The trap: the poll can mark an order PAID WITHOUT a payment id. It reads the
 * id from a second Razorpay call whose failure is swallowed, and at a doorstep
 * the poll normally arrives before the webhook. Comparing the webhook's id with
 * "no id" called the customer's ONLY payment a duplicate and refunded it.
 *
 * So a door payment is a duplicate only when the order was already paid by
 * something else: a DIFFERENT recorded payment id, or cash the rider recorded.
 * A door-paid order with no id yet ADOPTS the id. Anything else is left alone
 * and put in front of a person, because refunding a payment we cannot place is
 * worse than asking.
 */
export type DoorPaymentVerdict = 'same' | 'adopt' | 'duplicate' | 'unclear';

export function classifyDoorPayment(
  order: Pick<Order, 'razorpayPaymentId' | 'paymentMethod' | 'codCashRecordedAt'>,
  paymentId: string
): DoorPaymentVerdict {
  if (order.razorpayPaymentId) return order.razorpayPaymentId === paymentId ? 'same' : 'duplicate';
  if (order.paymentMethod === 'CASH_ON_DELIVERY' && order.codCashRecordedAt) return 'duplicate';
  if ((order.paymentMethod as string) === 'UPI_AT_DOOR') return 'adopt';
  return 'unclear';
}

/** Settles a door-QR payment reported on an order that is already PAID. */
export async function settleLateDoorPayment(
  order: Order,
  paymentId: string | undefined,
  amountPaise: number
): Promise<DoorPaymentVerdict | 'no-id'> {
  if (!paymentId) return 'no-id';
  const verdict = classifyDoorPayment(order, paymentId);

  if (verdict === 'adopt') {
    // The order's own payment, finally identified. Recorded so a later refund
    // on this order reverses it at the gateway rather than by link.
    order.razorpayPaymentId = paymentId;
    await orderRepository.save(order);
  } else if (verdict === 'duplicate') {
    await refundDuplicateCapture(order, paymentId, amountPaise);
  } else if (verdict === 'unclear') {
    emitOpsAlert({
      kind: 'DOOR_PAYMENT_UNMATCHED',
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      detail:
        `A door QR payment (${paymentId}) arrived for order #${order.orderNumber}, which is already ` +
        `marked paid with no payment recorded. It has NOT been refunded; check it in the Razorpay dashboard.`,
      raisedAt: new Date().toISOString()
    });
  }
  return verdict;
}
