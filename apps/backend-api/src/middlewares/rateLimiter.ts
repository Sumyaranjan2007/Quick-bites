import type { Request, Response, NextFunction } from 'express';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();
const CAPACITY = 100; // max requests
const REFILL_RATE = 100 / 60; // 100 req per 60 seconds

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
