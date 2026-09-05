import { meiliClient } from './meiliClient.ts';
import { searchCache } from './searchCache.ts';
import { calculateDistanceKm } from '../../db/client.ts';

export interface SearchCatalogParams {
  query?: string;
  latitude?: number;
  longitude?: number;
  isVeg?: boolean;
  minRating?: number;
  city?: string;
  type?: 'all' | 'restaurants' | 'dishes';
  limit?: number;
  offset?: number;
}

export interface SuggestionItem {
  type: 'restaurant' | 'dish' | 'cuisine';
  text: string;
  subtext?: string;
}

export const searchService = {
  async searchCatalog(params: SearchCatalogParams) {
    const startTime = performance.now();
    const query = (params.query || '').trim();
    const type = params.type || 'all';
    const limit = params.limit || 20;
    const offset = params.offset || 0;

    // Cache key incorporates all query parameters
    const cacheKey = `search:${query}:${type}:${params.isVeg}:${params.minRating}:${params.city}:${params.latitude}:${params.longitude}:${limit}:${offset}`;
    const cached = await searchCache.get<any>(cacheKey);
    if (cached) {
      return {
        ...cached,
        processingTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
        source: 'cache'
      };
    }

    const filter: Record<string, any> = {
      isAvailable: true
    };
    if (params.isVeg !== undefined) {
      filter.isVeg = params.isVeg;
    }
    if (params.minRating !== undefined) {
      filter.minRating = params.minRating;
    }
    if (params.city) {
      filter.city = params.city;
    }

    let restaurants: any[] = [];
    let dishes: any[] = [];

    // Search restaurants index
    if (type === 'all' || type === 'restaurants') {
      const res = await meiliClient.search<any>('restaurants', query, {
        filter,
        limit,
        offset
      });
      restaurants = res.hits;
    }

    // Search dishes index
    if (type === 'all' || type === 'dishes') {
      const res = await meiliClient.search<any>('dishes', query, {
        filter,
        limit,
        offset
      });
      dishes = res.hits;
    }

    // Annotate with spatial delivery estimates if coordinates provided
    if (params.latitude !== undefined && params.longitude !== undefined) {
      const userLat = Number(params.latitude);
      const userLng = Number(params.longitude);

      restaurants = restaurants.map(r => {
        const dist = calculateDistanceKm(userLat, userLng, r.latitude, r.longitude);
        const estMinutes = 20 + Math.ceil(dist * 3.5); // 20m prep + 3.5m/km travel
        return {
          ...r,
          distanceKm: dist,
          estimatedDeliveryMinutes: estMinutes
        };
      });

      dishes = dishes.map(d => {
        const dist = calculateDistanceKm(userLat, userLng, d.latitude, d.longitude);
        const estMinutes = 20 + Math.ceil(dist * 3.5);
        return {
          ...d,
          distanceKm: dist,
          estimatedDeliveryMinutes: estMinutes
        };
      });
    }

    const totalHits = restaurants.length + dishes.length;
    const processingTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    const result = {
      query,
      restaurants,
      dishes,
      totalHits,
      processingTimeMs,
      source: 'meilisearch'
    };

    // Cache for 60 seconds
    await searchCache.set(cacheKey, result, 60 * 1000);

    return result;
  },

  async getSuggestions(query: string): Promise<SuggestionItem[]> {
    const q = (query || '').trim().toLowerCase();
    if (q.length === 0) return [];

    const cacheKey = `suggestions:${q}`;
    const cached = await searchCache.get<SuggestionItem[]>(cacheKey);
    if (cached) return cached;

    const suggestions: SuggestionItem[] = [];
    const seen = new Set<string>();

    // 1. Search dishes
    const dishRes = await meiliClient.search<any>('dishes', q, { limit: 5 });
    for (const d of dishRes.hits) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        suggestions.push({
          type: 'dish',
          text: d.name,
          subtext: `in ${d.restaurantName}`
        });
      }
    }

    // 2. Search restaurants
    const restRes = await meiliClient.search<any>('restaurants', q, { limit: 3 });
    for (const r of restRes.hits) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        suggestions.push({
          type: 'restaurant',
          text: r.name,
          subtext: `${r.city}`
        });
      }

      // Check matching cuisine tags
      if (Array.isArray(r.cuisineTags)) {
        for (const tag of r.cuisineTags) {
          if (tag.toLowerCase().includes(q) && !seen.has(tag)) {
            seen.add(tag);
            suggestions.push({
              type: 'cuisine',
              text: tag
            });
          }
        }
      }
    }

    const finalSuggestions = suggestions.slice(0, 6);
    await searchCache.set(cacheKey, finalSuggestions, 60 * 1000);

    return finalSuggestions;
  }
};
