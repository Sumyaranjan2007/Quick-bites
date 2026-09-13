/**
 * The catalogue: every partner's menu, the queue of changes they have asked for,
 * and the platform-wide categories that organise it.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { menuRequestRepository } from '../../db/repositories/menuRequestRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { categoryRepository } from '../../db/repositories/categoryRepository.ts';
import { emitMenuUpdated, emitMenuRequestReviewed } from '../../sockets/socketServer.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { memoryStore } from '../../db/client.ts';
import { matchesQuery } from './shared.ts';

export const catalogRoutes = Router();

/* ---------------------------------- Menus --------------------------------- */

/** GET /api/admin/menus — one row per partner, with catalogue counts. */
catalogRoutes.get('/menus', requirePermission('catalog.menus.view'), async (req, res, next) => {
  try {
    const { q } = req.query as Record<string, string>;
    const restaurants = await restaurantRepository.listAll();

    let rows = restaurants.map(restaurant => {
      const menu = memoryStore.menus.get(restaurant.id);
      const categories = menu?.categories || [];
      const items = categories.flatMap((c: any) => c.items || []);
      return {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        status: restaurant.status,
        isOpen: restaurant.isOpen,
        city: restaurant.city,
        categoryCount: categories.length,
        itemCount: items.length,
        outOfStock: items.filter((i: any) => !i.isAvailable).length,
        pendingRequests: Array.from(memoryStore.menuRequests.values()).filter(
          (r: any) => r.restaurantId === restaurant.id && r.status === 'PENDING'
        ).length
      };
    });

    if (q) rows = rows.filter(r => matchesQuery(q, r.restaurantName, r.city, r.restaurantId));
    rows.sort((a, b) => b.pendingRequests - a.pendingRequests || a.restaurantName.localeCompare(b.restaurantName));

    res.json({ success: true, data: { menus: rows } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/menus/:restaurantId — one partner's full catalogue. */
catalogRoutes.get('/menus/:restaurantId', requirePermission('catalog.menus.view'), async (req, res, next) => {
  try {
    const restaurant = await restaurantRepository.findById(req.params.restaurantId);
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    res.json({
      success: true,
      data: {
        restaurant: { id: restaurant.id, name: restaurant.name, status: restaurant.status, isOpen: restaurant.isOpen },
        menu: (await menuRepository.findByRestaurantId(restaurant.id)) || { restaurantId: restaurant.id, categories: [] },
        requests: await menuRequestRepository.listByRestaurant(restaurant.id)
      }
    });
  } catch (err) {
    next(err);
  }
});

const MenuItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().positive().max(100000),
  isVeg: z.boolean(),
  categoryName: z.string().trim().min(1).max(80),
  imageUrl: z.string().trim().max(200000).optional(),
  isAvailable: z.boolean().optional()
});

/** POST /api/admin/menus/:restaurantId/items — add a dish directly. */
catalogRoutes.post(
  '/menus/:restaurantId/items',
  requirePermission('catalog.menus.edit'),
  validate({ body: MenuItemSchema }),
  async (req, res, next) => {
    try {
      const { categoryName, ...item } = req.body;
      const created = await menuRepository.addItem(req.params.restaurantId, categoryName, {
        ...item,
        description: item.description || '',
        isAvailable: item.isAvailable ?? true
      } as any);
      if (!created) throw new AppError('That restaurant has no menu to add to.', 404, 'MENU_NOT_FOUND');

      emitMenuUpdated(req.params.restaurantId);
      recordAudit(req, {
        action: 'MENU_ITEM_CREATED',
        entityType: 'MENU_ITEM',
        entityId: created.id,
        summary: `Added "${created.name}" (Rs ${created.price}) to ${req.params.restaurantId}`,
        after: created
      });

      res.status(201).json({ success: true, data: { item: created } });
    } catch (err) {
      next(err);
    }
  }
);

const MenuItemPatchSchema = MenuItemSchema.partial();

/** PATCH /api/admin/menus/:restaurantId/items/:dishId — correct a live dish. */
catalogRoutes.patch(
  '/menus/:restaurantId/items/:dishId',
  requirePermission('catalog.menus.edit'),
  validate({ body: MenuItemPatchSchema }),
  async (req, res, next) => {
    try {
      const updated = await menuRepository.updateItem(req.params.restaurantId, req.params.dishId, req.body);
      if (!updated) throw new AppError('That dish no longer exists.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.restaurantId);
      recordAudit(req, {
        action: 'MENU_ITEM_UPDATED',
        entityType: 'MENU_ITEM',
        entityId: req.params.dishId,
        summary: `Edited "${updated.name}" on ${req.params.restaurantId}`,
        after: req.body
      });

      res.json({ success: true, data: { item: updated } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/admin/menus/:restaurantId/items/:dishId
 *
 * `?soft=true` marks the dish unavailable instead of removing it. Deleting a
 * dish that appears on past orders would leave those orders referencing nothing;
 * taking it off sale is usually what is actually wanted.
 */
catalogRoutes.delete(
  '/menus/:restaurantId/items/:dishId',
  requirePermission('catalog.menus.edit'),
  async (req, res, next) => {
    try {
      const soft = String(req.query.soft || '') === 'true';
      const done = soft
        ? await menuRepository.updateItemStock(req.params.restaurantId, req.params.dishId, false)
        : await menuRepository.removeItem(req.params.restaurantId, req.params.dishId);
      if (!done) throw new AppError('That dish no longer exists.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.restaurantId);
      recordAudit(req, {
        action: soft ? 'MENU_ITEM_DISABLED' : 'MENU_ITEM_DELETED',
        entityType: 'MENU_ITEM',
        entityId: req.params.dishId,
        summary: `${soft ? 'Took off sale' : 'Deleted'} dish ${req.params.dishId} on ${req.params.restaurantId}`
      });

      res.json({ success: true, data: { deleted: !soft, disabled: soft } });
    } catch (err) {
      next(err);
    }
  }
);

const StockSchema = z.object({ isAvailable: z.boolean() });

/** POST /api/admin/menus/:restaurantId/items/:dishId/stock — in or out of stock. */
catalogRoutes.post(
  '/menus/:restaurantId/items/:dishId/stock',
  requirePermission('catalog.menus.edit'),
  validate({ body: StockSchema }),
  async (req, res, next) => {
    try {
      const done = await menuRepository.updateItemStock(
        req.params.restaurantId,
        req.params.dishId,
        req.body.isAvailable
      );
      if (!done) throw new AppError('That dish no longer exists.', 404, 'DISH_NOT_FOUND');
      emitMenuUpdated(req.params.restaurantId);
      res.json({ success: true, data: { dishId: req.params.dishId, isAvailable: req.body.isAvailable } });
    } catch (err) {
      next(err);
    }
  }
);

/* ----------------------------- Menu requests ------------------------------ */

/** GET /api/admin/menu-requests?status=PENDING — partner change requests. */
catalogRoutes.get('/menu-requests', requirePermission('catalog.menus.view', 'catalog.menus.review'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const requests =
      status === 'ALL'
        ? await menuRequestRepository.listAll()
        : await menuRequestRepository.listByStatus(status as any);
    res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
});

const ReviewMenuRequestSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().trim().max(400).optional(),
  /** An administrator may correct the partner's values before approving. */
  overrides: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(400).optional(),
      price: z.number().positive().max(100000).optional(),
      isVeg: z.boolean().optional(),
      categoryName: z.string().trim().min(1).max(80).optional(),
      imageUrl: z.string().trim().max(200000).optional()
    })
    .optional()
});

/**
 * POST /api/admin/menu-requests/:id/review
 *
 * The only path that writes a partner's requested dish onto a live menu. A
 * partner can ask; an administrator decides.
 */
catalogRoutes.post(
  '/menu-requests/:id/review',
  requirePermission('catalog.menus.review'),
  validate({ body: ReviewMenuRequestSchema }),
  async (req, res, next) => {
    try {
      const { action, rejectionReason, overrides } = req.body;
      const request = await menuRequestRepository.findById(req.params.id);
      if (!request) throw new AppError('Menu request not found.', 404, 'MENU_REQUEST_NOT_FOUND');
      if (request.status !== 'PENDING') {
        throw new AppError(
          `This request was already ${request.status.toLowerCase()}.`,
          409,
          'MENU_REQUEST_ALREADY_REVIEWED'
        );
      }

      if (action === 'REJECT') {
        if (!rejectionReason) {
          throw new AppError(
            'Tell the partner why it was rejected, so they can correct and resubmit.',
            400,
            'REJECTION_REASON_REQUIRED'
          );
        }
        const reviewed = await menuRequestRepository.review(request.id, 'REJECTED', req.user!.id, {
          rejectionReason
        });
        emitMenuRequestReviewed({ id: request.id, restaurantId: request.restaurantId, status: 'REJECTED' });
        recordAudit(req, {
          action: 'MENU_REQUEST_REJECTED',
          entityType: 'MENU_REQUEST',
          entityId: request.id,
          summary: `Rejected "${request.payload.name}" for ${request.restaurantName || request.restaurantId} — ${rejectionReason}`
        });
        return res.json({ success: true, data: { request: reviewed } });
      }

      // Approval writes the dish. Values the administrator corrected win over what
      // the partner asked for, so a mispriced submission can be fixed in review
      // rather than bounced back.
      const final = { ...request.payload, ...(overrides || {}) };
      const { categoryName, ...item } = final;

      let dish;
      if (request.kind === 'EDIT_ITEM' && request.dishId) {
        dish = await menuRepository.updateItem(request.restaurantId, request.dishId, { ...item, categoryName });
        if (!dish) throw new AppError('The dish this request edits no longer exists.', 404, 'DISH_NOT_FOUND');
      } else {
        dish = await menuRepository.addItem(request.restaurantId, categoryName, {
          ...item,
          description: item.description || '',
          isAvailable: true
        } as any);
        if (!dish) throw new AppError('That restaurant has no menu to add to.', 404, 'MENU_NOT_FOUND');
      }

      const reviewed = await menuRequestRepository.review(request.id, 'APPROVED', req.user!.id, {
        resultingDishId: dish.id
      });

      emitMenuUpdated(request.restaurantId);
      emitMenuRequestReviewed({ id: request.id, restaurantId: request.restaurantId, status: 'APPROVED' });
      recordAudit(req, {
        action: 'MENU_REQUEST_APPROVED',
        entityType: 'MENU_REQUEST',
        entityId: request.id,
        summary: `Approved "${dish.name}" (Rs ${dish.price}) for ${request.restaurantName || request.restaurantId}`,
        after: dish
      });

      res.json({ success: true, data: { request: reviewed, item: dish } });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------- Categories ------------------------------ */

/** GET /api/admin/categories — platform categories with usage counts. */
catalogRoutes.get('/categories', requirePermission('catalog.categories.manage', 'catalog.menus.view'), async (_req, res, next) => {
  try {
    res.json({
      success: true,
      data: { categories: await categoryRepository.list(), usage: await categoryRepository.usageCounts() }
    });
  } catch (err) {
    next(err);
  }
});

const CategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
  imageUrl: z.string().trim().max(200000).optional(),
  sortOrder: z.number().int().min(0).max(999).optional()
});

catalogRoutes.post(
  '/categories',
  requirePermission('catalog.categories.manage'),
  validate({ body: CategorySchema }),
  async (req, res, next) => {
    try {
      const category = await categoryRepository.create(req.body);
      recordAudit(req, {
        action: 'CATEGORY_CREATED',
        entityType: 'CATEGORY',
        entityId: category.id,
        summary: `Created category "${category.name}"`,
        after: category
      });
      res.status(201).json({ success: true, data: { category } });
    } catch (err) {
      next(err);
    }
  }
);

catalogRoutes.patch(
  '/categories/:id',
  requirePermission('catalog.categories.manage'),
  validate({ body: CategorySchema.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res, next) => {
    try {
      const category = await categoryRepository.update(req.params.id, req.body);
      if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
      recordAudit(req, {
        action: 'CATEGORY_UPDATED',
        entityType: 'CATEGORY',
        entityId: category.id,
        summary: `Updated category "${category.name}"`,
        after: req.body
      });
      res.json({ success: true, data: { category } });
    } catch (err) {
      next(err);
    }
  }
);

catalogRoutes.delete('/categories/:id', requirePermission('catalog.categories.manage'), async (req, res, next) => {
  try {
    const category = await categoryRepository.findById(req.params.id);
    if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    await categoryRepository.remove(req.params.id);
    recordAudit(req, {
      action: 'CATEGORY_DELETED',
      entityType: 'CATEGORY',
      entityId: req.params.id,
      summary: `Deleted category "${category.name}"`,
      before: category
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});
