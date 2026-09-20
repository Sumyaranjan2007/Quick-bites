import { Router } from 'express';
import { z } from 'zod';
import type { Restaurant } from '@quick-bites/shared-types';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { menuRequestRepository } from '../db/repositories/menuRequestRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { settlementRepository } from '../db/repositories/settlementRepository.ts';
import { calculateDistanceKm } from '../db/client.ts';
import { config } from '../config/env.ts';
import { estimateByRoad } from '../modules/places/routingService.ts';
import { hasRealLocation } from '../modules/restaurants/restaurantLocation.ts';
import { emitKitchenStatus, emitMenuUpdated, emitMenuRequestSubmitted } from '../sockets/socketServer.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { buildRestaurantDashboard } from '../modules/restaurants/restaurantInsights.ts';
import {
  buildDocumentOverview,
  RESTAURANT_DOCUMENT_TYPES,
  ACCEPTED_FORMATS,
  MAX_UPLOAD_MB
} from '../modules/restaurants/restaurantDocuments.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { shapeOrderForViewer } from '../modules/orders/contactVisibility.ts';

export const restaurantRouter = Router();

/**
 * GET /api/restaurants — the discovery feed, filtered and sorted.
 *
 * Every filter is applied here rather than in the app. The feed can run to
 * hundreds of kitchens, and filtering client-side means shipping all of them to
 * a phone on mobile data to throw most away — and it means three apps
 * re-implementing the same rules and disagreeing about them.
 *
 * Filters are ANDed. An unrecognised or unparseable value is ignored rather
 * than erroring: a discovery feed that returns 400 because a stale app sent
 * `minRating=good` shows a customer an empty home screen, which is a worse
 * failure than quietly showing them everything.
 */
const SORTS = ['relevance', 'rating', 'deliveryTime', 'costLowToHigh', 'costHighToLow', 'distance'] as const;
type FeedSort = (typeof SORTS)[number];

function numberParam(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

restaurantRouter.get('/', async (req, res) => {
  try {
    const lat = numberParam(req.query.lat);
    const lng = numberParam(req.query.lng);
    const isPureVeg = req.query.isPureVeg === 'true';
    const openNow = req.query.openNow === 'true';
    const minRating = numberParam(req.query.minRating);
    const maxDeliveryMinutes = numberParam(req.query.maxDeliveryMinutes);
    const maxCostForTwo = numberParam(req.query.maxCostForTwo);
    const minCostForTwo = numberParam(req.query.minCostForTwo);
    const cuisine = typeof req.query.cuisine === 'string' ? req.query.cuisine.trim().toLowerCase() : '';
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const sort: FeedSort = SORTS.includes(req.query.sort as FeedSort)
      ? (req.query.sort as FeedSort)
      : 'relevance';

    const list = await restaurantRepository.listActive();

    // Distance and delivery time exist only when the customer has told us where
    // they are. They used to be manufactured when they had not: `distanceKm`
    // defaulted to 2.5, which fed `15 + distanceKm * 4` and made EVERY
    // restaurant on the home screen read "25 mins" — the fixed delivery time
    // that looked like a hardcoded constant and was in fact a hardcoded input.
    //
    // Undefined is now the honest answer, and the app shows "Set your location"
    // rather than a number nobody computed.
    const origin = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : null;

    let annotated = list.map((r: Restaurant) => {
      // A restaurant whose position was never set is not measured and not
      // excluded. Judging it by distance would place every pre-map restaurant
      // in Cubbon Park and empty the home screen for the people it actually
      // delivers to — see modules/restaurants/restaurantLocation.ts.
      if (!origin || !hasRealLocation(r)) {
        return {
          ...r,
          distanceKm: undefined,
          isWithinServiceArea: true,
          locationPending: !hasRealLocation(r),
          estimatedDeliveryMinutes: undefined
        };
      }

      // Whether this kitchen delivers here is a question about a circle on a
      // map, so it is asked of the straight line. What the customer is TOLD is
      // the road estimate, because that is the journey their food makes.
      const straightLine = calculateDistanceKm(
        lat!,
        lng!,
        r.coordinates.latitude,
        r.coordinates.longitude
      );
      const road = estimateByRoad(origin, r.coordinates);
      const serviceRadius = Number(r.serviceRadiusKm) || config.DEFAULT_SERVICE_RADIUS_KM;

      return {
        ...r,
        distanceKm: road.distanceKm,
        // Each restaurant against its own delivery area, not one platform-wide
        // 10 km circle: a kitchen with one rider covers two kilometres and a
        // chain covers eight, and pretending otherwise promised deliveries that
        // would be declined.
        isWithinServiceArea: straightLine <= serviceRadius,
        locationPending: false,
        // Prep plus travel at the configured speed, both settable without a
        // release, instead of a slope invented in this line.
        estimatedDeliveryMinutes: Math.round(
          config.DEFAULT_PREP_MINUTES + (road.distanceKm / config.DELIVERY_SPEED_KMPH) * 60
        )
      };
    });

    // Out-of-area kitchens are dropped once we know where the customer is.
    // Keeping them was the old behaviour and it showed people restaurants that
    // could not deliver to them.
    if (origin) annotated = annotated.filter(r => r.isWithinServiceArea);

    if (isPureVeg) annotated = annotated.filter(r => r.isPureVeg);
    // `isOpen !== false` rather than `isOpen === true`, so a kitchen recorded
    // before the flag existed is treated as open rather than hidden.
    if (openNow) annotated = annotated.filter(r => r.isOpen !== false);
    if (minRating !== undefined) {
      annotated = annotated.filter(r => (Number(r.ratingAverage) || 0) >= minRating);
    }
    if (maxDeliveryMinutes !== undefined) {
      // `undefined <= 30` is false, so an unknown delivery time would quietly
      // empty the list for anyone who has not set a location. A kitchen whose
      // time we cannot compute is kept rather than judged.
      annotated = annotated.filter(
        r => r.estimatedDeliveryMinutes === undefined || r.estimatedDeliveryMinutes <= maxDeliveryMinutes
      );
    }
    // A kitchen that has not published a cost for two is kept in every price
    // band. Dropping it would hide a real restaurant because of a missing field.
    if (minCostForTwo !== undefined) {
      annotated = annotated.filter(r => r.costForTwo === undefined || Number(r.costForTwo) >= minCostForTwo);
    }
    if (maxCostForTwo !== undefined) {
      annotated = annotated.filter(r => r.costForTwo === undefined || Number(r.costForTwo) <= maxCostForTwo);
    }
    if (cuisine) {
      annotated = annotated.filter(r =>
        (r.cuisineTags || []).some((c: string) => c.toLowerCase() === cuisine)
      );
    }
    if (query) {
      annotated = annotated.filter(
        r =>
          r.name.toLowerCase().includes(query) ||
          (r.cuisineTags || []).some((c: string) => c.toLowerCase().includes(query))
      );
    }

    const byRating = (a: any, b: any) => (Number(b.ratingAverage) || 0) - (Number(a.ratingAverage) || 0);

    /**
     * Sorts unknown values last rather than first.
     *
     * Distance and delivery time are undefined for a customer who has not set a
     * location. Subtracting undefined gives NaN, and a comparator returning NaN
     * leaves the array in whatever order the engine happened to be in — so the
     * bug is not "wrong order" but "different order every time", which is the
     * kind of thing that never reproduces when someone goes looking for it.
     */
    const last = (n: number | undefined) => n ?? Number.MAX_SAFE_INTEGER;

    switch (sort) {
      case 'rating':
        annotated.sort(byRating);
        break;
      case 'deliveryTime':
        annotated.sort((a, b) => last(a.estimatedDeliveryMinutes) - last(b.estimatedDeliveryMinutes));
        break;
      case 'distance':
        // Unmeasured restaurants sort last rather than to the front, which is
        // where `undefined - undefined` (NaN) would have left them.
        annotated.sort((a, b) => last(a.distanceKm) - last(b.distanceKm));
        break;
      case 'costLowToHigh':
        annotated.sort((a, b) => (Number(a.costForTwo) || 0) - (Number(b.costForTwo) || 0));
        break;
      case 'costHighToLow':
        annotated.sort((a, b) => (Number(b.costForTwo) || 0) - (Number(a.costForTwo) || 0));
        break;
      default:
        // Relevance: an open kitchen first — a closed one cannot be ordered
        // from, so however good it is it is not the most relevant thing on the
        // screen — then nearest, then best rated.
        annotated.sort(
          (a, b) =>
            Number(b.isOpen !== false) - Number(a.isOpen !== false) ||
            last(a.distanceKm) - last(b.distanceKm) ||
            byRating(a, b)
        );
    }

    return res.json({
      success: true,
      data: {
        restaurants: annotated,
        // Echoed back so the app can show which filters produced this result,
        // and so a filter the server ignored is visibly absent rather than
        // appearing to have been applied.
        appliedFilters: {
          isPureVeg,
          openNow,
          minRating,
          maxDeliveryMinutes,
          minCostForTwo,
          maxCostForTwo,
          cuisine: cuisine || undefined,
          q: query || undefined,
          sort
        },
        total: annotated.length
      }
    });
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
restaurantRouter.get('/:id/orders', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    // Being a partner is not enough — this returns customer names, phone numbers and
    // delivery addresses, so the caller must own *this* restaurant.
    await assertOwnsRestaurant(req, req.params.id);

    const orders = await orderRepository.listByRestaurantId(req.params.id);
    // Shaped rather than having one field deleted. The doorstep OTP is only the
    // most obvious thing the kitchen must not have; the same shaping also stops
    // a delivered order leaving the customer's phone number on a kitchen tablet
    // indefinitely, which deleting one field did not.
    const safeOrders = orders.map((order: any) => shapeOrderForViewer(order, 'restaurant'));
    return res.json({ success: true, data: { orders: safeOrders } });
  } catch (err) {
    next(err);
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

    // Adding or editing a dish already announced itself; running out did not, so
    // a customer could keep adding something the kitchen had just pulled.
    emitMenuUpdated(req.params.id);

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
    const owned = await assertOwnsRestaurant(req, req.params.id);
    const { isKitchenActive } = req.body;

    /*
     * Going online is gated on approval; going offline never is.
     *
     * The delivery app has had this check since it was written — a rider whose
     * KYC is not ACTIVE is refused at `POST /riders/shift`. The partner app had
     * nothing equivalent, so a restaurant that registered thirty seconds ago,
     * with no documents submitted and nobody having looked at it, could press
     * Online and be told "Kitchen is now ONLINE".
     *
     * It was not, in the way that mattered: the customer feed reads
     * `listActive()` and order creation refuses a non-ACTIVE restaurant, so no
     * customer ever saw it and no order could reach it. What the partner saw
     * was a green toggle and a promise, and they waited for orders that could
     * not arrive. A control that lies in the safe direction is still a control
     * that lies.
     *
     * Refused here rather than hidden in the app, because hiding a button is a
     * courtesy and this is the switch that decides whether a kitchen is open.
     */
    if (isKitchenActive && owned.status !== 'ACTIVE') {
      throw new AppError(
        owned.status === 'SUSPENDED'
          ? 'Your restaurant is suspended, so it cannot go online. Contact Quick Bites support.'
          : owned.status === 'CLOSED'
            ? 'This restaurant is closed on the platform and cannot go online.'
            : 'Your restaurant is still being verified. You can go online once our team approves your documents.',
        409,
        owned.status === 'PENDING_APPROVAL' ? 'RESTAURANT_NOT_APPROVED' : 'RESTAURANT_NOT_ACTIVE'
      );
    }

    // Goes through the repository so the change is persisted. Assigning isOpen on
    // the object skipped triggerAutoSave, so the kitchen reverted to its previous
    // state on the next restart and the partner saw "Online" after going offline.
    const restaurant = await restaurantRepository.setOpenState(req.params.id, Boolean(isKitchenActive));
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }

    emitKitchenStatus(restaurant.id, { isKitchenActive: restaurant.isOpen });

    return res.json({
      success: true,
      message: `Kitchen is now ${restaurant.isOpen ? 'ONLINE' : 'OFFLINE'}`,
      data: { isOpen: restaurant.isOpen, changedAt: restaurant.kitchenStatusChangedAt }
    });
  } catch (err) {
    next(err);
  }
});

// NOTE: a second POST /:id/menu/items used to be declared here. Express matches the
// first registration, so it never ran — but it omitted the assertOwnsRestaurant check,
// and would have silently reopened the cross-restaurant write hole if the routes were
// ever reordered. The guarded definition above is the only one.

// ---------------------------------------------------------------------------
// Menu change requests
//
// A partner asks for a dish to be added or changed; an administrator approves it
// before it reaches a customer. Nothing here writes to the live menu — approval,
// in adminRouter, is the only path that does.
// ---------------------------------------------------------------------------

const MenuRequestSchema = z.object({
  kind: z.enum(['ADD_ITEM', 'EDIT_ITEM']).optional().default('ADD_ITEM'),
  dishId: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'Dish name is required').max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().positive('Price must be greater than zero').max(100000),
  isVeg: z.boolean(),
  categoryName: z.string().trim().min(1, 'Category is required').max(80),
  /**
   * A link, or a data URI from the partner app's own camera.
   *
   * Capped at the same 200,000 characters the admin catalogue routes use. They
   * disagreed before: a partner could submit a photo larger than an
   * administrator could ever edit, so the first attempt to correct that dish
   * would fail validation on a field nobody had touched.
   */
  imageUrl: z.string().trim().max(200000).optional()
});

// POST /api/restaurants/:id/menu/requests — partner submits a menu change for review
restaurantRouter.post(
  '/:id/menu/requests',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuRequestSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const { kind, dishId, ...payload } = req.body;

      if (kind === 'EDIT_ITEM' && !dishId) {
        throw new AppError('An edit request must name the dish it changes.', 400, 'DISH_ID_REQUIRED');
      }

      const request = await menuRequestRepository.create({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        requestedByUserId: req.user!.id,
        kind,
        dishId,
        payload
      });

      emitMenuRequestSubmitted(request);
      res.status(201).json({
        success: true,
        data: { request },
        message: 'Sent for review. You will see the dish on your menu once it is approved.'
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/restaurants/:id/menu/requests — the partner's own request history
restaurantRouter.get('/:id/menu/requests', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);
    const requests = await menuRequestRepository.listByRestaurant(req.params.id);
    res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Partner dashboard and order history
// ---------------------------------------------------------------------------

/**
 * GET /api/restaurants/:id/dashboard — the numbers behind the partner's home screen.
 *
 * Computed from the restaurant's own orders on every request rather than kept as a
 * running total, so a refund or a cancellation is reflected immediately and there
 * is no second copy of the figures to drift.
 */
restaurantRouter.get('/:id/dashboard', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const [orders, menu] = await Promise.all([
      orderRepository.listByRestaurantId(req.params.id),
      menuRepository.findByRestaurantId(req.params.id)
    ]);

    const dashboard = buildRestaurantDashboard(orders, menu);
    res.json({
      success: true,
      data: {
        dashboard,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          isOpen: restaurant.isOpen,
          status: restaurant.status,
          kycStatus: restaurant.kycStatus,
          ratingAverage: restaurant.ratingAverage,
          ratingCount: restaurant.ratingCount
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/restaurants/:id/orders/history — past orders, newest first.
 *
 * Separate from /orders, which is the live queue: the kitchen screen wants what is
 * cooking now, and this wants what already happened. `scope` selects completed,
 * cancelled or everything; the OTP is stripped here as it is on the live queue.
 */
restaurantRouter.get('/:id/orders/history', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);

    const scope = String(req.query.scope || 'all').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 100, 200);

    const all = await orderRepository.listByRestaurantId(req.params.id);
    const terminal = all.filter(o =>
      ['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)
    );

    const filtered =
      scope === 'completed'
        ? terminal.filter(o => o.status === 'DELIVERED')
        : scope === 'cancelled'
          ? terminal.filter(o => o.status === 'CANCELLED' || o.status === 'REFUNDED')
          : terminal;

    const orders = filtered.slice(0, limit).map((order: any) => shapeOrderForViewer(order, 'restaurant'));

    res.json({
      success: true,
      data: {
        orders,
        counts: {
          all: terminal.length,
          completed: terminal.filter(o => o.status === 'DELIVERED').length,
          cancelled: terminal.filter(o => o.status === 'CANCELLED' || o.status === 'REFUNDED').length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Document verification
// ---------------------------------------------------------------------------

/**
 * GET /api/restaurants/:id/documents — what is required, and where each one stands.
 *
 * Returns the catalogue merged with the restaurant's submissions, so the partner
 * app can render one list showing what is needed, why, the accepted formats and
 * the current status, instead of an opaque panel that never explained itself.
 */
restaurantRouter.get('/:id/documents', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const documents = await kycRepository.findByEntity('RESTAURANT', restaurant.id);
    const overview = buildDocumentOverview(documents);

    res.json({
      success: true,
      data: {
        ...overview,
        kycStatus: restaurant.kycStatus,
        acceptedFormats: ACCEPTED_FORMATS,
        maxSizeMb: MAX_UPLOAD_MB
      }
    });
  } catch (err) {
    next(err);
  }
});

const UploadDocumentSchema = z.object({
  documentType: z.enum(RESTAURANT_DOCUMENT_TYPES),
  documentNumber: z.string().trim().min(1, 'Enter the number printed on the document').max(40),
  /*
   * A photograph, not a sentence.
   *
   * This field used to accept any non-empty string, and the partner app sent
   * one: it had no picker at all, so it asked the partner to email the document
   * to support and type a note here describing where to find it. What reached
   * the reviewer was "emailed on 14 Sep" — a KYC queue full of prose that had
   * to be cross-referenced against an inbox by hand.
   *
   * Bounded and typed exactly as the rider route's equivalent. The ceiling is
   * the one the image helper in the app resizes to stay under, so an oversized
   * photo fails on the device with something the partner can act on rather than
   * being cut off by the 1 MB body limit.
   */
  fileUrl: z
    .string()
    .max(700_000, 'That photo is too large. Take a new one from inside the app.')
    .refine(
      v => v.startsWith('data:image/') || /^https?:\/\//.test(v),
      'Attach a photo of the document.'
    )
});

/**
 * POST /api/restaurants/:id/documents — upload, or re-upload after a rejection.
 *
 * A new submission for a type supersedes the previous one rather than editing it,
 * so the review history is preserved: an administrator can see that a document was
 * rejected once and what was sent the second time.
 */
restaurantRouter.post(
  '/:id/documents',
  authMiddleware('restaurant_owner'),
  validate({ body: UploadDocumentSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const { documentType, documentNumber, fileUrl } = req.body;

      const existing = await kycRepository.findByEntity('RESTAURANT', restaurant.id);
      const current = existing
        .filter(d => d.documentType === documentType)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

      // Re-uploading over something already approved would quietly un-verify a
      // trading restaurant, so it is refused rather than silently accepted.
      if (current?.status === 'APPROVED') {
        throw new AppError(
          `Your ${documentType} is already verified. Contact support if it needs to change.`,
          409,
          'DOCUMENT_ALREADY_APPROVED'
        );
      }
      if (current?.status === 'PENDING') {
        throw new AppError(
          `Your ${documentType} is already with our team for review.`,
          409,
          'DOCUMENT_UNDER_REVIEW'
        );
      }

      const doc = await kycRepository.submitDocument({
        entityType: 'RESTAURANT',
        entityId: restaurant.id,
        entityName: restaurant.name,
        entityCity: restaurant.city,
        entityAddress: restaurant.addressLine,
        entityPhone: restaurant.phone,
        documentType,
        documentNumber,
        fileUrl
      });

      if (restaurant.kycStatus !== 'ACTIVE') {
        await restaurantRepository.updateKycStatus(restaurant.id, 'PENDING_APPROVAL');
      }

      res.status(201).json({
        success: true,
        data: { document: doc },
        message: 'Uploaded. Our team reviews documents within one working day.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/restaurants/:id/settlements — what the platform owes this kitchen.
 *
 * The partner app could show takings but never what had been paid across, so a
 * restaurant had no way to reconcile the money it was owed against the money it
 * had received. Reads the same settlement records the admin console writes.
 */
restaurantRouter.get('/:id/settlements', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const delivered = (await orderRepository.listByRestaurantId(restaurant.id)).filter(
      o => o.status === 'DELIVERED'
    );
    const unsettled = delivered.filter(o => !o.settlementId);

    const COMMISSION_RATE = 0.15;
    const lineOf = (order: any) => {
      const grossSales = Number(order.bill?.itemsTotal) || 0;
      const commission = Math.round(grossSales * COMMISSION_RATE * 100) / 100;
      const tds = Math.round(commission * 0.01 * 100) / 100;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        deliveredAt: order.deliveredAt || order.updatedAt,
        grossSales,
        commission,
        tds,
        net: Math.round((grossSales - commission - tds) * 100) / 100
      };
    };

    const lines = unsettled.map(lineOf);
    const history = await settlementRepository.list({ restaurantId: restaurant.id });

    res.json({
      success: true,
      data: {
        summary: {
          ordersAllTime: delivered.length,
          ordersAwaitingSettlement: lines.length,
          grossPending: Math.round(lines.reduce((t, l) => t + l.grossSales, 0) * 100) / 100,
          commissionPending: Math.round(lines.reduce((t, l) => t + l.commission, 0) * 100) / 100,
          tdsPending: Math.round(lines.reduce((t, l) => t + l.tds, 0) * 100) / 100,
          netPending: Math.round(lines.reduce((t, l) => t + l.net, 0) * 100) / 100,
          paidToDate: await settlementRepository.paidTotal(restaurant.id),
          lastSettledAt: history.find(s => s.status === 'PAID')?.paidAt || null
        },
        pendingOrders: lines,
        history
      }
    });
  } catch (err) {
    next(err);
  }
});
