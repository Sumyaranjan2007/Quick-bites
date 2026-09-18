import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { searchService } from '../modules/search/searchService.ts';
import { syncService } from '../modules/search/syncService.ts';
import { authMiddleware } from '../middlewares/auth.ts';

export const searchRouter = Router();

// GET /api/v1/search
searchRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const isVeg = req.query.isVeg !== undefined ? req.query.isVeg === 'true' : undefined;
    const minRating = req.query.minRating ? parseFloat(req.query.minRating as string) : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const type = (req.query.type as any) || 'all';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const maxDeliveryMinutes = req.query.maxDeliveryMinutes
      ? parseFloat(req.query.maxDeliveryMinutes as string)
      : undefined;
    const minCostForTwo = req.query.minCostForTwo ? parseFloat(req.query.minCostForTwo as string) : undefined;
    const maxCostForTwo = req.query.maxCostForTwo ? parseFloat(req.query.maxCostForTwo as string) : undefined;
    const sort = typeof req.query.sort === 'string' ? (req.query.sort as any) : undefined;

    const result = await searchService.searchCatalog({
      query: q,
      latitude: lat,
      longitude: lng,
      isVeg,
      minRating,
      city,
      type,
      limit,
      offset,
      // NaN would survive every comparison as false and silently empty the
      // results, so an unparseable number is dropped rather than passed on.
      maxDeliveryMinutes: Number.isFinite(maxDeliveryMinutes!) ? maxDeliveryMinutes : undefined,
      minCostForTwo: Number.isFinite(minCostForTwo!) ? minCostForTwo : undefined,
      maxCostForTwo: Number.isFinite(maxCostForTwo!) ? maxCostForTwo : undefined,
      sort
    });

    res.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId,
        source: result.source
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/search/suggestions
searchRouter.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const suggestions = await searchService.getSuggestions(q);

    res.json({
      success: true,
      data: {
        query: q,
        suggestions
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/search/sync — a full catalogue reindex, so staff-only: left open it was
// an unauthenticated way to make the server do expensive work on demand.
searchRouter.post('/sync', authMiddleware('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await syncService.syncCatalog();

    res.json({
      success: true,
      data: report,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: (req as any).correlationId
      }
    });
  } catch (error) {
    next(error);
  }
});
