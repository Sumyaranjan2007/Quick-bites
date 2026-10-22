/**
 * What Razorpay tells us AFTER the fact (launch readiness S6, S7, 22 Oct 2026).
 *
 * A refund is booked when Razorpay accepts it, but Razorpay can still fail it
 * days later (a closed card, a bank refusing it): the customer was told
 * "refunded" and never got the money. And a cardholder's bank can open a
 * chargeback with a deadline to answer. Both arrive only as webhooks.
 *
 * Like the payments health job, this RAISES rather than repairs: a failed refund
 * is marked on its case and Operations is told to settle it by hand (the ledger
 * entry stays as booked, so nothing silently re-sends money); a dispute is marked
 * on its order and Operations is told the deadline.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { notifyAdminsRefundStuck, notifyAdminsChargeback } from '../../notifications/adminNotifier.ts';
import { formatPaise } from './money.ts';

/** `refund.processed` / `refund.failed`: the outcome lands on the case that sent it. Returns the case ids. */
export function recordGatewayRefundOutcome(refund: any, failed: boolean): string[] {
  const refundId = String(refund?.id || '');
  if (!refundId) return [];
  const cases = (Array.from(memoryStore.refundRequests.values()) as any[]).filter(r => r.refundTransactionId === refundId);
  const now = new Date().toISOString();
  for (const found of cases) {
    found.gatewayRefundStatus = failed ? 'FAILED' : 'PROCESSED';
    found.gatewayRefundAt = now;
    memoryStore.refundRequests.set(found.id, found);
    if (failed) {
      void notifyAdminsRefundStuck({
        caseId: found.id,
        orderNumber: String(found.orderNumber || ''),
        amountLabel: formatPaise(Number(refund?.amount) || 0),
        reason: 'Razorpay could not complete this refund after accepting it, so the customer has not received it.'
      });
    }
  }
  if (cases.length) triggerAutoSave();
  console.log(JSON.stringify({
    level: failed ? 'ERROR' : 'INFO',
    timestamp: now,
    event: failed ? 'GATEWAY_REFUND_FAILED' : 'GATEWAY_REFUND_PROCESSED',
    refundId,
    cases: cases.map(c => c.id)
  }));
  return cases.map(c => c.id);
}

/** `payment.dispute.created|won|lost|closed|under_review|action_required`: marked on the order, Operations told. */
export function recordDispute(eventType: string, dispute: any): string | null {
  const paymentId = String(dispute?.payment_id || '');
  const order = paymentId ? (Array.from(memoryStore.orders.values()) as any[]).find(o => o.razorpayPaymentId === paymentId) : undefined;
  const status = eventType.replace('payment.dispute.', '').toUpperCase();
  const respondBy = Number(dispute?.respond_by) ? new Date(Number(dispute.respond_by) * 1000).toISOString() : undefined;
  if (order) {
    order.dispute = {
      id: String(dispute?.id || ''),
      status,
      amountPaise: Number(dispute?.amount) || 0,
      reason: dispute?.reason_code,
      respondBy,
      updatedAt: new Date().toISOString()
    };
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();
  }
  void notifyAdminsChargeback({
    disputeId: String(dispute?.id || paymentId || 'unknown'),
    orderNumber: order?.orderNumber,
    status,
    amountLabel: formatPaise(Number(dispute?.amount) || 0),
    respondBy
  });
  console.log(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), event: 'PAYMENT_DISPUTE', status, paymentId, orderId: order?.id || null }));
  return order?.id || null;
}
