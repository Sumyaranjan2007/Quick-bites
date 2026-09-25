/**
 * Durable backing store for the in-memory database.
 *
 * The store was held in memory and snapshotted to a JSON file beside the code.
 * On a hosted deployment that filesystem is per-container and thrown away on
 * every redeploy, so every order a customer had placed disappeared the next time
 * the service restarted. Locally the file is fine; in production it is not
 * storage at all.
 *
 * This keeps the same shape - collections of documents, hydrated into memory at
 * boot - but persists them as JSONB rows in Postgres. Repositories are
 * untouched: they still read and write plain objects through `memoryStore`, and
 * this module is what makes those writes outlive the process.
 *
 * Documents are stored whole rather than mapped onto relational tables. The data
 * is document-shaped already (an order carries its items, bill and status
 * history; a menu carries its categories), every repository query is an id
 * lookup or a scan the size of one restaurant's catalogue, and keeping a single
 * representation avoids a translation layer that could drift from the types the
 * rest of the codebase compiles against.
 *
 * Two limits this design accepts. Both are fine at current volume, and neither
 * announces itself with an error when exceeded:
 *
 * SINGLE INSTANCE. Each process holds the whole store in memory and writes its
 * own view of it. Two replicas editing the SAME document do not conflict loudly:
 * the second writer's change is overwritten by the first's copy, built on state
 * that predates it. Order status is exactly that shape, with a kitchen accepting
 * on one instance and a rider collecting on another. Do not raise the replica
 * count without first giving upserts a version check, so a lost write becomes a
 * detectable conflict instead of a silent one.
 *
 * UNBOUNDED HYDRATION. Boot loads every document ever written, so memory use and
 * startup time grow with lifetime order count rather than with active orders.
 * The O(n) scans in the repositories - findByIdempotencyKey walking every order -
 * are the same ceiling seen from the other side. Both want completed orders
 * archived, or per-collection queries, well before this reaches tens of
 * thousands.
 */
import pg from 'pg';
import {
  memoryStore,
  takeDirty,
  restoreDirty,
  forgetDirty,
  reportPersistenceMisses,
  type DirtySnapshot,
  type SaveMode
} from './client.ts';
import { normaliseLoadedStore } from './normaliseStore.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/*
 * When this process last hydrated itself from Postgres.
 *
 * Recorded because a row written by one process is invisible to another until
 * that one reloads, and with more than one instance running there is no moment
 * at which they are both current. A submission that reaches the database and
 * never reaches a screen looks like a storage bug from every angle except this
 * one, so the timestamp is reported by the payee diagnostic.
 */
let lastLoadedFromDatabaseAt: string | null = null;

export function storeLoadedAt(): string | null {
  return lastLoadedFromDatabaseAt;
}

/**
 * What was last written for each document, so a save sends only rows that
 * actually changed. Without it, every mutation rewrites the entire store.
 *
 * Nested by collection rather than keyed by a joined string: a flat key has to
 * be parsed apart again on the deletion path, and getting that wrong fails
 * silently, deleting nothing while appearing to work.
 */
const persisted = new Map<string, Map<string, string>>();

function persistedFor(collection: string): Map<string, string> {
  let inner = persisted.get(collection);
  if (!inner) {
    inner = new Map();
    persisted.set(collection, inner);
  }
  return inner;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Railway's private network needs no TLS, so an internal URL skips it entirely.
 * The public proxy requires TLS but presents a certificate the default trust
 * store will not verify, so that path is encrypted yet unauthenticated and is no
 * defence against an active man-in-the-middle. Prefer the private DATABASE_URL:
 * the public one exists for connecting from outside the platform, not for a
 * deployment talking to its own database.
 */
function sslFor(url: string): any {
  if (process.env.PGSSLMODE === 'disable') return undefined;
  const needsSsl = /sslmode=require/.test(url) || !/\.railway\.internal/.test(url);
  return needsSsl ? { rejectUnauthorized: false } : undefined;
}

export async function initDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');

  pool = new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  // The app container routinely starts before the database accepts connections,
  // especially on the first deploy after a database is linked. Giving up on the
  // first refused connection would crash-loop the service and surface as a 502,
  // indistinguishable from a real outage. Retrying preserves the guarantee below
  // - an unreachable database still stops the boot - while tolerating a startup
  // race measured in seconds.
  const ATTEMPTS = 5;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt === ATTEMPTS) throw err;
      console.warn(
        `[WARN] Database not reachable (attempt ${attempt}/${ATTEMPTS}): ` +
          `${(err as Error).message}. Retrying...`
      );
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }

  // Past this point a failure must be loud. Quietly falling back to memory would
  // look healthy while losing orders, which is the bug this module removes.
  await pool.query(
    'CREATE TABLE IF NOT EXISTS store_documents (' +
      'collection TEXT NOT NULL, ' +
      'id TEXT NOT NULL, ' +
      'data JSONB NOT NULL, ' +
      'updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), ' +
      'PRIMARY KEY (collection, id))'
  );
}

export async function loadStoreFromDatabase(): Promise<boolean> {
  if (!pool) throw new Error('initDatabase() has not been called.');

  const { rows } = await pool.query<{ collection: string; id: string; data: any }>(
    'SELECT collection, id, data FROM store_documents'
  );
  if (rows.length === 0) return false;

  persisted.clear();
  for (const row of rows) {
    const target = (memoryStore as any)[row.collection] as Map<string, any> | undefined;
    if (!target) continue; // A collection this build no longer knows about.
    target.set(row.id, row.data);
    persistedFor(row.collection).set(row.id, JSON.stringify(row.data));
  }

  /*
   * THIS is the call that matters.
   *
   * Local runs, every test and every gate go through loadStoreFromFile, which
   * makes the same call. Production comes through here. A migration written
   * only into the JSON loader would be green everywhere we can observe it and
   * absent in the one place it is needed.
   *
   * It runs before `return true`, so nothing is served from a store still
   * carrying values this build cannot transition out of.
   */
  forgetDirty();
  normaliseLoadedStore();
  // Everything just loaded is already in the database. Anything normalise
  // rewrote stays marked, so the fix is saved.
  lastLoadedFromDatabaseAt = new Date().toISOString();
  return true;
}

export interface StoreChanges {
  upserts: Array<{ collection: string; id: string; data: string }>;
  deletions: Array<{ collection: string; id: string }>;
  /** Documents a FULL diff found changed that the tracking had not marked. */
  misses: Array<{ collection: string; id: string }>;
  snapshot: DirtySnapshot;
}

/**
 * Works out what a save must write, without touching the database (S1).
 *
 * `changed`: only the documents the change tracking marked, plus any
 * collection that was cleared (diffed whole). `full`: every document, as the
 * save always used to, and every changed document the tracking had NOT marked
 * is reported as a miss.
 */
export function computeChanges(mode: SaveMode = 'changed'): StoreChanges {
  const snapshot = takeDirty();
  const upserts: StoreChanges['upserts'] = [];
  const deletions: StoreChanges['deletions'] = [];
  const misses: StoreChanges['misses'] = [];

  const consider = (collection: string, id: string, map: Map<string, any>, marked: boolean) => {
    const seen = persistedFor(collection);
    if (map.has(id)) {
      const serialized = JSON.stringify(map.get(id));
      if (seen.get(id) !== serialized) {
        upserts.push({ collection, id, data: serialized });
        if (!marked) misses.push({ collection, id });
      }
    } else if (seen.has(id)) {
      deletions.push({ collection, id });
      if (!marked) misses.push({ collection, id });
    }
  };

  for (const [collection, map] of Object.entries(memoryStore) as Array<[string, Map<string, any>]>) {
    const marked = snapshot.ids.get(collection) || new Set<string>();
    if (mode === 'full' || snapshot.whole.has(collection)) {
      const all = new Set<string>([...map.keys(), ...persistedFor(collection).keys()]);
      for (const id of all) consider(collection, id, map, snapshot.whole.has(collection) || marked.has(id));
    } else {
      for (const id of marked) consider(collection, id, map, true);
    }
  }
  return { upserts, deletions, misses, snapshot };
}

/**
 * Writes what changed since the last save, and removes documents no longer
 * held in memory, as a single transaction. On failure the changes are put back
 * so the next save retries them.
 */
export async function saveStoreToDatabase(mode: SaveMode = 'changed'): Promise<void> {
  const { upserts, deletions, misses, snapshot } = computeChanges(mode);

  // Every FULL save says what it had to save unmarked, including "nothing", so
  // the admin alert clears when the misses do. Reported before the database is
  // needed, so the path can be exercised without one.
  if (mode === 'full') reportPersistenceMisses(misses.map(m => m.collection));

  if (!pool) {
    // Nothing was written, so nothing was saved: the marks stay for next time.
    restoreDirty(snapshot);
    return;
  }

  if (misses.length > 0) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        event: 'DIRTY_MISS',
        count: misses.length,
        sample: misses.slice(0, 10),
        note: 'Changed in place without set(): saved by this full diff; the code path should call set().'
      })
    );
  }
  if (upserts.length === 0 && deletions.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { collection, id, data } of upserts) {
      await client.query(
        'INSERT INTO store_documents (collection, id, data, updated_at) ' +
          'VALUES ($1, $2, $3::jsonb, now()) ' +
          'ON CONFLICT (collection, id) ' +
          'DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
        [collection, id, data]
      );
    }
    for (const { collection, id } of deletions) {
      await client.query('DELETE FROM store_documents WHERE collection = $1 AND id = $2', [collection, id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    restoreDirty(snapshot);
    throw err;
  } finally {
    client.release();
  }

  // Only record what actually committed, so a failed write is retried next time.
  commitPersisted(upserts, deletions);
}

function commitPersisted(upserts: StoreChanges['upserts'], deletions: StoreChanges['deletions']): void {
  for (const { collection, id, data } of upserts) persistedFor(collection).set(id, data);
  for (const { collection, id } of deletions) persistedFor(collection).delete(id);
}

/** Tests: treat the current memory as saved, as a fresh boot would. */
export function markEverythingPersistedForTesting(): void {
  persisted.clear();
  for (const [collection, map] of Object.entries(memoryStore) as Array<[string, Map<string, any>]>) {
    for (const [id, doc] of map.entries()) persistedFor(collection).set(id, JSON.stringify(doc));
  }
  forgetDirty();
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
}
