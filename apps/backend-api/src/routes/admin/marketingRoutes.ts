/**
 * Campaigns and customer feedback: promo codes, and the reviews customers leave
 * on the orders those campaigns brought in.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { couponRepository } from '../../db/repositories/couponRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { matchesQuery, paginate } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import type { Order } from '@quick-bites/shared-types';

export const marketingRoutes = Router();

/* --------------------------------- Coupons -------------------------------- */

/** GET /api/admin/coupons — every campaign, with how much each has cost. */
marketingRoutes.get('/coupons', requirePermission('marketing.coupons.manage'), async (_req, res, next) => {
  try {
    const coupons = await couponRepository.list();
    const orders = (await orderRepository.listAll()) as Order[];

    const rows = coupons.map(coupon => {
      const used = orders.filter(o => String(o.couponCode || '').toUpperCase() === coupon.code);
      const now = Date.now();
      const expired = Boolean(coupon.expiresAt && now > new Date(coupon.expiresAt).getTime());
      const scheduled = Boolean(coupon.startsAt && now < new Date(coupon.startsAt).getTime());
      return {
        ...coupon,
        // Derived rather than stored: a campaign that has run out of budget or
        // fallen out of its window is not "active" however the flag was left.
        effectiveStatus: !coupon.isActive
          ? 'DISABLED'
          : expired
            ? 'EXPIRED'
            : scheduled
              ? 'SCHEDULED'
              : coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit
                ? 'EXHAUSTED'
                : 'LIVE',
        ordersUsedOn: used.length,
        discountGiven:
          Math.round(used.reduce((t, o) => t + (Number(o.bill?.couponDiscount) || 0), 0) * 100) / 100,
        revenueInfluenced:
          Math.round(used.reduce((t, o) => t + (Number(o.bill?.totalAmount) || 0), 0) * 100) / 100
      };
    });

    res.json({ success: true, data: { coupons: rows } });
  } catch (err) {
    next(err);
  }
});

const CouponSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'A code needs at least 3 characters.')
    .max(24)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only.'),
  title: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  discountType: z.enum(['PERCENTAGE', 'FLAT', 'FREE_DELIVERY']),
  discountValue: z.number().min(0).max(100000),
  minOrderValue: z.number().min(0).max(100000).optional(),
  maxDiscountCap: z.number().min(0).max(100000).optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  usageLimit: z.number().int().min(1).max(1000000).optional(),
  perUserLimit: z.number().int().min(1).max(1000).optional(),
  applicableRestaurantIds: z.array(z.string()).max(200).optional(),
  applicableCategories: z.array(z.string().max(60)).max(50).optional(),
  isActive: z.boolean().optional()
});

/**
 * POST /api/admin/coupons
 *
 * A percentage discount without a cap is how a campaign accidentally pays for a
 * party of twenty, so one is required. The rest of the conditions are optional
 * and all enforced at checkout.
 */
marketingRoutes.post(
  '/coupons',
  requirePermission('marketing.coupons.manage'),
  validate({ body: CouponSchema }),
  async (req, res, next) => {
    try {
      const existing = await couponRepository.findByCode(req.body.code);
      if (existing) throw new AppError('A coupon with that code already exists.', 409, 'COUPON_EXISTS');

      if (req.body.discountType === 'PERCENTAGE') {
        if (req.body.discountValue > 100) {
          throw new AppError('A percentage discount cannot exceed 100%.', 400, 'INVALID_DISCOUNT');
        }
        if (!req.body.maxDiscountCap) {
          throw new AppError(
            'Set a maximum discount so a percentage campaign has a ceiling.',
            400,
            'DISCOUNT_CAP_REQUIRED'
          );
        }
      }
      if (req.body.startsAt && req.body.expiresAt && new Date(req.body.startsAt) >= new Date(req.body.expiresAt)) {
        throw new AppError('The campaign must end after it starts.', 400, 'INVALID_DATE_RANGE');
      }

      const coupon = await couponRepository.create({ ...req.body, createdByUserId: req.user!.id });
      recordAudit(req, {
        action: 'COUPON_CREATED',
        entityType: 'COUPON',
        entityId: coupon.code,
        summary: `Created coupon ${coupon.code} (${coupon.discountType} ${coupon.discountValue})`,
        after: coupon
      });

      res.status(201).json({ success: true, data: { coupon } });
    } catch (err) {
      next(err);
    }
  }
);

marketingRoutes.patch(
  '/coupons/:code',
  requirePermission('marketing.coupons.manage'),
  validate({ body: CouponSchema.partial().omit({ code: true }) }),
  async (req, res, next) => {
    try {
      const coupon = await couponRepository.update(req.params.code, req.body);
      if (!coupon) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
      recordAudit(req, {
        action: 'COUPON_UPDATED',
        entityType: 'COUPON',
        entityId: coupon.code,
        summary: `Updated coupon ${coupon.code}`,
        after: req.body
      });
      res.json({ success: true, data: { coupon } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/admin/coupons/:code
 *
 * A code that has already been used is deactivated rather than removed: orders
 * reference it, and deleting the row would leave those bills citing a discount
 * from a campaign that no longer exists.
 */
marketingRoutes.delete('/coupons/:code', requirePermission('marketing.coupons.manage'), async (req, res, next) => {
  try {
    const coupon = await couponRepository.findByCode(req.params.code);
    if (!coupon) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');

    if (coupon.timesUsed > 0) {
      await couponRepository.update(coupon.code, { isActive: false });
      recordAudit(req, {
        action: 'COUPON_DISABLED',
        entityType: 'COUPON',
        entityId: coupon.code,
        summary: `Disabled coupon ${coupon.code} (used ${coupon.timesUsed} time(s), so it was kept for the record)`
      });
      return res.json({
        success: true,
        data: { deleted: false, disabled: true },
        message: 'This code has been used on real orders, so it was deactivated rather than deleted.'
      });
    }

    await couponRepository.remove(coupon.code);
    recordAudit(req, {
      action: 'COUPON_DELETED',
      entityType: 'COUPON',
      entityId: coupon.code,
      summary: `Deleted unused coupon ${coupon.code}`,
      before: coupon
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- Reviews -------------------------------- */

/** GET /api/admin/reviews — customer ratings on delivered orders. */
marketingRoutes.get('/reviews', requirePermission('reviews.view'), async (req, res, next) => {
  try {
    const { rating, restaurantId, q, page, pageSize } = req.query as Record<string, string>;
    let orders = ((await orderRepository.listAll()) as Order[]).filter(o => typeof o.rating === 'number');

    if (rating && rating !== 'ALL') {
      if (rating === 'LOW') orders = orders.filter(o => (o.rating || 5) <= 2);
      else orders = orders.filter(o => o.rating === Number(rating));
    }
    if (restaurantId) orders = orders.filter(o => o.restaurantId === restaurantId);
    if (q) orders = orders.filter(o => matchesQuery(q, o.ratingComment, o.customerName, o.restaurantName, o.orderNumber));

    const rows = orders
      .sort((a, b) => new Date(b.ratedAt || 0).getTime() - new Date(a.ratedAt || 0).getTime())
      .map(order => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerName: order.customerName,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        riderId: order.riderId,
        riderName: order.riderName,
        rating: order.rating,
        comment: order.ratingComment,
        riderRating: order.riderRating,
        riderComment: order.riderRatingComment,
        ratedAt: order.ratedAt,
        isHidden: Boolean((order as any).reviewHidden),
        hiddenReason: (order as any).reviewHiddenReason
      }));

    const { rows: paged, pagination } = paginate(rows, Number(page) || 1, Number(pageSize) || 25);
    res.json({
      success: true,
      data: {
        reviews: paged,
        pagination,
        summary: {
          total: rows.length,
          average: rows.length ? Math.round((rows.reduce((t, r) => t + (r.rating || 0), 0) / rows.length) * 10) / 10 : 0,
          lowRated: rows.filter(r => (r.rating || 5) <= 2).length,
          hidden: rows.filter(r => r.isHidden).length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

const ModerateSchema = z.object({
  action: z.enum(['HIDE', 'RESTORE']),
  reason: z.string().trim().max(300).optional()
});

/**
 * POST /api/admin/reviews/:orderId/moderate
 *
 * Hiding takes the comment off the restaurant's page but leaves the score in the
 * average and the text on the record. A review that was abusive should stop
 * being published; it should not stop having happened.
 */
marketingRoutes.post(
  '/reviews/:orderId/moderate',
  requirePermission('reviews.moderate'),
  validate({ body: ModerateSchema }),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.params.orderId);
      if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
      if (typeof order.rating !== 'number') {
        throw new AppError('This order has not been reviewed.', 404, 'REVIEW_NOT_FOUND');
      }

      const hide = req.body.action === 'HIDE';
      if (hide && !req.body.reason) {
        throw new AppError('Record why the review was hidden.', 400, 'MODERATION_REASON_REQUIRED');
      }

      (order as any).reviewHidden = hide;
      (order as any).reviewHiddenReason = hide ? req.body.reason : undefined;
      (order as any).reviewModeratedBy = req.user!.id;
      (order as any).reviewModeratedAt = new Date().toISOString();
      memoryStore.orders.set(order.id, order);
      triggerAutoSave();

      recordAudit(req, {
        action: hide ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
        entityType: 'REVIEW',
        entityId: order.id,
        summary: `${hide ? 'Hid' : 'Restored'} the review on order #${order.orderNumber}${
          req.body.reason ? ` — ${req.body.reason}` : ''
        }`
      });

      res.json({ success: true, data: { orderId: order.id, hidden: hide } });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/restaurants-lite — id/name pairs for coupon targeting pickers. */
marketingRoutes.get('/restaurants-lite', requirePermission('marketing.coupons.manage', 'users.restaurants.view'), async (_req, res, next) => {
  try {
    const restaurants = await restaurantRepository.listAll();
    res.json({
      success: true,
      data: { restaurants: restaurants.map(r => ({ id: r.id, name: r.name, city: r.city, status: r.status })) }
    });
  } catch (err) {
    next(err);
  }
});
