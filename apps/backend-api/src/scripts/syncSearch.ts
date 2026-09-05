import { seedDatabase } from '../db/seed.ts';
import { syncService } from '../modules/search/syncService.ts';
import { meiliClient } from '../modules/search/meiliClient.ts';

async function main() {
  console.log('====================================================');
  console.log('      QUICK BITE PLATFORM - MEILISEARCH SYNC        ');
  console.log('====================================================\n');

  console.log('Step 1: Ensuring base catalog data is seeded in database...');
  await seedDatabase();

  console.log('\nStep 2: Synchronizing catalog into Meilisearch indexes...');
  const report = await syncService.syncCatalog();

  const restaurantStats = meiliClient.getStats('restaurants');
  const dishStats = meiliClient.getStats('dishes');

  console.log('\n====================================================');
  console.log('          SEARCH INDEX SYNCHRONIZATION REPORT       ');
  console.log('====================================================');
  console.log(`[PASS] Restaurants Indexed: ${report.restaurantsIndexed} (Total in index: ${restaurantStats.numberOfDocuments})`);
  console.log(`[PASS] Dishes Indexed:      ${report.dishesIndexed} (Total in index: ${dishStats.numberOfDocuments})`);
  console.log(`[PASS] Sync Duration:       ${report.durationMs}ms`);
  console.log(`[PASS] Timestamp:           ${report.timestamp}`);
  console.log('====================================================\n');

  console.log('[SUCCESS] Meilisearch catalog indexing completed successfully.');
}

main().catch(err => {
  console.error('[FAIL] Error during Meilisearch sync:', err);
  process.exit(1);
});
