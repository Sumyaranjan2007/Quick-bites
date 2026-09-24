/**
 * Fixtures that belong to one check, and are awkward to share.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * Five times across three workstreams, a check quietly stopped testing what its
 * name claimed because it shared a mutable fixture with another check:
 *
 *   - itemPricing: a later section rewrote the first restaurant's first dish to
 *     Rs 200, and that dish WAS the biryani two earlier checks asserted on.
 *   - itemPricing again: new checks changed `foodMarkupPercent` and two older
 *     ones inherited it.
 *   - riderTripPush, twice: two checks reused an order that riders had already
 *     been offered, so W1.2's new never-re-wake rule excluded them and each was
 *     asking a different question than its name.
 *   - adminPush: a block inserted between a setup and its assertions would have
 *     emptied the capture list the nine-event check reads.
 *
 * Every one was caught by the check FAILING rather than by anybody reviewing it,
 * which is luck. The rule "a check asserting exact rupees must own every number
 * it depends on" has been written down twice and broken five times, so it needs
 * to be mechanical.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS DOES ABOUT IT
 * -------------------------------------------------------------------------
 * Every fixture gets a unique id from a counter, so two calls cannot collide even
 * with identical arguments. There is no "get me the existing one" function and no
 * cache: the only way to use this is to make a new one, which is the point.
 *
 * It deliberately does NOT clean up. A suite that deletes its fixtures hides the
 * ordering bugs this is meant to prevent — a check that only passes because an
 * earlier one tidied up is the same class of problem pointing the other way.
 */
import { memoryStore } from '../../db/client.ts';
import type { Order } from '@quick-bites/shared-types';

let counter = 0;

/** A suffix nothing else in the store will have. */
function uniqueSuffix(label: string): string {
  counter += 1;
  return `${label}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface OwnOrderOptions {
  restaurantId: string;
  restaurantName?: string;
  restaurantCoordinates?: { latitude: number; longitude: number };
  customerId?: string;
  status?: Order['status'];
  riderId?: string;
  riderStage?: Order['riderStage'];
  paymentMethod?: Order['paymentMethod'];
  totalAmount?: number;
  /** Anything else this particular check needs to own. */
  extra?: Record<string, unknown>;
}

/**
 * An order no other check has touched, written into the store and returned.
 *
 * The id carries a counter, so calling this twice with identical arguments gives
 * two distinct orders. That is the whole mechanism: sharing requires passing the
 * object around deliberately, and a second call can never accidentally return the
 * first one.
 */
export function ownOrder(label: string, options: OwnOrderOptions): any {
  const id = `ord_${uniqueSuffix(label)}`;
  const now = new Date().toISOString();

  const order: any = {
    id,
    orderNumber: `QB-${id.slice(-8).toUpperCase()}`,
    customerId: options.customerId || 'usr_customer_01',
    restaurantId: options.restaurantId,
    restaurantName: options.restaurantName || 'Test Kitchen',
    ...(options.restaurantCoordinates ? { restaurantCoordinates: options.restaurantCoordinates } : {}),
    status: options.status || 'READY_FOR_PICKUP',
    paymentMethod: options.paymentMethod || 'ONLINE',
    bill: { totalAmount: options.totalAmount ?? 400 },
    /*
     * Empty rather than absent. An order whose `offeredToRiderIds` is undefined
     * behaves the same as one with none today, but a check that asserts "nobody
     * has been offered this" reads better against an explicit empty list — and
     * two of the five incidents above were exactly this field carrying history.
     */
    offeredToRiderIds: [],
    declinedByRiderIds: [],
    createdAt: now,
    updatedAt: now,
    ...(options.riderId ? { riderId: options.riderId } : {}),
    ...(options.riderStage ? { riderStage: options.riderStage } : {}),
    ...(options.extra || {})
  };

  memoryStore.orders.set(id, order);
  return order;
}

export interface OwnRiderOptions {
  isOnline?: boolean;
  cashInHand?: number;
  coordinates?: { latitude: number; longitude: number };
  extra?: Record<string, unknown>;
}

/**
 * A rider, and the user account behind them, that no other check has touched.
 *
 * Both together because a rider with no user is a rider no notification can
 * reach, and every check that has ever needed a rider has then needed the user.
 */
export function ownRider(label: string, options: OwnRiderOptions = {}): any {
  const id = `rdr_${uniqueSuffix(label)}`;
  const userId = `usr_${id}`;
  const now = new Date().toISOString();

  const rider: any = {
    id,
    userId,
    fullName: label,
    phone: '9800000000',
    isOnline: options.isOnline ?? true,
    codCashInHand: options.cashInHand ?? 0,
    kycStatus: 'ACTIVE',
    driverCode: 'QB-OWN',
    profilePhotoUrl: 'https://example.test/p.png',
    ...(options.coordinates ? { currentCoordinates: options.coordinates } : {}),
    createdAt: now,
    ...(options.extra || {})
  };

  memoryStore.riders.set(id, rider);
  memoryStore.users.set(userId, {
    id: userId,
    email: `${id}@own.test`,
    fullName: label,
    role: 'rider',
    createdAt: now
  } as any);

  return rider;
}

/**
 * Puts every rider NOT created by this helper off shift.
 *
 * For any check asserting who was notified. The seed's riders are online and
 * would otherwise be woken alongside the fixture's, turning "only the eligible
 * rider was told" into a statement about a list somebody else controls.
 */
export function onlyOwnRidersOnline(): void {
  for (const rider of memoryStore.riders.values() as any) {
    if (!String(rider.id).includes('_')) continue;
    if (!String(rider.id).startsWith('rdr_') || !String(rider.userId || '').startsWith('usr_rdr_')) {
      rider.isOnline = false;
    }
  }
}
