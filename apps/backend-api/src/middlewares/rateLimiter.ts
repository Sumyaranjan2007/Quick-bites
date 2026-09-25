import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();
const CAPACITY = 100; // max requests
const REFILL_RATE = 100 / 60; // 100 req per 60 seconds

// Periodic cleanup of stale rate limiter buckets (idle > 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_SEC = 5 * 60;

const cleanupTimer = setInterval(() => {
  const currentNow = Date.now() / 1000;
  for (const [ip, b] of buckets.entries()) {
    if (currentNow - b.lastRefill > STALE_THRESHOLD_SEC) {
      buckets.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Credential endpoints get their own, much tighter bucket. The global limit of 100
 * requests a minute is fine for browsing but permits roughly 144,000 password guesses
 * a day against a single account, which is a workable online brute force.
 */
const AUTH_CAPACITY = 10;
const AUTH_REFILL_RATE = 10 / 300; // 10 attempts per 5 minutes
const authBuckets = new Map<string, TokenBucket>();

const authCleanupTimer = setInterval(() => {
  const currentNow = Date.now() / 1000;
  for (const [key, b] of authBuckets.entries()) {
    if (currentNow - b.lastRefill > STALE_THRESHOLD_SEC) {
      authBuckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (authCleanupTimer.unref) {
  authCleanupTimer.unref();
}

export function authRateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  // Key on the account being attacked as well as the source, so a botnet spreading
  // guesses across many IPs still runs into the per-account ceiling.
  //
  // Phone counts as an account identifier. Customers sign in with a phone number
  // and a six-digit code and send no email at all, so keying on email alone left
  // the entire customer front door with only a per-IP limit — which is the one
  // limit a distributed attacker does not care about.
  const account =
    typeof req.body?.email === 'string'
      ? req.body.email.toLowerCase()
      : typeof req.body?.phone === 'string'
        ? `phone:${String(req.body.phone).replace(/\D/g, '')}`
        : '';
  const now = Date.now() / 1000;

  for (const key of [`ip:${ip}`, account ? `acct:${account}` : `ip:${ip}`]) {
    let bucket = authBuckets.get(key);
    if (!bucket) {
      bucket = { tokens: AUTH_CAPACITY, lastRefill: now };
      authBuckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      bucket.tokens = Math.min(AUTH_CAPACITY, bucket.tokens + elapsed * AUTH_REFILL_RATE);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      res.setHeader('Retry-After', 300);
      res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many sign-in attempts. Please wait five minutes and try again.'
        },
        meta: {
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId
        }
      });
      return;
    }
    bucket.tokens -= 1;
  }

  next();
}

/**
 * Empties the credential buckets.
 *
 * Exists for the test suites, which sign several accounts in and out within one
 * run and would otherwise trip a limiter that is doing exactly its job. Relaxing
 * the limit for `NODE_ENV=test` was the alternative and is worse: it makes the
 * throttle something that can be switched off by an environment variable, and
 * leaves the tests exercising a configuration production never runs.
 */
export function resetAuthRateLimit(): void {
  authBuckets.clear();
}

/**
 * Empties the general request bucket.
 *
 * The end-to-end suites drive four portals through a whole day of activity in a
 * few seconds, which is well past a limit meant for one person on one phone.
 * Clearing the bucket keeps the limit itself exactly as production runs it.
 */
export function resetRequestRateLimit(): void {
  buckets.clear();
  userBuckets.clear();
  addressBuckets.clear();
  anonBuckets.clear();
}

/*
 * PER USER, NOT PER ADDRESS (N15 / S4).
 *
 * The one bucket was keyed on the IP address. Indian mobile carriers put
 * thousands of phones behind one address (CGNAT), so one busy tower throttled
 * every customer, rider and kitchen on it: at 100 requests a minute shared,
 * a handful of riders streaming their position used up everyone's allowance.
 *
 * Now a signed-in request spends from its OWN bucket (100 a minute per
 * account, as before per phone), and every request also spends from a per-
 * address bucket that is wide enough for a carrier address and still stops
 * one machine flooding the server. Anonymous requests have a per-address bucket
 * of their own. The credential limiter above is unchanged: it keys on the
 * account being tried AND the address, which is right for guessing.
 */
const USER_CAPACITY = CAPACITY;
const USER_REFILL = REFILL_RATE;
const ADDRESS_CAPACITY = 1500; // per minute, per IP, all traffic
const ADDRESS_REFILL = 1500 / 60;
const ANON_CAPACITY = 300; // per minute, per IP, requests with no valid token
const ANON_REFILL = 300 / 60;
const userBuckets = new Map<string, TokenBucket>();
const addressBuckets = new Map<string, TokenBucket>();
const anonBuckets = new Map<string, TokenBucket>();

function spend(map: Map<string, TokenBucket>, key: string, capacity: number, refill: number, now: number): { ok: boolean; left: number } {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    map.set(key, bucket);
  } else {
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.lastRefill) * refill);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) return { ok: false, left: 0 };
  bucket.tokens -= 1;
  return { ok: true, left: Math.floor(bucket.tokens) };
}

/** The account a request is signed in as, or null. A bad token counts as anonymous. */
function signedInAs(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET, { algorithms: ['HS256'] }) as any;
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now() / 1000;
  const user = signedInAs(req);

  const address = spend(addressBuckets, ip, ADDRESS_CAPACITY, ADDRESS_REFILL, now);
  const own = user
    ? spend(userBuckets, user, USER_CAPACITY, USER_REFILL, now)
    : spend(anonBuckets, ip, ANON_CAPACITY, ANON_REFILL, now);

  if (address.ok && own.ok) {
    res.setHeader('X-RateLimit-Limit', user ? USER_CAPACITY : ANON_CAPACITY);
    res.setHeader('X-RateLimit-Remaining', own.left);
    return next();
  }
  res.setHeader('Retry-After', 60);
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry in 60 seconds.'
    },
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId
    }
  });
}
