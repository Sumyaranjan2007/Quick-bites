import type { Request, Response, NextFunction } from 'express';

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
  const account = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
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
}

export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now() / 1000;
  
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefill: now };
    buckets.set(ip, bucket);
  } else {
    // Refill tokens
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_RATE);
    bucket.lastRefill = now;
  }
  
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    res.setHeader('X-RateLimit-Limit', CAPACITY);
    res.setHeader('X-RateLimit-Remaining', Math.floor(bucket.tokens));
    return next();
  } else {
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
}
