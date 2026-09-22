import type { OrderStatus } from '@quick-bites/shared-types';
import { AppError } from '../../utils/AppError.ts';

/*
 * WHERE THE FOOD MAY GO NEXT. Nothing here is about the rider.
 *
 * `RIDER_ASSIGNED` was in this table, and it is what made the kitchen's
 * buttons stop working. Assigning a rider wrote that status, and its only
 * exits were OUT_FOR_DELIVERY and CANCELLED - so PREPARING and
 * READY_FOR_PICKUP became unreachable the instant a rider accepted, and the
 * kitchen could not mark food it was still cooking. A rider accepting a trip
 * now changes `riderStage` and touches this not at all.
 *
 * The kitchen's four taps are ACCEPTED, PREPARING, READY_FOR_PICKUP and
 * HANDED_TO_RIDER, in that order.
 *
 * HANDED_TO_RIDER -> OUT_FOR_DELIVERY is the two-sided handover: the kitchen
 * says the food left, the rider confirms they have it. Both sides recorded is
 * the only thing that settles "he never collected it".
 *
 * READY_FOR_PICKUP -> OUT_FOR_DELIVERY is kept on purpose, and it is the
 * escape hatch rather than an oversight. The kitchen has already got what it
 * wanted once the bag is off the counter, so the handover tap is pure overhead
 * to them and WILL be forgotten - and when it is, the cost lands on a rider
 * standing outside holding the food and a customer watching an order that
 * never moves. So the rider can still proceed, and the handover is recorded as
 * rider-asserted rather than mutual. The dispute record keeps the distinction,
 * which is the part that actually mattered; a hard block would only have
 * converted a forgotten tap into a stranded delivery.
 */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PAYMENT_PENDING: ['ORDER_PLACED', 'CANCELLED'],
  // Restaurant portal's "Accept Order & Start Cooking" combines accept + prep-start into one action.
  ORDER_PLACED: ['ACCEPTED', 'PREPARING', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  HANDED_TO_RIDER: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: []
};

export function canTransition(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  /*
   * An unknown status is reported, not silently treated as a dead end.
   *
   * `VALID_TRANSITIONS[unknown]` is undefined, and `|| []` turned that into
   * "nothing is allowed from here" - which is indistinguishable from a
   * legitimately terminal order. An order persisted by an older build would
   * refuse every action with "invalid transition" and stick forever, with no
   * log and nothing to search for. `normaliseLoadedStore()` exists to stop
   * that happening; this is what tells us when it has missed one.
   */
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) {
    console.log(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'UNKNOWN_ORDER_STATUS',
        status: currentStatus,
        attempted: nextStatus,
        note: 'Persisted by a build this one does not understand. Check normaliseLoadedStore().'
      })
    );
    return false;
  }
  return allowed.includes(nextStatus);
}

export function validateTransition(currentStatus: OrderStatus, nextStatus: OrderStatus): void {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new AppError(
      `Invalid order status transition from ${currentStatus} to ${nextStatus}.`,
      409,
      'INVALID_STATUS_TRANSITION'
    );
  }
}
