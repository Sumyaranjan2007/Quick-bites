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
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
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
  /**
   * The most that percentage may take off one order.
   *
   * Zero means uncapped, which is what this was before and is how a Rs 99
   * membership pays for itself on a single large order. A cap is the whole
   * difference between a discount and an unbounded liability.
   */
  maxDiscountPerOrder: number;
  /**
   * Percentage taken off the DELIVERY FEE for this member.
   *
   * This replaced free delivery, and it is a model change rather than a number
   * change. Free delivery above a threshold is all-or-nothing: a member one
   * rupee short of the floor pays the whole fee, and a member one rupee over
   * pays none of it, which is a cliff the customer feels as arbitrary. A
   * percentage is what the owner asked for and it scales with what the plan
   * costs -- which is what makes a dearer plan visibly better.
   */
  deliveryDiscountPercent: number;
  /**
   * Food total at which the delivery discount starts applying. Zero means
   * always.
   *
   * Kept, but it no longer decides whether delivery is FREE -- it decides
   * whether the discount applies at all. Per plan rather than platform-wide, so
   * a dearer plan can be genuinely better rather than only longer.
   */
  freeDeliveryMinOrder: number;
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
/*
 * The ladder the owner set on 23 Sep.
 *
 * The IDS ARE UNCHANGED although two of the names and one of the durations are
 * not. `plan_gold_yearly` now lasts 60 days, which reads oddly -- and renaming
 * it would orphan every subscription already pointing at it, turning a
 * cosmetic improvement into somebody losing a membership they paid for. The id
 * is a key; the name is what a customer sees, and only the name is changed.
 */
const DEFAULT_PLANS: MembershipPlan[] = [
  {
    id: 'plan_gold_monthly',
    name: 'Gold',
    price: 99,
    durationDays: 30,
    deliveryDiscountPercent: 10,
    extraDiscountPercent: 5,
    maxDiscountPerOrder: 75,
    // Zero: the delivery discount applies from the first rupee. The floor was
    // how free delivery was made affordable; a percentage does not need one.
    freeDeliveryMinOrder: 0,
    benefits: [],
    isActive: true
  },
  {
    id: 'plan_gold_quarterly',
    name: 'Gold+',
    price: 249,
    durationDays: 30,
    deliveryDiscountPercent: 25,
    extraDiscountPercent: 5,
    maxDiscountPerOrder: 100,
    freeDeliveryMinOrder: 0,
    benefits: [],
    isActive: true
  },
  {
    id: 'plan_gold_yearly',
    name: 'Gold Max',
    price: 799,
    durationDays: 60,
    deliveryDiscountPercent: 40,
    extraDiscountPercent: 7,
    maxDiscountPerOrder: 150,
    freeDeliveryMinOrder: 0,
    benefits: [],
    isActive: true
  }
];

export function listPlans(includeInactive = false): MembershipPlan[] {
  const stored = memoryStore.settings.get(SETTINGS_KEY) as MembershipPlan[] | undefined;
  const plans = Array.isArray(stored) && stored.length ? stored : DEFAULT_PLANS;
  const withText = plans.map(p => ({ ...p, benefits: planBenefits(p) }));
  return includeInactive ? withText : withText.filter(p => p.isActive);
}

export function findPlan(planId: string): MembershipPlan | null {
  return listPlans(true).find(p => p.id === planId) || null;
}

/** Admin-editable. Replaces the whole set, so a removed plan is really removed. */
export function savePlans(plans: MembershipPlan[]): MembershipPlan[] {
  memoryStore.settings.set(SETTINGS_KEY, plans);
  /*
   * Saved here rather than by whoever calls it.
   *
   * `memoryStore` is Maps, so a write lasts exactly as long as the process. An
   * administrator editing the membership price would have seen it take effect, and
   * seen it revert to the old price on the next deploy — which reads as the edit
   * screen being broken rather than as a missing line here.
   */
  triggerAutoSave();
  return plans;
}

/**
 * What a plan is worth, written from its own numbers.
 *
 * Generated rather than typed, and that is the point. The shipped text said
 * **"Free delivery on every order"** while the code has always required a Rs 199
 * food total — so the platform was promising something it did not do, on the
 * screen where somebody hands over money. A benefit list that is derived cannot
 * drift away from the thing it describes.
 */
export function planBenefits(plan: MembershipPlan): string[] {
  const lines: string[] = [];

  /*
   * The delivery line, derived from the discount rather than written out.
   *
   * This said "Free delivery" until the benefit became a percentage. A plan
   * that promises free delivery and then charges 60% of it is a refund and a
   * complaint, on the screen where somebody hands over money -- and the text
   * would have been wrong from the moment the model changed, with nothing to
   * catch it, because prose does not type-check.
   *
   * 100% is still written as free, because that is what a customer calls it.
   */
  if (plan.deliveryDiscountPercent >= 100) {
    lines.push(
      plan.freeDeliveryMinOrder > 0
        ? `Free delivery on orders over Rs ${plan.freeDeliveryMinOrder}`
        : 'Free delivery on every order'
    );
  } else if (plan.deliveryDiscountPercent > 0) {
    lines.push(
      plan.freeDeliveryMinOrder > 0
        ? `${plan.deliveryDiscountPercent}% off delivery on orders over Rs ${plan.freeDeliveryMinOrder}`
        : `${plan.deliveryDiscountPercent}% off delivery on every order`
    );
  }

  if (plan.extraDiscountPercent > 0) {
    lines.push(
      plan.maxDiscountPerOrder > 0
        ? `${plan.extraDiscountPercent}% off the food, up to Rs ${plan.maxDiscountPerOrder} an order`
        : `${plan.extraDiscountPercent}% off the food on every order`
    );
  }

  lines.push(`Rs ${plan.price} for ${plan.durationDays} days`);
  return lines;
}

/** The most this customer's plan may take off one order, or 0 for uncapped. */
export function goldDiscountCap(user: Pick<UserProfile, 'isGold' | 'goldExpiresAt' | 'goldPlanId'>): number {
  if (!isGoldActive(user)) return 0;
  const plan = user.goldPlanId ? findPlan(user.goldPlanId) : null;
  return plan?.maxDiscountPerOrder ?? 0;
}

/** The food total this customer needs for free delivery. */
/**
 * The percentage this member's plan takes off the delivery fee, or undefined
 * when they are not a member.
 *
 * Undefined rather than 0 deliberately: 0 is a real setting an administrator
 * may choose, and collapsing "no plan" into "a plan worth nothing" would make
 * a misconfigured plan indistinguishable from no membership at all.
 */
export function goldDeliveryDiscountPercent(
  user: Pick<UserProfile, 'isGold' | 'goldExpiresAt' | 'goldPlanId'>
): number | undefined {
  if (!isGoldActive(user)) return undefined;
  const plan = user.goldPlanId ? findPlan(user.goldPlanId) : null;
  if (plan) return plan.deliveryDiscountPercent;

  /*
   * A MEMBER WITH NO PLAN ID still gets a benefit, and this branch is not
   * theoretical: the seeded customer is exactly that, and so is anybody an
   * administrator has granted Gold by hand.
   *
   * Under the old rule the engine checked `isGold` alone, so those members got
   * free delivery. Reading the benefit off a plan they do not have would take
   * it away from them silently -- no error, no screen, just a delivery fee that
   * used to be lower. They would find out by paying it.
   *
   * So they fall back to the CHEAPEST active plan. Cheapest rather than best
   * because inventing the most generous benefit for a record that is already
   * anomalous is how a data problem turns into a bill nobody can explain, and
   * because it is the smallest thing that keeps a promise already made.
   */
  return planlessBenefitPercent();
}

/**
 * The delivery discount a Gold member with no plan id falls back to.
 *
 * Cheapest ACTIVE plan, and if none is active, cheapest of all of them.
 *
 * That second clause is not defensive padding. `listPlans()` is active-only, so
 * deactivating every plan made it return an empty array, `cheapest` undefined,
 * and the benefit silently zero -- which is exactly the failure this fallback
 * exists to prevent, arriving through the fallback itself. And it is the likely
 * path, not a contrived one: hiding the old plans while setting up new ones is
 * the obvious way to restructure a ladder, and the owner has just restructured
 * theirs.
 *
 * Note the asymmetry, which is deliberate. A member WITH a plan id keeps that
 * plan's benefit even after it is retired, because findPlan reads
 * listPlans(true) -- they bought it. Only the plan-less case needs a floor.
 */
function planlessBenefitPercent(): number | undefined {
  const byPrice = (plans: MembershipPlan[]) => plans.slice().sort((a, b) => a.price - b.price)[0];
  const cheapestActive = byPrice(listPlans());
  if (cheapestActive) return cheapestActive.deliveryDiscountPercent;

  const cheapestEver = byPrice(listPlans(true));
  return cheapestEver?.deliveryDiscountPercent;
}

/**
 * How many members are relying on that fallback, and what they are getting.
 *
 * Surfaced rather than left to work quietly, because a fallback nobody can see
 * becomes permanent: the underlying data problem never gets fixed, and every
 * future change to plans has to remember this branch exists. A number on the
 * Gold tab is what turns it back into something somebody can close.
 */
export function goldMembersWithoutPlan(): { count: number; gettingPercent: number | undefined } {
  let count = 0;
  for (const user of memoryStore.users.values() as any) {
    const u = user as Pick<UserProfile, 'isGold' | 'goldExpiresAt' | 'goldPlanId'>;
    if (!isGoldActive(u)) continue;
    if (u.goldPlanId && findPlan(u.goldPlanId)) continue;
    count++;
  }
  return { count, gettingPercent: planlessBenefitPercent() };
}

export function goldFreeDeliveryMinOrder(
  user: Pick<UserProfile, 'isGold' | 'goldExpiresAt' | 'goldPlanId'>
): number | undefined {
  if (!isGoldActive(user)) return undefined;
  const plan = user.goldPlanId ? findPlan(user.goldPlanId) : null;
  return plan?.freeDeliveryMinOrder;
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
