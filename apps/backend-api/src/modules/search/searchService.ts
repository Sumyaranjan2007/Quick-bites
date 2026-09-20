import { meiliClient } from './meiliClient.ts';
import { searchCache } from './searchCache.ts';
import { calculateDistanceKm } from '../../db/client.ts';
import { searchDishesInMenus } from './menuFallbackSearch.ts';

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
  /**
   * Applied after the index answers, not inside the query.
   *
   * Delivery time and price band are derived from the searcher's position and
   * from fields the index does not filter on, so they cannot be pushed into the
   * Meilisearch filter without reindexing per user. Filtering the hits is
   * correct here and wrong at scale; when the catalogue outgrows it, these move
   * into the index as pre-computed facets.
   */
  maxDeliveryMinutes?: number;
  minCostForTwo?: number;
  maxCostForTwo?: number;
  sort?: 'relevance' | 'rating' | 'deliveryTime' | 'costLowToHigh' | 'costHighToLow' | 'distance';
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
    // Every parameter that changes the answer must be in the key. A filter left
    // out of it would serve one customer's veg-only results to the next person
    // who searched the same word.
    const cacheKey =
      `search:${query}:${type}:${params.isVeg}:${params.minRating}:${params.city}:` +
      `${params.latitude}:${params.longitude}:${limit}:${offset}:` +
      `${params.maxDeliveryMinutes}:${params.minCostForTwo}:${params.maxCostForTwo}:${params.sort}`;
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

      // Nothing from the index is ambiguous: it means either that no dish
      // matches, or that there is no index. Both were true here — the local
      // config held a placeholder host and the live deployment answered 200
      // with an empty list for dishes that certainly exist on its menus — so
      // the dish filter in the customer app would have done nothing at all.
      //
      // Walking the menus is correct at this catalogue's size and wrong at ten
      // thousand restaurants, which is exactly when configuring Meilisearch
      // becomes worth it. A working index always wins, so this costs nothing on
      // a deployment that has one.
      if (dishes.length === 0 && query) {
        dishes = searchDishesInMenus(query, limit).filter(d => {
          if (params.isVeg !== undefined && d.isVeg !== params.isVeg) return false;
          return true;
        });
      }
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

    // Delivery time exists only when the searcher told us where they are; with
    // no position there is no distance and so no estimate, and filtering on a
    // figure that was never computed would empty the results.
    if (params.maxDeliveryMinutes !== undefined) {
      const cap = params.maxDeliveryMinutes;
      const within = (row: any) =>
        row.estimatedDeliveryMinutes === undefined || row.estimatedDeliveryMinutes <= cap;
      restaurants = restaurants.filter(within);
      dishes = dishes.filter(within);
    }

    // A row with no published price stays in every band, for the same reason as
    // in the discovery feed: a missing field should not hide a real kitchen.
    if (params.minCostForTwo !== undefined || params.maxCostForTwo !== undefined) {
      const min = params.minCostForTwo;
      const max = params.maxCostForTwo;
      const inBand = (value: unknown) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return true;
        if (min !== undefined && n < min) return false;
        if (max !== undefined && n > max) return false;
        return true;
      };
      restaurants = restaurants.filter(r => inBand(r.costForTwo));
      dishes = dishes.filter(d => inBand(d.price));
    }

    if (params.sort && params.sort !== 'relevance') {
      const rating = (row: any) => Number(row.ratingAverage ?? row.rating) || 0;
      const cost = (row: any) => Number(row.costForTwo ?? row.price) || 0;
      const eta = (row: any) => Number(row.estimatedDeliveryMinutes) || Number.MAX_SAFE_INTEGER;
      const distance = (row: any) => Number(row.distanceKm) || Number.MAX_SAFE_INTEGER;
      const comparators: Record<string, (a: any, b: any) => number> = {
        rating: (a, b) => rating(b) - rating(a),
        deliveryTime: (a, b) => eta(a) - eta(b),
        distance: (a, b) => distance(a) - distance(b),
        costLowToHigh: (a, b) => cost(a) - cost(b),
        costHighToLow: (a, b) => cost(b) - cost(a)
      };
      const comparator = comparators[params.sort];
      if (comparator) {
        restaurants = [...restaurants].sort(comparator);
        dishes = [...dishes].sort(comparator);
      }
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
