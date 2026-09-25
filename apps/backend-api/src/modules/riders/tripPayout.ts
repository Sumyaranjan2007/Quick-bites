/**
 * What a rider earns for one trip: base plus per-km beyond the free distance,
 * floored at the guaranteed minimum, plus the whole tip. All from the live
 * rates. See the long note where this used to live (riderRouter) for why the
 * customer's delivery fee is a separate number.
 */
import { getActiveRates } from '../payments/pricingConfig.ts';

export function calculateTripPayout(order: {
  distanceKm?: number;
  bill?: { deliveryFee?: number; tipAmount?: number };
}): number {
  const rates = getActiveRates();

  const distanceKm = Math.max(0, Number(order.distanceKm) || 0);
  const beyond = Math.max(0, distanceKm - rates.riderBaseKm);
  // Whole kilometres, matching how the customer's delivery fee is charged, so a
  // rider and a customer are never billed against different distances.
  const distanceComponent = Math.ceil(beyond) * rates.riderPerKmFee;

  const earned = rates.riderBaseFeePerTrip + distanceComponent;
  const floored = Math.max(earned, rates.riderMinEarningPerTrip);

  const tip = Math.max(0, Number(order.bill?.tipAmount) || 0);
  return Math.round((floored + tip) * 100) / 100;
}
