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

const GOOGLE = 'https://maps.googleapis.com/maps/api/distancematrix/json';

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

export interface RoadDistance {
  distanceKm: number;
  durationMinutes: number;
  /**
   * GOOGLE — measured along real roads.
   * ESTIMATED — straight line scaled by the road factor, because Google was not
   * configured, not reachable, or had no route to offer.
   */
  source: 'GOOGLE' | 'ESTIMATED';
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
  // fallback in place for six hours after Google came back, which is how a
  // transient outage turns into an afternoon of wrong delivery fees.
  if (value.source !== 'GOOGLE') return;
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

  for (let start = 0; start < pending.length; start += 25) {
    const chunk = pending.slice(start, start + 25);
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
  const params = new URLSearchParams({
    origins: `${from.latitude},${from.longitude}`,
    destinations: destinations.map(d => `${d.latitude},${d.longitude}`).join('|'),
    key: config.GOOGLE_MAPS_SERVER_KEY,
    // Two-wheelers are what actually does these deliveries. Google has no
    // scooter mode; driving is the closer of the two it offers, since walking
    // would route down lanes no rider takes and give times nobody could meet.
    mode: 'driving',
    units: 'metric',
    region: config.PLACES_REGION
  });

  try {
    const response = await breaker.run(
      signal => fetch(`${GOOGLE}?${params.toString()}`, { signal }),
      res => res.status >= 500
    );
    if (!response.ok) return null;
    const body: any = await response.json().catch(() => null);

    // Google answers 200 with a status field. REQUEST_DENIED — the shape of
    // "this key is not authorised for Distance Matrix" — arrives as HTTP 200
    // and would otherwise read as a route that does not exist, which is to say
    // it would silently degrade every fee on the platform to an estimate with
    // nothing in the logs to say why.
    if (!body || (body.status && body.status !== 'OK')) {
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'ROUTING_API_REFUSED',
        googleStatus: body?.status,
        // Names the misconfiguration; contains no key material.
        detail: body?.error_message
      }));
      return null;
    }

    const elements = body.rows?.[0]?.elements;
    if (!Array.isArray(elements)) return null;

    return elements.map((el: any) => {
      // Per-element status. ZERO_RESULTS is a real answer meaning "no drivable
      // route" — an island, a sea, a typo — and it must fall back for that one
      // destination without discarding the others in the same batch.
      if (el?.status !== 'OK') return null;
      const metres = Number(el.distance?.value);
      const seconds = Number(el.duration?.value);
      if (!Number.isFinite(metres) || !Number.isFinite(seconds)) return null;
      return {
        distanceKm: round2(metres / 1000),
        durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
        source: 'GOOGLE' as const
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
    dependency: breaker.snapshot()
  };
}
