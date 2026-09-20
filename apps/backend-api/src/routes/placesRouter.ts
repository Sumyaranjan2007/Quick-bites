/**
 * Address lookup for the apps.
 *
 * Behind authentication on purpose. These endpoints cost money per call, and an
 * open one is a free Google Places proxy for anyone who finds the URL — the
 * per-caller ceiling in the service counts a signed-in user, which only means
 * something if there is one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.ts';
import {
  suggestAddresses,
  resolvePlace,
  reverseGeocode,
  isPlacesConfigured
} from '../modules/places/placesService.ts';

export const placesRouter = Router();

/**
 * GET /api/v1/places/status
 *
 * Lets an app decide, once at startup, whether to offer search-as-you-type or
 * go straight to the manual address form. Without it the app would have to
 * discover an unconfigured server by watching an empty result arrive after
 * every keystroke, which looks identical to "no such place".
 */
placesRouter.get('/status', (_req, res) => {
  res.json({ success: true, data: { available: isPlacesConfigured() } });
});

const SuggestQuery = z.object({
  q: z.string().trim().min(1).max(200),
  sessionToken: z.string().trim().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional()
});

placesRouter.get('/suggest', validate({ query: SuggestQuery }), async (req, res, next) => {
  try {
    const { q, sessionToken, lat, lng } = req.query as unknown as z.infer<typeof SuggestQuery>;
    const near = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined;

    const suggestions = await suggestAddresses(q, req.user!.id, { sessionToken, near });
    res.json({ success: true, data: { suggestions, available: isPlacesConfigured() } });
  } catch (err) {
    next(err);
  }
});

const ResolveQuery = z.object({
  placeId: z.string().trim().min(1).max(200),
  sessionToken: z.string().trim().max(80).optional()
});

placesRouter.get('/resolve', validate({ query: ResolveQuery }), async (req, res, next) => {
  try {
    const { placeId, sessionToken } = req.query as unknown as z.infer<typeof ResolveQuery>;
    const place = await resolvePlace(placeId, req.user!.id, sessionToken);
    res.json({ success: true, data: { place } });
  } catch (err) {
    next(err);
  }
});

const ReverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

placesRouter.get('/reverse', validate({ query: ReverseQuery }), async (req, res, next) => {
  try {
    const { lat, lng } = req.query as unknown as z.infer<typeof ReverseQuery>;
    const place = await reverseGeocode(lat, lng, req.user!.id);
    res.json({ success: true, data: { place } });
  } catch (err) {
    next(err);
  }
});
