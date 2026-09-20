import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './apiFetch';

/**
 * Every order this customer has in flight right now.
 *
 * The app tracked exactly one: `activeOrder` was set when an order was placed
 * and replaced when the next one was. So placing a second order while the first
 * was still coming silently lost the first — it was still being cooked and
 * delivered, and the app simply stopped showing it. The only way back to it was
 * order history, which reads like a receipt rather than something happening now.
 *
 * Read from the server rather than remembered locally, because the set of live
 * orders survives the app being closed and does not survive a variable in
 * memory. That also makes this correct after a force-stop, which is exactly
 * when somebody reopens the app to ask where their food is.
 */

/** Statuses that mean "this is over": nothing more will happen to it. */
const TERMINAL = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);

export interface ActiveOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  total: number;
  otp: string;
  restaurantName: string;
  placedAt?: string;
}

export function useActiveOrders(apiUrl?: string, token?: string) {
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Guards a slow response from overwriting a fresher one. Two refreshes can be
  // in flight at once — a socket event and a screen focus land together often —
  // and without this the older answer sometimes wins and an order that has just
  // been delivered reappears in the bar.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!apiUrl || !token) {
      setOrders([]);
      setLoaded(true);
      return;
    }
    const mine = ++seq.current;
    try {
      const res = await apiFetch(`${apiUrl}/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (mine !== seq.current) return;
      if (!data?.success || !Array.isArray(data.data?.orders)) return;

      const live: ActiveOrder[] = data.data.orders
        .filter((o: any) => !TERMINAL.has(String(o.status)))
        .map((o: any) => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          status: String(o.status),
          total: Number(o.bill?.totalAmount) || 0,
          otp: o.deliveryOtp || '',
          restaurantName: o.restaurantName || 'Your order',
          placedAt: o.createdAt
        }))
        // Newest first, so the order somebody just placed is the one under
        // their thumb rather than the one at the far end of a scroll.
        .sort((a: ActiveOrder, b: ActiveOrder) =>
          String(b.placedAt || '').localeCompare(String(a.placedAt || ''))
        );

      setOrders(live);
    } catch {
      // Left as it was. An unreachable server is not evidence that an order
      // stopped existing, and clearing the bar here would tell somebody their
      // delivery had vanished because their train went into a tunnel.
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { orders, loaded, refresh };
}
