/**
 * AI dish pictures, Operations only (owner, 20 Oct 2026): one dish, a whole live menu, or a kitchen's
 * pending requests. The work is in modules/menu/dishImages.ts.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { memoryStore } from '../../db/client.ts';
import { pictureForDish, startImageJob, resumeImageJob, type ImageJob } from '../../modules/menu/dishImages.ts';

export const aiImageRoutes = Router();

/** This server's own API address, for the picture links the apps load. */
const apiBase = (req: Request) => `${req.protocol}://${req.get('host')}${req.baseUrl.replace(/\/admin$/, '')}`;

const DishSchema = z.object({
  name: z.string().trim().min(2).max(120),
  isVeg: z.boolean(),
  description: z.string().trim().max(500).optional()
});

/** POST /api/admin/ai-images/dish — one picture for the dish being added or edited (saved one if it exists). */
aiImageRoutes.post('/ai-images/dish', requirePermission('catalog.menus.edit'), validate({ body: DishSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, data: await pictureForDish(req.body, apiBase(req)) });
  } catch (err) {
    next(err);
  }
});

const JobSchema = z.object({ restaurantId: z.string().min(1).max(80), scope: z.enum(['MENU', 'REQUESTS']) });

/** The job as the console shows it: counts, not the dish list. */
const shape = (job: ImageJob) => ({
  id: job.id,
  restaurantId: job.restaurantId,
  scope: job.scope,
  status: job.status,
  pauseReason: job.pauseReason || null,
  total: job.targets.length,
  done: job.targets.filter(t => t.status === 'DONE').length,
  reused: job.targets.filter(t => t.reused).length,
  skipped: job.targets.filter(t => t.status === 'SKIPPED').length,
  failed: job.targets.filter(t => t.status === 'FAILED').map(t => ({ name: t.name, error: t.error })),
  updatedAt: job.updatedAt
});

/** POST /api/admin/ai-images/jobs — pictures for every dish (or pending request) of a kitchen that has none. */
aiImageRoutes.post('/ai-images/jobs', requirePermission('catalog.menus.edit'), validate({ body: JobSchema }), async (req, res, next) => {
  try {
    if (!memoryStore.restaurants.has(req.body.restaurantId)) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    res.json({ success: true, data: { job: shape(startImageJob(req.body.restaurantId, req.body.scope, apiBase(req), req.user!.id)) } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/ai-images/jobs?restaurantId= — the latest job of each scope for a kitchen. */
aiImageRoutes.get('/ai-images/jobs', requirePermission('catalog.menus.view', 'catalog.menus.edit'), async (req, res, next) => {
  try {
    const mine = ([...memoryStore.imageJobs.values()] as ImageJob[])
      .filter(j => j.restaurantId === String(req.query.restaurantId || ''))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = (scope: ImageJob['scope']) => mine.find(j => j.scope === scope);
    res.json({
      success: true,
      data: { menu: latest('MENU') ? shape(latest('MENU')!) : null, requests: latest('REQUESTS') ? shape(latest('REQUESTS')!) : null }
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/ai-images/jobs/:id/resume — carry on after a new key was added. */
aiImageRoutes.post('/ai-images/jobs/:id/resume', requirePermission('catalog.menus.edit'), async (req, res, next) => {
  try {
    const job = resumeImageJob(req.params.id);
    if (!job) throw new AppError('Job not found.', 404, 'JOB_NOT_FOUND');
    res.json({ success: true, data: { job: shape(job) } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/media/dish-images/:id.jpg — a saved picture (public: it is a menu photo). */
export const dishImageMedia = Router();
dishImageMedia.get('/media/dish-images/:file', (req, res) => {
  const picture: any = memoryStore.dishImages.get(String(req.params.file).replace(/\.jpg$/, ''));
  if (!picture?.data) return res.status(404).type('text/plain').send('Not found');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('image/jpeg').send(Buffer.from(picture.data, 'base64'));
});
