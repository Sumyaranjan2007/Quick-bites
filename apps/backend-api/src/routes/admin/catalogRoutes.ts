/**
 * The catalogue: every partner's menu, the queue of changes they have asked for,
 * and the platform-wide categories that organise it.
 */
import { optionGroupsFromChoices } from '../../modules/orders/dishOptions.ts';
import { Router } from 'express';
import {
  marginPreservingPrice,
  setItemPrice
} from '../../modules/payments/restaurantCharges.ts';
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
import { profileEditRepository } from '../../db/repositories/profileEditRepository.ts';
import {
  EDITABLE_PROFILE_FIELDS,
  requiresRelisting,
  reviewProfileEdit,
  type EditableProfileField
} from '../../modules/restaurants/profileEdits.ts';

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

/**
 * GET /api/admin/menu-requests/grouped — the review queue, by restaurant.
 *
 * A flat list of dishes is the wrong shape for this job. Twenty restaurants
 * submitting five dishes each produced a hundred interleaved cards, and an
 * administrator had to approve them one at a time while keeping track of which
 * kitchen they were half-way through. Menu review is a per-restaurant decision —
 * you look at what one kitchen is proposing, judge it together, and act on it —
 * so the queue is shaped that way, newest submission first.
 */
catalogRoutes.get(
  '/menu-requests/grouped',
  requirePermission('catalog.menus.view', 'catalog.menus.review'),
  async (req, res, next) => {
    try {
      const status = String(req.query.status || 'PENDING').toUpperCase();
      const requests =
        status === 'ALL'
          ? await menuRequestRepository.listAll()
          : await menuRequestRepository.listByStatus(status as any);

      const byRestaurant = new Map<string, any>();
      for (const request of requests) {
        let group = byRestaurant.get(request.restaurantId);
        if (!group) {
          const restaurant = await restaurantRepository.findById(request.restaurantId);
          group = {
            restaurantId: request.restaurantId,
            restaurantName: request.restaurantName || restaurant?.name || request.restaurantId,
            city: restaurant?.city,
            // Said plainly, because it changes the decision: a kitchen that is
            // not yet trading is usually submitting its opening menu.
            restaurantStatus: restaurant?.status,
            isFirstMenu: !(await menuRepository.findByRestaurantId(request.restaurantId)),
            requests: [],
            pendingCount: 0,
            oldestSubmittedAt: request.submittedAt,
            newestSubmittedAt: request.submittedAt
          };
          byRestaurant.set(request.restaurantId, group);
        }
        group.requests.push(request);
        if (request.status === 'PENDING') group.pendingCount++;
        if (request.submittedAt < group.oldestSubmittedAt) group.oldestSubmittedAt = request.submittedAt;
        if (request.submittedAt > group.newestSubmittedAt) group.newestSubmittedAt = request.submittedAt;
      }

      const groups = Array.from(byRestaurant.values()).sort(
        (a, b) => new Date(b.newestSubmittedAt).getTime() - new Date(a.newestSubmittedAt).getTime()
      );

      res.json({
        success: true,
        data: {
          groups,
          totalRequests: requests.length,
          totalPending: requests.filter((r: any) => r.status === 'PENDING').length,
          restaurantsWaiting: groups.filter((g: any) => g.pendingCount > 0).length
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const BulkReviewSchema = z.object({
  restaurantId: z.string().min(1),
  /**
   * The dishes to turn down, each with its own reason. Everything else still
   * pending for this restaurant is approved.
   */
  rejections: z
    .array(
      z.object({
        requestId: z.string().min(1),
        rejectionReason: z.string().trim().min(1).max(400)
      })
    )
    .max(200)
    .optional(),
  /**
   * Guards against acting on a stale screen. The client sends the request ids it
   * was showing; anything that arrived since is left alone rather than approved
   * sight-unseen.
   */
  expectedRequestIds: z.array(z.string()).max(500).optional()
});

/**
 * POST /api/admin/menu-requests/bulk-review
 *
 * Settles one restaurant's queue in a single decision: name the dishes being
 * turned down and why, and the rest go live. This is how the work is actually
 * done — an administrator reads a kitchen's submission, finds the two dishes
 * with a mispriced starter or a missing description, and waves the other eight
 * through. Doing that through the single-request route meant ten round trips and
 * no way to tell whether you had finished.
 *
 * Each dish is still reviewed individually underneath, through the same code the
 * single-request route uses, so a failure on one does not silently approve or
 * skip the others — every outcome is reported back.
 */
catalogRoutes.post(
  '/menu-requests/bulk-review',
  requirePermission('catalog.menus.review'),
  validate({ body: BulkReviewSchema }),
  async (req, res, next) => {
    try {
      const { restaurantId, rejections = [], expectedRequestIds } = req.body;

      const restaurant = await restaurantRepository.findById(restaurantId);
      if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

      const rejectionByRequestId = new Map<string, string>(
        rejections.map((r: any) => [r.requestId, r.rejectionReason])
      );

      let pending = (await menuRequestRepository.listByRestaurant(restaurantId)).filter(
        (r: any) => r.status === 'PENDING'
      );

      // Anything submitted after the administrator loaded the screen is left for
      // the next pass: approving a dish nobody has read is exactly the failure
      // this endpoint exists to avoid.
      let skippedUnseen = 0;
      if (expectedRequestIds) {
        const seen = new Set(expectedRequestIds);
        const before = pending.length;
        pending = pending.filter((r: any) => seen.has(r.id));
        skippedUnseen = before - pending.length;
      }

      const approved: any[] = [];
      const rejected: any[] = [];
      const failed: any[] = [];
      /** Dishes whose customer price was adjusted to hold the margin. */
      const markupsHeld: any[] = [];
      /** Dishes where it could not be, which the administrator must see. */
      const markupsNotHeld: any[] = [];

      for (const request of pending) {
        const rejectionReason = rejectionByRequestId.get(request.id);
        try {
          if (rejectionReason) {
            const reviewed = await menuRequestRepository.review(request.id, 'REJECTED', req.user!.id, {
              rejectionReason
            });
            emitMenuRequestReviewed({ id: request.id, restaurantId, status: 'REJECTED' });
            rejected.push(reviewed);
            continue;
          }

          const final = { ...request.payload };
          const { categoryName, sizes, extras, ...plain } = final as any;
          const item = {
            ...plain,
            ...optionGroupsFromChoices(
              { sizes, extras },
              request.dishId ? (await menuRepository.findItem(restaurantId, request.dishId))?.optionGroups : []
            )
          };

          let dish;
          if (request.kind === 'EDIT_ITEM' && request.dishId) {
            /*
             * Read the kitchen's CURRENT price and the margin standing on it
             * BEFORE the write, because updateItem clears a typed customer price
             * when the price changes and afterwards there is nothing left to
             * preserve.
             */
            const before = await menuRepository.findItem(restaurantId, request.dishId);
            const holding =
              before && typeof (item as any).price === 'number'
                ? marginPreservingPrice({
                    restaurantId,
                    itemId: request.dishId,
                    oldRestaurantPrice: before.price,
                    newRestaurantPrice: (item as any).price
                  })
                : null;

            dish = await menuRepository.updateItem(restaurantId, request.dishId, { ...item, categoryName });
            if (!dish) {
              failed.push({ requestId: request.id, name: request.payload.name, reason: 'The dish this request edits no longer exists.' });
              continue;
            }

            /*
             * BULK APPROVAL MUST NOT SKIP THE MARKUP.
             *
             * Approving many price changes at once without setting customer
             * prices would recreate, at scale and with one tap, exactly the lapse
             * the approval design exists to prevent: the kitchen's new price live
             * and the platform's markup gone. So the margin-preserving default is
             * applied automatically, and REPORTED -- silence here is the failure,
             * because nobody would think to check twelve dishes they had just
             * approved in one action.
             */
            if (holding) {
              try {
                setItemPrice({
                  restaurantId,
                  itemId: request.dishId,
                  restaurantPrice: dish.price,
                  customerPrice: holding.rupee,
                  actorUserId: req.user!.id,
                  note: `Bulk approval held the Rs ${holding.keptRupees} margin on ${dish.name}.`
                });
                markupsHeld.push({
                  dishId: dish.id,
                  name: dish.name,
                  kitchenPrice: dish.price,
                  customerPrice: holding.rupee,
                  keptRupees: holding.keptRupees
                });
              } catch (err: any) {
                // Reported rather than swallowed. An unpriced dish falls back to
                // the restaurant percentage, which is safe, but the
                // administrator has to know which ones did.
                markupsNotHeld.push({
                  dishId: dish.id,
                  name: dish.name,
                  reason: err?.message || 'The customer price could not be set.'
                });
              }
            }
          } else {
            dish = await menuRepository.addItem(restaurantId, categoryName, {
              ...item,
              description: item.description || '',
              isAvailable: true
            } as any);
            if (!dish) {
              failed.push({ requestId: request.id, name: request.payload.name, reason: 'The dish could not be written to the menu.' });
              continue;
            }
          }

          const reviewed = await menuRequestRepository.review(request.id, 'APPROVED', req.user!.id, {
            resultingDishId: dish.id
          });
          emitMenuRequestReviewed({ id: request.id, restaurantId, status: 'APPROVED' });
          approved.push({ request: reviewed, item: dish });
        } catch (err: any) {
          failed.push({ requestId: request.id, name: request.payload?.name, reason: err?.message || 'Unknown error' });
        }
      }

      if (approved.length) emitMenuUpdated(restaurantId);

      // One audit entry for one decision, naming what was turned down. A line per
      // dish would bury the judgement that was actually made.
      recordAudit(req, {
        action: 'MENU_REQUESTS_BULK_REVIEWED',
        entityType: 'RESTAURANT',
        entityId: restaurantId,
        summary:
          `Reviewed ${restaurant.name}'s menu: approved ${approved.length}, rejected ${rejected.length}` +
          (markupsHeld.length ? `, held our margin on ${markupsHeld.length}` : '') +
          (markupsNotHeld.length ? `, could NOT hold it on ${markupsNotHeld.length}` : '') +
          (failed.length ? `, ${failed.length} could not be applied` : '') +
          (rejected.length ? ` — turned down ${rejected.map((r: any) => `"${r.payload?.name}"`).join(', ')}` : ''),
        after: {
          approved: approved.map((a: any) => a.item?.name),
          rejected: rejected.map((r: any) => r.payload?.name)
        }
      });

      res.json({
        success: true,
        data: {
          restaurantId,
          restaurantName: restaurant.name,
          approvedCount: approved.length,
          /*
           * What the platform did on the administrator's behalf, in the
           * response, so the screen can say it. A margin adjusted silently is
           * one nobody verifies.
           */
          markupsHeld,
          markupsNotHeld,
          rejectedCount: rejected.length,
          approved: approved.map((a: any) => ({ requestId: a.request.id, dishId: a.item.id, name: a.item.name })),
          rejected: rejected.map((r: any) => ({ requestId: r.id, name: r.payload?.name })),
          failed,
          skippedUnseen
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

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
    .optional(),
  /**
   * What the CUSTOMER should pay for this dish, decided in the same action as
   * the price change.
   *
   * Three meanings, deliberately distinct:
   *   a number -- use it, refusing anything below the kitchen's own price
   *   null     -- clear any typed price, so the restaurant percentage applies
   *   absent   -- hold the existing margin automatically
   *
   * `.nullable()` rather than just optional, because "charge the percentage" and
   * "I did not say" are different instructions and collapsing them would make
   * clearing a price impossible through this route.
   */
  customerPrice: z.number().min(0).max(1000000).nullable().optional()
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
      // Sizes and extras become option groups here, with ids made at approval,
      // and the cheapest size sets the dish price (F05).
      const { categoryName, sizes, extras, ...plain } = final as any;
      const item = {
        ...plain,
        ...optionGroupsFromChoices(
          { sizes, extras },
          request.dishId ? (await menuRepository.findItem(request.restaurantId, request.dishId))?.optionGroups : []
        )
      };

      let dish;
      let markupHeld: any = null;
      if (request.kind === 'EDIT_ITEM' && request.dishId) {
        // Read before the write: updateItem clears a typed customer price when
        // the kitchen's price changes, and the margin standing on the old price
        // cannot be recovered afterwards.
        const before = await menuRepository.findItem(request.restaurantId, request.dishId);
        const holding =
          before && typeof (item as any).price === 'number'
            ? marginPreservingPrice({
                restaurantId: request.restaurantId,
                itemId: request.dishId,
                oldRestaurantPrice: before.price,
                newRestaurantPrice: (item as any).price
              })
            : null;

        dish = await menuRepository.updateItem(request.restaurantId, request.dishId, { ...item, categoryName });
        if (!dish) throw new AppError('The dish this request edits no longer exists.', 404, 'DISH_NOT_FOUND');

        /*
         * The price change and the customer price are ONE decision, taken here.
         *
         * `customerPrice` in the body is what the administrator typed; when it is
         * absent the margin-preserving default applies. Either way both values
         * are written before this request returns, so there is no window in which
         * the kitchen's new price is live and the platform's markup is not --
         * they were never two separate saves.
         */
        const typedByAdmin = (req.body as any).customerPrice;
        const target =
          typedByAdmin === null
            ? null
            : typeof typedByAdmin === 'number'
              ? typedByAdmin
              : holding
                ? holding.rupee
                : undefined;

        if (target !== undefined) {
          // Refusals from setItemPrice are NOT caught here. A customer price
          // below the kitchen's own is refused with both numbers named, and an
          // administrator who typed it needs to see that rather than have the
          // approval quietly succeed with something else.
          const result = setItemPrice({
            restaurantId: request.restaurantId,
            itemId: request.dishId,
            restaurantPrice: dish.price,
            customerPrice: target,
            actorUserId: req.user!.id,
            note:
              typeof typedByAdmin === 'number'
                ? `Set at approval of a price change on ${dish.name}.`
                : `Approval held the Rs ${holding?.keptRupees} margin on ${dish.name}.`
          });
          markupHeld = {
            customerPrice: result.customerPrice,
            marginRupees: Math.round(result.marginPaise) / 100,
            chosenBy: typeof typedByAdmin === 'number' ? 'ADMIN' : 'MARGIN_DEFAULT',
            alternatives: holding
          };
        }
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

      res.json({ success: true, data: { request: reviewed, item: dish, markupHeld } });
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

/* ------------------------- Partner profile changes ------------------------ */

/**
 * The queue of partner-submitted profile changes.
 *
 * Oldest first, because whoever has waited longest is reviewed first. A
 * newest-first queue is the tempting one - every other feed reads that way -
 * and it is how a submission at the bottom of a busy week waits a fortnight
 * while newer ones are cleared above it.
 *
 * Each row carries the restaurant it belongs to and the before/after of every
 * changed field, so the reviewer never has to open another screen to judge it.
 * "Sunrise Kitchen -> Sunrise Kitchen & Grill" is reviewable; "name changed"
 * is not.
 */
catalogRoutes.get(
  '/profile-edits',
  requirePermission('catalog.restaurants.approve'),
  async (req, res, next) => {
    try {
      const status = String(req.query.status || 'PENDING').toUpperCase();
      const all = status === 'PENDING'
        ? await profileEditRepository.listPending()
        : (await Promise.all(
            (await restaurantRepository.listAll()).map(r =>
              profileEditRepository.listByRestaurant(r.id)
            )
          )).flat();

      const rows = [];
      for (const edit of all) {
        if (status !== 'PENDING' && status !== 'ALL' && edit.status !== status) continue;
        const restaurant = await restaurantRepository.findById(edit.restaurantId);
        const fields = Object.keys(edit.changes) as EditableProfileField[];

        rows.push({
          id: edit.id,
          restaurantId: edit.restaurantId,
          restaurantName: restaurant?.name ?? edit.restaurantId,
          city: restaurant?.city,
          // Said plainly, because it changes the decision: a kitchen that is
          // not trading yet is usually completing its first profile, and a
          // kitchen that IS trading has customers looking at the old values
          // right now.
          restaurantStatus: restaurant?.status,
          submittedAt: edit.submittedAt,
          submittedByUserId: edit.submittedByUserId,
          status: edit.status,
          fields,
          changes: edit.changes,
          previous: edit.previous,
          approvedFields: edit.approvedFields ?? [],
          rejections: edit.rejections ?? [],
          reviewedAt: edit.reviewedAt ?? null,
          reviewedByUserId: edit.reviewedByUserId ?? null,
          /** True when approving this will change which customers can see them. */
          affectsListing: requiresRelisting(fields)
        });
      }

      rows.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

      res.json({
        success: true,
        data: {
          edits: rows,
          pendingCount: rows.filter(r => r.status === 'PENDING').length,
          /** The app renders its field labels against this, never a hardcoded list. */
          editableFields: EDITABLE_PROFILE_FIELDS
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const ProfileReviewSchema = z.object({
  approve: z.array(z.string()).optional().default([]),
  reject: z
    .array(
      z.object({
        field: z.string(),
        reason: z.string().min(1, 'Say why the change was refused.').max(300)
      })
    )
    .optional()
    .default([])
});

/**
 * Settles one submission, field by field.
 *
 * A reviewer can accept the opening hours and refuse the photograph in one
 * pass, with a reason on the refused part only. That is how the work is
 * actually done, and forcing an all-or-nothing decision means a partner whose
 * photograph is wrong also loses the hours they corrected, and has to submit
 * both again.
 *
 * Every changed field must be decided. A review that silently left one
 * undecided would close the submission with that change neither live nor
 * refused, and nothing would ever surface it again - the partner would wait
 * for a decision that had already been made without it.
 */
catalogRoutes.post(
  '/profile-edits/:id/review',
  requirePermission('catalog.restaurants.approve'),
  validate({ body: ProfileReviewSchema }),
  async (req, res, next) => {
    try {
      const edit = await profileEditRepository.findById(req.params.id);
      if (!edit) throw new AppError('Submission not found.', 404, 'PROFILE_EDIT_NOT_FOUND');

      if (edit.status !== 'PENDING') {
        throw new AppError(
          edit.status === 'SUPERSEDED'
            ? 'The partner has since submitted a newer version of this change. Review that one instead.'
            : 'This submission has already been reviewed.',
          409,
          'PROFILE_EDIT_NOT_PENDING'
        );
      }

      const restaurant = await restaurantRepository.findById(edit.restaurantId);
      if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

      const outcome = reviewProfileEdit(edit, {
        approve: req.body.approve as EditableProfileField[],
        reject: req.body.reject as { field: EditableProfileField; reason: string }[]
      });

      if (outcome.errors.length > 0) {
        throw new AppError(outcome.errors.join(' '), 400, 'INCOMPLETE_PROFILE_REVIEW');
      }

      // The live record is written FIRST, then the submission is closed. The
      // other order would leave a submission marked approved whose changes
      // never reached the restaurant, and nothing afterwards would retry it.
      if (outcome.approvedFields.length > 0) {
        await restaurantRepository.applyProfile(restaurant.id, outcome.apply);
      }

      const reviewed = await profileEditRepository.recordReview(edit.id, {
        status: outcome.status,
        approvedFields: outcome.approvedFields,
        rejections: outcome.rejections,
        reviewedByUserId: req.user!.id
      });

      recordAudit(req, {
        action: 'RESTAURANT_PROFILE_REVIEWED',
        entityType: 'RESTAURANT',
        entityId: restaurant.id,
        summary:
          outcome.approvedFields.length > 0 && outcome.rejections.length > 0
            ? 'Approved ' +
              outcome.approvedFields.join(', ') +
              ' and refused ' +
              outcome.rejections.map(r => r.field).join(', ') +
              ' on ' +
              restaurant.name
            : outcome.rejections.length > 0
              ? 'Refused ' + outcome.rejections.map(r => r.field).join(', ') + ' on ' + restaurant.name
              : 'Approved ' + outcome.approvedFields.join(', ') + ' on ' + restaurant.name,
        before: edit.previous,
        after: outcome.apply
      });

      res.json({
        success: true,
        data: {
          edit: reviewed,
          outcome: {
            status: outcome.status,
            approvedFields: outcome.approvedFields,
            rejections: outcome.rejections,
            applied: outcome.apply
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
