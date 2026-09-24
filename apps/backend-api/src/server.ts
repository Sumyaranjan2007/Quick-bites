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
import { ensureTestRider } from './db/ensureTestRider.ts';
import { adminRoleRepository } from './db/repositories/adminRoleRepository.ts';
import { ensureBootstrapAdmin } from './db/bootstrapAdmin.ts';
import { startOrderSweeper, stopOrderSweeper } from './modules/orders/orderSweeper.ts';
import { startPaymentReconciliation, stopPaymentReconciliation } from './modules/payments/reconciliation.ts';
import { startPaymentsHealthCheck, stopPaymentsHealthCheck } from './modules/payments/paymentsHealth.ts';
import { startAdminDigest, stopAdminDigest } from './notifications/adminDigest.ts';

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
  // The database path above deliberately refuses to start when it cannot reach
  // Postgres, rather than coming up healthy while writing orders somewhere they
  // will be discarded. This path had no such guard, so removing DATABASE_URL
  // from a deployment did exactly that silently: the service reported HEALTHY,
  // took real orders, and lost every one of them on the next restart, because
  // a container's filesystem does not survive a redeploy.
  //
  // The escape hatch exists because a test has to be able to start a real
  // production server without a database in order to observe these behaviours
  // at all. It must be set deliberately, like OTP_ALLOW_FIXED_IN_PRODUCTION.
  if (config.IS_PRODUCTION && process.env.ALLOW_FILE_PERSISTENCE !== 'true') {
    throw new Error(
      'DATABASE_URL is not set. Refusing to start: without it this service would ' +
        'write orders to a container filesystem that is discarded on the next ' +
        'restart, while reporting itself healthy.'
    );
  }
  console.log('[INFO] Persistence: local JSON snapshot (no DATABASE_URL set).');
}

const hydrated = usingDatabase ? await loadStoreFromDatabase() : loadStoreFromFile();

// A store written by an older revision of the seed is discarded rather than
// trusted: it is hydrated first, so the version stamp can be read, and then
// thrown away. Without this, changing the seed had no effect on any environment
// that already had data - the deployment kept serving the old records.
// Demo restaurants, menus and accounts are development and test furniture.
// A production platform starts empty and is filled by real people: a restaurant
// registers and is approved, a rider registers and is approved, a customer
// verifies their phone. A demonstration restaurant appearing to a real
// customer - who could then order from a kitchen that does not exist - is the
// failure this guard prevents.
if (!config.SEED_DEMO_DATA) {
  console.log('[INFO] SEED_DEMO_DATA is off. Starting with whatever real data exists.');
} else if (!hydrated) {
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

// Runs on every boot, not only after a seed. The shipped roles are part of the
// build: a release that adds a permission has to reach the role meant to hold
// it, and a store hydrated from before roles existed needs them created before
// the first administrator signs in.
await adminRoleRepository.ensureSystemRoles();

// Exactly one administrator, from the deployment's own environment. Every
// other account arrives by self-registration - a customer verifies a phone,
// a restaurant or rider signs up and waits - and somebody has to approve
// those. Re-applied on every boot, which is the documented way back in for a
// locked-out administrator: change ADMIN_PASSWORD on the host and redeploy.
await ensureBootstrapAdmin();

// The same idea for a delivery partner, and for the same reason: a self-
// registered rider signs up and waits for approval, which is correct but leaves
// nobody able to exercise a trip end to end on a fresh deployment. Opt-in and a
// no-op unless TEST_RIDER_EMAIL and TEST_RIDER_PASSWORD are set; the account it
// provisions is KYC-approved so it can actually be offered work.
await ensureTestRider();

await flushStore();

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

// Started after the sockets, not before: the sweeper's first act on finding a
// stale order is to tell the customer it has been cancelled, and an emit with
// no server behind it is a cancellation nobody is told about.
startOrderSweeper();
startPaymentReconciliation();
// Looks for the failures nobody reports: a payout whose outcome never came
// back, a rider quietly holding our cash for a week, books that stopped
// balancing. It resolves the first against the gateway and raises the other
// two — it never retries a payment and never corrects the ledger.
startPaymentsHealthCheck();

// And the only thing here that is not a problem: how the day is going, twice a
// day. Everything else on this list speaks up when something is wrong, and a
// platform that never says anything else is one nobody wants to hear from.
startAdminDigest();

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
  stopOrderSweeper();
  stopPaymentReconciliation();
  stopPaymentsHealthCheck();
  stopAdminDigest();
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
