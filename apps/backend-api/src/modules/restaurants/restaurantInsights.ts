import type { Order, RestaurantMenu } from '@quick-bites/shared-types';

/**
 * Everything the partner dashboard reports, derived from orders that actually
 * exist.
 *
 * Every figure here is computed from the order records at request time. The
 * partner web console previously displayed a fabricated "net payout" and invented
 * counts, which is worse than showing nothing: a partner reconciles their bank
 * statement against these numbers.
 */

/** Money is only counted once an order is delivered. */
const EARNING_STATUSES = new Set(['DELIVERED']);

export interface RevenuePoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface DishPerformance {
  dishId: string;
  name: string;
  unitsSold: number;
  revenue: number;
}

export interface CategoryPerformance {
  categoryName: string;
  unitsSold: number;
  revenue: number;
}

export interface RestaurantDashboard {
  revenue: {
    /** What the restaurant keeps, after platform commission. */
    netPayout: number;
    /** What customers were charged in total, before deductions. */
    grossSales: number;
    today: number;
    last7Days: number;
    last30Days: number;
    averageOrderValue: number;
  };
  orders: {
    total: number;
    delivered: number;
    cancelled: number;
    active: number;
    today: number;
    /** Delivered as a share of everything that reached a terminal state. */
    completionRate: number;
  };
  ratings: {
    average: number | null;
    count: number;
    /** Counts for 1..5 stars, index 0 is one star. */
    distribution: number[];
  };
  preparation: {
    averageMinutes: number | null;
    ordersMeasured: number;
  };
  topDishes: DishPerformance[];
  categories: CategoryPerformance[];
  revenueTrend: RevenuePoint[];
  menu: {
    totalItems: number;
    availableItems: number;
    outOfStockItems: number;
    /** Items that have never been ordered — candidates to drop or promote. */
    neverOrdered: number;
  };
}

function istDateKey(iso: string): string {
  // Reported in IST, since the restaurants and their trading day are in India.
  const date = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildRestaurantDashboard(
  orders: Order[],
  menu: RestaurantMenu | null,
  now: Date = new Date()
): RestaurantDashboard {
  const todayKey = istDateKey(now.toISOString());
  const msDay = 24 * 60 * 60 * 1000;
  const since = (days: number) => new Date(now.getTime() - days * msDay).getTime();

  const delivered = orders.filter(o => EARNING_STATUSES.has(o.status));
  const cancelled = orders.filter(o => o.status === 'CANCELLED' || o.status === 'REFUNDED');
  const active = orders.filter(
    o => !EARNING_STATUSES.has(o.status) && o.status !== 'CANCELLED' && o.status !== 'REFUNDED'
  );

  const netOf = (o: Order) => Number(o.bill?.restaurantNetPayout) || 0;
  const grossOf = (o: Order) => Number(o.bill?.totalAmount) || 0;

  const netPayout = delivered.reduce((sum, o) => sum + netOf(o), 0);
  const grossSales = delivered.reduce((sum, o) => sum + grossOf(o), 0);

  const inWindow = (o: Order, days: number) => new Date(o.createdAt).getTime() >= since(days);
  const revenueToday = delivered
    .filter(o => istDateKey(o.createdAt) === todayKey)
    .reduce((sum, o) => sum + netOf(o), 0);

  // Dish and category performance, counted from what was actually sold.
  const dishTotals = new Map<string, DishPerformance>();
  for (const order of delivered) {
    for (const item of order.items || []) {
      const existing = dishTotals.get(item.dishId) || {
        dishId: item.dishId,
        name: item.name,
        unitsSold: 0,
        revenue: 0
      };
      existing.unitsSold += item.quantity;
      existing.revenue += Number(item.totalPrice) || 0;
      dishTotals.set(item.dishId, existing);
    }
  }

  // A dish's category comes from the menu, so a dish that has since been recategorised
  // reports under where it lives now rather than where it was sold from.
  const categoryOfDish = new Map<string, string>();
  let totalItems = 0;
  let availableItems = 0;
  for (const category of menu?.categories || []) {
    for (const item of category.items || []) {
      categoryOfDish.set(item.id, category.name);
      totalItems += 1;
      if (item.isAvailable) availableItems += 1;
    }
  }

  const categoryTotals = new Map<string, CategoryPerformance>();
  for (const dish of dishTotals.values()) {
    const name = categoryOfDish.get(dish.dishId) || 'Uncategorised';
    const existing = categoryTotals.get(name) || { categoryName: name, unitsSold: 0, revenue: 0 };
    existing.unitsSold += dish.unitsSold;
    existing.revenue += dish.revenue;
    categoryTotals.set(name, existing);
  }

  // Fourteen days of trend, including days with no trade so the shape is honest.
  const revenueTrend: RevenuePoint[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const key = istDateKey(new Date(now.getTime() - i * msDay).toISOString());
    const dayOrders = delivered.filter(o => istDateKey(o.createdAt) === key);
    revenueTrend.push({
      date: key,
      revenue: roundMoney(dayOrders.reduce((sum, o) => sum + netOf(o), 0)),
      orders: dayOrders.length
    });
  }

  const rated = orders.filter(o => typeof o.rating === 'number');
  const distribution = [0, 0, 0, 0, 0];
  for (const order of rated) {
    const star = Math.min(5, Math.max(1, Math.round(order.rating as number)));
    distribution[star - 1] += 1;
  }

  const prepped = delivered.filter(o => typeof o.preparationMinutes === 'number');
  const terminal = delivered.length + cancelled.length;

  return {
    revenue: {
      netPayout: roundMoney(netPayout),
      grossSales: roundMoney(grossSales),
      today: roundMoney(revenueToday),
      last7Days: roundMoney(delivered.filter(o => inWindow(o, 7)).reduce((s, o) => s + netOf(o), 0)),
      last30Days: roundMoney(delivered.filter(o => inWindow(o, 30)).reduce((s, o) => s + netOf(o), 0)),
      averageOrderValue: delivered.length ? roundMoney(grossSales / delivered.length) : 0
    },
    orders: {
      total: orders.length,
      delivered: delivered.length,
      cancelled: cancelled.length,
      active: active.length,
      today: orders.filter(o => istDateKey(o.createdAt) === todayKey).length,
      completionRate: terminal ? Math.round((delivered.length / terminal) * 100) : 0
    },
    ratings: {
      average: rated.length
        ? Math.round((rated.reduce((s, o) => s + (o.rating as number), 0) / rated.length) * 10) / 10
        : null,
      count: rated.length,
      distribution
    },
    preparation: {
      averageMinutes: prepped.length
        ? Math.round(prepped.reduce((s, o) => s + (o.preparationMinutes as number), 0) / prepped.length)
        : null,
      ordersMeasured: prepped.length
    },
    topDishes: [...dishTotals.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10),
    categories: [...categoryTotals.values()].sort((a, b) => b.revenue - a.revenue),
    revenueTrend,
    menu: {
      totalItems,
      availableItems,
      outOfStockItems: totalItems - availableItems,
      neverOrdered: [...categoryOfDish.keys()].filter(id => !dishTotals.has(id)).length
    }
  };
}
