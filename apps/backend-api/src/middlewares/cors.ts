import cors from 'cors';
import { config } from '../config/env.ts';
import { AppError } from '../utils/AppError.ts';

/** A refused Origin is a 403, not the 500 a plain Error became (K2, 17 Oct 2026). */
const refuse = (message: string) => new AppError(message, 403, 'ORIGIN_NOT_ALLOWED');

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
    return refuse('CORS access blocked for malformed origin');
  }
  // Only our exact hosts (L4, 18 Oct 2026): any `*.vercel.app` / `*.railway.app` used to pass,
  // and anyone can create one of those. Our own pages are the same host as the API.
  if (parsed.protocol === 'https:' && host && parsed.host === host) return null;
  return refuse(`CORS access blocked for origin: ${origin}`);
}

export const corsMiddleware = cors((req: any, callback) => {
  // The emailed confirm page (authRouter /auth/confirm/:token) is a plain HTML
  // form whose only key is the secret link. Some browsers send `Origin: null`
  // for its Confirm button, which this check turned into a 500 (17 Oct 2026).
  const confirmPage = String(req.path || '').includes('/auth/confirm/');
  callback(confirmPage ? null : corsDecision(req.headers.origin, req.headers.host), {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'],
    // So a browser on another origin can read a download's file name (invoice PDFs).
    exposedHeaders: ['Content-Disposition']
  });
});
