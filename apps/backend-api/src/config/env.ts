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
