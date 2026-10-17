/**
 * Puts a running one-rider offer on a trip (master plan B4), as dispatch would, so a
 * suite about something else can have its rider accept. Since 18 Oct 2026 only the
 * rider holding the offer may claim (`OFFER_NOT_YOURS` otherwise); dispatch itself is
 * checked in `riderTripPush`.
 *
 * Takes a rider record id or the rider's user id.
 */
import { memoryStore } from '../../db/client.ts';

export function offerTo(orderId: string, rider: string, seconds = 108): void {
  const order: any = memoryStore.orders.get(orderId);
  if (!order) throw new Error(`offerTo: no order ${orderId}`);
  const record: any =
    memoryStore.riders.get(rider) ?? Array.from(memoryStore.riders.values()).find((r: any) => r.userId === rider);
  if (!record) throw new Error(`offerTo: no rider ${rider}`);
  const now = Date.now();
  order.riderOffer = {
    riderId: record.id,
    offeredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + seconds * 1000).toISOString(),
    round: (order.riderOffer?.round || 0) + 1
  };
}
