import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { meiliClient } from './meiliClient.ts';
import { searchCache } from './searchCache.ts';

export interface SyncReport {
  success: boolean;
  restaurantsIndexed: number;
  dishesIndexed: number;
  durationMs: number;
  timestamp: string;
}

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
              price: item.price,
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

    // 3. Batch index documents
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
  }
};
