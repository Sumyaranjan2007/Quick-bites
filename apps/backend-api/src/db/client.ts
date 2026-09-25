/**
 * Quick Bites Database Client & Data Store
 * Supports Dual Mode: Live Supabase PostgreSQL + PostGIS, with In-Memory Deterministic Engine for Multi-Portal State.
 * Includes Local JSON Persistence Engine to survive server restarts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/*
 * A cycle, deliberately: normaliseStore imports `memoryStore` from this
 * module. Harmless for ES modules because the binding is read when
 * loadStoreFromFile RUNS, not while either module is being evaluated.
 */
import { normaliseLoadedStore } from './normaliseStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Where the local JSON snapshot lives.
 *
 * Overridable so a test can point a whole server at an empty directory and
 * observe what a genuinely fresh deployment does. Without that, "does it start
 * empty?" can only ever be answered against whatever this developer's machine
 * happens to have lying in `data/` — which is how that check passed for four
 * seeded restaurants.
 */
export const DATA_DIR = process.env.QB_DATA_DIR
  ? path.resolve(process.env.QB_DATA_DIR)
  : path.resolve(__dirname, '../../data');
export const STORE_FILE = path.resolve(DATA_DIR, 'store.json');

/*
 * A SUITE MAY NOT WRITE TO THE DEVELOPER'S STORE.
 *
 * `scripts/run-backend-tests.mjs` gives every suite a directory of its own via
 * QB_DATA_DIR, and while the suites are run that way this cannot happen. But
 * the isolation lived entirely in the runner, so running one suite directly —
 * which is the obvious thing to do while writing it — silently wrote fixtures
 * into `apps/backend-api/data/store.json`. That is exactly how ord_markup_1,
 * rst_charge_1 and rst_silent ended up in a store meant to hold seeded data.
 *
 * Nothing about that failure was visible. The suite passed, the file was not
 * tracked by git so no diff appeared, and the fixtures simply sat there behind
 * whatever was loaded next.
 *
 * So the rule is enforced where the path is decided rather than in the runner
 * that happens to set it. Detected from the entry file instead of NODE_ENV,
 * because NODE_ENV is another thing a person has to remember, and the whole
 * defect was a thing a person had to remember.
 */
const ENTRY = process.argv[1] || '';
if (/\.test\.(ts|mts|js)$/.test(ENTRY) && !process.env.QB_DATA_DIR) {
  throw new Error(
    'This suite would write to the developer store at ' +
      STORE_FILE +
      '.\nRun the suites with `node scripts/run-backend-tests.mjs`, or set QB_DATA_DIR ' +
      'to a throwaway directory to run this one on its own.'
  );
}

export interface DbStore {
  users: Map<string, any>;
  restaurants: Map<string, any>;
  addresses: Map<string, any>;
  orders: Map<string, any>;
  menus: Map<string, any>;
  coupons: Map<string, any>;
  payouts: Map<string, any>;
  /** Payments from the platform to restaurants for periods of trading. */
  restaurantSettlements: Map<string, any>;
  riders: Map<string, any>;
  wallets: Map<string, any>;
  walletTransactions: Map<string, any>;
  kycDocuments: Map<string, any>;
  /** Customer/rider conversation about an order, keyed by message id. */
  orderMessages: Map<string, any>;
  /** Partner requests to add or change a menu item, awaiting admin review. */
  menuRequests: Map<string, any>;
  /** Emergency alerts raised by riders from the Safety & SOS screen. */
  sosAlerts: Map<string, any>;
  /** Incentive milestones already paid out, so a target pays exactly once. */
  riderIncentives: Map<string, any>;
  /** Named permission sets an administrator account can be assigned. */
  adminRoles: Map<string, any>;
  /** Immutable record of every administrative action, newest written last. */
  auditLogs: Map<string, any>;
  /** Return/refund cases raised by customers and riders, awaiting a decision. */
  refundRequests: Map<string, any>;
  /** Complaints and questions raised from any of the four apps. */
  supportTickets: Map<string, any>;
  /** Platform-wide food categories used for discovery and coupon targeting. */
  categories: Map<string, any>;
  /** Key-value platform settings an administrator can change at runtime. */
  settings: Map<string, any>;
  /**
   * Every version of the platform's rates. Append-only: an administrator
   * changing a rate writes a new version rather than editing the live one, so
   * an order priced last month can still be explained.
   */
  pricingConfigs: Map<string, any>;
  /**
   * Double-entry money movements. Append-only, and the authority on every
   * balance the platform reports — balances are derived from this, never
   * stored alongside it.
   */
  ledgerEntries: Map<string, any>;
  /**
   * Where a partner's or a rider's money is sent. Holds no full account
   * number: once a penny drop verifies one, Razorpay's fund account id is what
   * we pay to and the digits are discarded.
   */
  payeeAccounts: Map<string, any>;
  /** Cash a rider collected on COD and is bringing in to the office. */
  cashDeposits: Map<string, any>;
  /**
   * A partner or rider saying they would like to be paid.
   *
   * Carries no amount by design. What they are owed is derived from the ledger
   * when an administrator acts, so there is nothing stored here for a payee to
   * inflate and nothing that travels towards a bank.
   */
  payoutRequests: Map<string, any>;
  /**
   * What each restaurant costs a customer, keyed by restaurant id.
   *
   * Deliberately NOT stored on the restaurant record. The partner writes their
   * own declared packaging figure onto that record; the platform writes its
   * markup here. Two collections means the two writes can never land on one
   * object and quietly overwrite each other.
   */
  restaurantCharges: Map<string, any>;
  /**
   * Changes a partner has asked to make to how their restaurant appears.
   *
   * Held apart from the restaurant itself on purpose. Everything a customer
   * sees passes a human first, so the live record must never carry an
   * unreviewed name or an unreviewed photograph — not even for the length of a
   * review queue. Approval is the only thing that writes to a restaurant.
   */
  profileEdits: Map<string, any>;
  /** Where a push notification is actually delivered: one row per installed app. */
  deviceTokens: Map<string, any>;
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
  restaurantSettlements: new Map(),
  riders: new Map(),
  wallets: new Map(),
  walletTransactions: new Map(),
  kycDocuments: new Map(),
  orderMessages: new Map(),
  menuRequests: new Map(),
  sosAlerts: new Map(),
  riderIncentives: new Map(),
  adminRoles: new Map(),
  auditLogs: new Map(),
  refundRequests: new Map(),
  supportTickets: new Map(),
  categories: new Map(),
  settings: new Map(),
  pricingConfigs: new Map(),
  ledgerEntries: new Map(),
  payeeAccounts: new Map(),
  cashDeposits: new Map(),
  payoutRequests: new Map(),
  restaurantCharges: new Map(),
  profileEdits: new Map(),
  deviceTokens: new Map(),
  meta: new Map()
};

/**
 * Empties every collection in the store.
 *
 * Used when a snapshot on disk was written by an older revision of the seed: the
 * stale rows are dropped so the current seed can repopulate from scratch,
 * instead of the two being silently merged.
 */
/*
 * CHANGE TRACKING (S1 / N18).
 *
 * The database save used to re-serialise EVERY document ever written on every
 * flush, to find the few that changed: cost grew with the lifetime of the
 * platform, and it blocked the event loop while it ran. Each collection now
 * records the ids its `set`/`delete` touch, and a save writes those.
 *
 * Tracking is installed on the map INSTANCES (not a subclass), so it survives
 * code that holds a map, and is re-installed wherever a map is replaced (the
 * file loader). A full diff still runs on a timer, at shutdown, and for every
 * money write (`persistDurably`), and reports anything it finds changed but not
 * marked (DIRTY_MISS), so a path that mutates in place without `set` is seen
 * and still saved.
 */
const dirtyIds = new Map<string, Set<string>>();
const wholeCollections = new Set<string>();

function markDirty(collection: string, id: string): void {
  let ids = dirtyIds.get(collection);
  if (!ids) {
    ids = new Set();
    dirtyIds.set(collection, ids);
  }
  ids.add(id);
}

function trackMap(name: string, map: Map<any, any>): void {
  if ((map as any).__tracked) return;
  const set = map.set.bind(map);
  const del = map.delete.bind(map);
  const clear = map.clear.bind(map);
  (map as any).set = (key: any, value: any) => {
    markDirty(name, String(key));
    return set(key, value);
  };
  (map as any).delete = (key: any) => {
    markDirty(name, String(key));
    return del(key);
  };
  (map as any).clear = () => {
    wholeCollections.add(name);
    dirtyIds.get(name)?.clear();
    return clear();
  };
  Object.defineProperty(map, '__tracked', { value: true });
}

export function installChangeTracking(): void {
  for (const [name, map] of Object.entries(memoryStore)) trackMap(name, map as Map<any, any>);
}
installChangeTracking();

export interface DirtySnapshot {
  ids: Map<string, Set<string>>;
  whole: Set<string>;
}

/** Takes (and resets) what has changed since the last save. */
export function takeDirty(): DirtySnapshot {
  const snapshot: DirtySnapshot = {
    ids: new Map(Array.from(dirtyIds.entries()).map(([c, ids]) => [c, new Set(ids)])),
    whole: new Set(wholeCollections)
  };
  dirtyIds.clear();
  wholeCollections.clear();
  return snapshot;
}

/** Puts a snapshot back after a failed save, so its changes are retried. */
export function restoreDirty(snapshot: DirtySnapshot): void {
  for (const [c, ids] of snapshot.ids) for (const id of ids) markDirty(c, id);
  for (const c of snapshot.whole) wholeCollections.add(c);
}

/** What is marked right now, without taking it. */
export function peekDirty(collection: string, id: string): boolean {
  return wholeCollections.has(collection) || Boolean(dirtyIds.get(collection)?.has(id));
}

/** After hydration: what was just loaded is by definition already saved. */
export function forgetDirty(): void {
  dirtyIds.clear();
  wholeCollections.clear();
}

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
    // The loop above REPLACED the maps, which dropped their tracking.
    installChangeTracking();
    // Values this build no longer accepts are rewritten before anything is
    // served. Called from BOTH hydration paths, not just this one - see
    // normaliseStore.ts for why that distinction is the whole point.
    normaliseLoadedStore();
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
  save: (mode?: SaveMode) => Promise<void>;
}

let backend: PersistenceBackend | null = null;

export function setPersistenceBackend(next: PersistenceBackend | null): void {
  backend = next;
}

/**
 * Waits until everything written so far is in the database (N19).
 *
 * Money routes answer only after this resolves: a capture, a refund or a
 * payout marked paid used to be acknowledged up to two seconds before the
 * debounced flush wrote it, so a restart in that window lost money the app
 * had already been told about. With no database attached (local development,
 * the test gate) there is nothing more durable to wait for, and it resolves
 * at once, so the file store keeps its debounce.
 */
export function persistDurably(): Promise<void> {
  if (!backend) return Promise.resolve();
  // Money never depends on the tracking: a durable save is a full diff.
  return flushStore('full');
}

/*
 * Serialises saves so a slow write cannot overlap the next one, and COALESCES
 * the ones waiting (B's condition on S2).
 *
 * Each save writes everything changed so far, so once a save is queued and
 * has not started, every later caller is served by it: its snapshot is taken
 * when it STARTS, after all of them wrote. Chaining one full save per call made
 * N concurrent money requests wait for N sequential saves.
 */
let inFlight: Promise<void> = Promise.resolve();
let queued: Promise<void> | null = null;
let queuedMode: SaveMode = 'changed';

/**
 * `changed` writes what the change tracking marked. `full` also diffs every
 * document, which catches anything changed in place without a `set`.
 */
export type SaveMode = 'changed' | 'full';

export function flushStore(mode: SaveMode = 'changed'): Promise<void> {
  if (queued) {
    // Joining a queued save: it must be at least as thorough as this caller.
    if (mode === 'full') queuedMode = 'full';
    return queued;
  }
  queuedMode = mode;
  const run = async () => {
    // From here on, a new caller's write may land after this snapshot, so it
    // must queue a fresh save rather than join this one.
    queued = null;
    const thisMode = queuedMode;
    if (backend) await backend.save(thisMode);
    else saveStoreToFile();
  };
  const next = inFlight.then(run, run);
  queued = next;
  inFlight = next;
  return next;
}

let autoSaveTimer: NodeJS.Timeout | null = null;
/** When the oldest write still waiting to be persisted arrived. */
let firstPendingWriteAt: number | null = null;

const DEBOUNCE_MS = 300;
/**
 * The longest a write may wait, however busy the platform is.
 *
 * The debounce alone has no ceiling: every write cleared the timer and started
 * it again, so a steady stream of traffic could defer the flush indefinitely
 * and everything since the last one lived only in memory. On a host that
 * restarts -- a deploy, a crash, a container move -- that window is silent data
 * loss, and it looks exactly like a record that was never written: acknowledged
 * to the caller, counted by the process still holding it, gone afterwards.
 */
const MAX_DEFERRAL_MS = 2000;

/**
 * How long the next flush may wait. Pure, and exported, so the ceiling can be
 * asserted without a test that sits watching a clock.
 */
export function nextFlushDelayMs(firstWriteAt: number | null, now: number): number {
  if (firstWriteAt === null) return DEBOUNCE_MS;
  const alreadyWaited = now - firstWriteAt;
  return Math.max(0, Math.min(DEBOUNCE_MS, MAX_DEFERRAL_MS - alreadyWaited));
}

/**
 * Debounced automatic persistence trigger called after state mutations.
 *
 * Debounced because a burst of related writes should cost one flush, and
 * bounded because a write that is never flushed is a write that was never made.
 */
export function triggerAutoSave(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (firstPendingWriteAt === null) firstPendingWriteAt = Date.now();
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    firstPendingWriteAt = null;
    // A persistence failure must be visible: the request has already returned
    // success to the caller, so silence here means data loss nobody notices.
    flushStore().catch(err => {
      console.error('[ERROR] Failed to persist the database store:', err);
    });
  }, nextFlushDelayMs(firstPendingWriteAt, Date.now()));
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
