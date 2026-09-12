import { Router } from 'express';
import { z } from 'zod';
import type { Restaurant } from '@quick-bites/shared-types';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { calculateDistanceKm } from '../db/client.ts';
import { emitKitchenStatus, emitMenuUpdated } from '../sockets/socketServer.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';

export const restaurantRouter = Router();

// GET /api/restaurants
restaurantRouter.get('/', async (req, res) => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const isPureVeg = req.query.isPureVeg === 'true';

    let list = await restaurantRepository.listActive();

    if (isPureVeg) {
      list = list.filter((r: Restaurant) => r.isPureVeg);
    }

    const annotated = list.map((r: Restaurant) => {
      let distanceKm = 2.5; // default estimate
      let isWithin10km = true;
      if (lat !== undefined && lng !== undefined && r.coordinates) {
        distanceKm = calculateDistanceKm(lat, lng, r.coordinates.latitude, r.coordinates.longitude);
        isWithin10km = distanceKm <= 10.0;
      }
      return {
        ...r,
        distanceKm,
        isWithin10km,
        estimatedDeliveryMinutes: Math.round(15 + distanceKm * 4)
      };
    });

    return res.json({ success: true, data: { restaurants: annotated } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/owner/:ownerId
restaurantRouter.get('/owner/:ownerId', async (req, res) => {
  try {
    const all = await restaurantRepository.listAll();
    const found = all.find((r: Restaurant) => r.ownerId === req.params.ownerId);
    if (!found) {
      return res.status(404).json({ success: false, error: 'No restaurant found for this owner' });
    }
    const menu = await menuRepository.findByRestaurantId(found.id);
    return res.json({ success: true, data: { restaurant: found, menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id
restaurantRouter.get('/:id', async (req, res) => {
  try {
    const restaurant = await restaurantRepository.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    const menu = await menuRepository.findByRestaurantId(restaurant.id);
    return res.json({ success: true, data: { restaurant, menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id/menu
restaurantRouter.get('/:id/menu', async (req, res) => {
  try {
    const menu = await menuRepository.findByRestaurantId(req.params.id);
    if (!menu) {
      return res.status(404).json({ success: false, error: 'Menu not found' });
    }
    return res.json({ success: true, data: { menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id/orders - Incoming restaurant orders
restaurantRouter.get('/:id/orders', authMiddleware('restaurant_owner'), async (req, res) => {
  try {
    const orders = await orderRepository.listByRestaurantId(req.params.id);
    return res.json({ success: true, data: { orders } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * Confirms the signed-in partner actually owns this restaurant.
 *
 * authMiddleware('restaurant_owner') only proves the caller is *a* partner. Without
 * this check any partner could edit a competitor's menu — verified reproducible:
 * a newly registered owner marked another restaurant's flagship dish sold out and
 * customers immediately saw it.
 */
async function assertOwnsRestaurant(req: any, restaurantId: string) {
  const restaurant = await restaurantRepository.findById(restaurantId);
  if (!restaurant) {
    throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
  }
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  if (!isStaff && restaurant.ownerId !== req.user?.id) {
    throw new AppError('You do not manage this restaurant.', 403, 'NOT_RESTAURANT_OWNER');
  }
  return restaurant;
}

const MenuItemSchema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  description: z.string().max(400).optional().default(''),
  price: z.number().positive('price must be greater than zero').max(100000),
  isVeg: z.boolean(),
  isAvailable: z.boolean().optional().default(true),
  imageUrl: z.string().url('imageUrl must be a valid URL').optional(),
  categoryName: z.string().min(1, 'categoryName is required').max(80)
});

// POST /api/restaurants/:id/menu/items — add a dish
restaurantRouter.post(
  '/:id/menu/items',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuItemSchema }),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const { categoryName, ...item } = req.body;
      const created = await menuRepository.addItem(req.params.id, categoryName, item as any);
      if (!created) throw new AppError('Menu not found for this restaurant.', 404, 'MENU_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.status(201).json({ success: true, data: { item: created } });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/restaurants/:id/menu/items/:dishId — edit or reprice a dish
restaurantRouter.put(
  '/:id/menu/items/:dishId',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuItemSchema.partial() }),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const updated = await menuRepository.updateItem(req.params.id, req.params.dishId, req.body);
      if (!updated) throw new AppError('Dish not found on this menu.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.json({ success: true, data: { item: updated } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/restaurants/:id/menu/items/:dishId
restaurantRouter.delete(
  '/:id/menu/items/:dishId',
  authMiddleware('restaurant_owner'),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const removed = await menuRepository.removeItem(req.params.id, req.params.dishId);
      if (!removed) throw new AppError('Dish not found on this menu.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

const ToggleStockSchema = z.object({
  dishId: z.string().min(1, 'dishId is required'),
  isAvailable: z.boolean()
});

// POST /api/restaurants/:id/menu/toggle-stock
restaurantRouter.post('/:id/menu/toggle-stock', authMiddleware('restaurant_owner'), validate({ body: ToggleStockSchema }), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);
    const { dishId, isAvailable } = req.body;
    const menu = await menuRepository.findByRestaurantId(req.params.id);
    if (!menu) {
      return res.status(404).json({ success: false, error: 'Menu not found' });
    }

    let found = false;
    for (const cat of menu.categories) {
      for (const item of cat.items) {
        if (item.id === dishId) {
          item.isAvailable = Boolean(isAvailable);
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      return res.status(404).json({ success: false, error: 'Dish not found in menu' });
    }

    await menuRepository.upsert(menu);
    return res.json({ success: true, message: 'Stock status updated successfully', data: { dishId, isAvailable } });
  } catch (err) {
    next(err);
  }
});

const KitchenStatusSchema = z.object({
  isKitchenActive: z.boolean()
});

// POST /api/restaurants/:id/kitchen-status
restaurantRouter.post('/:id/kitchen-status', authMiddleware('restaurant_owner'), validate({ body: KitchenStatusSchema }), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);
    const { isKitchenActive } = req.body;
    const restaurant = await restaurantRepository.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }

    restaurant.isOpen = Boolean(isKitchenActive);
    emitKitchenStatus(restaurant.id, { isKitchenActive: restaurant.isOpen });

    return res.json({
      success: true,
      message: `Kitchen is now ${restaurant.isOpen ? 'ONLINE' : 'OFFLINE'}`,
      data: { isOpen: restaurant.isOpen }
    });
  } catch (err) {
    next(err);
  }
});

const AddMenuItemSchema = z.object({
  name: z.string().min(1, 'name is required').max(80),
  description: z.string().max(300).optional(),
  price: z.number().positive('price must be greater than zero'),
  isVeg: z.boolean(),
  category: z.string().min(1).max(60).optional(),
  imageUrl: z.string().url().optional()
});

// POST /api/restaurants/:id/menu/items — partner adds a dish to their menu
restaurantRouter.post(
  '/:id/menu/items',
  authMiddleware('restaurant_owner'),
  validate({ body: AddMenuItemSchema }),
  async (req, res, next) => {
    try {
      const { name, description, price, isVeg, category, imageUrl } = req.body;
      const created = await menuRepository.addItem(req.params.id, category || 'Specialities', {
        name,
        description: description || '',
        price,
        isVeg,
        isAvailable: true,
        imageUrl
      });

      if (!created) {
        throw new AppError('Restaurant menu not found.', 404, 'MENU_NOT_FOUND');
      }

      return res.status(201).json({ success: true, data: { item: created } });
    } catch (err) {
      next(err);
    }
  }
);
