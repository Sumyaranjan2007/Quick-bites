/**
 * Searching dishes without a search engine.
 *
 * `searchCatalog` asks Meilisearch. On a deployment where Meilisearch is not
 * configured, or is configured but has never been synced, it answers with an
 * empty list and an HTTP 200 — so "no restaurant near you serves biryani" and
 * "we have no search index" are indistinguishable from the app's side. Both
 * were true of this platform when the dish filter was built: the local `.env`
 * held `https://your-search.meilisearch.io` and the live deployment returned
 * nothing for every dish that certainly exists on its menus.
 *
 * A feature that depends on infrastructure nobody has set up is a feature that
 * does not work. This walks the menus directly instead.
 *
 * IT IS NOT A SEARCH ENGINE AND DOES NOT PRETEND TO BE. There is no typo
 * tolerance, no stemming, no ranking by relevance — it is a substring match
 * over dish names, which is what somebody typing "biryani" actually wants and
 * is honest about being. It is correct at this catalogue's size and would be
 * wrong at ten thousand restaurants, which is exactly when Meilisearch becomes
 * worth configuring; at that point this becomes dead code and should go.
 *
 * Used only when the index returns nothing, so a working Meilisearch always
 * wins and this costs nothing on a deployment that has one.
 */
import { memoryStore } from '../../db/client.ts';
import type { Restaurant } from '@quick-bites/shared-types';

export interface DishHit {
  id: string;
  name: string;
  description?: string;
  price: number;
  isVeg: boolean;
  imageUrl?: string;
  restaurantId: string;
  restaurantName: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Every available dish whose name or description contains `query`.
 *
 * Only ACTIVE restaurants, because an unapproved kitchen's menu is not
 * something a customer should be able to find by searching for one of its
 * dishes — the approval gate would otherwise be bypassable by anyone who
 * guessed a dish name.
 */
export function searchDishesInMenus(query: string, limit = 40): DishHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const hits: DishHit[] = [];

  for (const menu of memoryStore.menus.values()) {
    const restaurant = memoryStore.restaurants.get(menu.restaurantId) as Restaurant | undefined;
    if (!restaurant || restaurant.status !== 'ACTIVE') continue;

    for (const category of menu.categories || []) {
      for (const item of category.items || []) {
        if (item.isAvailable === false) continue;

        const name = String(item.name || '').toLowerCase();
        const description = String(item.description || '').toLowerCase();
        if (!name.includes(needle) && !description.includes(needle)) continue;

        hits.push({
          id: item.id,
          name: item.name,
          description: item.description,
          price: Number(item.price) || 0,
          isVeg: Boolean(item.isVeg),
          imageUrl: item.imageUrl,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          latitude: restaurant.coordinates?.latitude,
          longitude: restaurant.coordinates?.longitude
        });

        // Bounded here rather than after building the whole list: a catalogue
        // with a thousand dishes called "Paneer something" would otherwise be
        // assembled in full and then thrown away.
        if (hits.length >= limit) return hits;
      }
    }
  }

  // A name match beats a description match. "Chicken Biryani" should come above
  // a curry whose description happens to mention biryani rice.
  return hits.sort((a, b) => {
    const aName = a.name.toLowerCase().includes(needle) ? 0 : 1;
    const bName = b.name.toLowerCase().includes(needle) ? 0 : 1;
    return aName - bName;
  });
}
