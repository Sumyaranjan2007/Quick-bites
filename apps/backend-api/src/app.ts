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

  // 4b. A larger ceiling for the menu-building routes only (1 Oct 2026): a
  // photo of a printed menu page, or a batch of dishes with their photos, is
  // more than 1 MB. Parsed here, so the 1 MB parser below sees a body that is
  // already read and leaves it alone. Every other route keeps the 1 MB limit.
  const MENU_BUILD_PATHS = [
    /^\/api(\/v1)?\/restaurants\/[^/]+\/menu\/(ai-read|requests\/bulk)$/,
    /^\/api(\/v1)?\/admin\/menus\/[^/]+\/(ai-read|bulk)$/
  ];
  const largeJson = express.json({ limit: '8mb' });
  app.use((req, res, next) =>
    req.method === 'POST' && MENU_BUILD_PATHS.some(re => re.test(req.path)) ? largeJson(req, res, next) : next()
  );

  // 5. JSON Body Parser with 1MB ceiling
  // The raw bytes are kept alongside the parsed body because Razorpay signs
  // exactly what it sent: re-serialising a parsed object reorders keys and
  // drops whitespace, so its digest would never match and every webhook would
  // be rejected as a forgery.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      }
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 6. Sliding Window Rate Limiter
  app.use(rateLimiterMiddleware);

  // 7. Direct /health probe at root
  app.get('/health', getHealth);

  // Root welcome & status endpoint
  app.get('/', (req, res) => {
    res.json({
      success: true,
      name: 'Quick Bites Platform API',
      version: '2.0.0',
      status: 'ONLINE',
      endpoints: {
        health: '/health',
        restaurants: '/api/v1/restaurants',
        search: '/api/v1/search',
        auth: '/api/v1/auth',
        orders: '/api/v1/orders'
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  });

  // 8. API Router (Universal support for /api/v1 and /api)
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

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
