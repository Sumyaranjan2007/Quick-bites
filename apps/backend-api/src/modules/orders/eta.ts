/**
 * When the food will actually arrive.
 *
 * The tracking screen used to show a number that never moved, because there was
 * no number: the app displayed a constant. A fixed "30 minutes" is worse than no
 * estimate at all — it is still saying thirty minutes forty minutes in, which is
 * the moment a customer stops believing anything the screen says.
 *
 * The estimate here is built from what is actually known at each stage, and it
 * changes as the order moves:
 *
 *   before the kitchen accepts   prep guess + kitchen-to-door travel
 *   accepted / preparing         the kitchen's own prep time, counted down from
 *                                when it accepted, + travel
 *   ready / rider assigned       travel only, plus the wait for collection
 *   out for delivery             travel from where the rider actually is
 *   delivered                    nothing; it is here
 *
 * Distance is straight-line, so it understates a real road route. The handling
 * allowance absorbs some of that; a routing service would do better and is the
 * obvious later improvement. What matters is that the number is derived from
 * this order rather than invented, and that it moves.
 */
import { calculateDistanceKm, memoryStore } from '../../db/client.ts';
import { config } from '../../config/env.ts';
import type { Coordinates, Order, OrderStatus } from '@quick-bites/shared-types';

export interface EtaEstimate {
  /** Minutes from now until the customer has the food. Null once delivered or cancelled. */
  minutesRemaining: number | null;
  /** The same figure as a timestamp, so a client can count down without a clock skew. */
  arrivingAt: string | null;
  /** Which of the stages above produced it, so the screen can word itself honestly. */
  basis: 'PREP_AND_TRAVEL' | 'KITCHEN_ESTIMATE' | 'AWAITING_PICKUP' | 'RIDER_EN_ROUTE' | 'ARRIVED' | 'NONE';
  /** Kilometres the estimate was computed over, for the tracking screen and for debugging. */
  distanceKm: number | null;
  /** The arrival promised at checkout (frozen), when there is one. */
  promisedAt: string | null;
  /** True when the live estimate beats the promise by 3 minutes or more: "We're ahead of time!" (B3). */
  ahead: boolean;
}

/** How early counts as "ahead of time" (plan B3). */
const AHEAD_BY_MS = 3 * 60_000;
/** Orders a kitchen needs before its own cooking time replaces the platform default (plan B3). */
const MEASURED_ORDERS = 20;

const itemCount = (order: Pick<Order, 'items'>) =>
  (order.items || []).reduce((n, i: any) => n + (Number(i.quantity) || 1), 0);
/** Small, medium and large carts cook differently. */
const cartSize = (items: number) => (items <= 2 ? 'S' : items <= 5 ? 'M' : 'L');

/**
 * The kitchen's OWN cooking time for a cart this size (plan B3): the median of its
 * last 20 orders of that size, accepted to ready. The platform default until it has 20.
 *
 * seniordev: scans every order on each call. Fine at today's volume; keep a per-kitchen
 * rolling list updated on READY_FOR_PICKUP if the store grows large.
 */
export function kitchenPrepMinutes(restaurantId: string, items: number): number {
  const size = cartSize(items);
  const measured: Array<{ at: number; minutes: number }> = [];
  for (const o of memoryStore.orders.values() as Iterable<Order>) {
    if (o.restaurantId !== restaurantId || !o.acceptedAt || !o.readyAt) continue;
    if (cartSize(itemCount(o)) !== size) continue;
    const minutes = (Date.parse(o.readyAt) - Date.parse(o.acceptedAt)) / 60_000;
    if (minutes > 0 && minutes < 180) measured.push({ at: Date.parse(o.readyAt), minutes });
  }
  if (measured.length < MEASURED_ORDERS) return config.DEFAULT_PREP_MINUTES;
  const last = measured.sort((a, b) => b.at - a.at).slice(0, MEASURED_ORDERS).map(m => m.minutes).sort((a, b) => a - b);
  return (last[MEASURED_ORDERS / 2 - 1] + last[MEASURED_ORDERS / 2]) / 2;
}

/** Minutes for the rider (assigned, or the one holding the offer) to reach the kitchen; 0 when unknown. */
function riderToKitchenMinutes(order: Order): number {
  const riderId = order.riderId || order.riderOffer?.riderId;
  const rider: any = riderId ? memoryStore.riders.get(riderId) : undefined;
  const at = order.riderId && order.riderCoordinates ? order.riderCoordinates : rider?.currentCoordinates;
  const km = distanceBetween(at, order.restaurantCoordinates);
  return km === null ? 0 : (km / config.DELIVERY_SPEED_KMPH) * 60;
}

const TERMINAL: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

function travelMinutes(distanceKm: number): number {
  const hours = distanceKm / config.DELIVERY_SPEED_KMPH;
  return hours * 60 + config.DELIVERY_HANDLING_MINUTES;
}

function distanceBetween(from?: Coordinates | null, to?: Coordinates | null): number | null {
  if (!from || !to) return null;
  if (!Number.isFinite(from.latitude) || !Number.isFinite(to.latitude)) return null;
  return calculateDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude);
}

/**
 * Minutes of cooking still to go.
 *
 * Counted from when the kitchen accepted rather than from now, so the figure
 * falls as the food cooks. Floored at zero: a kitchen that has overrun its own
 * estimate is late, and reporting negative minutes would make the ETA drift
 * earlier the later it got.
 */
function prepRemainingMinutes(order: Order, now: number): number {
  // The time the kitchen typed for THIS order, else what it usually takes.
  const promised = Number(order.preparationMinutes) || kitchenPrepMinutes(order.restaurantId, itemCount(order));
  const startedAt = order.acceptedAt || order.createdAt;
  const elapsed = startedAt ? (now - new Date(startedAt).getTime()) / 60_000 : 0;
  return Math.max(0, promised - Math.max(0, elapsed));
}

export function estimateArrival(order: Order, now: Date = new Date()): EtaEstimate {
  const nowMs = now.getTime();
  const promisedAt = order.promisedArrivalAt ?? null;
  const none: EtaEstimate = { minutesRemaining: null, arrivingAt: null, basis: 'NONE', distanceKm: null, promisedAt, ahead: false };

  if (TERMINAL.includes(order.status)) {
    return order.status === 'DELIVERED' ? { ...none, basis: 'ARRIVED' } : none;
  }

  const destination = order.deliveryCoordinates;
  const kitchen = order.restaurantCoordinates;

  // Once the rider has the food, the only journey left is the one they are on,
  // measured from where they actually are. Before that, the food still has to
  // travel the whole way from the kitchen.
  const riderHasFood = order.status === 'OUT_FOR_DELIVERY' && Boolean(order.riderCoordinates);

  // Before pickup, the best figure available is the one recorded at checkout:
  // that is a real road distance from Google, whereas re-deriving it here would
  // only give the straight line under it. This preference used to run the other
  // way, which quietly discarded the measurement in favour of the estimate.
  //
  // Once the rider has the food it flips back, and deliberately. The rider's
  // position changes every few seconds, so the only current figure is one
  // computed here; paying Google per tick per live order is a bill that grows
  // with success, and a straight line is good enough for a number that refreshes
  // constantly and is never charged for.
  const recorded = Number(order.distanceKm) || null;
  const distanceKm = riderHasFood
    ? distanceBetween(order.riderCoordinates, destination)
    : recorded ?? distanceBetween(kitchen, destination);

  if (distanceKm === null) {
    return none;
  }

  const travel = travelMinutes(distanceKm);
  let minutes: number;
  let basis: EtaEstimate['basis'];

  switch (order.status) {
    case 'PAYMENT_PENDING':
    case 'ORDER_PLACED':
      minutes = kitchenPrepMinutes(order.restaurantId, itemCount(order)) + travel;
      basis = 'PREP_AND_TRAVEL';
      break;
    case 'ACCEPTED':
    case 'PREPARING':
      // Cooking and the rider's ride to the kitchen happen at the same time: whichever is longer.
      minutes = Math.max(prepRemainingMinutes(order, nowMs), riderToKitchenMinutes(order)) + travel;
      basis = 'KITCHEN_ESTIMATE';
      break;
    case 'READY_FOR_PICKUP':
    case 'HANDED_TO_RIDER':
      // The food is made; what remains is a rider reaching it and then driving.
      //
      // HANDED_TO_RIDER sits here rather than with OUT_FOR_DELIVERY because it
      // is only the KITCHEN's half of the handover. The rider has not yet
      // confirmed they have the bag, so the journey has not started and
      // quoting travel time alone would promise an arrival from a point
      // nobody has left.
      // Food is made: the wait is the rider reaching the kitchen (B3), at least the handover.
      minutes = Math.max(config.DELIVERY_HANDLING_MINUTES, riderToKitchenMinutes(order)) + travel;
      basis = 'AWAITING_PICKUP';
      break;
    case 'OUT_FOR_DELIVERY':
      minutes = travel;
      basis = 'RIDER_EN_ROUTE';
      break;
    default:
      return none;
  }

  // Rounded up to the whole minute. A customer reads "2 minutes" as "not yet",
  // and rounding down would let the screen say zero while the rider is still
  // riding.
  const minutesRemaining = Math.max(1, Math.ceil(minutes));

  const arrivingAt = nowMs + minutesRemaining * 60_000;
  return {
    minutesRemaining,
    arrivingAt: new Date(arrivingAt).toISOString(),
    basis,
    distanceKm: Math.round(distanceKm * 100) / 100,
    promisedAt,
    ahead: promisedAt !== null && Date.parse(promisedAt) - arrivingAt >= AHEAD_BY_MS
  };
}
