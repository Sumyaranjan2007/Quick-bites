import cors from 'cors';
import { config } from '../config/env.ts';

/**
 * Which browser origins may call the API with credentials. Returns null to
 * allow, or the Error that refuses the request.
 *
 * A page served by this server is always allowed, on whatever domain it is
 * reached (11 Oct 2026: the websites moved to www.quickbitesresturants.in and
 * their own sign-in was refused, because only *.railway.app was listed).
 * Matching the Origin's host to the request's Host cannot be used by another
 * site: a browser sets Origin, and a page elsewhere has a different host.
 */
export function corsDecision(origin: string | undefined, host: string | undefined): Error | null {
  // Non-browser clients (the phone apps, curl) send no Origin.
  if (!origin) return null;
  if (config.CORS_WHITELIST.includes(origin)) return null;
  // Outside production, allow anything so local tooling and tunnels work.
  if (!config.IS_PRODUCTION) return null;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return new Error('CORS access blocked for malformed origin');
  }
  if (parsed.protocol === 'https:') {
    if (host && parsed.host === host) return null;
    // Preview deployments, matched on the host only. The previous rule included
    // `origin.includes('vercel.app')`, which also matched hosts an attacker controls,
    // such as https://vercel.app.evil.example — and with credentials enabled that is
    // enough to read authenticated responses from a victim's browser.
    if (parsed.hostname.endsWith('.vercel.app') || parsed.hostname.endsWith('.railway.app')) return null;
  }
  return new Error(`CORS access blocked for origin: ${origin}`);
}

export const corsMiddleware = cors((req: any, callback) => {
  callback(corsDecision(req.headers.origin, req.headers.host), {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'],
    // So a browser on another origin can read a download's file name (invoice PDFs).
    exposedHeaders: ['Content-Disposition']
  });
});
