import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { searchService } from '../modules/search/searchService.ts';
import { syncService } from '../modules/search/syncService.ts';

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

    const result = await searchService.searchCatalog({
      query: q,
      latitude: lat,
      longitude: lng,
      isVeg,
      minRating,
      city,
      type,
      limit,
      offset
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

// POST /api/v1/search/sync
searchRouter.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
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
