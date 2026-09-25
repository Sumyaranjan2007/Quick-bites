/**
 * A kitchen that keeps rejecting orders (A6).
 *
 * Every rejection is refunded in full and the platform eats any coupon, so a
 * kitchen that rejects often costs money and customers. The rate was shown on
 * its admin page and nothing acted on it. Now, when a restaurant rejects at
 * least the owner's `rejectionAlertPercent` of its last 20 orders (and has had
 * at least 5), the control room is alerted, once a day per kitchen.
 *
 * Closing the kitchen automatically is a business decision, so it happens only
 * when the owner sets `rejectionAutoPause` to 1. It is off by default, and a
 * closed kitchen is reopened by staff, never by this.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { getActiveRates } from '../payments/pricingConfig.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import type { Order } from '@quick-bites/shared-types';

const WINDOW = 20;
const MIN_ORDERS = 5;

export function recentRejectionRate(restaurantId: string): { orders: number; rejected: number; percent: number } {
  const recent = (Array.from(memoryStore.orders.values()) as Order[])
    .filter(o => o.restaurantId === restaurantId && o.status !== 'PAYMENT_PENDING')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, WINDOW);
  const rejected = recent.filter(o => o.cancelledByRole === 'restaurant_owner').length;
  return {
    orders: recent.length,
    rejected,
    percent: recent.length ? Math.round((rejected / recent.length) * 1000) / 10 : 0
  };
}

/** Called after a kitchen rejects or cancels an order. Never throws. */
export function watchRejections(restaurantId: string): 'none' | 'alerted' | 'paused' {
  try {
    const rates = getActiveRates();
    const threshold = Number(rates.rejectionAlertPercent) || 0;
    if (threshold <= 0) return 'none';

    const rate = recentRejectionRate(restaurantId);
    if (rate.orders < MIN_ORDERS || rate.percent < threshold) return 'none';

    const restaurant = memoryStore.restaurants.get(restaurantId) as any;
    if (!restaurant) return 'none';
    const today = new Date().toISOString().slice(0, 10);
    const pause = Number(rates.rejectionAutoPause) === 1 && restaurant.isOpen !== false;
    if (restaurant.rejectionAlertedOn === today && !pause) return 'none';

    restaurant.rejectionAlertedOn = today;
    if (pause) {
      restaurant.isOpen = false;
      restaurant.pausedForRejectionsAt = new Date().toISOString();
    }
    memoryStore.restaurants.set(restaurantId, restaurant);
    triggerAutoSave();

    emitOpsAlert({
      kind: 'KITCHEN_REJECTING',
      restaurantId,
      restaurantName: restaurant.name,
      detail:
        `${restaurant.name} rejected ${rate.rejected} of its last ${rate.orders} orders (${rate.percent}%). ` +
        (pause
          ? 'The kitchen was closed automatically; reopen it once you have spoken to them.'
          : 'Call the kitchen to find out why.'),
      raisedAt: new Date().toISOString()
    });
    return pause ? 'paused' : 'alerted';
  } catch {
    return 'none';
  }
}
