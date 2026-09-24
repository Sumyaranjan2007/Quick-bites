import type { Order, RiderTripStage } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';
import { cashStanding } from '../payments/cashDeposits.ts';

/*
 * ---------------------------------------------------------------------------
 * QUESTIONS ABOUT THE RIDER, ANSWERED FROM THE RIDER'S TRACK.
 * ---------------------------------------------------------------------------
 *
 * Before the two tracks were separated, "does this rider have a job on" was
 * asked as `status === 'RIDER_ASSIGNED' || status === 'OUT_FOR_DELIVERY'`,
 * written out by hand in nine different places. Every one of them was really
 * asking about the RIDER and answering from the FOOD, which worked only
 * because assigning a rider overwrote the food's status - the bug.
 *
 * Collected here so the question has one answer. Nine copies of a predicate
 * are nine chances for one of them to be updated and the rest forgotten, and
 * the ones that get forgotten are the ones nobody is looking at: a rider held
 * off new work by a trip that ended, a dashboard counting deliveries that are
 * not happening.
 */

/** Stages where the rider is on a trip but has not yet collected the food. */
const BEFORE_PICKUP: readonly RiderTripStage[] = ['OFFERED', 'HEADING_TO_RESTAURANT', 'AT_RESTAURANT'];

/** Stages where the rider is carrying the food. */
const CARRYING: readonly RiderTripStage[] = ['PICKED_UP', 'AT_DOORSTEP'];

/**
 * Is this rider on a job right now?
 *
 * True from the moment they accept until the food is handed over. Used to stop
 * offering a second trip to someone already on one, and to count deliveries in
 * flight.
 *
 * `riderId` is required as well as a live stage. A stage left behind on an
 * order whose rider was released would otherwise keep that trip "active"
 * forever, and the symptom - a rider who is never offered anything again - is
 * invisible from the rider's side.
 */
export function hasActiveTrip(order: Pick<Order, 'riderId' | 'riderStage'>): boolean {
  if (!order.riderId || !order.riderStage) return false;
  return BEFORE_PICKUP.includes(order.riderStage) || CARRYING.includes(order.riderStage);
}

/**
 * Accepted, not yet collected. What the no-show sweep looks for, and what
 * decides whether a rider may still be released.
 *
 * `pickedUpAt` is checked as well as the stage, and it is not redundant. Two
 * tracks that move independently can disagree - anything that advances the
 * food without moving the rider's stage leaves a collected order still
 * claiming the rider is on their way to the restaurant. The no-show sweep
 * would then take a trip off somebody who already has the food in their bag,
 * flag them for not turning up, and hand the order to a second rider with
 * nothing to collect.
 *
 * `pickedUpAt` is stamped once, by collection, and never cleared. Where the
 * two disagree, believe the durable fact over the position.
 */
export function isAwaitingPickup(
  order: Pick<Order, 'riderId' | 'riderStage' | 'pickedUpAt'>
): boolean {
  if (!order.riderId || !order.riderStage) return false;
  if (order.pickedUpAt) return false;
  return BEFORE_PICKUP.includes(order.riderStage);
}

/**
 * How far along the food must be before this restaurant's trips are offered.
 * The order matters: an order at or past the configured point is offerable.
 */
const OFFER_SEQUENCE = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] as const;

/**
 * Is this order far enough along to be offered to riders?
 *
 * Reads the restaurant's `riderOfferAtStatus`, defaulting to READY_FOR_PICKUP.
 * An unknown or missing setting falls back to that default rather than
 * throwing or offering everything: a restaurant with a typo in its
 * configuration should dispatch conservatively, not stop dispatching and not
 * flood every rider in the city.
 */
export function offerableNow(order: Pick<Order, 'status' | 'restaurantId'>): boolean {
  const at = OFFER_SEQUENCE.indexOf(order.status as (typeof OFFER_SEQUENCE)[number]);
  if (at === -1) return false; // Not yet cooking, or already collected.

  const restaurant: any = memoryStore.restaurants.get(order.restaurantId);
  const configured = OFFER_SEQUENCE.indexOf(restaurant?.riderOfferAtStatus);
  const threshold = configured === -1 ? OFFER_SEQUENCE.indexOf('READY_FOR_PICKUP') : configured;

  return at >= threshold;
}

/** Carrying the food. */
export function isCarrying(order: Pick<Order, 'riderId' | 'riderStage'>): boolean {
  if (!order.riderId || !order.riderStage) return false;
  return CARRYING.includes(order.riderStage);
}

/**
 * Whether the cash this rider is holding stops them taking THIS order.
 *
 * -------------------------------------------------------------------------
 * THE OFFER LIST AND THE GATE USED TO DISAGREE
 * -------------------------------------------------------------------------
 * The claim gate refuses a cash order to a rider at the ceiling
 * (`riderRouter.ts`), and the offer list did not filter for it. So a rider who
 * had reached the limit was shown cash trips, tapped one, and got a 409. They
 * did nothing wrong and the app told them off for it.
 *
 * That was survivable while the list was the only way a trip reached anybody.
 * It stops being survivable the moment a PUSH offers the trip: a notification
 * that wakes somebody up for a job the server will refuse is worse than no
 * notification, and it arrives when the phone is in their pocket and they
 * cannot see why.
 *
 * So the list, the gate and the push all ask this one function. Three copies of
 * an eligibility rule is three chances for the one nobody is looking at to drift
 * — and the one nobody is looking at is the push.
 *
 * ONLY CASH ORDERS. Online-paid trips still reach a rider who is carrying cash,
 * because the ceiling exists to stop cash accumulating, not to stop somebody
 * earning.
 */
export function cashCeilingBlocks(
  riderId: string,
  order: Pick<Order, 'paymentMethod'>
): { blocked: boolean; message: string | null } {
  if (order.paymentMethod !== 'CASH_ON_DELIVERY') return { blocked: false, message: null };
  const standing = cashStanding(riderId);
  if (standing.canTakeCod) return { blocked: false, message: null };
  return {
    blocked: true,
    message:
      standing.message || 'Deposit the cash you are carrying before taking another cash order.'
  };
}
