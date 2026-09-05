import express from 'express';
import type { Express } from 'express';
import { correlationIdMiddleware } from './middlewares/correlationId.ts';
import { securityHeadersMiddleware } from './middlewares/securityHeaders.ts';
import { corsMiddleware } from './middlewares/cors.ts';
import { rateLimiterMiddleware } from './middlewares/rateLimiter.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { apiRouter } from './routes/apiRouter.ts';
import { getHealth } from './controllers/healthController.ts';

export function createApp(): Express {
  const app = express();

  // 1. Trust Reverse Proxy (Cloudflare / Render)
  app.set('trust proxy', 1);

  // 2. Global Correlation ID
  app.use(correlationIdMiddleware);

  // 3. Security Headers (Helmet)
  app.use(securityHeadersMiddleware);

  // 4. CORS Whitelist
  app.use(corsMiddleware);

  // 5. JSON Body Parser with 1MB ceiling
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 6. Sliding Window Rate Limiter
  app.use(rateLimiterMiddleware);

  // 7. Direct /health probe at root
  app.get('/health', getHealth);

  // 8. API v1 Router
  app.use('/api/v1', apiRouter);

  // 9. 404 Route Handler
  app.use((req, res, next) => {
    const error: any = new Error(`Route ${req.method} ${req.path} not found`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    next(error);
  });

  // 10. Global Error Boundary
  app.use(errorHandler);

  return app;
}
