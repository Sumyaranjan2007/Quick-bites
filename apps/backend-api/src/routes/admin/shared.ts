/**
 * Shaping helpers shared by the admin routes.
 *
 * The console's job is to show the whole relationship — customer, restaurant,
 * rider and order in one place — so these assemble that view once rather than
 * leaving each screen to stitch four lookups together and disagree about what a
 * "complete" order looks like.
 */
import { memoryStore } from '../../db/client.ts';
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import { supportRepository } from '../../db/repositories/supportRepository.ts';
import { economicsOf } from '../../modules/admin/analytics.ts';
import type { Order, DeliveryRider, Restaurant } from '@quick-bites/shared-types';

/** A dated step in an order's life, built from the timestamps the order carries. */
export interface TimelineStep {
  label: string;
  at: string;
  detail?: string;
}

export function buildOrderTimeline(order: Order): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const push = (label: string, at?: string, detail?: string) => {
    if (at) steps.push({ label, at, detail });
  };

  push('Order placed', order.createdAt, `${order.items?.length || 0} item(s)`);
  push('Rider assigned', order.riderAssignedAt, order.riderName);
  push('Picked up from restaurant', order.pickedUpAt);
  push('Delivered', order.deliveredAt);
  push('Cancelled', order.cancelledAt, order.cancellationReason);
  push('Rated by customer', order.ratedAt, order.rating ? `${order.rating} star` : undefined);

  // The current status is shown last when nothing more specific is dated, so an
  // order sitting in PREPARING does not look as though nothing has happened
  // since it was placed.
  const dated = new Set(steps.map(s => s.label));
  if (!dated.has('Delivered') && !dated.has('Cancelled')) {
    steps.push({ label: `Currently ${order.status.replace(/_/g, ' ').toLowerCase()}`, at: order.updatedAt });
  }

  return steps.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function summariseOrder(order: Order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    customerId: order.customerId,
    customerName: order.customerName || 'Customer',
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName || 'Restaurant',
    riderId: order.riderId,
    riderName: order.riderName || null,
    itemCount: (order.items || []).reduce((n, i) => n + (i.quantity || 0), 0),
    totalAmount: Number(order.bill?.totalAmount) || 0,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    deliveredAt: order.deliveredAt,
    rating: order.rating,
    distanceKm: order.distanceKm
  };
}

/**
 * Everything about one order: who was involved, what was bought, what it cost,
 * how it progressed, and anything raised against it afterwards.
 */
export async function shapeOrderDetail(order: Order) {
  const customer = memoryStore.users.get(order.customerId);
  const restaurant = memoryStore.restaurants.get(order.restaurantId) as Restaurant | undefined;
  const rider = order.riderId ? (memoryStore.riders.get(order.riderId) as DeliveryRider | undefined) : undefined;

  const [refunds, tickets] = await Promise.all([
    refundRepository.listByOrder(order.id),
    supportRepository.list().then(all => all.filter(t => t.orderId === order.id))
  ]);

  const walletRefunds = Array.from(memoryStore.walletTransactions.values()).filter(
    (tx: any) => tx.orderId === order.id && tx.type === 'CREDIT'
  );

  return {
    order: {
      ...order,
      // The codes are operational secrets between the rider and the doorstep.
      // Support needs to know whether they were used, not what they are.
      pickupCode: undefined,
      deliveryOtp: undefined,
      pickupVerified: Boolean(order.pickedUpAt)
    },
    economics: economicsOf(order),
    timeline: buildOrderTimeline(order),
    customer: customer
      ? {
          id: customer.id,
          fullName: customer.fullName,
          email: customer.email,
          phone: customer.phone || order.customerPhone,
          isGold: customer.isGold,
          joinedAt: customer.createdAt,
          isBlocked: Boolean(customer.isBlocked)
        }
      : { id: order.customerId, fullName: order.customerName || 'Deleted account' },
    restaurant: restaurant
      ? {
          id: restaurant.id,
          name: restaurant.name,
          phone: restaurant.phone,
          addressLine: restaurant.addressLine,
          city: restaurant.city,
          status: restaurant.status,
          isOpen: restaurant.isOpen,
          ratingAverage: restaurant.ratingAverage
        }
      : null,
    rider: rider
      ? {
          id: rider.id,
          fullName: rider.fullName,
          driverCode: rider.driverCode,
          phone: rider.phone,
          vehicleType: rider.vehicleType,
          isOnline: rider.isOnline,
          kycStatus: rider.kycStatus,
          currentCoordinates: rider.currentCoordinates
        }
      : null,
    delivery: {
      addressText: order.deliveryAddressText,
      coordinates: order.deliveryCoordinates,
      riderCoordinates: order.riderCoordinates,
      riderStage: order.riderStage,
      distanceKm: order.distanceKm,
      locationUpdatedAt: order.riderLocationUpdatedAt
    },
    refundRequests: refunds,
    supportTickets: tickets,
    walletCredits: walletRefunds
  };
}

/** Case-insensitive contains, used by every list screen's search box. */
export function matchesQuery(query: string | undefined, ...fields: Array<string | undefined | null>): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some(field => String(field || '').toLowerCase().includes(needle));
}

/** Uniform paging so every list screen behaves the same way. */
export function paginate<T>(rows: T[], page = 1, pageSize = 25) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const start = (safePage - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / safeSize))
    }
  };
}
