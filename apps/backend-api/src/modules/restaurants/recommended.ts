/**
 * The restaurants Quick Bites recommends, in the order admins chose (master plan B5).
 * Shown first on every customer's home, and as the whole list for a customer who has
 * not set a location. Only live kitchens appear: the feed applies this on top of its
 * own "approved and trading" filter, so a removed or suspended kitchen drops out.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';

const KEY = 'recommendedRestaurants';
export const MAX_RECOMMENDED = 30;

export function recommendedIds(): string[] {
  const stored = memoryStore.settings.get(KEY) as { ids?: unknown } | undefined;
  return Array.isArray(stored?.ids) ? (stored.ids as string[]) : [];
}

/** Replaces the list. Repeats are dropped; an id that is not a restaurant is refused. */
export function saveRecommended(ids: string[], actorUserId: string): string[] {
  const unique = [...new Set(ids)];
  const unknown = unique.filter(id => !memoryStore.restaurants.has(id));
  if (unknown.length) throw new AppError(`Not a restaurant: ${unknown.join(', ')}`, 400, 'RESTAURANT_NOT_FOUND');
  memoryStore.settings.set(KEY, { ids: unique, updatedAt: new Date().toISOString(), actorUserId });
  triggerAutoSave();
  return unique;
}
