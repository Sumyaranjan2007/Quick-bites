import { Router } from 'express';
import { z } from 'zod';
import type { Restaurant } from '@quick-bites/shared-types';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { menuRequestRepository } from '../db/repositories/menuRequestRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { settlementRepository } from '../db/repositories/settlementRepository.ts';
import { calculateDistanceKm } from '../db/client.ts';
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
restaurantRouter.get('/:id/orders', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    // Being a partner is not enough — this returns customer names, phone numbers and
    // delivery addresses, so the caller must own *this* restaurant.
    await assertOwnsRestaurant(req, req.params.id);

    const orders = await orderRepository.listByRestaurantId(req.params.id);
    // The doorstep OTP lives on the order record. The kitchen never needs it, and
    // leaking it would let staff close out a delivery that never happened.
    const safeOrders = orders.map(({ deliveryOtp, ...rest }: any) => rest);
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
    await assertOwnsRestaurant(req, req.params.id);
    const { isKitchenActive } = req.body;

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
  imageUrl: z.string().url('Image URL must be a valid link').optional()
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

    const orders = filtered.slice(0, limit).map(({ deliveryOtp, ...rest }: any) => rest);

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
  fileUrl: z.string().min(1, 'A file is required')
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
