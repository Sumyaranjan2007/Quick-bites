import { createApp } from './app.ts';
import { config } from './config/env.ts';
import { initSocketServer, closeSocketServer } from './sockets/socketServer.ts';
import { loadStoreFromFile, clearStore, memoryStore, setPersistenceBackend, flushStore } from './db/client.ts';
import {
  isDatabaseConfigured,
  initDatabase,
  loadStoreFromDatabase,
  saveStoreToDatabase,
  closeDatabase
} from './db/postgresStore.ts';
import { seedDatabase, SEED_VERSION } from './db/seed.ts';

// Choose where state is persisted before anything reads or writes it.
//
// With DATABASE_URL set, documents live in Postgres and survive a redeploy.
// Without it, the JSON file beside the code is used, which is right for local
// development and useless in production: that filesystem is per-container, so
// every order placed was lost the next time the service restarted.
const usingDatabase = isDatabaseConfigured();

if (usingDatabase) {
  // Deliberately not wrapped in a fallback to the file. A deployment that
  // cannot reach its database should fail to start, not come up looking healthy
  // while quietly writing orders somewhere they will be discarded.
  await initDatabase();
  setPersistenceBackend({ save: saveStoreToDatabase });
  console.log('[INFO] Persistence: Postgres (DATABASE_URL).');
} else {
  console.log('[INFO] Persistence: local JSON snapshot (no DATABASE_URL set).');
}

const hydrated = usingDatabase ? await loadStoreFromDatabase() : loadStoreFromFile();

// A store written by an older revision of the seed is discarded rather than
// trusted: it is hydrated first, so the version stamp can be read, and then
// thrown away. Without this, changing the seed had no effect on any environment
// that already had data - the deployment kept serving the old records.
if (!hydrated) {
  console.log('[INFO] No existing data found. Initializing and seeding database...');
  await seedDatabase();
  await flushStore();
  console.log('[INFO] Seed data initialized and persisted.');
} else if (memoryStore.meta.get('seedVersion') !== SEED_VERSION) {
  console.log(
    `[INFO] Stored data was written by seed "${memoryStore.meta.get('seedVersion') ?? 'unversioned'}", ` +
    `current seed is "${SEED_VERSION}". Re-seeding.`
  );
  clearStore();
  await seedDatabase();
  await flushStore();
  console.log('[INFO] Database re-seeded from the current seed revision.');
} else {
  console.log('[INFO] Existing data hydrated successfully.');
}

const app = createApp();

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('       QUICK BITE API SERVER STARTED                ');
  console.log('====================================================');
  console.log(`  Port:        ${config.PORT}`);
  console.log(`  Environment: ${config.NODE_ENV}`);
  console.log(`  Demo Mode:   ${config.DEMO_MODE ? 'ENABLED (Mocked Gateway)' : 'DISABLED'}`);
  console.log(`  Health URL:  http://localhost:${config.PORT}/health`);
  console.log(`  API Root:    http://localhost:${config.PORT}/api/v1`);
  console.log('====================================================\n');
});

// Initialize real-time WebSocket server attached to HTTP listener
initSocketServer(server);

// Graceful Shutdown
async function handleShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Gracefully closing Quick Bites HTTP and Socket servers...`);
  // Flush before the connection closes; a debounced write may still be pending,
  // and the platform sends SIGTERM on every redeploy.
  try {
    await flushStore();
  } catch (err) {
    console.error('[ERROR] Final persist failed; recent writes may be lost:', err);
  }
  await closeSocketServer();
  if (usingDatabase) await closeDatabase();
  server.close(() => {
    console.log('[SUCCESS] HTTP server closed cleanly and data persisted. Exiting process.');
    process.exit(0);
  });

  // Force close after 10 seconds if connections refuse to terminate
  setTimeout(() => {
    console.error('[WARN] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
