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

  /**
   * The restaurant's menu document, created empty if it does not exist yet.
   *
   * A menu is a container, not a thing a restaurant has to be given before it
   * can have dishes. Treating its absence as an error produced a deadlock that
   * no partner could escape: a newly onboarded restaurant has no menu document,
   * so approving its very first dish failed with "That restaurant has no menu to
   * add to" — and the only way a menu could come into existence was by approving
   * a dish. Every new restaurant was therefore permanently unable to publish
   * anything, and the administrator was told the restaurant was at fault.
   */
  async ensureMenu(restaurantId: string): Promise<RestaurantMenu> {
    const existing = memoryStore.menus.get(restaurantId);
    if (existing) return existing;

    const menu: RestaurantMenu = {
      id: 'menu_' + crypto.randomUUID(),
      restaurantId,
      categories: [],
      updatedAt: new Date().toISOString()
    } as RestaurantMenu;
    memoryStore.menus.set(restaurantId, menu);
    triggerAutoSave();
    return menu;
  },

  /** Adds a dish to a category, creating the category when it does not exist. */
  async addItem(
    restaurantId: string,
    categoryName: string,
    item: Omit<MenuItem, 'id'>
  ): Promise<MenuItem | null> {
    const menu = await this.ensureMenu(restaurantId);

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

  /** Edits an existing dish. Only the supplied fields change. */
  async updateItem(
    restaurantId: string,
    dishId: string,
    updates: Partial<Omit<MenuItem, 'id'>> & { categoryName?: string }
  ): Promise<MenuItem | null> {
    const menu = memoryStore.menus.get(restaurantId);
    if (!menu) return null;

    const { categoryName, ...fields } = updates;

    for (const category of menu.categories) {
      const item = category.items.find((i: MenuItem) => i.id === dishId);
      if (!item) continue;

      Object.assign(item, fields, { id: item.id });

      // Moving a dish to a different (or new) category.
      if (categoryName && category.name.toLowerCase() !== categoryName.toLowerCase()) {
        category.items = category.items.filter((i: MenuItem) => i.id !== dishId);
        let target = menu.categories.find(
          (c: any) => c.name.toLowerCase() === categoryName.toLowerCase()
        );
        if (!target) {
          target = {
            id: 'cat_' + crypto.randomUUID(),
            name: categoryName,
            sortOrder: menu.categories.length + 1,
            items: []
          };
          menu.categories.push(target);
        }
        target.items.push(item);
      }

      memoryStore.menus.set(restaurantId, menu);
      triggerAutoSave();
      return item;
    }
    return null;
  },

  /** Removes a dish, and drops the category if it is left empty. */
  async removeItem(restaurantId: string, dishId: string): Promise<boolean> {
    const menu = memoryStore.menus.get(restaurantId);
    if (!menu) return false;

    let removed = false;
    for (const category of menu.categories) {
      const before = category.items.length;
      category.items = category.items.filter((i: MenuItem) => i.id !== dishId);
      if (category.items.length !== before) {
        removed = true;
        break;
      }
    }

    if (removed) {
      menu.categories = menu.categories.filter((c: any) => c.items.length > 0);
      memoryStore.menus.set(restaurantId, menu);
      triggerAutoSave();
    }
    return removed;
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
