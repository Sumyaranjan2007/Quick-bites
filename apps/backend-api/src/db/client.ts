/**
 * Quick Bite Database Client & Data Store
 * Supports Dual Mode: Live Supabase PostgreSQL + PostGIS, with In-Memory Deterministic Engine for Demo Mode / Testing.
 */

export interface DbStore {
  users: Map<string, any>;
  restaurants: Map<string, any>;
  addresses: Map<string, any>;
  orders: Map<string, any>;
  menus: Map<string, any>; // MongoDB equivalent collection
  coupons: Map<string, any>;
  payouts: Map<string, any>;
}

// Global in-memory singleton data store
export const memoryStore: DbStore = {
  users: new Map(),
  restaurants: new Map(),
  addresses: new Map(),
  orders: new Map(),
  menus: new Map(),
  coupons: new Map(),
  payouts: new Map()
};

/**
 * Calculates Haversine distance in kilometers between two GPS coordinate pairs.
 * Mirrors PostGIS ST_Distance(ST_MakePoint(lon1, lat1)::geography, ST_MakePoint(lon2, lat2)::geography).
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}
