import { memoryStore, calculateDistanceKm, triggerAutoSave } from '../client.ts';
import { config } from '../../config/env.ts';
import { estimateByRoad } from '../../modules/places/routingService.ts';
import { hasRealLocation } from '../../modules/restaurants/restaurantLocation.ts';
import {
  EDITABLE_PROFILE_FIELDS,
  type EditableProfile,
  type Restaurant
} from '@quick-bites/shared-types';

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

  /**
   * The restaurants that will actually deliver to where this customer is.
   *
   * This used to be one platform-wide 15 km circle drawn around the customer,
   * which got the question backwards. Whether a kitchen delivers to a doorstep
   * is a fact about the kitchen: a single-rider place covers a couple of
   * kilometres, a chain covers eight. Listing on one shared radius showed people
   * restaurants that would decline their order, and hid ones a street away from
   * anybody standing just past the edge.
   *
   * Each restaurant is now measured against its OWN `serviceRadiusKm`, with the
   * caller's radius kept as an outer ceiling so a client can still ask for a
   * narrower list than the restaurants themselves would allow.
   *
   * The distance returned is a road ESTIMATE, not a measurement. A real road
   * distance for every restaurant on the home screen would be a paid Google
   * element each, on the most-visited screen in the product; the straight line
   * scaled by the road factor is close enough to sort a list by and costs
   * nothing. The one restaurant a customer actually orders from is measured
   * properly at checkout, where the number decides a charge.
   */
  async findNearby(filter: NearbyFilter): Promise<Array<Restaurant & { distanceKm: number }>> {
    const ceiling = filter.radiusKm || 15.0;
    const origin = { latitude: filter.latitude, longitude: filter.longitude };
    const results: Array<Restaurant & { distanceKm: number }> = [];

    for (const restaurant of memoryStore.restaurants.values()) {
      if (restaurant.status !== 'ACTIVE') continue;
      if (filter.isVegOnly && !restaurant.isPureVeg) continue;
      if (filter.cuisine && !restaurant.cuisineTags.some((c: string) => c.toLowerCase() === filter.cuisine!.toLowerCase())) {
        continue;
      }

      // A restaurant that was never placed on a map is kept rather than
      // measured. See modules/restaurants/restaurantLocation.ts for why
      // excluding it would empty the list for its own neighbours.
      if (!hasRealLocation(restaurant)) {
        results.push({ ...restaurant, distanceKm: 0 });
        continue;
      }

      // The region test is on the straight line, because a service area is a
      // circle drawn on a map and that is what a circle means. The distance
      // SHOWN is the road estimate, because that is what the customer is being
      // told about their food.
      const straightLine = calculateDistanceKm(
        filter.latitude,
        filter.longitude,
        restaurant.coordinates.latitude,
        restaurant.coordinates.longitude
      );

      const serviceRadius = Number(restaurant.serviceRadiusKm) || config.DEFAULT_SERVICE_RADIUS_KM;
      if (straightLine > Math.min(serviceRadius, ceiling)) continue;

      results.push({
        ...restaurant,
        distanceKm: estimateByRoad(origin, restaurant.coordinates).distanceKm
      });
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
    triggerAutoSave();
    return existing;
  },

  /** Moves the restaurant through verification as its documents are reviewed. */
  async updateKycStatus(id: string, kycStatus: Restaurant['kycStatus']): Promise<Restaurant | null> {
    const existing = memoryStore.restaurants.get(id);
    if (!existing) return null;
    existing.kycStatus = kycStatus;
    memoryStore.restaurants.set(id, existing);
    triggerAutoSave();
    return existing;
  },

  /**
   * Opens or closes the kitchen.
   *
   * The route used to assign `restaurant.isOpen` directly and never call
   * triggerAutoSave, so the toggle was never written down: it survived in memory
   * until the next restart and then reverted, which is exactly the "I switched it
   * to Offline and it still says Online" the partner reported.
   */
  async setOpenState(id: string, isOpen: boolean): Promise<Restaurant | null> {
    const existing = memoryStore.restaurants.get(id);
    if (!existing) return null;
    existing.isOpen = isOpen;
    existing.kitchenStatusChangedAt = new Date().toISOString();
    memoryStore.restaurants.set(id, existing);
    triggerAutoSave();
    return existing;
  },

  /**
   * Writes approved profile fields onto the live record.
   *
   * Takes only the fields a reviewer accepted, never a whole record. That is
   * the difference between approving a name change and silently reverting
   * everything else about the restaurant to whatever the partner's app had
   * cached when they opened the form.
   *
   * Nothing here validates: by the time a field reaches this method it has
   * passed the partner-side schema AND a human. The one thing it refuses is a
   * field outside the editable list, because a bug that let `commissionPercent`
   * through this door would let a partner set the platform's own margin.
   */
  async applyProfile(
    id: string,
    fields: Partial<EditableProfile>
  ): Promise<Restaurant | null> {
    const existing = memoryStore.restaurants.get(id);
    if (!existing) return null;

    for (const [key, value] of Object.entries(fields)) {
      if (!(EDITABLE_PROFILE_FIELDS as readonly string[]).includes(key)) continue;
      if (value === undefined) continue;
      (existing as Record<string, unknown>)[key] = value;
    }

    memoryStore.restaurants.set(id, existing);
    triggerAutoSave();
    return existing;
  },

  /**
   * The partner's manual override of their own declared hours.
   *
   * Stored as an expiry rather than a flag so it cannot quietly become
   * permanent — which is the exact failure declared hours exist to fix.
   */
  async setForceOpenUntil(id: string, until: string | undefined): Promise<Restaurant | null> {
    const existing = memoryStore.restaurants.get(id);
    if (!existing) return null;
    if (until) existing.forceOpenUntil = until;
    else delete existing.forceOpenUntil;
    memoryStore.restaurants.set(id, existing);
    triggerAutoSave();
    return existing;
  },

  async list(): Promise<Restaurant[]> {
    return Array.from(memoryStore.restaurants.values());
  },

  async listActive(): Promise<Restaurant[]> {
    return Array.from(memoryStore.restaurants.values()).filter(r => r.status === 'ACTIVE');
  },

  async listAll(): Promise<Restaurant[]> {
    return Array.from(memoryStore.restaurants.values());
  },

  /**
   * Folds one order's rating into the restaurant's running average.
   *
   * Stored as an average plus a count rather than a list of every rating: the
   * individual scores belong to their orders, and keeping a second copy here
   * would be a second source of truth that could drift.
   */
  async addRating(restaurantId: string, rating: number): Promise<void> {
    const restaurant = memoryStore.restaurants.get(restaurantId);
    if (!restaurant) return;
    const count = Number(restaurant.ratingCount) || 0;
    const average = Number(restaurant.ratingAverage) || 0;
    const nextCount = count + 1;
    restaurant.ratingAverage = Math.round(((average * count + rating) / nextCount) * 10) / 10;
    restaurant.ratingCount = nextCount;
    memoryStore.restaurants.set(restaurantId, restaurant);
    triggerAutoSave();
  }
};
