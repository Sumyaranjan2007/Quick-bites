/**
 * The clock that moves orders nobody is moving.
 *
 * Every other transition in this system happens because a person pressed
 * something: the kitchen accepts, the rider claims, the customer cancels. That
 * leaves one gap, and it is the gap that produces the worst customer
 * experience in food delivery — an order that was paid for, was never accepted,
 * and sits on the customer's screen saying "waiting for the restaurant" for
 * forty minutes because the kitchen's tablet was face down on a counter.
 *
 * Nothing in this codebase expired such an order before this file existed. The
 * only `setTimeout` in the server was the one that forces shutdown.
 *
 * Two different problems, deliberately handled differently:
 *
 *   - An order the kitchen never accepted is CANCELLED and refunded. Waiting
 *     longer cannot help: if the kitchen has not looked at its tablet in eight
 *     minutes it will not look at it in twenty, and every extra minute is a
 *     minute the customer could have spent ordering somewhere else.
 *
 *   - Food that is ready and has no rider is NOT cancelled. It is cooked. The
 *     right answer is a human in the control room finding a rider or calling
 *     the customer, so this raises an alert and leaves the order alone.
 *     Cancelling it would throw the food away and pay for it twice.
 *
 * Both are driven from one interval rather than a timer per order: timers per
 * order are lost on restart, and a restart during a deployment is exactly when
 * a kitchen tablet is most likely to be going unwatched.
 */
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';
import { orderService } from './orderService.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import {
  notifyAdminsNoRiderFound,
  notifyAdminsRiderNoShow,
  notifyAdminsOrderAutoCancelled,
  notifyAdminsRiderWentSilent,
  notifyAdminsDeliveryOverdue
} from '../../notifications/adminNotifier.ts';
import { offerTripToNearbyRiders } from './tripOffers.ts';
import { getActiveRates } from '../payments/pricingConfig.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { config } from '../../config/env.ts';
import { isEnabled } from '../platform/featureFlags.ts';
import type { Order } from '@quick-bites/shared-types';

/**
 * The actor recorded against an automated cancellation.
 *
 * A real user id is deliberately not borrowed for this. The audit trail has to
 * be able to answer "did a person do this?", and it cannot if the platform
 * signs its own actions with somebody's name.
 */
const SYSTEM_ACTOR = {
  userId: 'system:order-sweeper',
  name: 'Quick Bites (automatic)',
  role: 'admin' as const
};

export interface SweepResult {
  scanned: number;
  /** Order ids cancelled because the kitchen never responded. */
  cancelled: string[];
  /** Order ids raised with operations because no rider took them. */
  alerted: string[];
  /**
   * Trips offered to a further group of riders this sweep.
   *
   * Reported rather than silent: if this grows while the alert list stays empty the
   * widening is working, and if both grow together there genuinely are not enough
   * riders — two different problems that look identical without this.
   */
  widened: Array<{ orderId: string; riders: number }>;
  /**
   * Orders whose CARRYING rider was flagged this sweep, and why.
   *
   * Nothing watched these before, so the count is also the answer to "is anybody
   * being lost mid-delivery" — a question that previously had no source at all.
   */
  carryingFlagged: Array<{ orderId: string; tier: 'SILENT' | 'OVERDUE' }>;
  /** Order ids that should have been cancelled but could not be. */
  failed: Array<{ orderId: string; reason: string }>;
  /** Riders reminded that they are holding a trip they have not collected. */
  noShowWarned: string[];
  /** Trips taken back off a rider who never turned up, and returned to the pool. */
  released: string[];
}

function minutesSince(iso: string | undefined, now: Date): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  // An unparseable timestamp must not read as "infinitely old" and trigger a
  // cancellation. Zero means "not stale", which is the safe direction.
  if (!Number.isFinite(then)) return 0;
  return (now.getTime() - then) / 60000;
}

/**
 * A single pass. Exported separately from the interval so that a test can run
 * exactly one sweep at a chosen instant, which is the only way to check the
 * boundary without waiting eight real minutes.
 */
export async function sweepStaleOrders(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    scanned: 0,
    cancelled: [],
    alerted: [],
    widened: [],
    carryingFlagged: [],
    failed: [],
    noShowWarned: [],
    released: []
  };

  // Read once per sweep rather than per order: it is one value and a sweep can
  // walk hundreds of orders.
  const rates = getActiveRates();

  const orders = await orderRepository.listAwaitingAction();
  result.scanned = orders.length;

  for (const order of orders) {
    if (order.status === 'ORDER_PLACED') {
      if (minutesSince(order.createdAt, now) < config.ORDER_ACCEPT_TIMEOUT_MINUTES) continue;

      try {
        await orderService.cancelOrder(order.id, SYSTEM_ACTOR, 'RESTAURANT_DID_NOT_RESPOND');
        result.cancelled.push(order.id);

        // Recorded even though cancelOrder already emits, because the audit
        // trail is where "why did my order vanish" gets answered weeks later,
        // and socket events are not kept.
        await auditRepository.record({
          actorUserId: SYSTEM_ACTOR.userId,
          actorName: SYSTEM_ACTOR.name,
          actorRole: SYSTEM_ACTOR.role,
          action: 'ORDER_AUTO_CANCELLED',
          entityType: 'order',
          entityId: order.id,
          summary:
            'Cancelled automatically: the restaurant did not accept within ' +
            `${config.ORDER_ACCEPT_TIMEOUT_MINUTES} minutes.`
        });

        console.log(JSON.stringify({
          level: 'WARN',
          timestamp: now.toISOString(),
          event: 'ORDER_AUTO_CANCELLED',
          orderId: order.id,
          orderNumber: order.orderNumber,
          restaurantId: order.restaurantId,
          waitedMinutes: Math.round(minutesSince(order.createdAt, now))
        }));

        /*
         * The one detected problem here that had NO ops alert at all — only a log
         * line and an audit row, both of which require somebody to go looking.
         *
         * A customer paid, waited, and was refunded because a kitchen ignored its
         * tablet. Nobody at the platform found out unless they read the logs, and
         * a restaurant doing it repeatedly is a conversation somebody needs to
         * have.
         */
        void notifyAdminsOrderAutoCancelled({
          orderId: order.id,
          orderNumber: order.orderNumber,
          restaurantName: (order as Order & { restaurantName?: string }).restaurantName,
          waitedMinutes: Math.round(minutesSince(order.createdAt, now))
        });
      } catch (error) {
        // One order that cannot be cancelled must not stop the rest of the
        // sweep — the failure is recorded and the loop continues.
        result.failed.push({
          orderId: order.id,
          reason: error instanceof Error ? error.message : String(error)
        });
        console.log(JSON.stringify({
          level: 'ERROR',
          timestamp: now.toISOString(),
          event: 'ORDER_AUTO_CANCEL_FAILED',
          orderId: order.id,
          reason: error instanceof Error ? error.message : String(error)
        }));
      }
      continue;
    }

    // From here down: accepted, being cooked, or cooked — and no rider.
    if (order.riderId) continue;
    if (order.riderSearchAlertedAt) continue;

    // Counted from acceptance rather than from when the order was placed: the
    // clock on finding a rider starts when there is something to collect.
    const waiting = minutesSince(order.acceptedAt || order.createdAt, now);

    /*
     * ---------------------------------------------------------------------
     * WIDEN THE SEARCH BEFORE GIVING UP ON IT.
     * ---------------------------------------------------------------------
     * `offerTripToNearbyRiders` fires once, from the two places a trip becomes
     * available. It wakes the nearest few. If those riders are asleep, NOBODY
     * ELSE IS EVER ASKED — rider seven never hears about it and the order waits
     * here for NO_RIDER_FOUND while riders are still available.
     *
     * So each sweep offers it to the next group. The riders already asked are
     * skipped by `offeredToRiderIds`, which is what makes this widen rather than
     * repeat.
     *
     * AND IT RUNS BEFORE THE ALERT. Telling the owner "no rider found" while the
     * platform is still actively offering the trip is an alert about a problem
     * that may not exist yet, and one they cannot do anything useful about. The
     * alert now means what it says: everybody who could take this has been asked.
     */
    if (waiting >= rates.riderOfferWaveMinutes) {
      const woken = await offerTripToNearbyRiders(order);
      if (woken.length > 0) {
        result.widened.push({ orderId: order.id, riders: woken.length });
        console.log(JSON.stringify({
          level: 'INFO',
          timestamp: now.toISOString(),
          event: 'RIDER_SEARCH_WIDENED',
          orderId: order.id,
          orderNumber: order.orderNumber,
          riders: woken.length,
          waitedMinutes: Math.round(waiting)
        }));
        // Somebody new has just been asked. Raising NO_RIDER_FOUND in the same
        // tick would alert on a search that is still in progress.
        continue;
      }
    }

    if (waiting < config.RIDER_ASSIGN_ALERT_MINUTES) continue;

    const alertedAt = now.toISOString();
    await orderRepository.markRiderSearchAlerted(order.id, alertedAt);
    result.alerted.push(order.id);

    emitOpsAlert({
      kind: 'NO_RIDER_FOUND',
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      restaurantName: (order as Order & { restaurantName?: string }).restaurantName,
      waitingMinutes: Math.round(waiting),
      raisedAt: alertedAt
    });

    /*
     * AND ON A PHONE. The emit above reaches a console somebody has open; this
     * reaches the person who can do something about it wherever they are.
     *
     * Cooked food with nobody to carry it is the only operational alert on this
     * platform that is urgent, and it is now honest about what it means: since
     * W1.2 it fires only after the search has been widened to exhaustion.
     */
    void notifyAdminsNoRiderFound({
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantName: (order as Order & { restaurantName?: string }).restaurantName,
      waitingMinutes: Math.round(waiting)
    });

    await auditRepository.record({
      actorUserId: SYSTEM_ACTOR.userId,
      actorName: SYSTEM_ACTOR.name,
      actorRole: SYSTEM_ACTOR.role,
      action: 'ORDER_NO_RIDER_ALERT',
      entityType: 'order',
      entityId: order.id,
      summary: `No rider accepted this order after ${Math.round(waiting)} minutes. Raised to operations.`
    });
  }

  /* ------------------------------------------------------------------ *
   *  Accepted, and never collected                                     *
   * ------------------------------------------------------------------ */
  //
  // The third gap, and the one that is invisible from every screen. A rider
  // accepts a trip and then does nothing: the kitchen has the food on a
  // counter, the customer's app says "rider on the way to collect", and
  // nothing in the system disagrees. The order was not stuck waiting for a
  // rider — it HAS one — so the alert above never fires for it.
  //
  // Warn first, release second. Releasing without warning strands a rider who
  // is genuinely two minutes away, and they arrive at a kitchen to find the
  // order gone.
  for (const order of await orderRepository.listAssignedAwaitingPickup()) {
    if (!order.riderId || !order.riderAssignedAt) continue;

    // Copied out BEFORE anything is released.
    //
    // The repository hands back the live object from the in-memory store rather
    // than a copy, and `releaseRider` clears `riderId` on it — so reading
    // `order.riderId` after the release gives undefined, and the rider who
    // dropped the trip is never flagged. The release still worked, which is
    // what made this invisible: everything looked right except the one number
    // operations would use to spot a pattern.
    const riderId = order.riderId;
    const heldSince = order.riderAssignedAt;
    const restaurantName = (order as Order & { restaurantName?: string }).restaurantName;
    const held = minutesSince(heldSince, now);

    if (held >= config.RIDER_NOSHOW_RELEASE_MINUTES) {
      // Returns null if the rider collected it between the read above and now,
      // so a sweep racing a real pickup cannot take an order out of somebody's
      // hands.
      const released = await orderRepository.releaseRider(order.id, riderId);
      if (!released) continue;

      await riderRepository.recordNoShow(riderId);
      result.released.push(order.id);

      emitOpsAlert({
        kind: 'RIDER_NO_SHOW',
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        restaurantName,
        waitingMinutes: Math.round(held),
        raisedAt: now.toISOString()
      });

      void notifyAdminsRiderNoShow({
        orderId: order.id,
        orderNumber: order.orderNumber,
        riderName: (order as Order & { riderName?: string }).riderName,
        waitingMinutes: Math.round(held)
      });

      await auditRepository.record({
        actorUserId: SYSTEM_ACTOR.userId,
        actorName: SYSTEM_ACTOR.name,
        actorRole: SYSTEM_ACTOR.role,
        action: 'RIDER_RELEASED_NO_SHOW',
        entityType: 'order',
        entityId: order.id,
        summary:
          `${order.riderName || 'The rider'} accepted this trip and had not collected it after ` +
          `${Math.round(held)} minutes. Returned to the pool and flagged.`
      });

      console.log(JSON.stringify({
        level: 'WARN',
        timestamp: now.toISOString(),
        event: 'RIDER_NO_SHOW_RELEASED',
        orderId: order.id,
        riderId,
        heldMinutes: Math.round(held)
      }));
      continue;
    }

    if (held >= config.RIDER_NOSHOW_WARN_MINUTES) {
      // Returns false if this one has already been warned, so the rider gets
      // one nudge rather than one every thirty seconds.
      const isNew = await orderRepository.markNoShowWarned(order.id, now.toISOString());
      if (!isNew) continue;

      result.noShowWarned.push(order.id);
      await fcmDispatcher.notifyRiderNoShowWarning(
        riderId,
        order.id,
        order.orderNumber,
        restaurantName || 'the restaurant'
      );

      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: now.toISOString(),
        event: 'RIDER_NO_SHOW_WARNED',
        orderId: order.id,
        riderId,
        heldMinutes: Math.round(held)
      }));
    }
  }

  /* ------------------------------------------------------------------ *
   *  THE RIDER WHO HAS THE FOOD, WHICH NOTHING WATCHED                  *
   * ------------------------------------------------------------------ */

  /*
   * This sweeper iterated exactly two lists: orders awaiting action, and trips
   * accepted but not collected. AFTER PICKUP, NOBODY WAS LOOKING.
   *
   * So a rider who collected the food and then stopped — a crash, a dead phone,
   * or walking off with a cash order — left the order out for delivery forever.
   * No alert anywhere. The customer watched a map that had stopped moving, and on
   * a cash order an unseen person held both the food and the money.
   *
   * It is the one case re-offering cannot recover, because the food has left the
   * building.
   *
   * Two tiers, and the distinction is what keeps the urgent one worth reading:
   * silence while carrying may be somebody hurt, and being late while still
   * transmitting is traffic.
   */
  for (const order of await orderRepository.listCarrying()) {
    const riderName = (order as Order & { riderName?: string }).riderName;

    /*
     * Silence measured from the last ping OR from pickup.
     *
     * `riderLocationUpdatedAt` alone would miss the worst case: a rider who has
     * never transmitted at all since collecting. `minutesSince` returns 0 for a
     * missing timestamp — the safe direction for staleness, and the wrong answer
     * here — so pickup is the fallback baseline.
     */
    const lastSignal = order.riderLocationUpdatedAt || order.pickedUpAt;
    const silentFor = minutesSince(lastSignal, now);
    const isCash = order.paymentMethod === 'CASH_ON_DELIVERY';

    /*
     * LATENESS IS MEASURED FROM PICKUP, NOT FROM THE ETA.
     *
     * My first version compared `now` against `estimateArrival().arrivingAt`, and
     * a check caught that it can never fire: that function recomputes the journey
     * from the rider's CURRENT position on every call, so `arrivingAt` is always
     * in the future and "minutes past the estimate" is always negative. The log
     * said `lateByMinutes: -12` on an order ninety minutes old.
     *
     * There is no stored promised arrival anywhere on the order to compare
     * against, so the only durable fact is how long the food has been out. That is
     * also what an operator actually wants: "this has been carried for forty
     * minutes" is checkable and true, where "past its estimate" would have been a
     * comparison against a number that moves every time it is asked.
     */
    const carryingFor = minutesSince(order.pickedUpAt, now);

    /*
     * WHICH TIER, and only when it CHANGES.
     *
     * Stored as the tier rather than a boolean, so an order that was merely late
     * and has now gone silent raises the urgent one — an escalation is news. The
     * same tier twice is not, and the sweeper runs every thirty seconds.
     */
    const tier: 'SILENT' | 'OVERDUE' | null =
      silentFor >= rates.riderLocationSilentMinutes
        ? 'SILENT'
        : carryingFor >= rates.deliveryOverdueMinutes
        ? 'OVERDUE'
        : null;

    if (!tier) continue;
    if ((order as any).carryingAlertTier === tier) continue;

    (order as any).carryingAlertTier = tier;
    (order as any).carryingAlertAt = now.toISOString();
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();

    result.carryingFlagged.push({ orderId: order.id, tier });

    if (tier === 'SILENT') {
      emitOpsAlert({
        kind: 'RIDER_WENT_SILENT',
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        detail: `No position for ${Math.round(silentFor)} minutes while carrying${isCash ? ', and it is a cash order' : ''}.`,
        raisedAt: now.toISOString()
      });
      void notifyAdminsRiderWentSilent({
        orderId: order.id,
        orderNumber: order.orderNumber,
        riderName,
        silentMinutes: Math.round(silentFor),
        isCash
      });
    } else {
      emitOpsAlert({
        kind: 'DELIVERY_OVERDUE',
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        detail: `Carried for ${Math.round(carryingFor)} minutes and still not delivered; rider still transmitting.`,
        raisedAt: now.toISOString()
      });
      void notifyAdminsDeliveryOverdue({
        orderId: order.id,
        orderNumber: order.orderNumber,
        carryingMinutes: Math.round(carryingFor)
      });
    }

    /*
     * And tell the CUSTOMER, once.
     *
     * A frozen map with no explanation is the worst version of this: they cannot
     * tell whether the app is broken, the rider is lost, or the food is coming, so
     * they assume the worst and phone support. Said once per order, on whichever
     * tier fired first, because two messages about one late dinner is worse than
     * one.
     */
    if (order.customerId && !(order as any).customerToldLateAt) {
      (order as any).customerToldLateAt = now.toISOString();
      memoryStore.orders.set(order.id, order);
      try {
        await fcmDispatcher.notifyCustomerDeliveryDelayed(
          order.customerId,
          order.id,
          order.orderNumber,
          tier === 'SILENT'
        );
      } catch {
        /* Telling somebody must never be the reason a sweep fails. */
      }
    }

    console.log(JSON.stringify({
      level: tier === 'SILENT' ? 'ERROR' : 'WARN',
      timestamp: now.toISOString(),
      event: tier === 'SILENT' ? 'RIDER_WENT_SILENT' : 'DELIVERY_OVERDUE',
      orderId: order.id,
      orderNumber: order.orderNumber,
      riderId: order.riderId,
      silentMinutes: Math.round(silentFor),
      carryingForMinutes: Math.round(carryingFor),
      isCash
    }));
  }

  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Guards against overlap. A sweep that takes longer than the interval — because
 * a refund call to the payment gateway is slow — would otherwise start a second
 * pass over the same orders and try to cancel each of them twice.
 */
let running = false;

export function startOrderSweeper(): void {
  if (timer) return;

  timer = setInterval(async () => {
    if (running) return;
    // An operator investigating the sweeper can stop it without stopping the
    // server, which otherwise means a redeploy in the middle of an incident.
    if (!isEnabled('scheduled_reports')) return;
    running = true;
    try {
      await sweepStaleOrders();
    } catch (error) {
      // A throw inside a setInterval callback with nothing to catch it takes
      // the whole process down. The sweeper is a safety net; it must never be
      // the thing that causes the outage.
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'ORDER_SWEEP_FAILED',
        reason: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      running = false;
    }
  }, config.ORDER_SWEEP_INTERVAL_SECONDS * 1000);

  // Without this the interval keeps the event loop alive and the process will
  // not exit on its own after a shutdown signal.
  timer.unref?.();

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    event: 'ORDER_SWEEPER_STARTED',
    everySeconds: config.ORDER_SWEEP_INTERVAL_SECONDS,
    acceptTimeoutMinutes: config.ORDER_ACCEPT_TIMEOUT_MINUTES,
    riderAlertMinutes: config.RIDER_ASSIGN_ALERT_MINUTES
  }));
}

export function stopOrderSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
