import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { RestaurantMenu, MenuItem } from '@quick-bites/shared-types';

export const menuRepository = {
  async findByRestaurantId(restaurantId: string): Promise<RestaurantMenu | null> {
    return memoryStore.menus.get(restaurantId) || null;
  },

  async upsert(menu: RestaurantMenu): Promise<RestaurantMenu> {
    memoryStore.menus.set(menu.restaurantId, menu);
    triggerAutoSave();
    return menu;
  },

  /** Adds a dish to a category, creating the category when it does not exist. */
  async addItem(
    restaurantId: string,
    categoryName: string,
    item: Omit<MenuItem, 'id'>
  ): Promise<MenuItem | null> {
    const menu = memoryStore.menus.get(restaurantId);
    if (!menu) return null;

    let category = menu.categories.find((c: any) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!category) {
      category = {
        id: 'cat_' + crypto.randomUUID(),
        name: categoryName,
        sortOrder: menu.categories.length + 1,
        items: []
      };
      menu.categories.push(category);
    }

    const created: MenuItem = { ...item, id: 'dish_' + crypto.randomUUID() };
    category.items.push(created);

    memoryStore.menus.set(restaurantId, menu);
    triggerAutoSave();
    return created;
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
      triggerAutoSave();
    }
    return found;
  }
};
