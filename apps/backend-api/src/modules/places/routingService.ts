/**
 * How far it actually is by road, and how long that takes.
 *
 * Everything that costs a customer money or sets an expectation was, until now,
 * computed from a straight line between two points — and in a real city a
 * straight line is a lie of a fairly consistent size. A river, a railway, a
 * one-way system or a flyover with no exit routinely turn 2 km of geometry into
 * 4 km of riding. The customer is charged for the 2 and the rider does the 4.
 *
 * So the distance behind a delivery fee, and the delivery time shown before
 * ordering, now come from Google's Distance Matrix where that is possible.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not price the live rider leg. `eta.ts` re-measures the rider's
 * position every few seconds while they ride; asking Google each time would be
 * a paid call per tick per active order, which is a bill that scales with
 * success. Straight line is good enough for a number that refreshes constantly
 * and is never charged for.
 *
 * It does not measure every restaurant on the home screen. One customer opening
 * the app past twenty restaurants is twenty billable elements, and the home
 * screen is the most-visited screen there is. The list is sorted and filtered
 * on the estimate below, which is a straight line multiplied by a road factor;
 * the real measurement is made once, for the one restaurant actually ordered
 * from, at the moment the bill is computed. Approximate where it only orders a
 * list, exact where it decides a charge.
 *
 * It does not fail. Every function returns a usable distance whatever Google
 * does — key absent, quota spent, request timed out, address in the sea. A
 * checkout that cannot compute a delivery fee is a checkout that cannot take an
 * order, and no routing API is worth that. `source` says which answer you got,
 * so a caller that cares can tell measurement from estimate, and so the
 * difference between the two is visible in the logs rather than assumed.
 */
import { config } from '../../config/env.ts';
import { calculateDistanceKm } from '../../db/client.ts';
import { CircuitBreaker } from '../platform/circuitBreaker.ts';
import { isPlacesConfigured } from './placesService.ts';
import type { Coordinates } from '@quick-bites/shared-types';

const MAPBOX_MATRIX = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic';

/**
 * Its own breaker, separate from address lookup's.
 *
 * They are different APIs with different quotas and different failure modes:
 * exhausting the Distance Matrix quota must not also stop address autocomplete
 * working, and a shared breaker would do exactly that.
 */
const breaker = new CircuitBreaker('Road distance', {
  threshold: 4,
  cooldownMs: 60_000,
  timeoutMs: 5_000
});

/**
 * Why Google last refused a routing call. See placesService for the reasoning:
 * "configured" and "working" are different questions, and only the first was
 * answerable without reading the deployment logs.
 */
let lastRefusal: { status: string; detail?: string; at: string } | null = null;

export interface RoadDistance {
  distanceKm: number;
  durationMinutes: number;
  /**
   * MAPBOX — measured along real roads, on the traffic-aware profile.
   * ESTIMATED — straight line scaled by the road factor, because Mapbox was not
   * configured, not reachable, or had no route to offer.
   */
  source: 'MAPBOX' | 'ESTIMATED';
}

/* -------------------------------------------------------------------------- *
 *                                 THE FALLBACK                                *
 * -------------------------------------------------------------------------- */

/**
 * Straight line, scaled up to something a road might plausibly be.
 *
 * The multiplier is a real, measured quantity — the "circuity factor" — and for
 * dense Indian cities sits near 1.3. It is configurable because it is a claim
 * about a particular city's street grid, not a constant, and the honest way to
 * set it is to compare these estimates against delivered orders rather than to
 * guess once in a source file.
 *
 * This is never presented as a measurement. It is returned with
 * `source: 'ESTIMATED'` so nothing downstream mistakes it for one.
 */
export function estimateByRoad(from: Coordinates, to: Coordinates): RoadDistance {
  const straight = calculateDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude);
  const distanceKm = round2(straight * config.ROAD_DISTANCE_FACTOR);
  return {
    distanceKm,
    durationMinutes: Math.max(1, Math.ceil((distanceKm / config.DELIVERY_SPEED_KMPH) * 60)),
    source: 'ESTIMATED'
  };
}

/* -------------------------------------------------------------------------- *
 *                                   CACHING                                   *
 * -------------------------------------------------------------------------- */

interface CacheEntry {
  value: RoadDistance;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 5000;
// Six hours. Roads do not move, but traffic does, and the duration half of this
// answer is a traffic claim. Long enough that one restaurant's regulars share an
// entry; short enough that a morning estimate is not still being served at night.
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Four decimal places is about 11 metres.
 *
 * Coarse enough that two orders to the same building share an entry, fine
 * enough that two doors on opposite sides of a block do not — which is the
 * whole point, since the road between them can be several hundred metres.
 */
function key(from: Coordinates, to: Coordinates): string {
  return [
    from.latitude.toFixed(4),
    from.longitude.toFixed(4),
    to.latitude.toFixed(4),
    to.longitude.toFixed(4)
  ].join('|');
}

function readCache(k: string): RoadDistance | undefined {
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(k);
    return undefined;
  }
  return hit.value;
}

function writeCache(k: string, value: RoadDistance): void {
  // Only real measurements are worth keeping. Caching an estimate would pin the
  // fallback in place for six hours after Mapbox came back, which is how a
  // transient outage turns into an afternoon of wrong delivery fees.
  if (value.source !== 'MAPBOX') return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, { value, expiresAt: Date.now() + TTL_MS });
}

/** Exposed for tests, which must not inherit another test's cached answer. */
export function clearRoutingCache(): void {
  cache.clear();
}

/* -------------------------------------------------------------------------- *
 *                                THE MEASUREMENT                              *
 * -------------------------------------------------------------------------- */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function valid(point?: Coordinates | null): point is Coordinates {
  return (
    !!point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/**
 * One origin, up to 25 destinations, one billable request.
 *
 * 25 is Google's own ceiling per request for destinations. Callers above that
 * are chunked rather than refused, because a caller that has to know the limit
 * is a caller that will one day forget it.
 *
 * Returns one entry per destination, in order, always. A destination Google
 * could not route to gets the estimate rather than a gap, so the caller never
 * has to handle a missing element.
 */
export async function roadDistanceMatrix(
  from: Coordinates,
  destinations: Coordinates[]
): Promise<RoadDistance[]> {
  if (!valid(from) || destinations.length === 0) {
    return destinations.map(to =>
      valid(to) && valid(from) ? estimateByRoad(from, to) : { distanceKm: 0, durationMinutes: 0, source: 'ESTIMATED' }
    );
  }

  // Everything answerable without a call is answered first, so a batch where
  // every pair is already cached costs nothing at all.
  const results: (RoadDistance | undefined)[] = destinations.map(to =>
    valid(to) ? readCache(key(from, to)) : { distanceKm: 0, durationMinutes: 0, source: 'ESTIMATED' as const }
  );

  const pending: number[] = [];
  results.forEach((r, i) => {
    if (r === undefined && valid(destinations[i])) pending.push(i);
  });

  if (pending.length === 0 || !isPlacesConfigured()) {
    return results.map((r, i) => r ?? estimateByRoad(from, destinations[i]));
  }

  /*
   * NINE, not twenty-five.
   *
   * Google billed per element and allowed 25 destinations in a request. The
   * Mapbox traffic-aware profile limits a matrix to TEN COORDINATES IN TOTAL,
   * and the origin is one of them. Carrying the old batch size over would have
   * made every call with more than 24 destinations fail — and because a failed
   * matrix falls back to the straight-line estimate rather than erroring, the
   * only symptom would have been delivery fees quietly becoming estimates on
   * busy batches, with nothing in the logs to say why.
   */
  const MAX_DESTINATIONS_PER_CALL = 9;

  for (let start = 0; start < pending.length; start += MAX_DESTINATIONS_PER_CALL) {
    const chunk = pending.slice(start, start + MAX_DESTINATIONS_PER_CALL);
    const measured = await callDistanceMatrix(from, chunk.map(i => destinations[i]));
    chunk.forEach((destIndex, chunkIndex) => {
      const value = measured?.[chunkIndex];
      if (value) {
        writeCache(key(from, destinations[destIndex]), value);
        results[destIndex] = value;
      }
    });
  }

  return results.map((r, i) => r ?? estimateByRoad(from, destinations[i]));
}

/** The single-pair case, which is what checkout actually asks. */
export async function roadDistance(from: Coordinates, to: Coordinates): Promise<RoadDistance> {
  const [only] = await roadDistanceMatrix(from, [to]);
  return only;
}

async function callDistanceMatrix(
  from: Coordinates,
  destinations: Coordinates[]
): Promise<(RoadDistance | null)[] | null> {
  /*
   * Coordinates go in the path, semicolon separated, LONGITUDE FIRST.
   *
   * Google took lat,lng in a query parameter. Mapbox takes lon,lat in the URL
   * path. Swapped, an Indian delivery becomes a point in the Indian Ocean and
   * the API answers perfectly happily with a distance of several hundred
   * kilometres — so the failure is not an error, it is a delivery fee.
   */
  const points = [from, ...destinations].map(c => `${c.longitude},${c.latitude}`).join(';');

  const params = new URLSearchParams({
    access_token: config.MAPBOX_ACCESS_TOKEN,
    // Both, and both are needed: distance prices the delivery, duration is the
    // ETA the customer is shown.
    annotations: 'distance,duration',
    sources: '0',
    destinations: destinations.map((_, i) => i + 1).join(';')
  });

  try {
    const response = await breaker.run(
      signal => fetch(`${MAPBOX_MATRIX}/${points}?${params.toString()}`, { signal }),
      res => res.status >= 500
    );

    if (!response.ok) {
      /*
       * Mapbox refuses with a real status code — 401 for a bad token, 403 for
       * one without the scope, 422 for too many coordinates. None of them mean
       * "there is no road", and every one of them would otherwise degrade every
       * fee on the platform to an estimate with nothing in the logs to say why.
       */
      const errorBody: any = await response.json().catch(() => null);
      lastRefusal = {
        status: `HTTP_${response.status}`,
        detail: errorBody?.message ? String(errorBody.message) : undefined,
        at: new Date().toISOString()
      };
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'ROUTING_API_REFUSED',
        httpStatus: response.status,
        // Names the misconfiguration; contains no token material.
        detail: errorBody?.message
      }));
      return null;
    }

    const body: any = await response.json().catch(() => null);
    // Mapbox reports its own outcome in `code`. Anything other than Ok on a
    // 200 is not a route.
    if (!body || (body.code && body.code !== 'Ok')) return null;

    // One source, so one row in each matrix. Distances are metres, durations
    // are seconds — the same units Google used, which is the one thing about
    // this port that did not change.
    const distances = body.distances?.[0];
    const durations = body.durations?.[0];
    if (!Array.isArray(distances) || !Array.isArray(durations)) return null;

    return destinations.map((_, i) => {
      /*
       * Checked for null BEFORE converting, because Number(null) is 0 and not
       * NaN. Converting first made an unroutable pair look like a measured
       * zero-kilometre trip — a real answer, cached as one, and priced as a
       * free delivery. The straight-line fallback never ran.
       */
      if (distances[i] === null || distances[i] === undefined) return null;
      if (durations[i] === null || durations[i] === undefined) return null;

      const metres = Number(distances[i]);
      const seconds = Number(durations[i]);
      /*
       * Mapbox returns null for a pair it cannot route — an island, a sea, a
       * typo. That is a real answer about that one destination and it must
       * fall back for that one alone, without discarding the others measured
       * in the same call.
       */
      if (!Number.isFinite(metres) || !Number.isFinite(seconds)) return null;
      return {
        distanceKm: round2(metres / 1000),
        durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
        source: 'MAPBOX' as const
      };
    });
  } catch {
    // Breaker open, or the request timed out. The caller falls back to the
    // estimate, which is the whole reason this returns null rather than throws.
    return null;
  }
}

/** For the health payload, so "why is every fee an estimate" is answerable. */
export function routingStatus() {
  return {
    configured: isPlacesConfigured(),
    roadFactor: config.ROAD_DISTANCE_FACTOR,
    cachedRoutes: cache.size,
    /** Absent on a healthy deployment; present, it names the fix. */
    lastRefusal,
    dependency: breaker.snapshot()
  };
}
