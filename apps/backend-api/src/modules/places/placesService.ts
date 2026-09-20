/**
 * Address lookup, through this server rather than from the apps.
 *
 * Three questions the apps need answered, and none of them can be asked
 * directly from a phone:
 *
 *   - "What are they typing?" — autocomplete while an address is entered.
 *   - "Where exactly is that?" — the coordinates behind a chosen suggestion.
 *   - "What is here?" — the address at a pin the customer dragged.
 *
 * Google bills every one of those per call. A key embedded in an APK can be
 * extracted in about a minute with `unzip` and `grep`, and the bill for someone
 * else's traffic arrives at the end of the month. So the key stays here, the
 * apps call this server, and the server calls Google. Restricting the key by IP
 * to this deployment then makes an extracted key useless, because there is
 * nothing to extract it from.
 *
 * Two further things this placement buys, which a direct call could not:
 *
 * A CACHE. Autocomplete fires on nearly every keystroke. "koramangala" typed by
 * two hundred people is two hundred identical requests to a paid API. The cache
 * below collapses those to one per phrase per hour, which is the difference
 * between a bill worth ignoring and a bill worth an argument.
 *
 * A LIMIT. Even cached, a script can type nonsense faster than people can.
 * Anything past the per-minute ceiling is refused here rather than forwarded.
 *
 * Unconfigured, every function returns an empty, successful result. The apps
 * fall back to typing an address by hand — which is exactly what they did
 * before this file existed, so an absent key costs a convenience and never an
 * outage.
 */
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { CircuitBreaker } from '../platform/circuitBreaker.ts';

const GOOGLE = 'https://maps.googleapis.com/maps/api';

/** Its own breaker: Google being slow must not be confused with Razorpay being slow. */
const breaker = new CircuitBreaker('Address lookup', {
  threshold: 4,
  cooldownMs: 60_000,
  timeoutMs: 6_000
});

/**
 * Why Google last refused a call, if it did.
 *
 * Kept because "configured" and "working" are different questions and only the
 * first was answerable. A key can be set, reach Google, and be rejected — and
 * the only symptom is an empty result, which is indistinguishable from a street
 * that does not exist. Diagnosing that previously meant reading the deployment
 * logs; this puts Google's own words in the health payload.
 *
 * `detail` is Google's `error_message`, which names the misconfiguration ("This
 * API project is not authorized to use this API") and carries no key material.
 */
let lastRefusal: { status: string; detail?: string; at: string } | null = null;

export function isPlacesConfigured(): boolean {
  return config.GOOGLE_MAPS_SERVER_KEY.length > 0;
}

export interface PlaceSuggestion {
  placeId: string;
  /** "Koramangala 5th Block" */
  primary: string;
  /** "Bengaluru, Karnataka, India" */
  secondary: string;
}

export interface ResolvedPlace {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  /** Filled where Google returns them, so the app can prefill its own fields. */
  locality?: string;
  postalCode?: string;
}

/* -------------------------------------------------------------------------- *
 *                                  CACHING                                    *
 * -------------------------------------------------------------------------- */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-process, bounded, and deliberately not Redis.
 *
 * One box serves this today. An unbounded Map would be a memory leak measured
 * in months rather than minutes, so the oldest entries are dropped once it
 * fills — a cache that evicts is a cache; one that only grows is a leak.
 */
class TinyCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly max: number;
  private readonly ttlMs: number;

  // Written out rather than as constructor parameter properties: the backend
  // runs under Node's type stripping, which erases annotations and does not
  // transform syntax, so a parameter property is a boot-time syntax error.
  constructor(max: number, ttlMs: number) {
    this.max = max;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-inserted so that Map iteration order approximates least-recently-used.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

// An hour for suggestions: streets do not move, and an hour bounds how long a
// genuinely new address stays missing.
const suggestionCache = new TinyCache<PlaceSuggestion[]>(2000, 60 * 60 * 1000);
// A day for resolved coordinates, which move even less.
const placeCache = new TinyCache<ResolvedPlace | null>(2000, 24 * 60 * 60 * 1000);
const reverseCache = new TinyCache<ResolvedPlace | null>(2000, 24 * 60 * 60 * 1000);

/** Exposed for tests, which must not inherit another test's cached answer. */
export function clearPlacesCache(): void {
  suggestionCache.clear();
  placeCache.clear();
  reverseCache.clear();
}

/* -------------------------------------------------------------------------- *
 *                                RATE LIMITING                                *
 * -------------------------------------------------------------------------- */

const MAX_LOOKUPS_PER_MINUTE = 60;
const callers = new Map<string, { count: number; windowStart: number }>();

function enforceQuota(callerId: string): void {
  const now = Date.now();
  const bucket = callers.get(callerId);

  if (!bucket || now - bucket.windowStart > 60_000) {
    callers.set(callerId, { count: 1, windowStart: now });
    // Swept here rather than on a timer: the map is only ever read on a request,
    // so there is nothing to clean up between requests.
    if (callers.size > 5000) {
      for (const [key, value] of callers) {
        if (now - value.windowStart > 60_000) callers.delete(key);
      }
    }
    return;
  }

  bucket.count++;
  if (bucket.count > MAX_LOOKUPS_PER_MINUTE) {
    throw new AppError(
      'That is a lot of address searches. Please wait a minute and try again.',
      429,
      'PLACES_RATE_LIMITED'
    );
  }
}

/* -------------------------------------------------------------------------- *
 *                                  LOOKUPS                                    *
 * -------------------------------------------------------------------------- */

async function callGoogle(url: string): Promise<any | null> {
  try {
    const response = await breaker.run(
      signal => fetch(url, { signal }),
      res => res.status >= 500
    );
    if (!response.ok) return null;
    const body: any = await response.json().catch(() => null);
    if (!body) return null;

    // Google answers 200 with a status field; OVER_QUERY_LIMIT and
    // REQUEST_DENIED both arrive as HTTP 200 and would otherwise read as an
    // address that does not exist.
    if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
      lastRefusal = {
        status: String(body.status),
        detail: body.error_message ? String(body.error_message) : undefined,
        at: new Date().toISOString()
      };
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'PLACES_API_REFUSED',
        googleStatus: body.status,
        // error_message names the misconfiguration ("This API project is not
        // authorized to use this API") and contains no key material.
        detail: body.error_message
      }));
      return null;
    }
    return body;
  } catch {
    // Breaker open or request timed out. Null means "no suggestions", and the
    // app falls back to manual entry rather than showing an error.
    return null;
  }
}

/**
 * Suggestions for a partial address.
 *
 * `sessionToken` is Google's own billing mechanism: passing one groups every
 * keystroke of a single address entry plus the final details call into one
 * billable session instead of a dozen. The client generates it per entry and
 * discards it on selection.
 */
export async function suggestAddresses(
  query: string,
  callerId: string,
  options: { sessionToken?: string; near?: { latitude: number; longitude: number } } = {}
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  // Two characters return most of the country and cost a call to do it.
  if (trimmed.length < 3) return [];
  if (!isPlacesConfigured()) return [];

  enforceQuota(callerId);

  const near = options.near ? `${options.near.latitude.toFixed(2)},${options.near.longitude.toFixed(2)}` : '';
  // The session token is left out of the cache key on purpose: it differs per
  // customer and would make the cache never hit.
  const cacheKey = `${trimmed.toLowerCase()}|${near}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    input: trimmed,
    key: config.GOOGLE_MAPS_SERVER_KEY,
    components: `country:${config.PLACES_REGION}`,
    types: 'geocode|establishment'
  });
  if (options.sessionToken) params.set('sessiontoken', options.sessionToken);
  if (options.near) {
    params.set('location', `${options.near.latitude},${options.near.longitude}`);
    params.set('radius', '30000');
  }

  const refusalsBefore = lastRefusal?.at;
  const body = await callGoogle(`${GOOGLE}/place/autocomplete/json?${params.toString()}`);
  // A refusal returns nothing AND is not cached below, so the next keystroke
  // after the key is fixed gets a real answer.
  if (!body || !Array.isArray(body.predictions)) return [];
  if (lastRefusal?.at !== refusalsBefore) return [];

  const suggestions: PlaceSuggestion[] = body.predictions.slice(0, 8).map((p: any) => ({
    placeId: p.place_id,
    primary: p.structured_formatting?.main_text || p.description || '',
    secondary: p.structured_formatting?.secondary_text || ''
  }));

  suggestionCache.set(cacheKey, suggestions);
  return suggestions;
}

/** The coordinates and tidy address behind a chosen suggestion. */
export async function resolvePlace(
  placeId: string,
  callerId: string,
  sessionToken?: string
): Promise<ResolvedPlace | null> {
  if (!isPlacesConfigured()) return null;
  if (!placeId) return null;

  enforceQuota(callerId);

  const cached = placeCache.get(placeId);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    place_id: placeId,
    key: config.GOOGLE_MAPS_SERVER_KEY,
    // Asked for by name so the response stays small and the call stays on the
    // cheapest billing tier that answers the question.
    fields: 'formatted_address,geometry/location,address_component'
  });
  if (sessionToken) params.set('sessiontoken', sessionToken);

  const refusalsBefore = lastRefusal?.at;
  const body = await callGoogle(`${GOOGLE}/place/details/json?${params.toString()}`);
  const location = body?.result?.geometry?.location;
  if (!location) {
    // Only cache a genuine "no such place". A refused or failed call must not
    // be remembered, or fixing the key leaves every address anybody has already
    // looked up broken for a day — which is exactly long enough for somebody to
    // conclude the fix did not work.
    if (body && lastRefusal?.at === refusalsBefore) placeCache.set(placeId, null);
    return null;
  }

  const resolved = shapePlace(
    body.result.formatted_address,
    location.lat,
    location.lng,
    body.result.address_components
  );
  placeCache.set(placeId, resolved);
  return resolved;
}

/** The address at a dropped pin. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  callerId: string
): Promise<ResolvedPlace | null> {
  if (!isPlacesConfigured()) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  enforceQuota(callerId);

  // Five decimal places is about a metre, which is finer than a dragged pin and
  // coarse enough for two drags of the same doorstep to share a cache entry.
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = reverseCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    latlng: `${latitude},${longitude}`,
    key: config.GOOGLE_MAPS_SERVER_KEY,
    result_type: 'street_address|premise|subpremise|route|neighborhood'
  });

  const refusalsBefore = lastRefusal?.at;
  const body = await callGoogle(`${GOOGLE}/geocode/json?${params.toString()}`);
  const first = body?.results?.[0];
  if (!first) {
    // See resolvePlace: a refusal is not an answer and is not cached.
    if (body && lastRefusal?.at === refusalsBefore) reverseCache.set(cacheKey, null);
    return null;
  }

  const resolved = shapePlace(
    first.formatted_address,
    first.geometry?.location?.lat ?? latitude,
    first.geometry?.location?.lng ?? longitude,
    first.address_components
  );
  reverseCache.set(cacheKey, resolved);
  return resolved;
}

function shapePlace(
  formattedAddress: string,
  lat: number,
  lng: number,
  components: any[] | undefined
): ResolvedPlace {
  const find = (type: string) =>
    Array.isArray(components)
      ? components.find(c => Array.isArray(c.types) && c.types.includes(type))?.long_name
      : undefined;

  return {
    formattedAddress: formattedAddress || '',
    latitude: lat,
    longitude: lng,
    locality: find('locality') || find('sublocality') || find('administrative_area_level_2'),
    postalCode: find('postal_code')
  };
}

/** For the health payload, so "why is address search dead" is answerable. */
export function placesStatus() {
  return {
    configured: isPlacesConfigured(),
    region: config.PLACES_REGION,
    cachedSuggestions: suggestionCache.size,
    /**
     * Present only when Google has actually refused something. Its absence on a
     * configured deployment is the good case; its presence names the fix.
     */
    lastRefusal,
    dependency: breaker.snapshot()
  };
}
