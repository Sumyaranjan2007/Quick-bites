/**
 * How many times an order's handover codes may be guessed wrong.
 *
 * The pickup code and the doorstep code are four digits. They are proof that
 * food changed hands only because nobody can produce them without being there:
 * the kitchen's screen shows one, the customer reads out the other. With no
 * count, a rider can try all 10,000 in an afternoon, mark a prepaid order
 * delivered without ever meeting the customer, and be paid for the trip.
 *
 * So wrong guesses are counted on the order, and after `MAX_FAILURES` the codes
 * stop being accepted for `LOCK_MINUTES`. Operations are alerted on the lock,
 * because an honest rider who hits it is standing at a door and needs a person,
 * and a dishonest one is exactly who operations should know about.
 *
 * The count lives on the order rather than in process memory so it survives a
 * restart, which is when a brute force would otherwise get a fresh start.
 */
import type { Order } from '@quick-bites/shared-types';
import { emitOpsAlert } from '../../sockets/socketServer.ts';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

export type CodeKind = 'pickup' | 'delivery';

/** Minutes left on a lock, or 0 when the codes are accepted. */
export function lockedMinutesLeft(order: Order, now = Date.now()): number {
  const until = order.codeAttempts?.lockedUntil;
  if (!until) return 0;
  const left = new Date(until).getTime() - now;
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

/**
 * Records one wrong guess. Returns true when this guess caused the lock, so the
 * caller can say so rather than "wrong code" for the sixth time.
 */
export function recordWrongCode(order: Order, kind: CodeKind, now = Date.now()): boolean {
  const attempts = { ...(order.codeAttempts || {}) };
  const field = kind === 'pickup' ? 'pickupFailures' : 'deliveryFailures';
  attempts[field] = (attempts[field] || 0) + 1;

  let lockedNow = false;
  if (attempts[field]! >= MAX_FAILURES) {
    attempts.lockedUntil = new Date(now + LOCK_MINUTES * 60000).toISOString();
    // A fresh window after the lock, not a permanent one: the rider at the
    // door gets five more tries once operations have had a chance to look.
    attempts[field] = 0;
    lockedNow = true;

    emitOpsAlert({
      kind: 'HANDOVER_CODE_LOCKED',
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurantName,
      detail:
        `${MAX_FAILURES} wrong ${kind} codes on this order` +
        `${order.riderId ? `, rider ${order.riderId}` : ''}. Codes locked for ${LOCK_MINUTES} minutes.`,
      raisedAt: new Date(now).toISOString()
    });
  }

  order.codeAttempts = attempts;
  return lockedNow;
}

/** A correct code clears the count for that kind. */
export function clearWrongCodes(order: Order, kind: CodeKind): void {
  if (!order.codeAttempts) return;
  const field = kind === 'pickup' ? 'pickupFailures' : 'deliveryFailures';
  order.codeAttempts = { ...order.codeAttempts, [field]: 0 };
}

export function lockedMessage(minutes: number): string {
  return (
    `Too many wrong codes on this order. Codes are paused for ${minutes} more ` +
    `minute${minutes === 1 ? '' : 's'}. Call support if you are with the customer or at the restaurant.`
  );
}
