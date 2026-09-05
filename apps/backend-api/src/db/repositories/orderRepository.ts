import { memoryStore } from '../client.ts';
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
    memoryStore.orders.set(order.id, order);
    return order;
  },

  async updateStatus(id: string, status: OrderStatus, prepMinutes?: number): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    order.status = status;
    if (prepMinutes !== undefined) {
      order.preparationMinutes = prepMinutes;
    }
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    return order;
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
  }
};
