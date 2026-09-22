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
import { memoryStore, type DbStore } from './client.ts';
import { normaliseLoadedStore } from './normaliseStore.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;

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
  normaliseLoadedStore();
  return true;
}

/**
 * Writes everything that changed since the last save, and removes documents no
 * longer held in memory, as a single transaction.
 */
export async function saveStoreToDatabase(): Promise<void> {
  if (!pool) return;

  const upserts: Array<{ collection: string; id: string; data: string }> = [];
  const deletions: Array<{ collection: string; id: string }> = [];

  for (const [collection, map] of Object.entries(memoryStore) as Array<[keyof DbStore, Map<string, any>]>) {
    const name = collection as string;
    const seen = persistedFor(name);

    for (const [id, doc] of map.entries()) {
      const serialized = JSON.stringify(doc);
      if (seen.get(id) !== serialized) {
        upserts.push({ collection: name, id, data: serialized });
      }
    }

    for (const id of seen.keys()) {
      if (!map.has(id)) deletions.push({ collection: name, id });
    }
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
    throw err;
  } finally {
    client.release();
  }

  // Only record what actually committed, so a failed write is retried next time.
  for (const { collection, id, data } of upserts) persistedFor(collection).set(id, data);
  for (const { collection, id } of deletions) persistedFor(collection).delete(id);
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
}
