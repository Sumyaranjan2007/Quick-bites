/**
 * What must be true once an order has been delivered, whichever way it got
 * there.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO CLOSE
 * -------------------------------------------------------------------------
 * There are two ways an order reaches DELIVERED on this platform, and they were
 * exact mirror images of each other. Neither did both halves:
 *
 *   the rider taps the customer's code     credited cash    posted NO earnings
 *   a status update to DELIVERED           posted earnings  recorded NO cash
 *
 * The rider route is the ordinary, correct, everyday path -- it is what happens
 * at the door on every delivery. So the normal case posted NOTHING to the
 * ledger: no REVENUE_COMMISSION, no REVENUE_FEES, no PARTNER_PAYABLE. Every
 * screen built on those balances showed a fraction of the truth, with nothing
 * on it to suggest doubt, and the owner would have read their own takings as a
 * small number and believed it.
 *
 * The safety net did not run. `backfillEarnings()` has exactly one caller in
 * this codebase -- an admin route somebody has to press -- despite two comments
 * that said it swept at boot. Both comments were wrong, both were believed, and
 * one was repeated into a third file.
 *
 * The other direction is worse per person. An order closed by an administrator
 * left the rider holding cash nothing had recorded. Cash-in-hand is what blocks
 * a payout, so that rider was paid in full on payday while carrying money that
 * belongs to the platform.
 *
 * -------------------------------------------------------------------------
 * WHY A FUNCTION AND NOT A FIX IN EACH PLACE
 * -------------------------------------------------------------------------
 * Because there are two call sites today and the next person to add a third --
 * a support tool, a bulk close, a reconciliation script -- will not know there
 * are two consequences to a delivery. This is the list, in one place, and the
 * name says when to call it.
 *
 * It deliberately does NOT move the write that sets DELIVERED. The rider route
 * writes through `orderRepository.verifyDeliveryOtp`, and the guard that stops
 * an ORDER_PLACED order becoming DELIVERED on a correct code lives inside it.
 * Unifying by moving that write would take the guard out of the path, which
 * trades a money bug for a fraud one.
 */
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { recordOrderEarnings } from '../payments/earnings.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import type { Order } from '@quick-bites/shared-types';

export interface CompletionOutcome {
  /** Cash added to what the rider is holding, in rupees. Zero when none was. */
  cashRecorded: number;
  /** Whether the ledger posting was attempted and did not throw. */
  earningsPosted: boolean;
  /** Present when the earnings posting refused, with the reason it gave. */
  earningsHeldReason?: string;
}

/**
 * Records everything a delivery causes: the cash the rider is now carrying, and
 * the money the order earned.
 *
 * Safe to call more than once for the same order, which matters because the two
 * paths could both reach it for one delivery and because a retried request
 * must not pay anybody twice:
 *
 *   - the cash is guarded by `codCashRecordedAt` on the order, because
 *     crediting cash-in-hand is a DELTA and deltas do not deduplicate
 *     themselves
 *   - the earnings are guarded inside `recordOrderEarnings`, which is keyed on
 *     the order id
 *
 * It never throws. A ledger problem must not un-deliver a delivered order --
 * the food is with the customer either way, and an exception here would roll
 * back a fact that has already happened in the world.
 */
export async function completeDelivery(order: Order): Promise<CompletionOutcome> {
  const outcome: CompletionOutcome = { cashRecorded: 0, earningsPosted: false };
  if (!order?.id) return outcome;

  /* ---------------------------------------------------------------- *
   *  1. THE CASH THE RIDER IS NOW CARRYING                             *
   * ---------------------------------------------------------------- */
  const isCash = order.paymentMethod === 'CASH_ON_DELIVERY';
  const amount = Number(order.bill?.totalAmount) || 0;

  if (isCash && order.riderId && amount > 0 && !order.codCashRecordedAt) {
    try {
      await riderRepository.adjustCashInHand(order.riderId, amount);

      /*
       * Written to the stored order, not to the copy in hand.
       *
       * A caller holding a detached object would otherwise set the marker on
       * something nobody reads back, and the next call would credit the cash a
       * second time -- which is the exact failure this marker exists to
       * prevent, arriving through the mechanism meant to prevent it.
       */
      const stored = (memoryStore.orders.get(order.id) as Order) || order;
      stored.codCashRecordedAt = new Date().toISOString();
      order.codCashRecordedAt = stored.codCashRecordedAt;
      memoryStore.orders.set(order.id, stored);
      triggerAutoSave();

      outcome.cashRecorded = amount;
    } catch (error) {
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'COD_CASH_RECORD_FAILED',
          orderId: order.id,
          riderId: order.riderId,
          reason: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  /* ---------------------------------------------------------------- *
   *  2. THE MONEY THE ORDER EARNED                                     *
   * ---------------------------------------------------------------- */
  try {
    recordOrderEarnings(order);
    outcome.earningsPosted = true;
  } catch (error) {
    /*
     * A refusal here is usually correct rather than broken. `recordOrderEarnings`
     * declines to post an order with no proof the food was collected or the
     * money arrived, and those land in the held queue for a person to look at.
     * Logged with the reason so the queue is explicable, never rethrown.
     */
    outcome.earningsHeldReason = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'ORDER_EARNINGS_POST_FAILED',
        orderId: order.id,
        reason: outcome.earningsHeldReason
      })
    );
  }

  return outcome;
}
