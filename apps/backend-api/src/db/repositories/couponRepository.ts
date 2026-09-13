import { memoryStore, triggerAutoSave } from '../client.ts';
import type { Coupon } from '@quick-bites/shared-types';

/**
 * Promo codes.
 *
 * Keyed by the uppercased code rather than a generated id, because the code is
 * what a customer types and what the checkout looks up; a second identifier
 * would only be a chance for the two to disagree.
 */
function normalizeCode(code: string): string {
  return String(code).trim().toUpperCase();
}

export const couponRepository = {
  async list(): Promise<Coupon[]> {
    return Array.from(memoryStore.coupons.values()).sort((a: Coupon, b: Coupon) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  },

  async findByCode(code: string): Promise<Coupon | null> {
    return memoryStore.coupons.get(normalizeCode(code)) || null;
  },

  async create(input: Partial<Coupon> & { code: string; discountType: Coupon['discountType']; discountValue: number }): Promise<Coupon> {
    const code = normalizeCode(input.code);
    const coupon: Coupon = {
      code,
      title: input.title,
      description: input.description,
      discountType: input.discountType,
      discountValue: Number(input.discountValue),
      minOrderValue: input.minOrderValue !== undefined ? Number(input.minOrderValue) : undefined,
      maxDiscountCap: input.maxDiscountCap !== undefined ? Number(input.maxDiscountCap) : undefined,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      usageLimit: input.usageLimit !== undefined ? Number(input.usageLimit) : undefined,
      perUserLimit: input.perUserLimit !== undefined ? Number(input.perUserLimit) : undefined,
      timesUsed: 0,
      applicableRestaurantIds: input.applicableRestaurantIds || [],
      applicableCategories: input.applicableCategories || [],
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      createdByUserId: input.createdByUserId
    };
    memoryStore.coupons.set(code, coupon);
    triggerAutoSave();
    return coupon;
  },

  async update(code: string, changes: Partial<Coupon>): Promise<Coupon | null> {
    const key = normalizeCode(code);
    const coupon = memoryStore.coupons.get(key) as Coupon | undefined;
    if (!coupon) return null;
    // The code identifies the row and is what customers have already been told;
    // everything else is the campaign and may be tuned.
    const { code: _ignored, timesUsed: _used, createdAt: _created, ...editable } = changes as any;
    Object.assign(coupon, editable);
    coupon.updatedAt = new Date().toISOString();
    memoryStore.coupons.set(key, coupon);
    triggerAutoSave();
    return coupon;
  },

  async remove(code: string): Promise<boolean> {
    const key = normalizeCode(code);
    if (!memoryStore.coupons.has(key)) return false;
    memoryStore.coupons.delete(key);
    triggerAutoSave();
    return true;
  },

  /** Counted at checkout so a usage limit means something. */
  async recordRedemption(code: string): Promise<void> {
    const key = normalizeCode(code);
    const coupon = memoryStore.coupons.get(key) as Coupon | undefined;
    if (!coupon) return;
    coupon.timesUsed = (coupon.timesUsed || 0) + 1;
    memoryStore.coupons.set(key, coupon);
    triggerAutoSave();
  },

  /** How many times one customer has already used a code, from the orders. */
  async redemptionsByUser(code: string, userId: string): Promise<number> {
    const key = normalizeCode(code);
    let count = 0;
    for (const order of memoryStore.orders.values()) {
      if (order.customerId === userId && String(order.couponCode || '').toUpperCase() === key) count++;
    }
    return count;
  }
};
