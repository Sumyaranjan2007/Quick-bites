import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { onCollectionChange } from '../../db/client.ts';
import { customerDishPrice } from '../payments/restaurantCharges.ts';
import { meiliClient } from './meiliClient.ts';
import { searchCache } from './searchCache.ts';

export interface SyncReport {
  success: boolean;
  restaurantsIndexed: number;
  dishesIndexed: number;
  durationMs: number;
  timestamp: string;
}

/** Collections the index is built from. A change to any of them rebuilds it. */
const CATALOG_COLLECTIONS = new Set(['restaurants', 'menus', 'restaurantCharges']);
const RESYNC_DELAY_MS = 1_500;

let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let stopWatching: (() => void) | null = null;

export const syncService = {
  async syncCatalog(): Promise<SyncReport> {
    const startTime = performance.now();

    // 1. Fetch data from repositories
    const restaurants = await restaurantRepository.list();
    const restaurantDocs: any[] = [];
    const dishDocs: any[] = [];

    for (const r of restaurants) {
      const rest = r as any;
      const city = rest.city || rest.address?.city || 'Bengaluru';
      const addressLine = rest.addressLine || rest.address?.street || '';
      const description = addressLine ? `${addressLine}, ${city}` : city;

      // Build restaurant search document
      restaurantDocs.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        cuisineTags: r.cuisineTags,
        description,
        isVeg: r.isPureVeg,
        rating: r.ratingAverage,
        ratingCount: r.ratingCount,
        city,
        latitude: r.coordinates?.latitude || 12.9716,
        longitude: r.coordinates?.longitude || 77.5946,
        isAvailable: r.status === 'ACTIVE',
        packagingFee: r.packagingFee,
        // Indexed because search filters and sorts on them. Without these two,
        // a price band on /search silently matched every kitchen (a row with no
        // published price deliberately stays in every band, and NONE of them
        // had one), and "cost: low to high" ordered every result by zero.
        // The filter looked like it worked because nothing was ever excluded.
        costForTwo: r.costForTwo,
        isOpen: r.isOpen !== false,
        // Both spellings: `rating` is what this index has always used, and
        // `ratingAverage` is what every other surface calls it. A filter that
        // has to know which one it is looking at will eventually pick wrong.
        ratingAverage: r.ratingAverage,
        imageUrl: (r as any).imageUrl || ''
      });

      // Fetch menus
      const menu = await menuRepository.findByRestaurantId(r.id);
      if (menu && menu.categories) {
        for (const cat of menu.categories) {
          for (const item of cat.items) {
            dishDocs.push({
              id: item.id,
              restaurantId: r.id,
              restaurantName: r.name,
              restaurantRating: r.ratingAverage,
              name: item.name,
              description: item.description,
              // The CUSTOMER's price. The menu stores the kitchen's, and search
              // is read by customers: indexing the raw figure showed a dish
              // cheaper in search than on the menu it opens.
              price: customerDishPrice(r.id, item.id, item.price),
              isVeg: item.isVeg,
              categoryName: cat.name,
              cuisineTags: r.cuisineTags,
              isAvailable: item.isAvailable && r.status === 'ACTIVE',
              city,
              rating: r.ratingAverage,
              latitude: r.coordinates?.latitude || 12.9716,
              longitude: r.coordinates?.longitude || 77.5946,
              imageUrl: item.imageUrl
            });
          }
        }
      }
    }

    // 2. Configure Meilisearch settings
    await meiliClient.setSettings('restaurants', {
      searchableAttributes: ['name', 'cuisineTags', 'description'],
      filterableAttributes: ['isVeg', 'rating', 'city', 'isAvailable'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
    });

    await meiliClient.setSettings('dishes', {
      searchableAttributes: ['name', 'cuisineTags', 'description'],
      filterableAttributes: ['isVeg', 'rating', 'city', 'isAvailable'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
    });

    // 3. Rebuild, not merge: a deleted dish or restaurant must leave the index
    //    too, and adding alone kept every document ever indexed.
    meiliClient.getIndex('restaurants').deleteDocuments();
    meiliClient.getIndex('dishes').deleteDocuments();
    await meiliClient.addDocuments('restaurants', restaurantDocs);
    await meiliClient.addDocuments('dishes', dishDocs);

    // 4. Invalidate search cache
    await searchCache.flush();

    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
      success: true,
      restaurantsIndexed: restaurantDocs.length,
      dishesIndexed: dishDocs.length,
      durationMs,
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Rebuilds the index shortly after the catalogue changes.
   *
   * Debounced: approving a menu writes the menu, the request and the
   * restaurant in one go, and that is one rebuild, not three.
   */
  scheduleResync(): void {
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      syncService.syncCatalog().catch(err => console.error('[ERROR] Search index rebuild failed:', err));
    }, RESYNC_DELAY_MS);
    resyncTimer.unref?.();
  },

  /**
   * Fills the index now and keeps it current from here on.
   *
   * THE INDEX WAS NEVER FILLED. Only `POST /search/sync` and a script wrote
   * it, and nothing called either, so on the live server searching a
   * restaurant or a cuisine found nothing and suggestions were always empty.
   * Called once at boot, after the store is loaded.
   */
  async startIndexing(): Promise<SyncReport> {
    stopWatching?.();
    stopWatching = onCollectionChange(collection => {
      if (CATALOG_COLLECTIONS.has(collection)) syncService.scheduleResync();
    });
    return syncService.syncCatalog();
  },

  /** For tests: stop watching and drop any pending rebuild. */
  stopIndexing(): void {
    stopWatching?.();
    stopWatching = null;
    if (resyncTimer) clearTimeout(resyncTimer);
    resyncTimer = null;
  }
};
