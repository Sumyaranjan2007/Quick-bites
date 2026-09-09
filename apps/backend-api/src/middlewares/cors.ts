import cors from 'cors';
import { config } from '../config/env.ts';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (mobile native, curl, postman)
    if (!origin) return callback(null, true);
    
    if (
      config.CORS_WHITELIST.includes(origin) ||
      config.NODE_ENV === 'development' ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.railway.app') ||
      origin.includes('vercel.app')
    ) {
      return callback(null, true);
    }
    
    return callback(new Error(`CORS access blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key']
});
