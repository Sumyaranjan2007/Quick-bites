/**
 * Every number the admin console puts on a card or a chart.
 *
 * Derived from the orders, riders and restaurants themselves on each request
 * rather than from counters maintained alongside them. Counters drift: a refund
 * issued from one screen and a cancellation from another both have to remember
 * to decrement, and the first one that forgets leaves the dashboard quietly
 * wrong. At the current volume a full scan costs less than the bugs would.
 *
 * Money is split the way it is actually earned. GST is collected for the
 * government and is not platform revenue; the restaurant's share and the rider's
 * payout are costs of the order; what is left — commission, platform fee and the
 * margin on delivery, less any discount the platform funded — is the take.
 */
import type { Order, Restaurant, DeliveryRider } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';
import { getActiveRates } from '../payments/pricingConfig.ts';

const IST_OFFSET_MINUTES = 330;

export function istDayStart(at: Date = new Date()): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnight - IST_OFFSET_MINUTES * 60_000);
}

export function istDayKey(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);
export const LIVE_STATUSES = new Set([
  'ORDER_PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'RIDER_ASSIGNED',
  'OUT_FOR_DELIVERY'
]);
/** A trip a rider is physically on, as opposed to one still in the kitchen. */
export const IN_TRANSIT_STATUSES = new Set(['RIDER_ASSIGNED', 'OUT_FOR_DELIVERY']);

export interface OrderEconomics {
  gross: number;
  commission: number;
  platformFee: number;
  deliveryFee: number;
  riderPayout: number;
  restaurantPayout: number;
  tax: number;
  discount: number;
  /** What the platform keeps once partners and riders are paid. */
  netRevenue: number;
}

/**
 * What the platform took from one order.
 *
 * This used to be `itemsTotal * 0.15` against a `COMMISSION_RATE` declared in
 * this file — a second copy of a number that also lived in the pricing engine.
 * Two copies of one business rule is how a revenue report and a settlement stop
 * describing the same business without anybody noticing.
 *
 * The order's own frozen figure is the authority now. It is what the kitchen
 * was actually charged, at whatever rate that kitchen was on at the time, and
 * no later rate change can rewrite it. Orders placed before the field existed
 * fall back to the rate in force — the closest honest answer available for an
 * order that never recorded one.
 */
export function economicsOf(order: Order): OrderEconomics {
  const bill = order.bill || ({} as any);
  const itemsTotal = Number(bill.itemsTotal) || 0;
  const frozen = Number((bill as any).commissionAmount);
  const commission = Number.isFinite(frozen) && frozen >= 0
    ? frozen
    : Math.round(itemsTotal * (getActiveRates().defaultCommissionPercent / 100) * 100) / 100;
  const platformFee = Number(bill.platformFee) || 0;
  const deliveryFee = Number(bill.deliveryFee) || 0;
  const riderPayout = Number(order.riderPayout) || 0;
  const discount = Number(bill.couponDiscount) || 0;
  const netRevenue =
    Math.round((commission + platformFee + deliveryFee - riderPayout - discount) * 100) / 100;

  return {
    gross: Number(bill.totalAmount) || 0,
    commission,
    platformFee,
    deliveryFee,
    riderPayout,
    restaurantPayout: Number(bill.restaurantNetPayout) || 0,
    tax: Number(bill.gstAmount) || 0,
    discount,
    netRevenue
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DashboardSnapshot {
  orders: {
    total: number;
    today: number;
    completed: number;
    cancelled: number;
    refunded: number;
    live: number;
    inTransit: number;
    completionRate: number;
    cancellationRate: number;
    averageOrderValue: number;
  };
  people: {
    totalCustomers: number;
    newCustomersToday: number;
    totalDrivers: number;
    activeDrivers: number;
    onlineDrivers: number;
    totalRestaurants: number;
    activeRestaurants: number;
    openRestaurants: number;
  };
  money: {
    grossMerchandiseValue: number;
    gmvToday: number;
    netRevenue: number;
    netRevenueToday: number;
    commission: number;
    deliveryFees: number;
    platformFees: number;
    taxCollected: number;
    discountsGiven: number;
    restaurantPayable: number;
    riderPayable: number;
    refundedAmount: number;
  };
  payments: {
    paid: number;
    pending: number;
    failed: number;
    refunded: number;
    codOrders: number;
    onlineOrders: number;
    walletOrders: number;
    codCashInHand: number;
  };
  queues: {
    pendingKyc: number;
    pendingMenuRequests: number;
    openRefundRequests: number;
    openSupportTickets: number;
    openSosAlerts: number;
    pendingPayouts: number;
    pendingPayoutAmount: number;
  };
  catalogue: {
    categories: number;
    activeCoupons: number;
    totalCoupons: number;
    menuItems: number;
  };
  reviews: {
    total: number;
    averageRating: number;
    lowRated: number;
  };
  generatedAt: string;
}

export function buildDashboard(): DashboardSnapshot {
  const orders = Array.from(memoryStore.orders.values()) as Order[];
  const restaurants = Array.from(memoryStore.restaurants.values()) as Restaurant[];
  const riders = Array.from(memoryStore.riders.values()) as DeliveryRider[];
  const users = Array.from(memoryStore.users.values());

  const dayStart = istDayStart().getTime();
  const isToday = (iso?: string) => Boolean(iso) && new Date(iso!).getTime() >= dayStart;

  const delivered = orders.filter(o => o.status === 'DELIVERED');
  const cancelled = orders.filter(o => o.status === 'CANCELLED');
  const refunded = orders.filter(o => o.status === 'REFUNDED');
  const live = orders.filter(o => LIVE_STATUSES.has(o.status));
  const inTransit = orders.filter(o => IN_TRANSIT_STATUSES.has(o.status));
  const ordersToday = orders.filter(o => isToday(o.createdAt));

  // Revenue is recognised on delivery. Counting an order the moment it is placed
  // would report money the platform has not earned and may have to give back.
  const earning = delivered.map(economicsOf);
  const earningToday = delivered.filter(o => isToday(o.deliveredAt || o.updatedAt)).map(economicsOf);
  const sum = (rows: OrderEconomics[], key: keyof OrderEconomics) =>
    round(rows.reduce((total, row) => total + (row[key] as number), 0));

  const gmv = sum(earning, 'gross');
  const customers = users.filter(u => u.role === 'customer');

  const refundRequests = Array.from(memoryStore.refundRequests.values());
  const supportTickets = Array.from(memoryStore.supportTickets.values());
  const payouts = Array.from(memoryStore.payouts.values());
  const pendingPayouts = payouts.filter(p => p.status === 'PENDING' || p.status === 'PROCESSING');

  const rated = orders.filter(o => typeof o.rating === 'number');
  const menuItemCount = Array.from(memoryStore.menus.values()).reduce(
    (total: number, menu: any) =>
      total + (menu.categories || []).reduce((n: number, c: any) => n + (c.items?.length || 0), 0),
    0
  );

  const coupons = Array.from(memoryStore.coupons.values());

  return {
    orders: {
      total: orders.length,
      today: ordersToday.length,
      completed: delivered.length,
      cancelled: cancelled.length,
      refunded: refunded.length,
      live: live.length,
      inTransit: inTransit.length,
      completionRate: orders.length ? round((delivered.length / orders.length) * 100) : 0,
      cancellationRate: orders.length ? round((cancelled.length / orders.length) * 100) : 0,
      averageOrderValue: delivered.length ? round(gmv / delivered.length) : 0
    },
    people: {
      totalCustomers: customers.length,
      newCustomersToday: customers.filter(u => isToday(u.createdAt)).length,
      totalDrivers: riders.length,
      activeDrivers: riders.filter(r => r.kycStatus === 'ACTIVE').length,
      onlineDrivers: riders.filter(r => r.isOnline && r.kycStatus === 'ACTIVE').length,
      totalRestaurants: restaurants.length,
      activeRestaurants: restaurants.filter(r => r.status === 'ACTIVE').length,
      openRestaurants: restaurants.filter(r => r.status === 'ACTIVE' && r.isOpen).length
    },
    money: {
      grossMerchandiseValue: gmv,
      gmvToday: sum(earningToday, 'gross'),
      netRevenue: sum(earning, 'netRevenue'),
      netRevenueToday: sum(earningToday, 'netRevenue'),
      commission: sum(earning, 'commission'),
      deliveryFees: sum(earning, 'deliveryFee'),
      platformFees: sum(earning, 'platformFee'),
      taxCollected: sum(earning, 'tax'),
      discountsGiven: sum(earning, 'discount'),
      restaurantPayable: sum(earning, 'restaurantPayout'),
      riderPayable: sum(earning, 'riderPayout'),
      refundedAmount: round(
        refunded.reduce((total, o) => total + (Number(o.bill?.totalAmount) || 0), 0)
      )
    },
    payments: {
      paid: orders.filter(o => o.paymentStatus === 'PAID').length,
      pending: orders.filter(o => o.paymentStatus === 'PENDING').length,
      failed: orders.filter(o => o.paymentStatus === 'FAILED').length,
      refunded: orders.filter(o => o.paymentStatus === 'REFUNDED').length,
      codOrders: orders.filter(o => o.paymentMethod === 'CASH_ON_DELIVERY').length,
      onlineOrders: orders.filter(o => o.paymentMethod === 'RAZORPAY_SANDBOX').length,
      walletOrders: orders.filter(o => o.paymentMethod === 'WALLET' || o.paymentMethod === 'SPLIT').length,
      codCashInHand: round(riders.reduce((total, r) => total + (Number(r.codCashInHand) || 0), 0))
    },
    queues: {
      pendingKyc: Array.from(memoryStore.kycDocuments.values()).filter((d: any) => d.status === 'PENDING').length,
      pendingMenuRequests: Array.from(memoryStore.menuRequests.values()).filter((r: any) => r.status === 'PENDING').length,
      openRefundRequests: refundRequests.filter((r: any) => r.status === 'REQUESTED' || r.status === 'PROCESSING').length,
      openSupportTickets: supportTickets.filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length,
      openSosAlerts: Array.from(memoryStore.sosAlerts.values()).filter((a: any) => a.status === 'OPEN').length,
      pendingPayouts: pendingPayouts.length,
      pendingPayoutAmount: round(pendingPayouts.reduce((total: number, p: any) => total + (p.netAmount || 0), 0))
    },
    catalogue: {
      categories: memoryStore.categories.size,
      activeCoupons: coupons.filter((c: any) => c.isActive).length,
      totalCoupons: coupons.length,
      menuItems: menuItemCount
    },
    reviews: {
      total: rated.length,
      averageRating: rated.length
        ? round(rated.reduce((total, o) => total + (o.rating || 0), 0) / rated.length)
        : 0,
      lowRated: rated.filter(o => (o.rating || 5) <= 2).length
    },
    generatedAt: new Date().toISOString()
  };
}

export interface RevenuePoint {
  date: string;
  orders: number;
  gross: number;
  netRevenue: number;
  commission: number;
  refunds: number;
}

/** Day-by-day revenue for the last `days` IST days, oldest first. */
export function revenueSeries(days = 14): RevenuePoint[] {
  const orders = Array.from(memoryStore.orders.values()) as Order[];
  const buckets = new Map<string, RevenuePoint>();

  const today = istDayStart();
  for (let i = days - 1; i >= 0; i--) {
    const key = istDayKey(new Date(today.getTime() - i * 86_400_000));
    buckets.set(key, { date: key, orders: 0, gross: 0, netRevenue: 0, commission: 0, refunds: 0 });
  }

  for (const order of orders) {
    const key = istDayKey(order.deliveredAt || order.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    if (order.status === 'DELIVERED') {
      const economics = economicsOf(order);
      bucket.orders += 1;
      bucket.gross = round(bucket.gross + economics.gross);
      bucket.netRevenue = round(bucket.netRevenue + economics.netRevenue);
      bucket.commission = round(bucket.commission + economics.commission);
    } else if (order.status === 'REFUNDED') {
      bucket.refunds = round(bucket.refunds + (Number(order.bill?.totalAmount) || 0));
    }
  }

  return Array.from(buckets.values());
}

/** Totals over a named window, for the revenue screen's period switcher. */
export function revenueForPeriod(period: 'today' | 'week' | 'month' | 'all') {
  const now = Date.now();
  const spans: Record<string, number> = {
    today: now - istDayStart().getTime(),
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    all: Number.MAX_SAFE_INTEGER
  };
  const since = period === 'all' ? 0 : now - spans[period];

  const delivered = (Array.from(memoryStore.orders.values()) as Order[]).filter(
    o => o.status === 'DELIVERED' && new Date(o.deliveredAt || o.updatedAt).getTime() >= since
  );
  const rows = delivered.map(economicsOf);
  const total = (key: keyof OrderEconomics) =>
    round(rows.reduce((sum, row) => sum + (row[key] as number), 0));

  return {
    period,
    orders: delivered.length,
    gross: total('gross'),
    netRevenue: total('netRevenue'),
    commission: total('commission'),
    deliveryFees: total('deliveryFee'),
    platformFees: total('platformFee'),
    taxCollected: total('tax'),
    discounts: total('discount'),
    restaurantPayout: total('restaurantPayout'),
    riderPayout: total('riderPayout'),
    averageOrderValue: delivered.length ? round(total('gross') / delivered.length) : 0
  };
}
