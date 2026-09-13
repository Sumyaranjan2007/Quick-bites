import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { RiderPayout, PayoutStatus } from '@quick-bites/shared-types';

/**
 * Rider settlements.
 *
 * A payout is a record of a decision to pay, not a running balance: the amounts
 * are computed from delivered trips at the moment it is drafted and then frozen,
 * so what was actually paid can still be read back after the underlying trips
 * have been corrected, archived or re-rated.
 */
export const payoutRepository = {
  async list(filter: { riderId?: string; status?: PayoutStatus } = {}): Promise<RiderPayout[]> {
    let rows = Array.from(memoryStore.payouts.values()) as RiderPayout[];
    if (filter.riderId) rows = rows.filter(p => p.riderId === filter.riderId);
    if (filter.status) rows = rows.filter(p => p.status === filter.status);
    return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async findById(id: string): Promise<RiderPayout | null> {
    return memoryStore.payouts.get(id) || null;
  },

  async create(input: Omit<RiderPayout, 'id' | 'createdAt' | 'status'> & { status?: PayoutStatus }): Promise<RiderPayout> {
    const payout: RiderPayout = {
      id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      status: input.status || 'PENDING',
      ...input,
      createdAt: new Date().toISOString()
    };
    memoryStore.payouts.set(payout.id, payout);
    triggerAutoSave();
    return payout;
  },

  async setStatus(
    id: string,
    status: PayoutStatus,
    actor: { userId: string },
    extras: { reference?: string; note?: string } = {}
  ): Promise<RiderPayout | null> {
    const payout = memoryStore.payouts.get(id) as RiderPayout | undefined;
    if (!payout) return null;
    payout.status = status;
    payout.processedByUserId = actor.userId;
    if (extras.reference) payout.reference = extras.reference;
    if (extras.note) payout.note = extras.note;
    if (status === 'PAID') payout.paidAt = new Date().toISOString();
    memoryStore.payouts.set(id, payout);
    triggerAutoSave();
    return payout;
  },

  /** Trips already covered by a payout, so the next draft does not pay twice. */
  async settledTripCount(riderId: string): Promise<number> {
    let total = 0;
    for (const payout of memoryStore.payouts.values()) {
      if (payout.riderId === riderId && payout.status !== 'FAILED') total += payout.tripsCompleted || 0;
    }
    return total;
  },

  async paidTotal(riderId: string): Promise<number> {
    let total = 0;
    for (const payout of memoryStore.payouts.values()) {
      if (payout.riderId === riderId && payout.status === 'PAID') total += payout.netAmount || 0;
    }
    return Math.round(total * 100) / 100;
  }
};
