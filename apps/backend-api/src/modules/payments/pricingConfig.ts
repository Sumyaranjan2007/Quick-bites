/**
 * The platform's rates, versioned.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * Every number the platform charges or withholds used to live in source code.
 * The commission rate lived in TWO places — `packages/pricing-engine` computed
 * `itemsTotal * 0.15` and `modules/admin/analytics.ts` declared its own
 * `COMMISSION_RATE = 0.15` and computed it again for the revenue screen. Those
 * two could drift apart with nothing to notice, at which point the revenue
 * report and the settlements would quietly stop describing the same business.
 *
 * Changing any rate meant a deploy. An owner who wanted to run 12% commission
 * for a month could not.
 *
 * -------------------------------------------------------------------------
 * VERSIONS, NOT EDITS
 * -------------------------------------------------------------------------
 * A configuration is never modified. An administrator changing a rate creates
 * a new version, and an order records the version it was priced under together
 * with a frozen copy of the rates used.
 *
 * That is what makes a settlement defensible months later. "Why was this order
 * commissioned at 18%?" is answered by the order itself, not by whatever the
 * configuration says today — and a rate change can never silently rewrite what
 * a partner was owed for trading they have already done.
 *
 * -------------------------------------------------------------------------
 * THE DEFAULTS ARE TODAY'S HARDCODED NUMBERS
 * -------------------------------------------------------------------------
 * Every default below is exactly what the code did before this module existed.
 * Installing it changes no bill and no settlement by a single paisa; it only
 * moves where the numbers come from. That is deliberate: a change that both
 * relocates a rate and alters it gives you no way to tell which of the two
 * caused a difference.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { DEFAULT_PRICING_RATES } from '@quick-bites/shared-types';
import type { PricingConfig, PricingRates } from '@quick-bites/shared-types';

/**
 * What the platform charged before any of this was configurable.
 *
 * Imported rather than declared here, and declared in the package the pricing
 * engine also depends on, so there is exactly one copy. Two copies of a rate in
 * two files is the defect this module exists to remove; recreating it one
 * directory away would be a poor joke.
 */
export const DEFAULT_RATES: PricingRates = DEFAULT_PRICING_RATES;

/**
 * What each rate means and what it may be set to.
 *
 * The bounds are not decoration. An administrator who can set commission to
 * 500% or GST to -5 can make every settlement on the platform nonsense in one
 * keystroke, and the apology afterwards does not recover the money. Held here
 * rather than in the route so the admin screen can render the same limits it
 * will be judged by.
 */
export interface RateBound {
  key: keyof PricingRates;
  label: string;
  help: string;
  unit: 'PERCENT' | 'RUPEES' | 'KM' | 'DAYS' | 'MINUTES';
  min: number;
  max: number;
  /** Rates a change to which alters what customers are charged. */
  affectsCustomerBill: boolean;
}

export const RATE_BOUNDS: RateBound[] = [
  { key: 'gstFoodPercent', label: 'GST on food', help: 'Statutory. 5% for restaurant service without input tax credit.', unit: 'PERCENT', min: 0, max: 28, affectsCustomerBill: true },
  { key: 'packagingFeeDefault', label: 'Packaging fee', help: 'Per order, unless the restaurant sets its own.', unit: 'RUPEES', min: 0, max: 200, affectsCustomerBill: true },
  { key: 'deliveryBaseFee', label: 'Delivery base fee', help: 'Charged up to the base distance.', unit: 'RUPEES', min: 0, max: 500, affectsCustomerBill: true },
  { key: 'deliveryBaseKm', label: 'Delivery base distance', help: 'Distance covered by the base fee.', unit: 'KM', min: 0, max: 50, affectsCustomerBill: true },
  { key: 'deliveryPerKmBeyond', label: 'Delivery per extra km', help: 'Added per whole kilometre beyond the base.', unit: 'RUPEES', min: 0, max: 200, affectsCustomerBill: true },
  { key: 'memberFreeDeliveryMinOrder', label: 'Member free delivery above', help: 'Food total at which a member pays no delivery fee.', unit: 'RUPEES', min: 0, max: 10000, affectsCustomerBill: true },
  { key: 'platformFeeBase', label: 'Platform fee', help: 'Before GST is added to it.', unit: 'RUPEES', min: 0, max: 500, affectsCustomerBill: true },
  { key: 'platformFeeGstPercent', label: 'GST on platform fee', help: 'Statutory. 18% on a service fee.', unit: 'PERCENT', min: 0, max: 28, affectsCustomerBill: true },
  { key: 'defaultCommissionPercent', label: 'Default commission', help: 'Used when a restaurant has no negotiated rate of its own.', unit: 'PERCENT', min: 0, max: 50, affectsCustomerBill: false },
  { key: 'commissionGstPercent', label: 'GST on commission', help: 'What the platform owes on its own commission.', unit: 'PERCENT', min: 0, max: 28, affectsCustomerBill: false },
  { key: 'tdsPercent', label: 'TDS (section 194-O)', help: 'Withheld from a partner payout and paid to the government.', unit: 'PERCENT', min: 0, max: 10, affectsCustomerBill: false },
  { key: 'tcsPercent', label: 'TCS (GST section 52)', help: 'Collected at source on net taxable supplies.', unit: 'PERCENT', min: 0, max: 10, affectsCustomerBill: false },
  { key: 'riderBaseFeePerTrip', label: 'Rider base fee', help: 'Earned per trip before distance is counted.', unit: 'RUPEES', min: 0, max: 1000, affectsCustomerBill: false },
  { key: 'riderBaseKm', label: 'Rider base distance', help: 'Distance covered by the base fee.', unit: 'KM', min: 0, max: 50, affectsCustomerBill: false },
  { key: 'riderPerKmFee', label: 'Rider per extra km', help: 'Earned per kilometre beyond the base.', unit: 'RUPEES', min: 0, max: 200, affectsCustomerBill: false },
  { key: 'riderMinEarningPerTrip', label: 'Rider minimum per trip', help: 'No trip pays less than this, whatever the distance.', unit: 'RUPEES', min: 0, max: 1000, affectsCustomerBill: false },
  {
    key: 'riderDeliveryMarkupPercent',
    label: 'Delivery markup',
    // Named for what it does to the customer, not for what it does to the
    // rider, because it does nothing to the rider. An administrator reading
    // "rider percentage" would reasonably expect it to change rider pay.
    help: 'Added to what the CUSTOMER pays for delivery. Rider earnings are unaffected — the difference is ours.',
    unit: 'PERCENT',
    min: 0,
    max: 100,
    affectsCustomerBill: true
  },
  { key: 'codCashCeiling', label: 'Rider cash ceiling', help: 'Cash a rider may hold before the platform stops offering them COD orders.', unit: 'RUPEES', min: 0, max: 100000, affectsCustomerBill: false },
  /*
   * How long dispatch waits before widening the search.
   *
   * A rate rather than an environment constant because it is the number the owner
   * will actually want to move: too short and riders three streets away are
   * skipped past before they look at their phone, too long and cooked food sits
   * while the next six are not asked. That is an operational judgement about a
   * real city, and it should not need a deploy.
   *
   * It has to be in RATE_BOUNDS to exist at all — `createVersion` silently drops
   * any key not listed here, so a rate added without this line is editable,
   * displayed and read by nothing.
   */
  { key: 'riderOfferWaveMinutes', label: 'Widen rider search after', help: 'Minutes to wait before offering a waiting trip to the next group of riders.', unit: 'MINUTES', min: 1, max: 60, affectsCustomerBill: false },
  /*
   * The two numbers that decide when a rider carrying food is in trouble.
   *
   * Both are judgements about a real city rather than constants. A dense area with
   * good signal can use ten minutes of silence; somewhere with dead spots cannot,
   * and setting it too low means an alert every time somebody rides through an
   * underpass — which is how the urgent channel gets muted.
   */
  { key: 'riderLocationSilentMinutes', label: 'Rider silent for', help: 'Minutes without a location from a rider carrying food before operations are alerted.', unit: 'MINUTES', min: 2, max: 120, affectsCustomerBill: false },
  { key: 'deliveryOverdueMinutes', label: 'Delivery overdue after', help: 'Minutes a rider may be carrying food before the delivery is flagged as late.', unit: 'MINUTES', min: 2, max: 120, affectsCustomerBill: false },
  { key: 'gatewaySettlementOverdueDays', label: 'Gateway settlement overdue after', help: 'Days money may sit at the payment gateway before it is reported as a problem. Razorpay settles in about two working days.', unit: 'DAYS', min: 1, max: 30, affectsCustomerBill: false },
  { key: 'codCashWarnPercent', label: 'Cash warning at', help: 'Percentage of the ceiling at which the rider is told to deposit.', unit: 'PERCENT', min: 1, max: 100, affectsCustomerBill: false },
  { key: 'partnerHoldDays', label: 'Partner hold period', help: 'Days after delivery before a restaurant’s money becomes payable.', unit: 'DAYS', min: 0, max: 30, affectsCustomerBill: false },
  { key: 'riderHoldDays', label: 'Rider hold period', help: 'Days after delivery before a rider’s money becomes payable.', unit: 'DAYS', min: 0, max: 30, affectsCustomerBill: false },
  {
    key: 'payoutCadenceDays',
    label: 'How often payday runs',
    // The hold period is how long ONE order's money waits. This is how often a
    // run happens at all. A partner is told both, and they are different
    // promises — "released after a day" and "paid every seven" are compatible
    // and confusing to state as one number.
    help: 'Days between payout runs. 7 is weekly. Cash a rider collects does not follow this — that comes in whenever they near their limit.',
    unit: 'DAYS',
    min: 1,
    max: 30,
    affectsCustomerBill: false
  },
  { key: 'minPayoutAmount', label: 'Minimum payout', help: 'Below this, a payout carries to the next run instead of being sent.', unit: 'RUPEES', min: 0, max: 10000, affectsCustomerBill: false },
  { key: 'makerCheckerThreshold', label: 'Second approver above', help: 'Payouts above this need a second administrator to approve them.', unit: 'RUPEES', min: 0, max: 1000000, affectsCustomerBill: false },
  { key: 'dailyPayoutCap', label: 'Daily payout cap', help: 'Everything the platform may pay out in any 24 hours.', unit: 'RUPEES', min: 0, max: 100000000, affectsCustomerBill: false },
  { key: 'payoutLinkExpiryHours', label: 'Refund link expiry', help: 'How long a refund link stays claimable.', unit: 'MINUTES', min: 1, max: 720, affectsCustomerBill: false },
  { key: 'doorQrExpiryMinutes', label: 'Door QR expiry', help: 'How long a doorstep QR stays payable. Razorpay caps this at 120 minutes.', unit: 'MINUTES', min: 2, max: 120, affectsCustomerBill: false }
];

const boundsByKey = new Map(RATE_BOUNDS.map(b => [b.key, b]));

/** Every rate in `rates` is present, numeric and inside its bounds. */
export function validateRates(rates: PricingRates): string[] {
  const problems: string[] = [];
  for (const bound of RATE_BOUNDS) {
    const value = rates[bound.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${bound.label} must be a number.`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      problems.push(`${bound.label} must be between ${bound.min} and ${bound.max}.`);
    }
  }
  return problems;
}

/**
 * The version in force.
 *
 * Creates version 1 from the defaults on first call, so a platform that has
 * never had an administrator touch a rate still prices orders — and prices them
 * exactly as it did before this module existed.
 */
export function getActiveConfig(): PricingConfig {
  const all = listConfigs();
  if (all.length > 0) return all[0];

  const initial: PricingConfig = {
    id: 'pcfg_1',
    version: 1,
    rates: { ...DEFAULT_RATES },
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdByUserId: 'system',
    note: 'Platform defaults, matching the rates that were hardcoded before rates were configurable.'
  };
  memoryStore.pricingConfigs.set(initial.id, initial);
  triggerAutoSave();
  return initial;
}

/** The rates in force, which is all most callers want. */
export function getActiveRates(): PricingRates {
  return getActiveConfig().rates;
}

/** Newest version first. */
export function listConfigs(): PricingConfig[] {
  return (Array.from(memoryStore.pricingConfigs.values()) as PricingConfig[]).sort(
    (a, b) => b.version - a.version
  );
}

export function findConfigByVersion(version: number): PricingConfig | null {
  return listConfigs().find(c => c.version === version) || null;
}

/**
 * Writes a new version.
 *
 * Takes a partial: an administrator changing the commission rate sends the
 * commission rate, and everything else is carried forward from the version in
 * force. Sending a whole configuration to change one number is how the other
 * twenty-three get reverted to whatever the screen happened to be showing.
 */
export function createVersion(
  changes: Partial<PricingRates>,
  actor: { userId: string },
  note: string
): { config: PricingConfig; changed: Array<{ key: string; from: number; to: number }> } {
  const current = getActiveConfig();
  const rates: PricingRates = { ...current.rates, ...changes };

  const problems = validateRates(rates);
  if (problems.length > 0) {
    const error = new Error(problems.join(' '));
    (error as any).statusCode = 400;
    (error as any).code = 'INVALID_RATES';
    throw error;
  }

  const changed: Array<{ key: string; from: number; to: number }> = [];
  for (const bound of RATE_BOUNDS) {
    if (rates[bound.key] !== current.rates[bound.key]) {
      changed.push({ key: bound.key, from: current.rates[bound.key], to: rates[bound.key] });
    }
  }

  // Nothing actually differs. Writing a version anyway would fill the history
  // with rows that record no decision, and make the ones that do harder to find.
  if (changed.length === 0) {
    return { config: current, changed: [] };
  }

  const version = current.version + 1;
  const config: PricingConfig = {
    id: `pcfg_${version}_${crypto.randomBytes(3).toString('hex')}`,
    version,
    rates,
    effectiveFrom: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdByUserId: actor.userId,
    note
  };

  memoryStore.pricingConfigs.set(config.id, config);
  triggerAutoSave();
  return { config, changed };
}

/**
 * The commission rate for one restaurant.
 *
 * A restaurant may carry its own negotiated rate; most do not, and fall back to
 * the platform default. Read through this function rather than off the record
 * directly, so that a restaurant whose rate is missing, null, or a string that
 * came back from JSON cannot end up commissioned at zero.
 */
export function commissionPercentFor(
  restaurant: { commissionPercent?: number | null } | null | undefined,
  rates: PricingRates = getActiveRates()
): number {
  const own = restaurant?.commissionPercent;
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0 && own <= 50) {
    return own;
  }
  return rates.defaultCommissionPercent;
}

/** Only used by tests and the platform reset, which need a clean slate. */
export function resetConfigsForTesting(): void {
  memoryStore.pricingConfigs.clear();
}

export { boundsByKey };
