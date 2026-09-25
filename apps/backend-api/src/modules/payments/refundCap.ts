/**
 * How much of an order can still be refunded.
 *
 * Every refund path checked its OWN case against the order total and nothing
 * else. So a case refunded in full closed, a second case could be raised on the
 * same order (only an OPEN case blocked a new one), and paying that second case
 * passed the same check — the customer refunded twice. An order cancelled and
 * refunded automatically could be claimed again the same way.
 *
 * The answer is one number every path reads: the order total less what has
 * already gone back. It is summed from the refund cases, which is where every
 * path on the platform records a refund it paid (the cancellation refund, the
 * admin case decision, and the admin order refund all create one).
 */
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import type { Order } from '@quick-bites/shared-types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rupees already refunded on this order, not counting `exceptCaseId`. */
export async function refundedSoFar(orderId: string, exceptCaseId?: string): Promise<number> {
  const cases = await refundRepository.listByOrder(orderId);
  let total = 0;
  for (const c of cases as any[]) {
    if (c.id === exceptCaseId) continue;
    if (c.status !== 'REFUNDED') continue;
    total += Number(c.approvedAmount ?? c.requestedAmount) || 0;
  }
  return round2(total);
}

/** What may still be refunded on this order, never below zero. */
export async function refundableRemaining(order: Order, exceptCaseId?: string): Promise<number> {
  const total = Number(order.bill?.totalAmount) || 0;
  return Math.max(0, round2(total - (await refundedSoFar(order.id, exceptCaseId))));
}
