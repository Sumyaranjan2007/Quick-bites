import { Router } from 'express';
import { z } from 'zod';
import { userRepository } from '../db/repositories/userRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';

/**
 * Customer-account features that belong to the person rather than to an order.
 *
 * Favourites lived only in a React `useState` on the discovery screen: the heart
 * filled in, and the choice was gone the moment the screen unmounted, let alone
 * on another device. Anything a customer is invited to curate has to outlive the
 * screen that collected it, so it is kept on the account.
 */
export const customerRouter = Router();

customerRouter.use(authMiddleware());

function favouritesOf(user: any): string[] {
  return Array.isArray(user?.favouriteRestaurantIds) ? user.favouriteRestaurantIds : [];
}

/** GET /api/customers/favourites — the saved restaurants, hydrated for display. */
customerRouter.get('/favourites', async (req, res, next) => {
  try {
    const user = await userRepository.findById(req.user!.id);
    const ids = favouritesOf(user);
    const restaurants = [];
    for (const id of ids) {
      const restaurant = await restaurantRepository.findById(id);
      // A restaurant that has since been removed is dropped from the reply but
      // left on the account: a delisting should not silently edit someone's list.
      if (restaurant) {
        restaurants.push({
          id: restaurant.id,
          name: restaurant.name,
          cuisineTags: restaurant.cuisineTags,
          ratingAverage: restaurant.ratingAverage,
          ratingCount: restaurant.ratingCount,
          bannerUrl: restaurant.bannerUrl,
          isOpen: restaurant.isOpen !== false,
          costForTwo: restaurant.costForTwo,
          highlightTag: restaurant.highlightTag,
          city: restaurant.city
        });
      }
    }
    res.json({
      success: true,
      data: { restaurantIds: ids, restaurants },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

const FavouriteSchema = z.object({ restaurantId: z.string().min(1) });

/**
 * PUT /api/customers/favourites — add one.
 *
 * Idempotent on purpose: a double tap, or a retry after a flaky connection,
 * should leave the list in the state the customer asked for rather than toggling
 * it back off.
 */
customerRouter.put('/favourites', validate({ body: FavouriteSchema }), async (req, res, next) => {
  try {
    const restaurant = await restaurantRepository.findById(req.body.restaurantId);
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const user = await userRepository.findById(req.user!.id);
    const ids = favouritesOf(user);
    if (!ids.includes(restaurant.id)) ids.push(restaurant.id);
    await userRepository.update(req.user!.id, { favouriteRestaurantIds: ids } as any);

    res.json({
      success: true,
      data: { restaurantIds: ids, isFavourite: true },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/customers/favourites/:restaurantId — remove one. */
customerRouter.delete('/favourites/:restaurantId', async (req, res, next) => {
  try {
    const user = await userRepository.findById(req.user!.id);
    const ids = favouritesOf(user).filter(id => id !== req.params.restaurantId);
    await userRepository.update(req.user!.id, { favouriteRestaurantIds: ids } as any);

    res.json({
      success: true,
      data: { restaurantIds: ids, isFavourite: false },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/customers/avatar — set or clear the profile photo.
 *
 * The image itself is carried as a data URI. This platform has no object store,
 * and inventing one for a profile picture would be a larger commitment than the
 * feature deserves; the cap below is what keeps that honest, and is enforced
 * here as well as in the picker so a hand-made request cannot bloat the store.
 */
const MAX_AVATAR_CHARS = 900_000; // ~650 KB of image once base64 is decoded.

const AvatarSchema = z.object({
  avatarUrl: z
    .string()
    .max(MAX_AVATAR_CHARS, 'That photo is too large. Choose a smaller image.')
    .refine(
      value => value === '' || /^data:image\/(png|jpe?g|webp);base64,/i.test(value) || /^https?:\/\//i.test(value),
      { message: 'A profile photo must be a PNG, JPEG or WebP image.' }
    )
});

customerRouter.put('/avatar', validate({ body: AvatarSchema }), async (req, res, next) => {
  try {
    const avatarUrl = String(req.body.avatarUrl || '');
    const updated = await userRepository.update(req.user!.id, {
      avatarUrl: avatarUrl || undefined
    } as any);
    if (!updated) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');

    res.json({
      success: true,
      data: { avatarUrl: updated.avatarUrl || null },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});
