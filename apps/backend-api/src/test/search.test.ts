import assert from 'node:assert';
import { seedDatabase } from '../db/seed.ts';
import { syncService } from '../modules/search/syncService.ts';
import { searchService } from '../modules/search/searchService.ts';
import { searchCache } from '../modules/search/searchCache.ts';
import { meiliClient } from '../modules/search/meiliClient.ts';

async function runSearchTests() {
  console.log('====================================================');
  console.log('     RUNNING CHUNK 05 MEILISEARCH SEARCH TESTS      ');
  console.log('====================================================\n');

  // Step 1: Database Seed and Catalog Sync
  console.log('Step 1: Seeding database and synchronizing Meilisearch index...');
  await seedDatabase();
  const syncReport = await syncService.syncCatalog();
  assert.strictEqual(syncReport.success, true);
  assert.ok(syncReport.restaurantsIndexed >= 2, 'Should index at least 2 restaurants');
  assert.ok(syncReport.dishesIndexed >= 4, 'Should index at least 4 dishes');
  console.log(`[PASS] Step 1: Indexed ${syncReport.restaurantsIndexed} restaurants and ${syncReport.dishesIndexed} dishes in ${syncReport.durationMs}ms`);

  // Step 2: Exact Query Search
  console.log('\nStep 2: Testing exact keyword search...');
  const exactRes = await searchService.searchCatalog({ query: 'biryani' });
  assert.ok(exactRes.restaurants.length > 0, 'Should find Bangalore Biryani House');
  assert.ok(exactRes.dishes.length > 0, 'Should find Special Chicken Dum Biryani');
  assert.strictEqual(exactRes.restaurants[0].name, 'Bangalore Biryani House');
  assert.strictEqual(exactRes.dishes[0].name, 'Special Chicken Dum Biryani');
  console.log(`[PASS] Step 2: Exact search found ${exactRes.totalHits} hits for 'biryani'`);

  // Step 3: Typo-Tolerant Search
  console.log('\nStep 3: Testing typo-tolerant fuzzy search...');
  // Typo 1: "biryanii" (extra letter)
  const typo1 = await searchService.searchCatalog({ query: 'biryanii' });
  assert.ok(typo1.totalHits > 0, 'Typo search for "biryanii" should return matches');
  assert.strictEqual(typo1.restaurants[0].name, 'Bangalore Biryani House');

  // Typo 2: "paneer buttr"
  const typo2 = await searchService.searchCatalog({ query: 'paneer buttr' });
  assert.ok(typo2.dishes.some(d => d.name === 'Paneer Butter Masala'), 'Typo search should match Paneer Butter Masala');

  // Typo 3: "udupi" / "udpi"
  const typo3 = await searchService.searchCatalog({ query: 'udpi' });
  assert.ok(typo3.restaurants.some(r => r.name === 'Udupi Sri Krishna Bhavan'), 'Typo search should match Udupi');
  console.log('[PASS] Step 3: Typo tolerance handled variations ("biryanii", "paneer buttr", "udpi")');

  // Step 4: Attribute Filtering (isVeg, minRating, city)
  console.log('\nStep 4: Testing filterable attributes...');
  // Veg-only filter
  const vegRes = await searchService.searchCatalog({ isVeg: true });
  for (const r of vegRes.restaurants) {
    assert.strictEqual(r.isVeg, true, 'Non-veg restaurant returned with isVeg=true filter');
  }
  for (const d of vegRes.dishes) {
    assert.strictEqual(d.isVeg, true, 'Non-veg dish returned with isVeg=true filter');
  }
  console.log(`[PASS] Step 4a: Pure veg filter returned ${vegRes.totalHits} veg-only entities`);

  // Minimum Rating filter (>= 4.7)
  const ratingRes = await searchService.searchCatalog({ minRating: 4.7 });
  assert.ok(ratingRes.restaurants.length >= 1, 'Should find at least 1 restaurant with rating >= 4.7');
  assert.ok(ratingRes.restaurants.every(r => r.rating >= 4.7), 'All returned restaurants must have rating >= 4.7');
  console.log(`[PASS] Step 4b: Rating filter matched ${ratingRes.restaurants.length} restaurants with rating >= 4.7`);

  // City filter
  const cityRes = await searchService.searchCatalog({ city: 'Bengaluru' });
  assert.ok(cityRes.restaurants.length >= 2, 'Should find at least 2 Bengaluru restaurants');
  assert.ok(cityRes.restaurants.every(r => r.city === 'Bengaluru'), 'All returned restaurants must be in Bengaluru');
  console.log(`[PASS] Step 4c: City filter matched ${cityRes.restaurants.length} Bengaluru restaurants`);

  // Step 5: Geolocation Distance & Delivery ETA Estimation
  console.log('\nStep 5: Testing spatial distance and delivery ETA calculation...');
  // Indiranagar customer coordinates
  const customerLat = 12.9716;
  const customerLng = 77.6412;
  const spatialRes = await searchService.searchCatalog({
    query: 'dosa',
    latitude: customerLat,
    longitude: customerLng
  });

  assert.ok(spatialRes.dishes.length > 0);
  const matchedDish = spatialRes.dishes[0];
  assert.ok(typeof matchedDish.distanceKm === 'number', 'distanceKm must be computed');
  assert.ok(typeof matchedDish.estimatedDeliveryMinutes === 'number', 'estimatedDeliveryMinutes must be computed');
  assert.ok(matchedDish.distanceKm > 0, 'Distance should be greater than 0');
  console.log(`[PASS] Step 5: Computed distance ${matchedDish.distanceKm} km, ETA: ${matchedDish.estimatedDeliveryMinutes} mins for '${matchedDish.name}'`);

  // Step 6: Autocomplete Typeahead Suggestions
  console.log('\nStep 6: Testing search typeahead suggestions...');
  const suggestions = await searchService.getSuggestions('bir');
  assert.ok(suggestions.length >= 2, 'Should return at least 2 suggestions');
  assert.ok(suggestions.some(s => s.type === 'dish' && s.text.includes('Biryani')));
  assert.ok(suggestions.some(s => s.type === 'restaurant' && s.text.includes('Biryani')));
  console.log(`[PASS] Step 6: Retrieved ${suggestions.length} suggestions for prefix 'bir':`);
  for (const s of suggestions) {
    console.log(`       - [${s.type.toUpperCase()}] ${s.text} (${s.subtext || 'Cuisine'})`);
  }

  // Step 7: Cache Layer Verification
  console.log('\nStep 7: Testing search cache hit ratio and invalidation...');
  await searchCache.flush();

  // 1st request -> Cache miss
  const req1 = await searchService.searchCatalog({ query: 'masala dosa' });
  assert.strictEqual(req1.source, 'meilisearch');

  // 2nd identical request -> Cache hit
  const req2 = await searchService.searchCatalog({ query: 'masala dosa' });
  assert.strictEqual(req2.source, 'cache');

  const cacheMetrics = searchCache.getMetrics();
  assert.ok(cacheMetrics.hits >= 1, 'Cache should register at least 1 hit');
  console.log(`[PASS] Step 7: Cache confirmed (Hits: ${cacheMetrics.hits}, Misses: ${cacheMetrics.misses}, Ratio: ${cacheMetrics.hitRatio})`);

  // Step 8: Performance & Latency Benchmark (< 50ms)
  console.log('\nStep 8: Benchmarking search response time (< 50ms requirement)...');
  const iterations = 50;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await searchService.searchCatalog({
      query: i % 2 === 0 ? 'biryani' : 'dosa',
      latitude: customerLat,
      longitude: customerLng
    });
    const duration = performance.now() - start;
    latencies.push(duration);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
  const maxLatency = Math.max(...latencies);

  console.log(`[PASS] Step 8: 50 Iterations - Average Latency: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency.toFixed(2)}ms`);
  assert.ok(avgLatency < 15.0, `Average search latency must be < 15ms (Got: ${avgLatency}ms)`);
  assert.ok(maxLatency < 50.0, `Maximum search latency must be < 50ms (Got: ${maxLatency}ms)`);

  console.log('\n====================================================');
  console.log('   ALL CHUNK 05 MEILISEARCH SEARCH TESTS PASSED!    ');
  console.log('====================================================\n');
}

runSearchTests().catch(err => {
  console.error('\n[FAIL] Search test suite failed:', err);
  process.exit(1);
});
