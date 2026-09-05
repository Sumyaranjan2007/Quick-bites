import { memoryStore } from '../client.ts';
import type { RestaurantMenu, MenuItem } from '@quick-bites/shared-types';

export const menuRepository = {
  async findByRestaurantId(restaurantId: string): Promise<RestaurantMenu | null> {
    return memoryStore.menus.get(restaurantId) || null;
  },

  async upsert(menu: RestaurantMenu): Promise<RestaurantMenu> {
    memoryStore.menus.set(menu.restaurantId, menu);
    return menu;
  },

  async updateItemStock(restaurantId: string, dishId: string, isAvailable: boolean): Promise<boolean> {
    const menu = memoryStore.menus.get(restaurantId);
    if (!menu) return false;

    let found = false;
    for (const category of menu.categories) {
      for (const item of category.items) {
        if (item.id === dishId) {
          item.isAvailable = isAvailable;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (found) {
      memoryStore.menus.set(restaurantId, menu);
    }
    return found;
  }
};
