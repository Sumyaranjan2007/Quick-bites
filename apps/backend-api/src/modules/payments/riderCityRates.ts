/**
 * Rider pay per km, by city (owner, 2 Oct 2026).
 *
 * The global "Rider pay per km" (₹12 by default) applies everywhere unless a
 * city has its own rate: a Mysuru rate set here pays riders on every order
 * from a Mysuru restaurant at that rate. Only the per-km amount varies by
 * city; the minimum per trip and the delivery markup stay global, as the owner
 * decided.
 *
 * The city is the RESTAURANT's, because the trip starts there. Matched on the
 * name, ignoring case and spaces, so "Bengaluru " and "bengaluru" are one city.
 *
 * Like every rate, it is read at checkout and frozen on the bill as
 * `riderPay`, so changing a city's rate never changes an order already placed.
 */
import type { PricingRates } from '@quick-bites/shared-types';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { getActiveRates, RATE_BOUNDS } from './pricingConfig.ts';
import { AppError } from '../../utils/AppError.ts';

const KEY = 'rider-city-rates';

export interface CityRate {
  city: string;
  perKm: number;
  updatedAt: string;
  updatedByName: string;
}

const norm = (city: string) => String(city || '').trim().replace(/\s+/g, ' ').toLowerCase();

function table(): Record<string, CityRate> {
  return (memoryStore.meta.get(KEY) as Record<string, CityRate>) || {};
}

export function listCityRates(): CityRate[] {
  return Object.values(table()).sort((a, b) => a.city.localeCompare(b.city));
}

export function cityRateFor(city: string | null | undefined): number | null {
  const row = table()[norm(city || '')];
  return row ? row.perKm : null;
}

/**
 * Sets a city's rate, or removes it with `perKm: null` so the city follows the
 * global rate again. Same bounds as the global rate.
 */
export function setCityRate(city: string, perKm: number | null, actorName: string): CityRate | null {
  const key = norm(city);
  if (!key) throw new AppError('Name the city.', 400, 'CITY_REQUIRED');
  const next = { ...table() };
  if (perKm === null) {
    delete next[key];
    memoryStore.meta.set(KEY, next);
    triggerAutoSave();
    return null;
  }
  const bound = RATE_BOUNDS.find(b => b.key === 'riderPerKmFee');
  const min = bound?.min ?? 0;
  const max = bound?.max ?? 200;
  if (!Number.isFinite(perKm) || perKm < min || perKm > max) {
    throw new AppError(`Rider pay per km must be between ₹${min} and ₹${max}.`, 400, 'CITY_RATE_OUT_OF_RANGE');
  }
  const row: CityRate = {
    city: String(city).trim().replace(/\s+/g, ' '),
    perKm: Math.round(perKm * 100) / 100,
    updatedAt: new Date().toISOString(),
    updatedByName: actorName
  };
  next[key] = row;
  memoryStore.meta.set(KEY, next);
  triggerAutoSave();
  return row;
}

/** The rates an order from this restaurant is priced with: its city's ₹/km, if set. */
export function ratesForRestaurant(restaurant: { city?: string | null }, rates: PricingRates = getActiveRates()): PricingRates {
  const perKm = cityRateFor(restaurant.city);
  return perKm === null ? rates : { ...rates, riderPerKmFee: perKm };
}
