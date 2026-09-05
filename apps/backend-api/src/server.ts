import { createApp } from './app.ts';
import { config } from './config/env.ts';
import { initSocketServer, closeSocketServer } from './sockets/socketServer.ts';

const app = createApp();

const server = app.listen(config.PORT, () => {
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
  console.log(`\nReceived ${signal}. Gracefully closing Quick Bite HTTP and Socket servers...`);
  await closeSocketServer();
  server.close(() => {
    console.log('[SUCCESS] HTTP server closed cleanly. Exiting process.');
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

