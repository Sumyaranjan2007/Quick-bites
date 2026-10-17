/**
 * A whole menu section switched off at once ("no dosa after 7 pm"; master plan B5).
 *
 * The section carries the switch; each dish keeps its own `isAvailable`, so switching
 * the section back on restores every dish as it was. Everything a customer can reach
 * (the menu, the quote, checkout, reorder, search) reads availability through here, so
 * a dish in an off section is never orderable by one path and refused by another.
 */
import { z } from 'zod';
import type { MenuCategory, RestaurantMenu } from '@quick-bites/shared-types';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { AppError } from '../../utils/AppError.ts';

/** The body of both section-switch routes (partner and admin). */
export const SectionSwitchSchema = z.object({
  isAvailable: z.boolean(),
  /** When the section comes back by itself (ISO time, within 7 days). Absent = until switched on. */
  backAt: z.string().max(40).optional()
});

/** The section as the apps read it after a switch. */
export const sectionState = (c: MenuCategory) => ({
  id: c.id,
  isAvailable: c.isAvailable !== false,
  backAt: c.backAt ?? null
});

/** Longest a section can be switched off "until" a time. */
const MAX_BACK_AT_MS = 7 * 24 * 60 * 60 * 1000;

/** On unless switched off; an off section whose "back at" time has passed counts as on. */
export function sectionIsOn(cat: Partial<MenuCategory>, now = Date.now()): boolean {
  if (cat.isAvailable !== false) return true;
  const back = Date.parse(cat.backAt || '');
  return Number.isFinite(back) && back <= now;
}

/** Every dish by id, unavailable when its section is off. The one map the order paths read. */
export function dishesForOrdering(menu: RestaurantMenu | null | undefined, now = Date.now()): Map<string, any> {
  const dishes = new Map<string, any>();
  for (const cat of menu?.categories || []) {
    const on = sectionIsOn(cat, now);
    for (const dish of cat.items) dishes.set(dish.id, on ? dish : { ...dish, isAvailable: false });
  }
  return dishes;
}

/**
 * The menu as customers see it: an off section's dishes shown unavailable, a section
 * whose time has passed shown on. The stored object itself when no section is off, so
 * the common case allocates nothing.
 */
export function menuForCustomers<T extends RestaurantMenu | null | undefined>(menu: T, now = Date.now()): T {
  if (!menu || menu.categories.every(c => c.isAvailable !== false)) return menu;
  return {
    ...menu,
    categories: menu.categories.map(c => {
      if (c.isAvailable !== false) return c;
      if (sectionIsOn(c, now)) return { ...c, isAvailable: true, backAt: undefined };
      return { ...c, items: c.items.map(i => ({ ...i, isAvailable: false })) };
    })
  } as T;
}

/** Switches a section off (optionally until `backAt`) or back on. Partner and admin routes both call this. */
export async function setSectionAvailability(
  restaurantId: string,
  categoryId: string,
  isAvailable: boolean,
  backAt?: string
): Promise<MenuCategory> {
  const menu = await menuRepository.findByRestaurantId(restaurantId);
  const cat = menu?.categories.find(c => c.id === categoryId);
  if (!menu || !cat) throw new AppError('Menu section not found.', 404, 'SECTION_NOT_FOUND');

  if (isAvailable) {
    delete cat.isAvailable;
    delete cat.backAt;
  } else {
    if (backAt !== undefined) {
      const at = Date.parse(backAt);
      if (!Number.isFinite(at) || at <= Date.now() || at - Date.now() > MAX_BACK_AT_MS) {
        throw new AppError('Choose a time in the next 7 days for the section to come back.', 400, 'INVALID_BACK_AT');
      }
      cat.backAt = new Date(at).toISOString();
    } else {
      delete cat.backAt;
    }
    cat.isAvailable = false;
  }
  await menuRepository.upsert(menu);
  return cat;
}

/**
 * Clears sections whose "back at" time has passed, so the partner and admin screens
 * show them on too (customers already see them on, `sectionIsOn`). Run by the order
 * sweeper; returns the restaurants whose menu changed.
 */
export function reopenSectionsDue(now = Date.now()): string[] {
  const changed: string[] = [];
  for (const menu of memoryStore.menus.values() as Iterable<RestaurantMenu>) {
    let touched = false;
    for (const cat of menu.categories || []) {
      if (cat.isAvailable === false && cat.backAt && sectionIsOn(cat, now)) {
        delete cat.isAvailable;
        delete cat.backAt;
        touched = true;
      }
    }
    if (touched) changed.push(menu.restaurantId);
  }
  // Set back into the map: an in-place edit is not seen by change tracking, so it would never reach Postgres.
  for (const id of changed) memoryStore.menus.set(id, memoryStore.menus.get(id));
  if (changed.length) triggerAutoSave();
  return changed;
}
