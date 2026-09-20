/**
 * Quick Bites Gold: a paid membership, and an expiry that is actually enforced.
 *
 * WHY THIS REPLACED THE WALLET TOP-UP. Letting customers load money onto a
 * stored balance makes the platform the issuer of a prepaid payment instrument,
 * which in India is an RBI-licensed activity. The wallet stays, but only as a
 * destination for refunds on cash orders — money can leave it and can only
 * enter it as something we owe. That keeps it a closed loop and keeps this out
 * of a licence application.
 *
 * WHAT WAS ALREADY HALF-BUILT. `UserProfile.isGold` has existed all along and
 * decides free delivery in the pricing engine. `UserProfile.goldExpiresAt` has
 * existed alongside it and was read by NOTHING — declared, stored, and never
 * consulted. A membership sold against that would have been sold once and
 * honoured forever, which is the most expensive kind of dead field there is.
 *
 * `isGoldActive` below is the only thing anything should ask. Reading the raw
 * `isGold` flag anywhere that decides money is the bug this module exists to
 * make impossible.
 */
import { memoryStore } from '../../db/client.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { AppError } from '../../utils/AppError.ts';
import type { UserProfile } from '@quick-bites/shared-types';

export interface MembershipPlan {
  id: string;
  name: string;
  /** What the customer pays, in rupees. */
  price: number;
  /** How long it lasts. */
  durationDays: number;
  /** Shown on the purchase screen, in the customer's words rather than ours. */
  benefits: string[];
  /**
   * Percentage taken off the items total, on top of free delivery.
   * Held here rather than in the pricing engine so an administrator can change
   * what Gold is worth without a release.
   */
  extraDiscountPercent: number;
  isActive: boolean;
}

const SETTINGS_KEY = 'membership:plans';

/**
 * The plans a deployment starts with.
 *
 * Deliberately three, at prices that make the middle one obvious: a single
 * plan gives nobody anything to choose, and five gives them a spreadsheet.
 * Every number here is editable from the admin app — these are a starting
 * point, not a decision baked into the source.
 */
const DEFAULT_PLANS: MembershipPlan[] = [
  {
    id: 'plan_gold_monthly',
    name: 'Gold Monthly',
    price: 99,
    durationDays: 30,
    extraDiscountPercent: 5,
    benefits: ['Free delivery on every order', '5% off every order', 'Priority support'],
    isActive: true
  },
  {
    id: 'plan_gold_quarterly',
    name: 'Gold 3 Months',
    price: 249,
    durationDays: 90,
    extraDiscountPercent: 5,
    benefits: ['Free delivery on every order', '5% off every order', 'Priority support', 'Save ₹48'],
    isActive: true
  },
  {
    id: 'plan_gold_yearly',
    name: 'Gold Yearly',
    price: 799,
    durationDays: 365,
    extraDiscountPercent: 7,
    benefits: ['Free delivery on every order', '7% off every order', 'Priority support', 'Save ₹389'],
    isActive: true
  }
];

export function listPlans(includeInactive = false): MembershipPlan[] {
  const stored = memoryStore.settings.get(SETTINGS_KEY) as MembershipPlan[] | undefined;
  const plans = Array.isArray(stored) && stored.length ? stored : DEFAULT_PLANS;
  return includeInactive ? plans : plans.filter(p => p.isActive);
}

export function findPlan(planId: string): MembershipPlan | null {
  return listPlans(true).find(p => p.id === planId) || null;
}

/** Admin-editable. Replaces the whole set, so a removed plan is really removed. */
export function savePlans(plans: MembershipPlan[]): MembershipPlan[] {
  memoryStore.settings.set(SETTINGS_KEY, plans);
  return plans;
}

/* -------------------------------------------------------------------------- *
 *                        THE ONLY QUESTION THAT MATTERS                       *
 * -------------------------------------------------------------------------- */

/**
 * Is this customer's membership live RIGHT NOW?
 *
 * Not "did they ever buy one". A membership with no expiry is treated as
 * active, because that is what every account seeded before memberships existed
 * looks like and revoking their benefit retrospectively would be a change
 * nobody asked for. A membership WITH an expiry is honoured up to that instant
 * and not past it.
 */
export function isGoldActive(user: Pick<UserProfile, 'isGold' | 'goldExpiresAt'> | null | undefined): boolean {
  if (!user?.isGold) return false;
  if (!user.goldExpiresAt) return true;
  const expiry = new Date(user.goldExpiresAt).getTime();
  // An unparseable date is treated as no expiry rather than as expired: the
  // customer paid, and a storage fault on our side must not silently withdraw
  // what they bought.
  if (!Number.isFinite(expiry)) return true;
  return expiry > Date.now();
}

/** The extra discount this customer's plan carries, or zero. */
export function goldDiscountPercent(user: Pick<UserProfile, 'isGold' | 'goldExpiresAt' | 'goldPlanId'>): number {
  if (!isGoldActive(user)) return 0;
  const plan = user.goldPlanId ? findPlan(user.goldPlanId) : null;
  // A member with no recorded plan — anyone seeded as Gold before memberships
  // existed — keeps free delivery and gets no extra discount, rather than
  // inheriting whichever plan happens to be first in the list.
  return plan?.extraDiscountPercent ?? 0;
}

/* -------------------------------------------------------------------------- *
 *                                  BUYING IT                                  *
 * -------------------------------------------------------------------------- */

export interface MembershipStatus {
  active: boolean;
  planId?: string;
  planName?: string;
  expiresAt?: string;
  daysRemaining?: number;
  extraDiscountPercent: number;
}

export async function statusFor(userId: string): Promise<MembershipStatus> {
  const user = await userRepository.findById(userId);
  if (!user) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');

  const active = isGoldActive(user);
  const plan = (user as any).goldPlanId ? findPlan((user as any).goldPlanId) : null;

  return {
    active,
    planId: active ? plan?.id : undefined,
    planName: active ? plan?.name : undefined,
    expiresAt: active ? user.goldExpiresAt : undefined,
    daysRemaining:
      active && user.goldExpiresAt
        ? Math.max(0, Math.ceil((new Date(user.goldExpiresAt).getTime() - Date.now()) / 86_400_000))
        : undefined,
    extraDiscountPercent: goldDiscountPercent(user as any)
  };
}

/**
 * Turn a paid membership on.
 *
 * EXTENDS rather than replaces. Someone who renews eleven months into a yearly
 * plan should get thirteen months, not lose the one they already paid for —
 * and "buy again to extend" is how renewal reminders work, so this path runs
 * on a live membership far more often than on an expired one.
 *
 * Called only after a payment has been verified against Razorpay's signature.
 * Nothing here checks payment, and nothing here should: a function that both
 * grants a benefit and decides whether it was paid for is one mistake away
 * from granting it for free.
 */
export async function activate(userId: string, planId: string): Promise<MembershipStatus> {
  const plan = findPlan(planId);
  if (!plan) throw new AppError('That membership plan does not exist.', 404, 'PLAN_NOT_FOUND');

  const user = await userRepository.findById(userId);
  if (!user) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');

  const now = Date.now();
  const currentExpiry = isGoldActive(user) && user.goldExpiresAt
    ? new Date(user.goldExpiresAt).getTime()
    : now;
  const from = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
  const expiresAt = new Date(from + plan.durationDays * 86_400_000).toISOString();

  await userRepository.update(userId, {
    isGold: true,
    goldExpiresAt: expiresAt,
    goldPlanId: plan.id
  } as any);

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    event: 'MEMBERSHIP_ACTIVATED',
    userId,
    planId: plan.id,
    expiresAt
  }));

  return statusFor(userId);
}
