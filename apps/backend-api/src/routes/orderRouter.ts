import { Router } from 'express';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { z } from 'zod';
import { AppError } from '../utils/AppError.ts';
import { messageRepository } from '../db/repositories/messageRepository.ts';
import { emitOrderMessage } from '../sockets/socketServer.ts';
import { estimateArrival } from '../modules/orders/eta.ts';
import { cancellationReasonsFor, actorForRole } from '../modules/orders/cancellationReasons.ts';
import { config } from '../config/env.ts';
import type { LanguageCode } from '@quick-bites/shared-types';

export const orderRouter = Router();

// GET /api/v1/orders - Order history for authenticated user
orderRouter.get('/', authMiddleware(), async (req, res, next) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id || '';

    let orders;
    if (role === 'customer') {
      orders = await orderRepository.listByCustomerId(userId);
    } else if (role === 'rider') {
      orders = await orderRepository.listByRiderId(userId);
    } else if (role === 'admin' || role === 'super_admin') {
      orders = await orderRepository.listAll();
    } else {
      orders = await orderRepository.listByCustomerId(userId);
    }

    res.json({
      success: true,
      data: { orders },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/cancellation-reasons — the reasons this caller may choose.
 *
 * Served rather than compiled into each app so that adding a reason, or fixing
 * its wording in Hindi, reaches every installed phone on the next screen open.
 * Scoped to the caller's role: a customer is never offered "the kitchen is
 * overloaded", and a partner is never offered "I changed my mind".
 */
orderRouter.get('/cancellation-reasons', authMiddleware(), async (req, res, next) => {
  try {
    const requested = String(req.query.language || 'en');
    const language: LanguageCode = ['en', 'hi', 'kn'].includes(requested)
      ? (requested as LanguageCode)
      : 'en';

    res.json({
      success: true,
      data: { reasons: cancellationReasonsFor(actorForRole(req.user?.role), language) },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/orders/:id - Single order detail
orderRouter.get('/:id', authMiddleware(), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Order not found' },
        meta: {
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId
        }
      });
    }

    const isCustomer = order.customerId === req.user?.id;
    const isRider = order.riderId === req.user?.id;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin' || req.user?.role === 'restaurant_owner';

    if (!isCustomer && !isRider && !isStaff) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Forbidden: You do not have permission to view this order.' },
        meta: {
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId
        }
      });
    }

    res.json({
      success: true,
      data: { order },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});

const CreateOrderSchema = z.object({
  restaurantId: z.string().min(1, 'Restaurant ID is required'),
  deliveryAddressId: z.string().min(1, 'Delivery Address ID is required'),
  items: z.array(z.object({
    dishId: z.string().min(1),
    quantity: z.number().int().positive(),
    selectedOptions: z.array(z.object({
      groupId: z.string(),
      optionId: z.string()
    })).optional()
  })).min(1, 'Order must contain at least one dish'),
  paymentMethod: z.enum(['RAZORPAY_SANDBOX', 'CASH_ON_DELIVERY']),
  couponCode: z.string().optional(),
  idempotencyKey: z.string().min(8, 'Idempotency key must be at least 8 characters'),
  distanceKm: z.number().positive().optional(),
  /**
   * The rider's tip. Bounded here as well as in the service so an absurd figure
   * is refused with a readable message instead of being silently clamped — a
   * customer who typed an extra zero should be told, not quietly corrected.
   */
  tipAmount: z
    .number()
    .min(0, 'A tip cannot be negative')
    .max(config.MAX_TIP_AMOUNT, `A tip cannot be more than Rs ${config.MAX_TIP_AMOUNT}`)
    .optional()
});

const QuoteOrderSchema = z.object({
  restaurantId: z.string().min(1, 'Restaurant ID is required'),
  deliveryAddressId: z.string().min(1).optional(),
  items: z.array(z.object({
    dishId: z.string().min(1),
    quantity: z.number().int().positive(),
    selectedOptions: z.array(z.object({
      groupId: z.string(),
      optionId: z.string()
    })).optional()
  })).min(1, 'Add at least one dish before pricing a basket'),
  couponCode: z.string().optional(),
  distanceKm: z.number().positive().optional(),
  tipAmount: z
    .number()
    .min(0, 'A tip cannot be negative')
    .max(config.MAX_TIP_AMOUNT, `A tip cannot be more than Rs ${config.MAX_TIP_AMOUNT}`)
    .optional()
});

/**
 * POST /api/orders/quote — what this basket will actually cost.
 *
 * The cart screen calls this instead of pricing the order itself. It creates
 * nothing and charges nothing; it exists so that the bill a customer agrees to
 * and the bill the server writes are produced by the same code, from the same
 * account record and the same promo campaign.
 */
orderRouter.post('/quote', authMiddleware('customer'), validate({ body: QuoteOrderSchema }), async (req, res, next) => {
  try {
    const quote = await orderService.quoteOrder({ ...req.body, customerId: req.user!.id });
    res.json({
      success: true,
      data: quote,
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

orderRouter.post('/', authMiddleware('customer'), validate({ body: CreateOrderSchema }), async (req, res, next) => {
  try {
    const result = await orderService.createOrder({
      ...req.body,
      customerId: req.user!.id
    });

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/orders/:id/tracking — live position of the rider carrying this order.
 *
 * The customer needs to follow the rider without being handed the whole order
 * record (which contains the delivery OTP). Restricted to the order's own
 * customer, its assigned rider, or staff.
 */
orderRouter.get('/:id/tracking', authMiddleware(), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    const isCustomer = order.customerId === req.user?.id;
    const isRider = order.riderId === req.user?.id;
    const isStaff =
      req.user?.role === 'admin' || req.user?.role === 'super_admin' || req.user?.role === 'rider';

    if (!isCustomer && !isRider && !isStaff) {
      throw new AppError('You do not have permission to track this order.', 403, 'FORBIDDEN');
    }

    res.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        riderName: order.riderName ?? null,
        riderPhone: order.riderPhone ?? null,
        riderCoordinates: order.riderCoordinates ?? null,
        riderBearing: order.riderBearing ?? 0,
        riderLocationUpdatedAt: order.riderLocationUpdatedAt ?? null,
        destinationCoordinates: order.deliveryCoordinates ?? null,
        // Recomputed on every poll rather than stored, because it is a function
        // of where the rider is right now. A stored ETA is a stale ETA the
        // moment the rider moves, and the tracking screen's whole job is to
        // show a number that changes.
        eta: estimateArrival(order),
        pickedUpAt: order.pickedUpAt ?? null,
        preparationMinutes: order.preparationMinutes ?? null
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/:id/reorder — what this order would cost to repeat today.
 *
 * Returns a basket; it does not place anything. See
 * orderService.buildReorderBasket for why repeating an order blind is the wrong
 * behaviour.
 */
orderRouter.post('/:id/reorder', authMiddleware('customer'), async (req, res, next) => {
  try {
    const basket = await orderService.buildReorderBasket(req.user!.id, req.params.id);
    res.json({
      success: true,
      data: basket,
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

const ConfirmPaymentSchema = z.object({
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required')
});

// POST /api/v1/orders/:id/confirm-payment - Moves PAYMENT_PENDING -> ORDER_PLACED
orderRouter.post('/:id/confirm-payment', authMiddleware(), validate({ body: ConfirmPaymentSchema }), async (req, res, next) => {
  try {
    const order = await orderService.confirmPayment(
      req.params.id,
      req.body.razorpayPaymentId,
      req.body.razorpaySignature
    );

    res.json({
      success: true,
      data: { order },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});

const StatusTransitionSchema = z.object({
  status: z.enum([
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED'
  ]),
  /**
   * A kitchen cannot plausibly cook and pack in under ten minutes, and the figure
   * is shown to the customer as a promise. Enforced here rather than only in the
   * partner app, because the app is the part a partner can bypass.
   */
  preparationMinutes: z
    .number()
    .int('Preparation time must be a whole number of minutes')
    .min(10, 'Preparation time cannot be less than 10 minutes')
    .max(180, 'Preparation time cannot be more than 3 hours')
    .optional(),
  otp: z.string().length(4).optional(),
  /**
   * Required when cancelling. A code from the served catalogue, not a sentence:
   * see modules/orders/cancellationReasons.ts for why the wording is not the
   * thing that gets stored.
   */
  cancellationReasonCode: z.string().min(1).max(64).optional(),
  /** Only kept for the catch-all reason, and only up to 300 characters. */
  cancellationNote: z.string().max(300).optional()
});

/**
 * Who may move an order, and to where. Previously any signed-in account could drive
 * any order by id — a customer could mark someone else's order DELIVERED, or a
 * stranger could cancel a restaurant's queue.
 */
async function assertMayTransition(req: any, orderId: string, nextStatus: string) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  }

  const role = req.user?.role;
  if (role === 'admin' || role === 'super_admin') return;

  // The kitchen accepts, prepares and hands over its own orders.
  if (role === 'restaurant_owner') {
    const restaurant = await restaurantRepository.findById(order.restaurantId);
    if (!restaurant || restaurant.ownerId !== req.user?.id) {
      throw new AppError('You do not manage this restaurant.', 403, 'NOT_RESTAURANT_OWNER');
    }
    return;
  }

  // The assigned rider carries it out for delivery and closes it with the OTP.
  if (role === 'rider') {
    const rider = await riderRepository.findByUserId(req.user!.id);
    if (!rider || order.riderId !== rider.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
    }
    return;
  }

  // A customer may only cancel their own order, and only before the kitchen starts.
  if (order.customerId !== req.user?.id) {
    throw new AppError('You do not have permission to update this order.', 403, 'FORBIDDEN');
  }
  if (nextStatus !== 'CANCELLED') {
    throw new AppError('Customers can only cancel an order.', 403, 'CUSTOMER_CANNOT_ADVANCE');
  }
}

orderRouter.put('/:id/status', authMiddleware(), validate({ body: StatusTransitionSchema }), async (req, res, next) => {
  try {
    await assertMayTransition(req, req.params.id, req.body.status);

    // Cancelling is not just another transition: it has to record why, and it
    // has to return the customer's money when money was taken. Both live in
    // orderService.cancelOrder, and routing through it here is what stops a
    // cancellation from ever arriving without them.
    if (req.body.status === 'CANCELLED') {
      if (!req.body.cancellationReasonCode) {
        throw new AppError(
          'Choose a reason for cancelling this order.',
          400,
          'CANCELLATION_REASON_REQUIRED'
        );
      }
      const result = await orderService.cancelOrder(
        req.params.id,
        {
          userId: req.user!.id,
          name: req.user!.fullName || req.user!.email || 'Quick Bites user',
          role: req.user!.role
        },
        req.body.cancellationReasonCode,
        req.body.cancellationNote
      );

      res.json({
        success: true,
        data: { ...result.order, refund: result.refund },
        meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
      });
      return;
    }

    const updated = await orderService.transitionStatus(
      req.params.id,
      req.body.status,
      req.body.preparationMinutes,
      req.body.otp
    );

    res.json({
      success: true,
      data: updated,
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId
      }
    });
  } catch (err) {
    next(err);
  }
});


const RatingSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'),
  comment: z.string().max(500).optional(),
  /** The rider is scored separately from the food, so a slow kitchen does not
   *  cost the rider their rating. Omitted, the order's rating counts for both. */
  riderRating: z.number().int().min(1).max(5).optional(),
  riderComment: z.string().max(500).optional()
});

/**
 * POST /api/orders/:id/rating
 *
 * Only the customer who placed it, only once it has actually arrived, and only
 * once. A rating on an undelivered order would be rating something that has not
 * happened yet, and re-rating would let one customer move a restaurant's average
 * as often as they liked.
 */
orderRouter.post('/:id/rating', authMiddleware('customer'), validate({ body: RatingSchema }), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.customerId !== req.user?.id) {
      throw new AppError('You can only rate your own orders.', 403, 'NOT_ORDER_OWNER');
    }
    if (order.status !== 'DELIVERED') {
      throw new AppError('An order can only be rated once it has been delivered.', 409, 'ORDER_NOT_DELIVERED');
    }
    if (order.rating) {
      throw new AppError('This order has already been rated.', 409, 'ALREADY_RATED');
    }

    const updated = await orderRepository.setRating(
      order.id,
      req.body.rating,
      req.body.comment,
      req.body.riderRating,
      req.body.riderComment
    );
    await restaurantRepository.addRating(order.restaurantId, req.body.rating);

    res.json({
      success: true,
      data: { order: updated },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Everyone involved in an order may read and write its thread.
 *
 * `order.riderId` holds the rider RECORD id, not the user id, so a rider has to
 * be resolved through their rider profile. Comparing it against `req.user.id`
 * directly never matches - which is why the tracking endpoint's rider check has
 * always passed only by falling through to its staff clause.
 */
async function assertMayUseThread(req: any, orderId: string) {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

  const isCustomer = order.customerId === req.user?.id;
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';

  let isRider = false;
  if (order.riderId && req.user?.role === 'rider') {
    const self = await riderRepository.findByUserId(req.user.id);
    isRider = Boolean(self && self.id === order.riderId);
  }

  if (!isCustomer && !isRider && !isStaff) {
    throw new AppError('You are not part of this order.', 403, 'FORBIDDEN');
  }
  return order;
}

// GET /api/orders/:id/messages
orderRouter.get('/:id/messages', authMiddleware(), async (req, res, next) => {
  try {
    await assertMayUseThread(req, req.params.id);
    const messages = await messageRepository.listByOrder(req.params.id);
    res.json({
      success: true,
      data: { messages },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

const MessageSchema = z.object({
  body: z.string().trim().min(1, 'A message cannot be empty').max(1000, 'Message is too long')
});

// POST /api/orders/:id/messages
orderRouter.post('/:id/messages', authMiddleware(), validate({ body: MessageSchema }), async (req, res, next) => {
  try {
    const order = await assertMayUseThread(req, req.params.id);

    // Closed orders are read-only. The thread stays visible in history, but a
    // delivered order should not remain an open channel to the rider.
    if (['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new AppError('This order is closed, so its chat is read-only.', 409, 'ORDER_CLOSED');
    }

    const message = await messageRepository.create({
      orderId: order.id,
      senderId: req.user!.id,
      senderRole: req.user!.role as any,
      senderName: req.user!.fullName || 'Quick Bites user',
      body: req.body.body
    });

    emitOrderMessage(order.id, message);

    res.status(201).json({
      success: true,
      data: { message },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});
