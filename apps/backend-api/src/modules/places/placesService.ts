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
import { randomUUID } from 'node:crypto';
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { CircuitBreaker } from '../platform/circuitBreaker.ts';

const MAPBOX = 'https://api.mapbox.com';

/** Its own breaker: Mapbox being slow must not be confused with Razorpay being slow. */
const breaker = new CircuitBreaker('Address lookup', {
  threshold: 4,
  cooldownMs: 60_000,
  timeoutMs: 6_000
});

/**
 * Why Mapbox last refused a call, if it did.
 *
 * Kept because "configured" and "working" are different questions and only the
 * first was answerable. A token can be set, reach Mapbox, and be rejected — and
 * the only symptom is an empty result, which is indistinguishable from a street
 * that does not exist.
 *
 * The shape of a refusal changed with the provider and that is the part worth
 * being careful about. Google answered HTTP 200 with a `status` field, so
 * refusals were found by reading the body. Mapbox uses real status codes: 401
 * for a bad token, 403 for one lacking the scope, 422 for a malformed query,
 * 429 for the rate limit. Porting this by deleting the body check would have
 * made every one of those look like "no such address", forever, silently.
 *
 * `detail` is Mapbox's own `message`, which names the misconfiguration and
 * carries no token material.
 */
let lastRefusal: { status: string; detail?: string; at: string } | null = null;

export function isPlacesConfigured(): boolean {
  return config.MAPBOX_ACCESS_TOKEN.length > 0;
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

/**
 * One call to Mapbox, with every refusal made visible.
 *
 * Returns null for "no answer" — a refusal, a timeout, an open breaker — and
 * the caller must not cache null unless `lastRefusal` is unchanged across the
 * call. Caching a refusal would leave every address anybody looked up broken
 * for as long as the cache lives, which is exactly long enough for somebody to
 * decide that fixing the token did not work.
 */
async function callMapbox(url: string): Promise<any | null> {
  try {
    const response = await breaker.run(
      signal => fetch(url, { signal }),
      res => res.status >= 500
    );

    if (!response.ok) {
      /*
       * A non-2xx from Mapbox is the refusal. 401 is a bad token, 403 a token
       * without the scope, 422 a malformed query, 429 the account rate limit.
       * None of them mean "that address does not exist", and recording them is
       * the only thing that makes the difference visible to anybody.
       */
      const body: any = await response.json().catch(() => null);
      lastRefusal = {
        status: `HTTP_${response.status}`,
        detail: body?.message ? String(body.message) : undefined,
        at: new Date().toISOString()
      };
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'PLACES_API_REFUSED',
        httpStatus: response.status,
        // Mapbox's own message names the misconfiguration and contains no
        // token material.
        detail: body?.message
      }));
      return null;
    }

    return (await response.json().catch(() => null)) || null;
  } catch {
    // Breaker open or request timed out. Null means "no suggestions", and the
    // app falls back to manual entry rather than showing an error.
    return null;
  }
}

/**
 * Search Box requires a session token; Google merely preferred one.
 *
 * On Google a missing `sessiontoken` cost more money and worked. On Mapbox the
 * suggest/retrieve pair is billed per session and a missing one is rejected, so
 * an older client that never sent one would have had address search fail
 * outright rather than get more expensive. One is generated per call when the
 * client does not supply it: it bills as a single-use session, which is the
 * correct price for a caller that is not grouping its keystrokes anyway.
 */
function sessionFor(supplied?: string): string {
  return supplied && supplied.trim() ? supplied.trim() : randomUUID();
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
    q: trimmed,
    access_token: config.MAPBOX_ACCESS_TOKEN,
    session_token: sessionFor(options.sessionToken),
    country: config.PLACES_REGION,
    language: 'en',
    limit: '8',
    types: 'address,street,place,locality,neighborhood,poi'
  });
  if (options.near) {
    // LONGITUDE FIRST. Mapbox orders every coordinate as lon,lat and Google
    // ordered them lat,lng. Reversed, this silently biases results toward a
    // point in the wrong hemisphere rather than failing, so it reads as
    // "the suggestions are bad" instead of as a bug.
    params.set('proximity', `${options.near.longitude},${options.near.latitude}`);
  }

  const refusalsBefore = lastRefusal?.at;
  const body = await callMapbox(`${MAPBOX}/search/searchbox/v1/suggest?${params.toString()}`);
  // A refusal returns nothing AND is not cached below, so the next keystroke
  // after the token is fixed gets a real answer.
  if (!body || !Array.isArray(body.suggestions)) return [];
  if (lastRefusal?.at !== refusalsBefore) return [];

  const suggestions: PlaceSuggestion[] = body.suggestions.slice(0, 8).map((p: any) => ({
    placeId: p.mapbox_id,
    primary: p.name || p.name_preferred || '',
    secondary: p.place_formatted || p.full_address || ''
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
    access_token: config.MAPBOX_ACCESS_TOKEN,
    // The same session as the suggest calls that led here, so the whole address
    // entry bills as one session rather than as a suggest plus a lookup.
    session_token: sessionFor(sessionToken)
  });

  const refusalsBefore = lastRefusal?.at;
  const body = await callMapbox(
    `${MAPBOX}/search/searchbox/v1/retrieve/${encodeURIComponent(placeId)}?${params.toString()}`
  );
  const feature = body?.features?.[0];
  // GeoJSON: [longitude, latitude]. In that order, always.
  const coordinates = feature?.geometry?.coordinates;
  const location = Array.isArray(coordinates) && coordinates.length >= 2
    ? { lat: Number(coordinates[1]), lng: Number(coordinates[0]) }
    : null;
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    // Only cache a genuine "no such place". A refused or failed call must not
    // be remembered, or fixing the key leaves every address anybody has already
    // looked up broken for a day — which is exactly long enough for somebody to
    // conclude the fix did not work.
    if (body && lastRefusal?.at === refusalsBefore) placeCache.set(placeId, null);
    return null;
  }

  const resolved = shapePlace(
    feature.properties?.full_address || feature.properties?.name || '',
    location.lat,
    location.lng,
    feature.properties?.context
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
    // Named parameters rather than an ordered pair, which is the one place
    // Mapbox removes the chance of swapping them.
    longitude: String(longitude),
    latitude: String(latitude),
    access_token: config.MAPBOX_ACCESS_TOKEN,
    types: 'address,street,neighborhood,place',
    limit: '1'
  });

  const refusalsBefore = lastRefusal?.at;
  const body = await callMapbox(`${MAPBOX}/search/geocode/v6/reverse?${params.toString()}`);
  const first = body?.features?.[0];
  if (!first) {
    // See resolvePlace: a refusal is not an answer and is not cached.
    if (body && lastRefusal?.at === refusalsBefore) reverseCache.set(cacheKey, null);
    return null;
  }

  const resolved = shapePlace(
    first.properties?.full_address || first.properties?.name || '',
    Number(first.geometry?.coordinates?.[1] ?? latitude),
    Number(first.geometry?.coordinates?.[0] ?? longitude),
    first.properties?.context
  );
  reverseCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * `context` replaces Google's address_components, and it is a different shape
 * rather than a renamed one.
 *
 * Google returned an ARRAY of components, each carrying a list of types, so a
 * locality was found by searching for one. Mapbox returns an OBJECT keyed by
 * the type, so it is a lookup. A port that kept the array search would find
 * nothing, every time, and every address would silently lose its locality and
 * postcode — which does not break anything loudly, it just quietly degrades
 * every address the platform stores.
 */
function shapePlace(
  formattedAddress: string,
  lat: number,
  lng: number,
  context: Record<string, any> | undefined
): ResolvedPlace {
  const find = (type: string) => {
    const entry = context && typeof context === 'object' ? (context as any)[type] : undefined;
    const value = entry?.name;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  return {
    formattedAddress: formattedAddress || '',
    latitude: lat,
    longitude: lng,
    locality: find('locality') || find('neighborhood') || find('place') || find('district'),
    postalCode: find('postcode')
  };
}

/** For the health payload, so "why is address search dead" is answerable. */
export function placesStatus() {
  return {
    configured: isPlacesConfigured(),
    region: config.PLACES_REGION,
    cachedSuggestions: suggestionCache.size,
    /**
     * Present only when Mapbox has actually refused something. Its absence on a
     * configured deployment is the good case; its presence names the fix.
     */
    lastRefusal,
    dependency: breaker.snapshot()
  };
}
