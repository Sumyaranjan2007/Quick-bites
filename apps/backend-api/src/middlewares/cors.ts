import cors from 'cors';
import { config } from '../config/env.ts';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (mobile native, curl, postman)
    if (!origin) return callback(null, true);
    
    if (config.CORS_WHITELIST.includes(origin)) {
      return callback(null, true);
    }

    // Outside production, allow anything so local tooling and tunnels work.
    if (!config.IS_PRODUCTION) {
      return callback(null, true);
    }

    // Preview deployments, matched on the host only. The previous rule included
    // `origin.includes('vercel.app')`, which also matched hosts an attacker controls,
    // such as https://vercel.app.evil.example — and with credentials enabled that is
    // enough to read authenticated responses from a victim's browser.
    try {
      const { protocol, hostname } = new URL(origin);
      if (protocol === 'https:' && (hostname.endsWith('.vercel.app') || hostname.endsWith('.railway.app'))) {
        return callback(null, true);
      }
    } catch {
      return callback(new Error('CORS access blocked for malformed origin'));
    }
    
    return callback(new Error(`CORS access blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key']
});
