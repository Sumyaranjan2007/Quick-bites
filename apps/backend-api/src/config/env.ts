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
