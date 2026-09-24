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

    /*
     * ALREADY SHOWN THIS TRIP. This is what makes the waves WIDEN rather than
     * repeat.
     *
     * Dispatch offers a trip to the nearest few, waits, then offers it to the
     * next few. Without this, every wave wakes the same nearest riders again —
     * the ones who have already decided not to take it — while rider seven is
     * never asked at all, and the order waits for NO_RIDER_FOUND with riders
     * still available.
     *
     * `offeredToRiderIds` is the field the offer LIST already writes, so a rider
     * who has seen the trip on their screen is not then woken about it. Two marks
     * for one fact would drift, and the drift would be invisible.
     */
    if ((order.offeredToRiderIds || []).includes(rider.id)) continue;

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

      /*
       * Recorded AFTER the push, so a rider the push failed to reach is tried
       * again on the next wave rather than being marked as asked.
       *
       * The mark is what makes the next wave widen instead of repeating, and it
       * is the same field the offer list writes — one record of "this rider has
       * seen this trip", whichever way they saw it.
       */
      await orderRepository.markOfferedToRider(order.id, rider.id);
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

/**
 * Tells every rider who was offered this trip, except the one who took it, that
 * it is gone.
 *
 * -------------------------------------------------------------------------
 * THE OTHER FIVE ALARMS
 * -------------------------------------------------------------------------
 * Six riders are woken and one accepts. The other five keep a looping alarm in
 * the tray for a job that no longer exists, and a rider who taps it a minute
 * later is refused. That is the same shape as the offer list showing a trip the
 * gate would refuse — offered something, then told no — arriving through the push
 * instead.
 *
 * Read `notifyRiderTripWithdrawn` for what this does and does not achieve on the
 * APK riders have today: the withdrawal is inert until the rider app grows a
 * handler for it. The `androidTag` on the offer, which DOES work now, is what
 * stops repeated waves stacking.
 *
 * NEVER THROWS. Assigning a rider must not fail because a withdrawal could not be
 * sent; the worst case of a failure here is a stale entry, which is where we
 * already were.
 */
export async function withdrawTripOffers(order: Order, takenByRiderId: string): Promise<string[]> {
  try {
    const offered = order.offeredToRiderIds || [];
    const told: string[] = [];

    for (const riderId of offered) {
      if (riderId === takenByRiderId) continue;
      const rider = memoryStore.riders.get(riderId) as DeliveryRider | undefined;
      if (!rider?.userId) continue;
      await fcmDispatcher.notifyRiderTripWithdrawn(rider.userId, order.id, order.orderNumber);
      told.push(riderId);
    }

    return told;
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        event: 'RIDER_TRIP_WITHDRAW_FAILED',
        orderId: order?.id,
        message: err?.message
      })
    );
    return [];
  }
}
