import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { Order, OrderStatus } from '@quick-bites/shared-types';

export const orderRepository = {
  async findById(id: string): Promise<Order | null> {
    return memoryStore.orders.get(id) || null;
  },

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    for (const order of memoryStore.orders.values()) {
      if (order.idempotencyKey === key) return order;
    }
    return null;
  },

  async create(order: Order): Promise<Order> {
    // Generate authoritative 4-digit pickup code & 4-digit delivery OTP if not provided
    if (!order.pickupCode) {
      order.pickupCode = crypto.randomInt(1000, 10000).toString();
    }
    if (!order.deliveryOtp) {
      order.deliveryOtp = crypto.randomInt(1000, 10000).toString();
    }
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();
    return order;
  },

  async updateStatus(id: string, status: OrderStatus, prepMinutes?: number): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    order.status = status;
    if (prepMinutes !== undefined) {
      order.preparationMinutes = prepMinutes;
    }
    if (status === 'DELIVERED') {
      order.deliveredAt = new Date().toISOString();
      order.paymentStatus = 'PAID';
    }
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  async assignRider(
    id: string,
    riderId: string,
    riderName: string,
    riderPhone?: string
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;

    // Atomic check: if already claimed, return null
    if (order.riderId && order.riderId !== riderId) {
      return null;
    }

    order.riderId = riderId;
    order.riderName = riderName;
    if (riderPhone) order.riderPhone = riderPhone;
    order.status = 'RIDER_ASSIGNED';
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  async verifyPickup(id: string, pickupCode: string): Promise<{ success: boolean; order?: Order; error?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found' };
    if (order.pickupCode !== pickupCode.trim()) {
      return { success: false, error: 'Invalid pickup verification code' };
    }

    order.status = 'OUT_FOR_DELIVERY';
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return { success: true, order };
  },

  async verifyDeliveryOtp(id: string, otp: string): Promise<{ success: boolean; order?: Order; error?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found' };
    if (order.deliveryOtp !== otp.trim()) {
      return { success: false, error: 'Invalid doorstep delivery OTP' };
    }

    order.status = 'DELIVERED';
    order.deliveredAt = new Date().toISOString();
    order.paymentStatus = 'PAID';
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return { success: true, order };
  },

  async listAvailableBroadcasts(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => (o.status === 'ACCEPTED' || o.status === 'PREPARING' || o.status === 'READY_FOR_PICKUP') && !o.riderId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listByCustomerId(customerId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.customerId === customerId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listByRestaurantId(restaurantId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.restaurantId === restaurantId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listByRiderId(riderId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.riderId === riderId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listAll(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
};
