/**
 * Authorization for real-time subscriptions.
 *
 * The REST layer has always been careful: every mutating route carries a
 * role-scoped `authMiddleware`, Zod validation and an ownership assertion. The
 * socket layer authenticated the connection and then trusted whatever room name
 * arrived next, which meant the same data the REST layer guards was readable by
 * asking for it over a socket instead:
 *
 *   - `join:order` with any id returned a stranger's order and, once a rider was
 *     moving, their live coordinates.
 *   - `join:restaurant` with any id returned whole order objects for every order
 *     a kitchen received — names, addresses, phone numbers, bills.
 *   - `join:admin` had no role check at all.
 *   - `join:riders` handed the broadcast queue to anyone.
 *   - `rider:location` accepted coordinates for any order from any socket.
 *
 * These predicates close that gap. They deliberately mirror the REST rules
 * rather than inventing parallel ones: a person may watch an order over a socket
 * exactly when they may read it over HTTP.
 *
 * Two details worth keeping in mind when editing:
 *
 * IDENTITY. `order.riderId` stores the rider ENTITY id, not the user id — see
 * `riderRouter` claiming a trip with `self.id`. A rider is therefore resolved
 * through `riderRepository.findByUserId` before any comparison. Comparing the
 * socket's user id to `order.riderId` directly would silently deny every rider.
 *
 * FAIL CLOSED. Every predicate returns a deny when a record is missing, when a
 * role is unrecognised, or when a lookup throws. A subscription is not worth an
 * exception path that leaks.
 */
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';

export type SocketRole = 'CUSTOMER' | 'RESTAURANT_PARTNER' | 'DELIVERY_PARTNER' | 'ADMIN';

export interface SocketIdentity {
  userId: string;
  role: SocketRole;
}

export interface AccessDecision {
  allowed: boolean;
  /** Machine-readable reason, logged on refusal. Never sent to the client verbatim. */
  reason?: string;
}

const ALLOW: AccessDecision = { allowed: true };
const deny = (reason: string): AccessDecision => ({ allowed: false, reason });

/**
 * May this identity watch this order?
 *
 * Its customer, the kitchen cooking it, the rider carrying it, or an
 * administrator. Nobody else, including a customer who once had a different
 * order from the same restaurant.
 */
export async function canJoinOrder(user: SocketIdentity, orderId: string): Promise<AccessDecision> {
  try {
    if (user.role === 'ADMIN') return ALLOW;

    const order = await orderRepository.findById(orderId);
    if (!order) return deny('ORDER_NOT_FOUND');

    switch (user.role) {
      case 'CUSTOMER':
        return order.customerId === user.userId ? ALLOW : deny('NOT_ORDER_CUSTOMER');

      case 'RESTAURANT_PARTNER': {
        const restaurant = await restaurantRepository.findById(order.restaurantId);
        if (!restaurant) return deny('RESTAURANT_NOT_FOUND');
        return restaurant.ownerId === user.userId ? ALLOW : deny('NOT_ORDER_RESTAURANT');
      }

      case 'DELIVERY_PARTNER': {
        const rider = await riderRepository.findByUserId(user.userId);
        if (!rider) return deny('NO_RIDER_PROFILE');
        // An order is offered to several riders before one claims it. Only the
        // rider who actually holds the trip may watch it.
        return order.riderId === rider.id ? ALLOW : deny('NOT_ASSIGNED_RIDER');
      }

      default:
        return deny('UNKNOWN_ROLE');
    }
  } catch {
    return deny('LOOKUP_FAILED');
  }
}

/**
 * May this identity watch a kitchen's live order feed?
 *
 * The owning partner or an administrator. This room carries whole order objects,
 * so it is the most sensitive of the four.
 */
export async function canJoinRestaurant(
  user: SocketIdentity,
  restaurantId: string
): Promise<AccessDecision> {
  try {
    if (user.role === 'ADMIN') return ALLOW;
    if (user.role !== 'RESTAURANT_PARTNER') return deny('NOT_A_PARTNER');

    const restaurant = await restaurantRepository.findById(restaurantId);
    if (!restaurant) return deny('RESTAURANT_NOT_FOUND');

    return restaurant.ownerId === user.userId ? ALLOW : deny('NOT_RESTAURANT_OWNER');
  } catch {
    return deny('LOOKUP_FAILED');
  }
}

/**
 * May this identity watch a restaurant's menu changes?
 *
 * Anyone signed in. This is the customer-facing room and carries only stock and
 * kitchen-open flags — deliberately not the `restaurant:` room, which carries
 * orders. The separation already existed; it is asserted here so a later edit
 * cannot quietly merge the two.
 */
export function canJoinMenu(user: SocketIdentity): AccessDecision {
  return user.userId ? ALLOW : deny('NOT_AUTHENTICATED');
}

/** Only administrators may enter the control tower. */
export function canJoinAdmin(user: SocketIdentity): AccessDecision {
  return user.role === 'ADMIN' ? ALLOW : deny('NOT_ADMIN');
}

/**
 * May this identity sit in the pool that receives delivery offers?
 *
 * A delivery partner who is on shift. Offers carry the pickup restaurant, the
 * drop address and the payout, so an off-shift rider — or anyone else — has no
 * business receiving them.
 */
export async function canJoinRidersPool(user: SocketIdentity): Promise<AccessDecision> {
  try {
    if (user.role !== 'DELIVERY_PARTNER') return deny('NOT_A_RIDER');

    const rider = await riderRepository.findByUserId(user.userId);
    if (!rider) return deny('NO_RIDER_PROFILE');
    if (!rider.isOnline) return deny('RIDER_OFF_SHIFT');

    return ALLOW;
  } catch {
    return deny('LOOKUP_FAILED');
  }
}

/** Statuses during which a customer is entitled to see the rider moving. */
const TRACKABLE_STATUSES = new Set(['OUT_FOR_DELIVERY']);

/**
 * May this identity publish live coordinates for this order?
 *
 * Only the rider actually carrying it, and only once the food is on its way.
 *
 * The second condition is the product behaviour the owner asked for — the map
 * appears after pickup, as it does on Zomato — and it is also a privacy rule: a
 * rider's position before they have collected an order is their own business,
 * not the customer's. Restricting the publisher to the assigned rider closes the
 * matching hole in the other direction, where anyone could inject fabricated
 * coordinates into a stranger's tracking screen.
 */
export async function canStreamRiderLocation(
  user: SocketIdentity,
  orderId: string
): Promise<AccessDecision> {
  try {
    if (user.role !== 'DELIVERY_PARTNER') return deny('NOT_A_RIDER');

    const order = await orderRepository.findById(orderId);
    if (!order) return deny('ORDER_NOT_FOUND');

    const rider = await riderRepository.findByUserId(user.userId);
    if (!rider) return deny('NO_RIDER_PROFILE');
    if (order.riderId !== rider.id) return deny('NOT_ASSIGNED_RIDER');

    if (!TRACKABLE_STATUSES.has(order.status)) return deny('NOT_YET_PICKED_UP');

    return ALLOW;
  } catch {
    return deny('LOOKUP_FAILED');
  }
}

/**
 * Coordinates that a map can actually plot.
 *
 * NaN and Infinity survive JSON and a plain `typeof === 'number'` test, and
 * reach the client as a broken marker rather than an error anyone would notice.
 */
export function isPlottableCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}
