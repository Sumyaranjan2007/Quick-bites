import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root or apps/backend-api
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  DEMO_MODE: process.env.DEMO_MODE !== 'false', // Default true for free tier / offline testing
  
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
  
  // Razorpay
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_test_samplekey123',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || 'sample_secret_key_456',
  
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
