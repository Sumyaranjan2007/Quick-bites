/**
 * Quick Bites Database Client & Data Store
 * Supports Dual Mode: Live Supabase PostgreSQL + PostGIS, with In-Memory Deterministic Engine for Multi-Portal State.
 * Includes Local JSON Persistence Engine to survive server restarts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DATA_DIR = path.resolve(__dirname, '../../data');
export const STORE_FILE = path.resolve(DATA_DIR, 'store.json');

export interface DbStore {
  users: Map<string, any>;
  restaurants: Map<string, any>;
  addresses: Map<string, any>;
  orders: Map<string, any>;
  menus: Map<string, any>;
  coupons: Map<string, any>;
  payouts: Map<string, any>;
  riders: Map<string, any>;
  wallets: Map<string, any>;
  walletTransactions: Map<string, any>;
  kycDocuments: Map<string, any>;
  /** Customer/rider conversation about an order, keyed by message id. */
  orderMessages: Map<string, any>;
  /** Bookkeeping about the snapshot itself, e.g. which seed revision produced it. */
  meta: Map<string, any>;
}

// Global in-memory singleton data store
export const memoryStore: DbStore = {
  users: new Map(),
  restaurants: new Map(),
  addresses: new Map(),
  orders: new Map(),
  menus: new Map(),
  coupons: new Map(),
  payouts: new Map(),
  riders: new Map(),
  wallets: new Map(),
  walletTransactions: new Map(),
  kycDocuments: new Map(),
  orderMessages: new Map(),
  meta: new Map()
};

/**
 * Empties every collection in the store.
 *
 * Used when a snapshot on disk was written by an older revision of the seed: the
 * stale rows are dropped so the current seed can repopulate from scratch,
 * instead of the two being silently merged.
 */
export function clearStore(): void {
  for (const map of Object.values(memoryStore)) {
    (map as Map<string, any>).clear();
  }
}

/**
 * Persists the entire in-memory data store to a JSON file on disk.
 */
export function saveStoreToFile(customPath?: string): void {
  try {
    const targetFile = customPath || STORE_FILE;
    const targetDir = path.dirname(targetFile);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const serialized: Record<string, any[]> = {};
    for (const [key, map] of Object.entries(memoryStore)) {
      serialized[key] = Array.from((map as Map<string, any>).entries());
    }
    fs.writeFileSync(targetFile, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (err) {
    console.error('[WARN] Failed to save database store to disk:', err);
  }
}

/**
 * Loads and hydrates the in-memory data store from the persistent JSON file on disk.
 */
export function loadStoreFromFile(customPath?: string): boolean {
  try {
    const targetFile = customPath || STORE_FILE;
    if (!fs.existsSync(targetFile)) {
      return false;
    }
    const raw = fs.readFileSync(targetFile, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [key, entries] of Object.entries(parsed)) {
      if ((memoryStore as any)[key] && Array.isArray(entries)) {
        (memoryStore as any)[key] = new Map(entries as [string, any][]);
      }
    }
    return true;
  } catch (err) {
    console.error('[WARN] Failed to load database store from disk:', err);
    return false;
  }
}

/**
 * Where mutations are persisted.
 *
 * Defaults to the JSON file, which is right for local development. A hosted
 * deployment installs a database-backed one at boot, because the container
 * filesystem is discarded on every redeploy — orders written to it did not
 * survive a restart. Kept as an injected backend rather than an import so this
 * module stays free of a dependency on any particular database driver.
 */
export interface PersistenceBackend {
  save: () => Promise<void>;
}

let backend: PersistenceBackend | null = null;

export function setPersistenceBackend(next: PersistenceBackend | null): void {
  backend = next;
}

/** Serialises saves so a slow write cannot overlap the next one. */
let inFlight: Promise<void> = Promise.resolve();

export function flushStore(): Promise<void> {
  const run = async () => {
    if (backend) await backend.save();
    else saveStoreToFile();
  };
  inFlight = inFlight.then(run, run);
  return inFlight;
}

let autoSaveTimer: NodeJS.Timeout | null = null;
/**
 * Debounced automatic persistence trigger called after state mutations.
 */
export function triggerAutoSave(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    // A persistence failure must be visible: the request has already returned
    // success to the caller, so silence here means data loss nobody notices.
    flushStore().catch(err => {
      console.error('[ERROR] Failed to persist the database store:', err);
    });
  }, 300);
}

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
