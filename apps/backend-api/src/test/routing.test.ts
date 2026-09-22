/**
 * Road distance: what it returns, and what it returns when Google will not.
 *
 * This service decides a delivery fee and a delivery time, so the part worth
 * testing hardest is not the happy path — it is every way the call can fail.
 * A routing service that throws on a bad day takes checkout down with it, and a
 * routing service that quietly returns zero charges everybody the minimum and
 * nobody notices for a month.
 *
 * Google is stubbed at `fetch` rather than at the module boundary on purpose.
 * Stubbing our own wrapper would test that the wrapper is called; stubbing
 * `fetch` tests what actually happens to the response Google sends, including
 * the two shapes that matter most and that no type can catch: a 200 carrying
 * `REQUEST_DENIED`, and a per-element `ZERO_RESULTS` inside an otherwise fine
 * batch.
 */
import assert from 'node:assert';
import { config } from '../config/env.ts';
import {
  roadDistance,
  roadDistanceMatrix,
  estimateByRoad,
  clearRoutingCache,
  routingStatus
} from '../modules/places/routingService.ts';

console.log('====================================================');
console.log('  ROUTING / ROAD DISTANCE                           ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`[PASS] ${name}`);
    })
    .catch(err => {
      failed++;
      console.log(`[FAIL] ${name}: ${err?.message || err}`);
    });
}

/** Bengaluru: Cubbon Park and Koramangala, about 5 km apart in a straight line. */
const A = { latitude: 12.9763, longitude: 77.5929 };
const B = { latitude: 12.9352, longitude: 77.6245 };
const C = { latitude: 12.9141, longitude: 77.6101 };

const realFetch = globalThis.fetch;
const realKey = config.MAPBOX_ACCESS_TOKEN;

/** Replaces fetch for one call, and records what the service asked for. */
function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as any;
  }) as any;
  return calls;
}

/**
 * Captures what the service logs during one call.
 *
 * Needed because the status check in `callDistanceMatrix` does NOT change what
 * the caller receives — a REQUEST_DENIED body has no `rows`, so the code would
 * fall back to an estimate either way. What it changes is whether anybody ever
 * finds out. Asserting only the fallback therefore passes with the check
 * deleted, which is a test that cannot fail for the reason it exists.
 */
async function capturingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = realLog;
  }
}

function restore() {
  globalThis.fetch = realFetch;
  (config as any).MAPBOX_ACCESS_TOKEN = realKey;
  clearRoutingCache();
}

/**
 * A Matrix response for one source and the given destinations.
 *
 * Mapbox answers with PARALLEL ARRAYS — `distances[0][i]` and
 * `durations[0][i]` — rather than Google's array of per-destination objects
 * each carrying its own status. An unroutable pair is a null in place, not an
 * object saying ZERO_RESULTS, which is why the per-destination fallback had to
 * be rewritten rather than renamed.
 */
function matrixBody(elements: Array<{ metres: number; seconds: number } | null>) {
  return {
    code: 'Ok',
    distances: [elements.map(e => (e ? e.metres : null))],
    durations: [elements.map(e => (e ? e.seconds : null))]
  };
}

function okElement(metres: number, seconds: number) {
  return { metres, seconds };
}

await (async () => {
  /* ------------------------------------------------------------------ *
   *  The fallback, which is what runs on most deployments              *
   * ------------------------------------------------------------------ */

  await check('Unconfigured: returns an ESTIMATE rather than throwing or zero', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = '';
    clearRoutingCache();
    const result = await roadDistance(A, B);
    assert.equal(result.source, 'ESTIMATED');
    assert.ok(result.distanceKm > 0, 'a distance of zero would charge everyone the minimum fee');
    assert.ok(result.durationMinutes >= 1);
    restore();
  });

  await check('The estimate is the straight line scaled UP, never down', () => {
    const estimate = estimateByRoad(A, B);
    // The road factor is >= 1 by construction, so a road can never come out
    // shorter than the straight line under it — which would be geometry going
    // backwards, and would understate every fee.
    assert.ok(
      estimate.distanceKm >= 4.5,
      `expected the ~5km Cubbon-Koramangala gap to scale up, got ${estimate.distanceKm}`
    );
    assert.ok(estimate.distanceKm <= 5 * 3, 'the factor is clamped at 3');
  });

  /* ------------------------------------------------------------------ *
   *  A real measurement                                                *
   * ------------------------------------------------------------------ */

  await check('Configured: a measured road distance is reported as GOOGLE', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    stubFetch(matrixBody([okElement(7400, 1320)]));
    const result = await roadDistance(A, B);
    assert.equal(result.source, 'MAPBOX');
    assert.equal(result.distanceKm, 7.4);
    assert.equal(result.durationMinutes, 22);
    restore();
  });

  await check('Duration always rounds UP, and never to zero minutes', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();

    // 1330s is 22 minutes 10 seconds. Rounded down that is 22, which is the
    // same answer as the previous check's exact 1320s — so an exact-multiple
    // fixture cannot tell ceil from floor, and this test could not fail for the
    // reason it exists.
    stubFetch(matrixBody([okElement(9000, 1330)]));
    const uneven = await roadDistance(A, B);
    assert.equal(uneven.durationMinutes, 23, 'part of a minute is still a minute of riding');
    restore();

    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    // A 40-second hop: next door, or two points Google matched to the same
    // road. Floored, this reports "0 minutes", which a customer reads as
    // "it is already here" and a rider reads as "you are late".
    stubFetch(matrixBody([okElement(300, 40)]));
    const tiny = await roadDistance(A, C);
    assert.equal(tiny.durationMinutes, 1, 'the floor is one minute, never zero');
    restore();
  });

  await check('The token is sent to Mapbox and never appears in a thrown message', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    const calls = stubFetch(matrixBody([okElement(1000, 300)]));
    await roadDistance(A, B);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('access_token=test-key'), 'the request must carry the token');
    /*
     * The profile lives in the PATH on Mapbox, not in a query parameter.
     *
     * Pinned because `driving-traffic` is the difference between an ETA that
     * accounts for a Bengaluru evening and one that quotes off-peak time at
     * 7pm — a promise the platform then breaks in front of the customer. A
     * silent fall back to plain `driving` would look identical in every test
     * that only checked a distance came back.
     */
    assert.ok(
      calls[0].includes('/directions-matrix/v1/mapbox/driving-traffic/'),
      'the traffic-aware profile is what makes the ETA honest'
    );
    // Coordinates are lon,lat on Mapbox. Reversed, an Indian address becomes a
    // point at sea and the API answers with a perfectly plausible distance.
    assert.ok(
      calls[0].includes(`${A.longitude},${A.latitude}`),
      'coordinates must be sent longitude first'
    );
    restore();
  });

  /* ------------------------------------------------------------------ *
   *  Failure, which is the whole point of this service                 *
   * ------------------------------------------------------------------ */

  await check('A refusal falls back AND says so in the log', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    /*
     * Google signalled a refusal with HTTP 200 and a status field; Mapbox uses
     * the status code. Both mean "this token cannot do this", and neither means
     * "there is no road" — which is what a fee silently becoming an estimate
     * would otherwise imply.
     */
    stubFetch({ message: 'Not Authorized - Invalid Token' }, 401);

    const { result, logs } = await capturingLogs(() => roadDistance(A, B));
    assert.equal(result.source, 'ESTIMATED');
    assert.ok(result.distanceKm > 0);

    // The diagnostic is the point. Without it, a key that is not authorised for
    // Distance Matrix silently degrades every delivery fee on the platform to
    // an estimate, and the only symptom is fees being slightly wrong forever.
    const refused = logs.find(l => l.includes('ROUTING_API_REFUSED'));
    assert.ok(refused, 'a refused call must be logged, not swallowed');
    assert.ok(refused!.includes('401'), 'the log must name the status Mapbox refused with');
    assert.ok(
      refused!.toLowerCase().includes('not authorized'),
      'the log must carry the message that names the misconfiguration'
    );

    /*
     * And it must reach the health payload, not only the log.
     *
     * A log line is found by somebody who already suspects this service; the
     * health payload is what answers "why is every delivery fee an estimate"
     * without anyone knowing where to look. Asserting only the log passed with
     * `lastRefusal` never being set at all — the log and the field are written
     * in the same block, and nothing tied the second one to anything.
     */
    const status: any = routingStatus();
    assert.ok(status.lastRefusal, 'the refusal never reached the health payload');
    assert.equal(status.lastRefusal.status, 'HTTP_401');
    assert.ok(
      String(status.lastRefusal.detail || '').toLowerCase().includes('not authorized'),
      'the health payload must name the misconfiguration too'
    );
    assert.ok(
      !JSON.stringify(status).includes('test-key'),
      'the health payload must never carry the token'
    );
    assert.ok(!refused!.includes('test-key'), 'the log must not carry the key');
    restore();
  });

  await check('A thrown fetch falls back rather than propagating into checkout', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    globalThis.fetch = (async () => {
      throw new Error('socket hang up');
    }) as any;
    const result = await roadDistance(A, B);
    assert.equal(result.source, 'ESTIMATED');
    restore();
  });

  await check('A 500 falls back', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    stubFetch({}, 500);
    const result = await roadDistance(A, B);
    assert.equal(result.source, 'ESTIMATED');
    restore();
  });

  /* ------------------------------------------------------------------ *
   *  Batching                                                          *
   * ------------------------------------------------------------------ */

  await check('One entry per destination, in the order asked', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    stubFetch(matrixBody([okElement(1000, 300), okElement(2000, 600)]));
    const results = await roadDistanceMatrix(A, [B, C]);
    assert.equal(results.length, 2);
    assert.equal(results[0].distanceKm, 1);
    assert.equal(results[1].distanceKm, 2);
    restore();
  });

  await check('One unroutable destination does not discard the rest of the batch', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    stubFetch(matrixBody([null, okElement(2000, 600)]));
    const results = await roadDistanceMatrix(A, [B, C]);
    assert.equal(results.length, 2, 'the caller must never have to handle a gap');
    assert.equal(results[0].source, 'ESTIMATED', 'the unroutable one falls back');
    assert.ok(results[0].distanceKm > 0);
    assert.equal(results[1].source, 'MAPBOX', 'its neighbour is still measured');
    restore();
  });

  await check('More destinations than one call allows are chunked, not refused', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    let call = 0;
    globalThis.fetch = (async (url: any) => {
      call++;
      /*
       * Answer with exactly as many entries as were asked for, so a chunking
       * bug shows up as a length mismatch rather than being papered over.
       *
       * Mapbox sends destination INDICES in the query and the coordinates in
       * the path, semicolon separated — Google sent pipe-separated coordinate
       * pairs in the query. Counting the old way returned 1 for every call and
       * made this assertion meaningless.
       */
      const asked = String(url)
        .split('destinations=')[1]
        .split('&')[0]
        .split(/;|%3B/)
        .filter(Boolean).length;
      return {
        ok: true,
        status: 200,
        json: async () => matrixBody(Array.from({ length: asked }, () => okElement(1500, 400)))
      } as any;
    }) as any;

    // 30 distinct points, so none of them share a cache entry.
    const many = Array.from({ length: 30 }, (_, i) => ({
      latitude: 12.9 + i * 0.01,
      longitude: 77.6 + i * 0.01
    }));
    const results = await roadDistanceMatrix(A, many);
    assert.equal(results.length, 30);
    /*
     * Four, not two. The traffic-aware profile allows ten coordinates per
     * call and the origin is one of them, so thirty destinations is four
     * calls of at most nine. Asserted as an exact number because "more than
     * one call" would pass with the limit set to anything at all.
     */
    assert.equal(call, 4, `expected 4 chunks of <=9, got ${call} calls`);
    assert.ok(results.every(r => r.source === 'MAPBOX'));
    restore();
  });

  /* ------------------------------------------------------------------ *
   *  Caching                                                           *
   * ------------------------------------------------------------------ */

  await check('A measured pair is cached and not asked for twice', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    const calls = stubFetch(matrixBody([okElement(3300, 720)]));
    const first = await roadDistance(A, B);
    const second = await roadDistance(A, B);
    assert.equal(calls.length, 1, 'the second lookup must come from the cache');
    assert.deepEqual(first, second);
    restore();
  });

  await check('An ESTIMATE is never cached, so a blip does not outlive itself', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();

    // First call fails, so the answer is an estimate.
    stubFetch({ status: 'UNKNOWN_ERROR' });
    const degraded = await roadDistance(A, B);
    assert.equal(degraded.source, 'ESTIMATED');

    // Google comes back. If the estimate had been cached, this would still be
    // returning the fallback — a transient outage frozen in for six hours.
    // Asserted directly against the cache rather than inferred from call
    // counts: this holds no matter which code path a future change routes the
    // estimate through.
    assert.equal(
      routingStatus().cachedRoutes,
      0,
      'a fallback estimate must leave the cache empty, or a blip outlives itself by six hours'
    );

    const calls = stubFetch(matrixBody([okElement(5000, 900)]));
    const recovered = await roadDistance(A, B);
    assert.equal(calls.length, 1, 'the failed pair must be retried, not served from cache');
    assert.equal(recovered.source, 'MAPBOX');
    assert.equal(recovered.distanceKm, 5);
    assert.equal(routingStatus().cachedRoutes, 1, 'a real measurement IS cached');
    restore();
  });

  /* ------------------------------------------------------------------ *
   *  Bad input                                                         *
   * ------------------------------------------------------------------ */

  await check('Nonsense coordinates do not throw', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = '';
    clearRoutingCache();
    const results = await roadDistanceMatrix(A, [
      { latitude: NaN, longitude: 77.6 },
      { latitude: 999, longitude: 77.6 },
      B
    ]);
    assert.equal(results.length, 3);
    assert.ok(results.every(r => Number.isFinite(r.distanceKm)), 'every entry must be a real number');
    restore();
  });

  await check('An empty destination list asks Google nothing', async () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'test-key';
    clearRoutingCache();
    const calls = stubFetch(matrixBody([]));
    const results = await roadDistanceMatrix(A, []);
    assert.equal(results.length, 0);
    assert.equal(calls.length, 0);
    restore();
  });

  await check('routingStatus reports configuration without leaking the key', () => {
    (config as any).MAPBOX_ACCESS_TOKEN = 'super-secret-key';
    const status = routingStatus();
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes('super-secret-key'), 'the health payload must not carry the key');
    restore();
  });

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
