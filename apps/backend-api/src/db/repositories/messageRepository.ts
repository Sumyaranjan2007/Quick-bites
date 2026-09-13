import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { OrderMessage } from '@quick-bites/shared-types';

/**
 * Messages between a customer and the rider delivering their order.
 *
 * Scoped to an order rather than to the two people: the pair have no
 * relationship outside the delivery, and the thread should stop being reachable
 * when the order is finished rather than becoming a private channel between a
 * customer and a stranger who once brought them food.
 */
export const messageRepository = {
  async listByOrder(orderId: string): Promise<OrderMessage[]> {
    const all: OrderMessage[] = [];
    for (const message of memoryStore.orderMessages.values()) {
      if (message.orderId === orderId) all.push(message);
    }
    return all.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  },

  async create(input: Omit<OrderMessage, 'id' | 'sentAt'>): Promise<OrderMessage> {
    const message: OrderMessage = {
      ...input,
      id: `msg_${crypto.randomUUID()}`,
      sentAt: new Date().toISOString()
    };
    memoryStore.orderMessages.set(message.id, message);
    triggerAutoSave();
    return message;
  },

  /** Used when an order is removed, so a thread cannot outlive its subject. */
  async removeByOrder(orderId: string): Promise<number> {
    let removed = 0;
    for (const [id, message] of memoryStore.orderMessages.entries()) {
      if (message.orderId === orderId) {
        memoryStore.orderMessages.delete(id);
        removed++;
      }
    }
    if (removed) triggerAutoSave();
    return removed;
  }
};
