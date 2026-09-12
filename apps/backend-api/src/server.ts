import { createApp } from './app.ts';
import { config } from './config/env.ts';
import { initSocketServer, closeSocketServer } from './sockets/socketServer.ts';
import { loadStoreFromFile, saveStoreToFile } from './db/client.ts';
import { seedDatabase } from './db/seed.ts';

// Hydrate database from disk persistence or initialize with seed data
if (!loadStoreFromFile()) {
  console.log('[INFO] No existing persistent store found on disk. Initializing and seeding database...');
  await seedDatabase();
  saveStoreToFile();
  console.log('[INFO] Seed data initialized and persisted to data/store.json.');
} else {
  console.log('[INFO] Persistent database hydrated successfully from disk.');
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
  saveStoreToFile();
  await closeSocketServer();
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
