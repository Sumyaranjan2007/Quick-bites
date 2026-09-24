/**
 * Finds money that was taken and never recorded.
 *
 * A webhook is a message across the internet from a third party, and messages
 * across the internet are lost. Every one that goes missing here has the same
 * shape: the customer's card was charged, Razorpay captured the payment, the
 * notification never arrived, and our order is still sitting in
 * PAYMENT_PENDING. The customer has paid and has no order. They will not
 * discover this by refreshing; they will discover it on their bank statement.
 *
 * The gateway is the authority on what it captured, so the fix is to go and
 * ask it. For every order stuck unpaid past the window, this reads back what
 * Razorpay holds against that order:
 *
 *   - Something captured: the order is put through exactly as the webhook
 *     would have put it through, so there is one code path for a paid order
 *     rather than two that can drift.
 *   - Nothing captured, and old enough: the order is cancelled, so the kitchen
 *     list and the customer's history stop showing something that will never
 *     happen.
 *   - Nothing captured, still recent: left alone. Somebody may be typing their
 *     OTP into their bank's page right now.
 *
 * Deliberately asks the gateway before giving up on anything. Cancelling an
 * order on age alone would eventually cancel a paid one.
 */
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';
import { orderService } from '../orders/orderService.ts';
import { razorpayAdapter } from './razorpayAdapter.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import { notifyAdminsPaymentRecovered } from '../../notifications/adminNotifier.ts';
import { isEnabled } from '../platform/featureFlags.ts';
import { config } from '../../config/env.ts';

const SYSTEM_ACTOR = {
  userId: 'system:payment-reconciliation',
  name: 'Quick Bites (automatic)',
  role: 'admin' as const
};

export interface ReconcileResult {
  scanned: number;
  /** Orders that turned out to be paid after all. */
  recovered: string[];
  /** Orders cancelled because nothing was ever captured for them. */
  abandoned: string[];
  /** Orders left for the next pass. */
  pending: number;
}

function minutesSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return (now.getTime() - then) / 60000;
}

export async function reconcilePayments(now: Date = new Date()): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, recovered: [], abandoned: [], pending: 0 };

  const stuck = await orderRepository.listUnsettled();
  result.scanned = stuck.length;

  for (const order of stuck) {
    const age = minutesSince(order.createdAt, now);
    if (age < config.PAYMENT_RECONCILE_AFTER_MINUTES) {
      result.pending++;
      continue;
    }

    // Cash orders never reach PAYMENT_PENDING, and an order with no gateway id
    // was never handed to the gateway — there is nothing to ask about.
    if (!order.razorpayOrderId) {
      if (age >= config.PAYMENT_ABANDON_AFTER_MINUTES) {
        await abandon(order.id, order.orderNumber, 'no payment was ever started', result, now);
      } else {
        result.pending++;
      }
      continue;
    }

    const payments = await razorpayAdapter.listPaymentsForOrder(order.razorpayOrderId);
    const captured = payments.find(p => p.status === 'captured');

    if (captured) {
      await orderService.markPaidByGateway(order.id, {
        razorpayPaymentId: captured.id,
        amountPaise: captured.amount
      });
      result.recovered.push(order.id);

      await auditRepository.record({
        actorUserId: SYSTEM_ACTOR.userId,
        actorName: SYSTEM_ACTOR.name,
        actorRole: SYSTEM_ACTOR.role,
        action: 'PAYMENT_RECONCILED',
        entityType: 'order',
        entityId: order.id,
        summary:
          `Payment ${captured.id} was captured at the gateway but never reached us. ` +
          'Recovered by reconciliation and the order released to the kitchen.'
      });

      // Raised to operations as well as logged: a recovery means a webhook was
      // lost, and one lost webhook is a curiosity while twenty is an incident.
      emitOpsAlert({
        kind: 'PAYMENT_RECOVERED',
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        detail: `Captured payment found at the gateway ${Math.round(age)} minutes after checkout.`,
        raisedAt: now.toISOString()
      });

      void notifyAdminsPaymentRecovered({
        orderId: order.id,
        orderNumber: order.orderNumber,
        minutesLate: Math.round(age)
      });
      continue;
    }

    if (age >= config.PAYMENT_ABANDON_AFTER_MINUTES) {
      await abandon(order.id, order.orderNumber, 'the gateway captured nothing for it', result, now);
    } else {
      result.pending++;
    }
  }

  return result;
}

async function abandon(
  orderId: string,
  orderNumber: string,
  why: string,
  result: ReconcileResult,
  now: Date
): Promise<void> {
  try {
    await orderService.cancelOrder(orderId, SYSTEM_ACTOR, 'PAYMENT_FAILED');
    result.abandoned.push(orderId);
    await auditRepository.record({
      actorUserId: SYSTEM_ACTOR.userId,
      actorName: SYSTEM_ACTOR.name,
      actorRole: SYSTEM_ACTOR.role,
      action: 'ORDER_ABANDONED_UNPAID',
      entityType: 'order',
      entityId: orderId,
      summary: `Cancelled ${Math.round(config.PAYMENT_ABANDON_AFTER_MINUTES)} minutes after checkout: ${why}.`
    });
  } catch (error) {
    console.log(JSON.stringify({
      level: 'ERROR',
      timestamp: now.toISOString(),
      event: 'ORDER_ABANDON_FAILED',
      orderId,
      orderNumber,
      reason: error instanceof Error ? error.message : String(error)
    }));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Runs on a multiple of the sweep interval rather than its own schedule.
 *
 * Reconciliation talks to the gateway, so it is the expensive job of the two
 * and there is nothing to gain from running it every thirty seconds. Six times
 * the sweep interval — three minutes by default — is well inside the window in
 * which a customer is still waiting to hear.
 */
export function startPaymentReconciliation(): void {
  if (timer) return;
  const everyMs = config.ORDER_SWEEP_INTERVAL_SECONDS * 1000 * 6;

  timer = setInterval(async () => {
    if (running) return;
    // The operator can stop the background jobs without stopping the server.
    if (!isEnabled('scheduled_reports')) return;
    running = true;
    try {
      await reconcilePayments();
    } catch (error) {
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'PAYMENT_RECONCILE_FAILED',
        reason: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      running = false;
    }
  }, everyMs);

  timer.unref?.();

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    event: 'PAYMENT_RECONCILIATION_STARTED',
    everySeconds: Math.round(everyMs / 1000),
    reconcileAfterMinutes: config.PAYMENT_RECONCILE_AFTER_MINUTES,
    abandonAfterMinutes: config.PAYMENT_ABANDON_AFTER_MINUTES
  }));
}

export function stopPaymentReconciliation(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
