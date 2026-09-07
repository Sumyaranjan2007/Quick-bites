import type { OrderStatus } from '@quick-bites/shared-types';

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PAYMENT_PENDING: ['ORDER_PLACED', 'CANCELLED'],
  ORDER_PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'RIDER_ASSIGNED', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'CANCELLED'],
  READY_FOR_PICKUP: ['RIDER_ASSIGNED', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  RIDER_ASSIGNED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: []
};

export function canTransition(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

export function validateTransition(currentStatus: OrderStatus, nextStatus: OrderStatus): void {
  if (!canTransition(currentStatus, nextStatus)) {
    throw new Error(`Invalid order status transition from ${currentStatus} to ${nextStatus}.`);
  }
}
