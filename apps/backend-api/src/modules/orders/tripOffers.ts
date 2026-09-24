/**
 * Waking the riders who could actually take this trip.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * Nothing has ever pushed a rider a job. `emitOrderAvailableForPickup` puts the
 * trip into a socket room, which reaches riders whose app is open and connected —
 * and Android kills background sockets, so it reaches almost nobody. A rider with
 * the phone in their pocket heard nothing, food that was ready sat on the pass,
 * and the sweeper eventually raised NO_RIDER_FOUND.
 *
 * That alert reads as "no riders available". What actually happened is that
 * nobody was asked.
 *
 * The socket stays. It is the fast path for an app that is already open, and it
 * is what makes the offer list refresh without a poll. This is the second,
 * independent path for a phone that is closed — the same relationship the kitchen
 * push has with the in-app alarm.
 *
 * -------------------------------------------------------------------------
 * THE PUSH MUST NOT OFFER WHAT THE GATE WILL REFUSE
 * -------------------------------------------------------------------------
 * Every filter here is the one the claim gate enforces, from the same function.
 * A notification that wakes somebody for a job the server then refuses is worse
 * than no notification: it arrives while the phone is in their pocket, they
 * cannot see why, and after twice they stop trusting the alert that exists to be
 * trusted.
 *
 * That is also how this work found a live defect — the offer LIST had the same
 * mismatch and nobody had noticed, because a 409 on a tap looks like bad luck.
 */
import type { Order, DeliveryRider } from '@quick-bites/shared-types';
import { memoryStore, calculateDistanceKm } from '../../db/client.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import { hasActiveTrip, cashCeilingBlocks, offerableNow } from './riderTrip.ts';

/**
 * How many riders are woken for one trip.
 *
 * NOT everybody online. A city with forty riders means forty alarms for one
 * order, thirty-nine of which are for a trip somebody else takes — and a rider
 * whose phone screams four times an hour for work that evaporates turns the
 * channel off. Then the one trip that needed them arrives silently.
 *
 * Six is enough that somebody answers and few enough that the alarm keeps
 * meaning something. The socket still reaches everyone with the app open, so this
 * is a ceiling on who is WOKEN, not on who may accept.
 */
const MAX_RIDERS_WOKEN = 6;

/** A rider who could accept this order right now, nearest to the kitchen first. */
export async function eligibleRidersFor(order: Order): Promise<DeliveryRider[]> {
  const riders = Array.from(memoryStore.riders.values()) as DeliveryRider[];

  const candidates: DeliveryRider[] = [];
  for (const rider of riders) {
    if (!rider.isOnline) continue;
    if (!rider.userId) continue;

    // Already declined it. Offering it again is how a rider learns to ignore the
    // alarm, and the list already respects this.
    if ((order.declinedByRiderIds || []).includes(rider.id)) continue;

    // On a job. The gate refuses a second trip, so waking them for one is noise
    // arriving while they are riding.
    const theirs = await orderRepository.listByRiderId(rider.id);
    if (theirs.some(o => hasActiveTrip(o))) continue;

    // At the cash ceiling, for a cash trip. The same function the gate uses.
    if (cashCeilingBlocks(rider.id, order).blocked) continue;

    candidates.push(rider);
  }

  const kitchen = (order as any).restaurantCoordinates;
  if (!kitchen || !Number.isFinite(kitchen.latitude) || !Number.isFinite(kitchen.longitude)) {
    return candidates;
  }

  /*
   * Nearest to the KITCHEN, not to the customer. The rider's first job is to
   * collect, and a rider three streets from the restaurant gets there while one
   * near the delivery address is still crossing town.
   *
   * A rider with no recorded position sorts last rather than first, which is
   * where a NaN comparison would have silently left them.
   */
  const distanceOf = (rider: DeliveryRider) =>
    rider.currentCoordinates
      ? calculateDistanceKm(
          rider.currentCoordinates.latitude,
          rider.currentCoordinates.longitude,
          kitchen.latitude,
          kitchen.longitude
        )
      : Number.MAX_SAFE_INTEGER;

  return candidates.sort((a, b) => distanceOf(a) - distanceOf(b));
}

/**
 * Pushes this trip to the nearest eligible riders.
 *
 * Returns the rider ids it addressed, which is what a check asserts on: proving
 * "a rider was notified" passes when every rider in the city was notified, and
 * that is the failure this module is shaped to avoid.
 *
 * NEVER THROWS. A trip becoming available must not fail because a push service is
 * slow or a credential expired — the same rule as `tellTheKitchen`. Callers use
 * `void`.
 */
export async function offerTripToNearbyRiders(order: Order): Promise<string[]> {
  try {
    /*
     * Re-checked here rather than trusted from the caller.
     *
     * Both call sites fire alongside `emitOrderAvailableForPickup`, and both are
     * correct today. But this function wakes people up, and "is this trip
     * actually on offer" is cheap to ask and expensive to get wrong: a rider
     * woken for an order that has already been claimed, or for one whose kitchen
     * has not started cooking, is the alarm losing its meaning.
     */
    if (order.riderId) return [];
    if (!offerableNow(order)) return [];

    const riders = (await eligibleRidersFor(order)).slice(0, MAX_RIDERS_WOKEN);
    if (riders.length === 0) return [];

    const kitchen = (order as any).restaurantCoordinates;
    const restaurantName = order.restaurantName || 'the restaurant';

    for (const rider of riders) {
      const km =
        kitchen && rider.currentCoordinates
          ? calculateDistanceKm(
              rider.currentCoordinates.latitude,
              rider.currentCoordinates.longitude,
              kitchen.latitude,
              kitchen.longitude
            )
          : null;

      await fcmDispatcher.notifyRiderTripAvailable(
        rider.userId!,
        order.id,
        order.orderNumber,
        restaurantName,
        km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
      );
    }

    return riders.map(r => r.id);
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        event: 'RIDER_TRIP_PUSH_FAILED',
        orderId: order?.id,
        message: err?.message
      })
    );
    return [];
  }
}
