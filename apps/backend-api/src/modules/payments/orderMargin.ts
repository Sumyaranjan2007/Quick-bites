/**
 * What the platform keeps on one order, and which orders lost money (N11).
 *
 * One source: `splitForOrder`, the same function the ledger posts delivery
 * earnings from. The platform's contribution is the gross the customer paid,
 * less everything owed out of it — the kitchen, the rider, food GST, GST on
 * commission, TCS and TDS — which equals the commission plus the REVENUE_FEES
 * remainder the ledger books (negative when a coupon or membership cost more
 * than the order made). The gateway's fee is recorded separately at
 * settlement (W3) and is NOT in this figure; the report says so.
 */
import type { Order } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';
import { splitForOrder } from './earnings.ts';
import { toRupees } from './money.ts';
import { calculateTripPayout } from '../riders/tripPayout.ts';

export interface OrderMargin {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  restaurantName?: string;
  deliveredAt?: string;
  gross: number;
  contribution: number;
  couponCode?: string;
  couponDiscount: number;
  membershipDiscount: number;
  deliveryFee: number;
  riderCost: number;
}

/** The platform's contribution on an order, in paise. The rider's pay is estimated when not yet fixed. */
export function contributionPaise(order: Pick<Order, 'bill' | 'riderPayout' | 'distanceKm'> & Partial<Order>): number {
  const withRider = {
    ...order,
    riderPayout: order.riderPayout ?? calculateTripPayout({ distanceKm: order.distanceKm, bill: order.bill as any }) - (Number((order.bill as any)?.tipAmount) || 0)
  } as Order;
  const s = splitForOrder(withRider);
  return s.grossPaise - s.partnerPaise - s.riderPaise - s.gstOnFoodPaise - s.commissionGstPaise - s.tcsPaise - s.tdsPaise;
}

export function marginOf(order: Order): OrderMargin {
  const bill: any = order.bill || {};
  const s = splitForOrder(order);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    deliveredAt: order.deliveredAt,
    gross: toRupees(s.grossPaise),
    contribution: toRupees(contributionPaise(order)),
    couponCode: order.couponCode,
    couponDiscount: Number(bill.couponDiscount) || 0,
    membershipDiscount: Number(bill.membershipDiscount) || 0,
    deliveryFee: Number(bill.deliveryFee) || 0,
    riderCost: toRupees(s.riderPaise - s.tipPaise)
  };
}

/** Delivered orders in the window that cost the platform money, worst first. */
export function lossMakingOrders(sinceIso: string, untilIso: string = new Date().toISOString()): {
  orders: OrderMargin[];
  totalLoss: number;
  delivered: number;
} {
  const rows: OrderMargin[] = [];
  let delivered = 0;
  for (const order of memoryStore.orders.values() as Iterable<Order>) {
    if (order.status !== 'DELIVERED' || !order.deliveredAt) continue;
    if (order.deliveredAt < sinceIso || order.deliveredAt > untilIso) continue;
    delivered += 1;
    const m = marginOf(order);
    if (m.contribution < 0) rows.push(m);
  }
  rows.sort((a, b) => a.contribution - b.contribution);
  const totalLoss = Math.round(rows.reduce((t, r) => t - r.contribution, 0) * 100) / 100;
  return { orders: rows, totalLoss, delivered };
}
