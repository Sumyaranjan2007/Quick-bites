import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root or apps/backend-api
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

/**
 * Secrets must never fall back to a literal in source. This repository is public,
 * so a committed default is a published credential: anyone could sign a JWT for any
 * account, or forge a payment signature. In production we refuse to boot without the
 * real value; outside production we derive a random per-process value, which keeps
 * local development working but makes tokens useless anywhere else.
 */
function requireSecret(name: string, value: string | undefined): string {
  if (value && value.length > 0) return value;
  if (IS_PRODUCTION) {
    throw new Error(
      `${name} is not set. Refusing to start: falling back to a built-in value would ` +
        `publish this deployment's signing key, since the source is public.`
    );
  }
  return `dev-only-${name}-${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Demo bearer tokens bypass authentication entirely, so production must never enable
 * them — not even when DEMO_MODE=true is set by mistake on the host.
 */
const DEMO_MODE = IS_PRODUCTION ? false : process.env.DEMO_MODE !== 'false';

/**
 * A number from the environment, clamped, with a fallback that actually holds.
 *
 * `Math.max(1, parseFloat(value))` looks like a floor and is not one: parseFloat
 * of anything unparseable is NaN, and Math.max(1, NaN) is NaN, not 1. A single
 * typo in a Railway variable would therefore reach the pricing engine as NaN and
 * turn every delivery fee on the platform into `NaN` — the kind of fault that
 * survives review because the guard is right there in the line and looks correct.
 */
function numberFromEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const config = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: parseInt(process.env.PORT || '5000', 10),
  DEMO_MODE,
  JWT_SECRET: requireSecret('JWT_SECRET', process.env.JWT_SECRET),

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://mock.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'mock-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-key',
  
  // Upstash Redis
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  
  // MongoDB Atlas
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/quickbites',
  
  // Meilisearch
  MEILISEARCH_HOST: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  MEILISEARCH_API_KEY: process.env.MEILISEARCH_API_KEY || 'masterKey123SampleForLocalDev',
  
  // Razorpay — the secret verifies payment signatures, so a published default
  // would let anyone mint a "paid" order.
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_test_samplekey123',
  RAZORPAY_KEY_SECRET: requireSecret('RAZORPAY_KEY_SECRET', process.env.RAZORPAY_KEY_SECRET),

  /**
   * Separate from the key secret, and issued when the webhook is registered in
   * the Razorpay dashboard. Without it, webhook signatures cannot be verified —
   * and an unverified webhook endpoint is an open instruction to mark any order
   * paid, so the handler refuses rather than trusting the body.
   */
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',

  /**
   * Whether a password-reset code is returned in the API response.
   *
   * There is no mail or SMS provider wired up, so a reset code has to reach the
   * person somehow. Echoing it in the response is convenient and is exactly how
   * an account is stolen by anyone who knows an email address, so it is off in
   * production unless someone deliberately turns it on. In production the code
   * is written to the server log instead, where support can read it out.
   */
  PASSWORD_RESET_ECHO: IS_PRODUCTION
    ? process.env.PASSWORD_RESET_ECHO === 'true'
    : process.env.PASSWORD_RESET_ECHO !== 'false',

  /**
   * Customer identity is a phone number verified by a one-time code.
   *
   * OTP_PROVIDER selects how the code is delivered. `fixed` does not deliver
   * anything: it accepts one known code, which is how the platform is tested
   * before an SMS vendor exists. Adding a real provider is a new driver in
   * `modules/auth/otpDrivers.ts` and a change to this variable — nothing else.
   *
   * India requires TRAI DLT registration (entity, sender header, and approved
   * template) before ANY provider will deliver an OTP to an Indian number. That
   * is law rather than a vendor rule, and it is the long-pole item for going
   * live. See legal/COMPLIANCE.md.
   */
  OTP_PROVIDER: (process.env.OTP_PROVIDER || 'fixed') as 'fixed' | 'msg91' | 'twilio',
  OTP_FIXED_CODE: process.env.OTP_FIXED_CODE || '123456',

  /**
   * A fixed code on a public deployment means anyone who knows six digits can
   * sign in as any phone number, so production refuses it unless this is set
   * deliberately. It exists so testers can use the hosted API before an SMS
   * vendor is chosen; **removing it is the entire switch to real OTP**.
   */
  OTP_ALLOW_FIXED_IN_PRODUCTION: process.env.OTP_ALLOW_FIXED_IN_PRODUCTION === 'true',

  /** Minutes a code stays valid, and how many wrong guesses it survives. */
  OTP_TTL_MINUTES: parseInt(process.env.OTP_TTL_MINUTES || '5', 10),
  OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
  OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '30', 10),

  /**
   * The single administrator created at boot.
   *
   * Nothing is seeded with a known password any more. Production refuses to
   * start without these rather than coming up with no way in, or — worse —
   * with a default everyone can read in a public repository.
   */
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',

  /**
   * Demo restaurants, menus and accounts exist for tests and local development.
   * Production boots empty and is populated through admin onboarding, so a
   * demonstration restaurant can never appear to a real customer.
   */
  SEED_DEMO_DATA: IS_PRODUCTION
    ? process.env.SEED_DEMO_DATA === 'true'
    : process.env.SEED_DEMO_DATA !== 'false',

  /**
   * How fast a rider actually moves through city traffic, in km/h, used to turn
   * a distance into an arrival time.
   *
   * It is configuration rather than a literal because it is the one number in
   * the ETA that is a claim about the real world: it differs between a dense
   * city and a small town, and it will be wrong until it is measured against
   * delivered orders. Changing it must not require a release.
   */
  DELIVERY_SPEED_KMPH: numberFromEnv(process.env.DELIVERY_SPEED_KMPH, 18, 1, 120),

  /**
   * How much longer a road is than the straight line under it.
   *
   * Used only where a real road measurement is not worth a paid call — the
   * restaurant list, and any pair Google could not route. A straight line
   * between two points in a city understates the ride by a fairly consistent
   * proportion, and 1.3 is the figure measured for dense Indian street grids.
   *
   * It is a claim about a particular city, not a constant, so it is settable
   * without a release. The honest way to tune it is to compare estimates
   * against the road distances Google returns on real orders.
   */
  ROAD_DISTANCE_FACTOR: numberFromEnv(process.env.ROAD_DISTANCE_FACTOR, 1.3, 1, 3),

  /**
   * The delivery radius assumed for a restaurant that has not set its own.
   *
   * Applies to kitchens onboarded before `serviceRadiusKm` existed. Eight
   * kilometres is a little over half the old platform-wide 15 km ceiling: far
   * enough that no existing restaurant loses most of its customers overnight,
   * close enough that the listing stops promising deliveries nobody will ride.
   */
  DEFAULT_SERVICE_RADIUS_KM: numberFromEnv(process.env.DEFAULT_SERVICE_RADIUS_KM, 8, 1, 50),

  /**
   * Minutes added to every estimate for the parts of a delivery that are not
   * travel: parking, finding the counter, waiting for a lift, reaching a door.
   */
  DELIVERY_HANDLING_MINUTES: Math.max(0, parseInt(process.env.DELIVERY_HANDLING_MINUTES || '6', 10)),

  /**
   * What a kitchen is assumed to take when it has not said. Used only until the
   * restaurant accepts the order and gives a real preparation time.
   */
  DEFAULT_PREP_MINUTES: Math.max(1, parseInt(process.env.DEFAULT_PREP_MINUTES || '20', 10)),

  /**
   * How long a kitchen has to accept an order before the platform cancels it
   * on the customer's behalf.
   *
   * Without this an ignored order sits forever: the customer waits, their money
   * is held, and no rider is ever dispatched. Nobody is served by that, least of
   * all the restaurant — a cancellation with a reason is recoverable, an order
   * that silently never arrives is not.
   */
  ORDER_ACCEPT_TIMEOUT_MINUTES: Math.max(1, parseInt(process.env.ORDER_ACCEPT_TIMEOUT_MINUTES || '8', 10)),

  /**
   * How long food may sit packed with no rider before operations is told.
   *
   * This raises an alert rather than cancelling. Food that is already cooked is
   * a different problem from an order nobody accepted, and cancelling it wastes
   * the kitchen's work — a human should decide.
   */
  RIDER_ASSIGN_ALERT_MINUTES: Math.max(1, parseInt(process.env.RIDER_ASSIGN_ALERT_MINUTES || '10', 10)),

  /**
   * How long an order may sit in PAYMENT_PENDING before reconciliation asks the
   * gateway what actually happened to it.
   *
   * Long enough that a customer still on the payment screen is left alone, and
   * short enough that money taken with a lost webhook is found in minutes
   * rather than at the end of the day.
   */
  PAYMENT_RECONCILE_AFTER_MINUTES: Math.max(1, parseInt(process.env.PAYMENT_RECONCILE_AFTER_MINUTES || '5', 10)),

  /**
   * When an unpaid order is given up on. The gateway is asked first, every
   * time; this only applies once it has confirmed nothing was captured.
   */
  PAYMENT_ABANDON_AFTER_MINUTES: Math.max(5, parseInt(process.env.PAYMENT_ABANDON_AFTER_MINUTES || '30', 10)),

  /**
   * The Google Maps key used for Geocoding, Places and Distance Matrix.
   *
   * SERVER SIDE ONLY, and that is the whole point of it being here. Those three
   * APIs are billed per call with no free ceiling beyond the monthly credit, so
   * a key that reaches a phone is a key anyone can pull out of the APK and
   * spend. Every lookup the apps need goes through this server instead, which
   * means the key is restricted by IP to this deployment and the apps cannot
   * make a request we did not write.
   *
   * The Android map-rendering key is a different key entirely, is restricted to
   * the app's package and signing certificate, and is injected at build time by
   * the withGoogleMapsKey plugin. It is not this one and must never be set to
   * the same value.
   *
   * Absent, address lookup falls back to manual entry and nothing crashes.
   */
  GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY || '',

  /**
   * Biases address search toward the country being served, so "MG Road"
   * returns Bengaluru rather than a street in another hemisphere.
   */
  PLACES_REGION: process.env.PLACES_REGION || 'in',

  /** How often the sweeper looks. Short enough to be timely, long enough to be cheap. */
  ORDER_SWEEP_INTERVAL_SECONDS: Math.max(5, parseInt(process.env.ORDER_SWEEP_INTERVAL_SECONDS || '30', 10)),

  /**
   * How far from the delivery address a rider may be when marking an order
   * delivered before it is flagged for review.
   *
   * Flagged, never blocked: GPS is accurate to 60-150 metres at best and can be
   * wrong by kilometres indoors, so refusing the handover would strand honest
   * riders at real doorsteps. A flag costs a review; a block costs a delivery.
   */
  DELIVERY_PROXIMITY_METRES: Math.max(50, parseInt(process.env.DELIVERY_PROXIMITY_METRES || '300', 10)),

  /**
   * The largest tip that will be accepted. An upper bound exists because the
   * tip is the only figure on the bill the client chooses outright, so an
   * unbounded one is a way to push an arbitrary amount through checkout — by a
   * mistyped number as easily as by a hostile client.
   */
  MAX_TIP_AMOUNT: Math.max(0, parseFloat(process.env.MAX_TIP_AMOUNT || '500')),

  // Security
  CORS_WHITELIST: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8081',
    'https://quickbite.app',
    'https://partner.quickbite.app',
    'https://admin.quickbite.app'
  ]
};
