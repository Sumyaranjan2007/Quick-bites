import { memoryStore, calculateDistanceKm } from '../client.ts';
import type { Restaurant } from '@quick-bites/shared-types';

export interface NearbyFilter {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  isVegOnly?: boolean;
  cuisine?: string;
}

export const restaurantRepository = {
  async findById(id: string): Promise<Restaurant | null> {
    return memoryStore.restaurants.get(id) || null;
  },

  async findBySlug(slug: string): Promise<Restaurant | null> {
    for (const r of memoryStore.restaurants.values()) {
      if (r.slug === slug) return r;
    }
    return null;
  },

  async findNearby(filter: NearbyFilter): Promise<Array<Restaurant & { distanceKm: number }>> {
    const radius = filter.radiusKm || 15.0; // 15km delivery ceiling
    const results: Array<Restaurant & { distanceKm: number }> = [];

    for (const restaurant of memoryStore.restaurants.values()) {
      if (restaurant.status !== 'ACTIVE') continue;
      if (filter.isVegOnly && !restaurant.isPureVeg) continue;
      if (filter.cuisine && !restaurant.cuisineTags.some((c: string) => c.toLowerCase() === filter.cuisine!.toLowerCase())) {
        continue;
      }

      const distance = calculateDistanceKm(
        filter.latitude,
        filter.longitude,
        restaurant.coordinates.latitude,
        restaurant.coordinates.longitude
      );

      if (distance <= radius) {
        results.push({ ...restaurant, distanceKm: distance });
      }
    }

    // Sort by proximity ascending
    return results.sort((a, b) => a.distanceKm - b.distanceKm);
  },

  async create(restaurant: Restaurant): Promise<Restaurant> {
    memoryStore.restaurants.set(restaurant.id, restaurant);
    return restaurant;
  },

  async updateStatus(id: string, status: Restaurant['status']): Promise<Restaurant | null> {
    const existing = memoryStore.restaurants.get(id);
    if (!existing) return null;
    existing.status = status;
    memoryStore.restaurants.set(id, existing);
    return existing;
  },

  async list(): Promise<Restaurant[]> {
    return Array.from(memoryStore.restaurants.values());
  }
};
