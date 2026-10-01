import { getActiveRates } from '../payments/pricingConfig.ts';
import { riderPayFor } from '@quick-bites/pricing-engine';

/**
 * What the rider earns for a trip, EXCLUDING the tip.
 *
 * ONE FIGURE, FROZEN AT CHECKOUT (owner, 1 Oct 2026). The bill now carries
 * `riderPay` — road km from kitchen to door x the per-km rate, never below the
 * minimum — and the customer's delivery fee was built from that same number. So
 * the offer, the trip, the statement and the payout read it from the bill and
 * cannot disagree with what the customer was charged. Orders placed before
 * then have no `riderPay`; they keep the formula they were quoted under.
 *
 * THE TIP IS NOT IN HERE ANY MORE. This used to return pay + tip, the result was
 * stored as `order.riderPayout`, and the earnings step then added the tip AGAIN
 * (`riderPayout + tipPaise`). Every tipped order credited the rider twice, the
 * second copy paid out of the platform's money. The tip is added once, in
 * `splitForOrder`.
 */
export function calculateTripPayout(order: {
  distanceKm?: number;
  bill?: { deliveryFee?: number; tipAmount?: number; riderPay?: number };
}): number {
  const frozen = Number(order.bill?.riderPay);
  if (Number.isFinite(frozen) && frozen >= 0) return Math.round(frozen * 100) / 100;

  // Orders priced before 1 Oct 2026: the formula they were quoted under.
  const rates = getActiveRates();
  const distanceKm = Math.max(0, Number(order.distanceKm) || 0);
  if (rates.riderBaseFeePerTrip > 0 || rates.riderBaseKm > 0) {
    const beyond = Math.max(0, distanceKm - rates.riderBaseKm);
    const earned = rates.riderBaseFeePerTrip + Math.ceil(beyond) * rates.riderPerKmFee;
    return Math.round(Math.max(earned, rates.riderMinEarningPerTrip) * 100) / 100;
  }
  return riderPayFor(distanceKm, rates);
}

/** What the rider takes home from the trip: pay plus the whole tip. For display. */
export function tripTakeHome(order: {
  distanceKm?: number;
  riderPayout?: number;
  bill?: { deliveryFee?: number; tipAmount?: number; riderPay?: number };
}): number {
  const pay = typeof order.riderPayout === 'number' ? order.riderPayout : calculateTripPayout(order);
  return Math.round((pay + Math.max(0, Number(order.bill?.tipAmount) || 0)) * 100) / 100;
}
