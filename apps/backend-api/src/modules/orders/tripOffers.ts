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
import { memoryStore, calculateDistanceKm, persistDurably, triggerAutoSave } from '../../db/client.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import { hasActiveTrip, cashCeilingBlocks, offerableNow } from './riderTrip.ts';
import { getActiveRates } from '../payments/pricingConfig.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import { notifyAdminsNoRiderFound } from '../../notifications/adminNotifier.ts';

/** A rider whose last position is younger than this ranks ahead of riders with an older one (plan B4: 2 min). */
const FRESH_FIX_MS = 2 * 60 * 1000;

/** The offer on this order while it is still running; null once it has expired or there is none. */
export function liveOffer(order: Pick<Order, 'riderOffer'>, now = Date.now()) {
  const offer = order.riderOffer;
  return offer && Date.parse(offer.expiresAt) > now ? offer : null;
}

/** Riders holding a running offer on some trip: one offer per rider at a time (review D4). */
function ridersHoldingAnOffer(now: number): Set<string> {
  const holding = new Set<string>();
  for (const o of memoryStore.orders.values() as Iterable<Order>) {
    const offer = !o.riderId && liveOffer(o, now);
    if (offer) holding.add(offer.riderId);
  }
  return holding;
}

/** Trips each rider has taken today, for the tie-break: work goes to whoever has had less. */
function tripsToday(): Map<string, number> {
  // Today in India: the server runs on UTC, whose midnight is 05:30 here (review S3).
  const IST_MS = 5.5 * 3_600_000;
  const since = Math.floor((Date.now() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS;
  const counts = new Map<string, number>();
  for (const o of memoryStore.orders.values() as Iterable<Order>) {
    if (!o.riderId || !o.riderAssignedAt || Date.parse(o.riderAssignedAt) < since) continue;
    counts.set(o.riderId, (counts.get(o.riderId) || 0) + 1);
  }
  return counts;
}

/**
 * Riders who could take this trip right now, best first (owner Q6, 18 Oct 2026):
 * not yet asked about this trip, then a recent position, then nearest the kitchen,
 * then fewer trips today. Every filter is the one the claim gate enforces.
 *
 * seniordev: a stale position ranks a rider lower instead of excluding them. The
 * Rider app on phones today sends a position only after moving 50 m, so a rider
 * waiting outside a restaurant goes quiet; excluding them would starve dispatch.
 * Make freshness a hard filter once the Stage E app sends a heartbeat. Distance is
 * straight line; switch to Routes API road time with B2.
 */
export async function eligibleRidersFor(order: Order, now = Date.now()): Promise<DeliveryRider[]> {
  const riders = Array.from(memoryStore.riders.values()) as DeliveryRider[];
  const holding = ridersHoldingAnOffer(now);

  const candidates: DeliveryRider[] = [];
  for (const rider of riders) {
    if (!rider.isOnline) continue;
    if (!rider.userId) continue;
    // A rider who is also a customer is never offered their own order.
    if (rider.userId === order.customerId) continue;
    // Passed on it (or gave it back): never offered it again.
    if ((order.declinedByRiderIds || []).includes(rider.id)) continue;
    // Already looking at another trip's offer.
    if (holding.has(rider.id)) continue;
    // On a job. The gate refuses a second trip.
    const theirs = await orderRepository.listByRiderId(rider.id);
    if (theirs.some(o => hasActiveTrip(o))) continue;
    // At the cash ceiling, for a cash trip. The same function the gate uses.
    if (cashCeilingBlocks(rider.id, order).blocked) continue;
    candidates.push(rider);
  }

  const kitchen = (order as any).restaurantCoordinates;
  const hasKitchen = kitchen && Number.isFinite(kitchen.latitude) && Number.isFinite(kitchen.longitude);
  const asked = new Set(order.offeredToRiderIds || []);
  const trips = tripsToday();
  const fresh = (r: DeliveryRider) =>
    Boolean(r.currentCoordinates && r.lastPingAt && now - Date.parse(r.lastPingAt) < FRESH_FIX_MS);
  // No position sorts last rather than first, which is where a NaN comparison would leave it.
  const distanceOf = (r: DeliveryRider) =>
    hasKitchen && r.currentCoordinates
      ? calculateDistanceKm(r.currentCoordinates.latitude, r.currentCoordinates.longitude, kitchen.latitude, kitchen.longitude)
      : Number.MAX_SAFE_INTEGER;

  return candidates.sort(
    (a, b) =>
      Number(asked.has(a.id)) - Number(asked.has(b.id)) ||
      Number(fresh(b)) - Number(fresh(a)) ||
      distanceOf(a) - distanceOf(b) ||
      (trips.get(a.id) || 0) - (trips.get(b.id) || 0)
  );
}

/** One timer per running offer, for the exact expiry (review D3); the sweeper is the restart backstop. */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleExpiry(orderId: string, ms: number): void {
  clearTimeout(expiryTimers.get(orderId));
  const timer = setTimeout(() => {
    expiryTimers.delete(orderId);
    const order = memoryStore.orders.get(orderId) as Order | undefined;
    if (order) void offerTripToNearbyRiders(order);
  }, ms + 250);
  timer.unref?.();
  expiryTimers.set(orderId, timer);
}

/**
 * Offers this trip to the ONE best rider for `riderOfferSeconds` (owner Q6: 108 s).
 * Called when food becomes ready, when a trip is given back, by ops rescue, by the
 * expiry timer and by every sweep; it does nothing while an offer is still running,
 * so repeated calls never offer one trip to two riders.
 *
 * Returns the rider id it offered to (or none). NEVER THROWS: a trip becoming
 * available must not fail because a push service is slow. Callers use `void`.
 */
export async function offerTripToNearbyRiders(passed: Order): Promise<string[]> {
  try {
    // Callers sometimes hold a copy; the stored order is the one that carries the offer.
    const order = (memoryStore.orders.get(passed.id) as Order | undefined) ?? passed;
    if (order.riderId) return [];
    if (!offerableNow(order)) return [];
    const now = Date.now();
    if (liveOffer(order, now)) return [];

    const candidates = await eligibleRidersFor(order, now);
    // Review S1 (18 Oct 2026): the ranking above awaits, and six callers (ready,
    // sweep, expiry timer, decline, ops rescue, a trip given back) can run at
    // once. So the checks are repeated here, with no await between them and
    // writing the offer: a second caller then sees the first one's offer, and a
    // rider who picked up another trip's offer meanwhile is skipped.
    if (order.riderId || !offerableNow(order) || liveOffer(order, now)) return [];
    const holding = ridersHoldingAnOffer(now);
    const rider = candidates.find(r => !holding.has(r.id));
    if (!rider) return [];
    const previous = order.riderOffer;

    const rates = getActiveRates();
    const seconds = Number(rates.riderOfferSeconds) || 108;
    const round = (previous?.round || 0) + 1;
    order.riderOffer = {
      riderId: rider.id,
      offeredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + seconds * 1000).toISOString(),
      round
    };
    order.updatedAt = order.riderOffer.offeredAt;
    memoryStore.orders.set(order.id, order);
    // Saved before anyone is told, so a deploy mid-offer carries on (plan B4).
    await persistDurably();
    scheduleExpiry(order.id, seconds * 1000);

    // The rider whose time ran out loses it from their tray.
    const before = previous ? (memoryStore.riders.get(previous.riderId) as DeliveryRider | undefined) : undefined;
    if (before?.userId && before.id !== rider.id) {
      await fcmDispatcher.notifyRiderTripWithdrawn(before.userId, order.id, order.orderNumber);
    }

    const kitchen = (order as any).restaurantCoordinates;
    const km =
      kitchen && rider.currentCoordinates
        ? calculateDistanceKm(rider.currentCoordinates.latitude, rider.currentCoordinates.longitude, kitchen.latitude, kitchen.longitude)
        : null;
    await fcmDispatcher.notifyRiderTripAvailable(
      rider.userId!,
      order.id,
      order.orderNumber,
      order.restaurantName || 'the restaurant',
      km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
    );
    // Counted once per rider and trip (QA v11), however many times the offer cycles back to them.
    if (await orderRepository.markOfferedToRider(order.id, rider.id)) {
      await riderRepository.recordOffer(rider.id);
    }

    // After N different riders, operations hears about it once; offers keep cycling
    // (owner Q6). Counted in riders, not offers (review S2): one rider asked five
    // times is not five riders.
    const ridersAsked = new Set([...(order.offeredToRiderIds || []), rider.id]).size;
    if (ridersAsked >= (Number(rates.riderOffersBeforeAlert) || 5) && !order.riderSearchAlertedAt) {
      const raisedAt = new Date().toISOString();
      await orderRepository.markRiderSearchAlerted(order.id, raisedAt);
      emitOpsAlert({
        kind: 'NO_RIDER_FOUND',
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        detail: `${ridersAsked} riders asked; still offering. Assign one by hand if needed.`,
        raisedAt
      });
      void notifyAdminsNoRiderFound({
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantName: order.restaurantName,
        waitingMinutes: Math.round((now - Date.parse(order.acceptedAt || order.createdAt)) / 60000)
      });
    }

    return [rider.id];
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        event: 'RIDER_TRIP_PUSH_FAILED',
        orderId: passed?.id,
        message: err?.message
      })
    );
    return [];
  }
}

/** The offered rider passed: the trip moves to the next rider at once (they are in `declinedByRiderIds`). */
export async function moveOfferOnAfterDecline(orderId: string, riderId: string): Promise<string[]> {
  const order = memoryStore.orders.get(orderId) as Order | undefined;
  if (!order?.riderOffer || order.riderOffer.riderId !== riderId) return [];
  order.riderOffer = { ...order.riderOffer, expiresAt: new Date().toISOString() };
  memoryStore.orders.set(order.id, order);
  // Saved even when nobody else is free to take it, so the ended offer survives a restart.
  triggerAutoSave();
  return offerTripToNearbyRiders(order);
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
