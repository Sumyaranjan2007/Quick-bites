import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { RestaurantSettlement, PayoutStatus } from '@quick-bites/shared-types';

/**
 * Restaurant settlements.
 *
 * The platform collects the whole bill from the customer and therefore owes the
 * kitchen its share. Until now that debt was visible only as a derived figure on
 * an analytics screen, which meant nobody could say what had actually been paid
 * or when — a restaurant asking "have you paid me for last week?" had no answer.
 *
 * Mirrors `payoutRepository` on purpose: the same frozen-at-draft discipline, so
 * a settlement remains a truthful record of a transfer even after the orders
 * behind it are refunded or corrected.
 */
export const settlementRepository = {
  async list(filter: { restaurantId?: string; status?: PayoutStatus } = {}): Promise<RestaurantSettlement[]> {
    let rows = Array.from(memoryStore.restaurantSettlements.values()) as RestaurantSettlement[];
    if (filter.restaurantId) rows = rows.filter(s => s.restaurantId === filter.restaurantId);
    if (filter.status) rows = rows.filter(s => s.status === filter.status);
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async findById(id: string): Promise<RestaurantSettlement | null> {
    return memoryStore.restaurantSettlements.get(id) || null;
  },

  async create(
    input: Omit<RestaurantSettlement, 'id' | 'createdAt' | 'status'> & { status?: PayoutStatus }
  ): Promise<RestaurantSettlement> {
    const settlement: RestaurantSettlement = {
      id: `rst_stl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      status: input.status || 'PENDING',
      ...input,
      createdAt: new Date().toISOString()
    };
    memoryStore.restaurantSettlements.set(settlement.id, settlement);
    triggerAutoSave();
    return settlement;
  },

  async setStatus(
    id: string,
    status: PayoutStatus,
    actor: { userId: string },
    extras: { reference?: string; note?: string } = {}
  ): Promise<RestaurantSettlement | null> {
    const settlement = memoryStore.restaurantSettlements.get(id) as RestaurantSettlement | undefined;
    if (!settlement) return null;
    settlement.status = status;
    settlement.processedByUserId = actor.userId;
    if (extras.reference) settlement.reference = extras.reference;
    if (extras.note) settlement.note = extras.note;
    if (status === 'PAID') settlement.paidAt = new Date().toISOString();
    memoryStore.restaurantSettlements.set(id, settlement);
    triggerAutoSave();
    return settlement;
  },

  async paidTotal(restaurantId: string): Promise<number> {
    let total = 0;
    for (const s of memoryStore.restaurantSettlements.values()) {
      if (s.restaurantId === restaurantId && s.status === 'PAID') total += s.netAmount || 0;
    }
    return Math.round(total * 100) / 100;
  }
};
