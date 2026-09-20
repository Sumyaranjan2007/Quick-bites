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
import { calculateDistanceKm } from '../../db/client.ts';
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
  const promised = Number(order.preparationMinutes) || config.DEFAULT_PREP_MINUTES;
  const startedAt = order.acceptedAt || order.createdAt;
  const elapsed = startedAt ? (now - new Date(startedAt).getTime()) / 60_000 : 0;
  return Math.max(0, promised - Math.max(0, elapsed));
}

export function estimateArrival(order: Order, now: Date = new Date()): EtaEstimate {
  const nowMs = now.getTime();
  const none: EtaEstimate = { minutesRemaining: null, arrivingAt: null, basis: 'NONE', distanceKm: null };

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
      minutes = config.DEFAULT_PREP_MINUTES + travel;
      basis = 'PREP_AND_TRAVEL';
      break;
    case 'ACCEPTED':
    case 'PREPARING':
      minutes = prepRemainingMinutes(order, nowMs) + travel;
      basis = 'KITCHEN_ESTIMATE';
      break;
    case 'READY_FOR_PICKUP':
    case 'RIDER_ASSIGNED':
      // The food is made; what remains is a rider reaching it and then driving.
      minutes = config.DELIVERY_HANDLING_MINUTES + travel;
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

  return {
    minutesRemaining,
    arrivingAt: new Date(nowMs + minutesRemaining * 60_000).toISOString(),
    basis,
    distanceKm: Math.round(distanceKm * 100) / 100
  };
}
