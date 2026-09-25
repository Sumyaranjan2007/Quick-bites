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
import { visibleContact, shapeOrderForViewer, viewerFor } from '../modules/orders/contactVisibility.ts';
import { isCallMaskingConfigured, placeMaskedCall } from '../modules/orders/callMasking.ts';
import { isContactable } from '../modules/orders/contactVisibility.ts';

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
      // Shaped for whoever is asking. The stored record carries the delivery
      // OTP, and this route used to hand it to the assigned rider — the one
      // person who must not have it, because it is the only proof that the food
      // reached the customer.
      data: { order: shapeOrderForViewer(order, viewerFor(order, req.user)) },
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

    /*
     * Looked up rather than read off the order, because an order carries the
     * restaurant's NAME and not its position. Failure here is null, not an
     * error: a missing coordinate costs the first map phase, and a tracking
     * screen that 500s costs the customer everything else on it too.
     */
    const trackedRestaurant = order.restaurantId
      ? await restaurantRepository.findById(order.restaurantId).catch(() => null)
      : null;

    res.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        riderName: order.riderName ?? null,
        // Dialable while the rider is on the way and not afterwards, so a
        // delivered order does not leave a permanent phone number on a screen.
        riderPhone: visibleContact(order.riderPhone, order.status).phone,
        riderPhoneMasked: visibleContact(order.riderPhone, order.status).maskedPhone,
        /*
         * THE RIDER'S POSITION IS WITHHELD UNTIL THEY ARE CARRYING THE FOOD.
         *
         * It used to go out whenever it existed — including while the rider was
         * still riding to the restaurant, on a trip this customer's food is not
         * part of yet. Every customer with an accepted order could read a
         * rider's live coordinates from this JSON.
         *
         * Hiding it in the screen would not have hidden it. `pickedUpAt` is the
         * gate the owner described ("when driver is on its way after taking otp")
         * so it is applied where it can actually be enforced.
         *
         * The rider's STAGE still shows as words — "your rider is at the
         * restaurant" — which is what a customer actually wants and discloses
         * nothing precise.
         */
        riderCoordinates: order.pickedUpAt ? order.riderCoordinates ?? null : null,
        riderBearing: order.pickedUpAt ? order.riderBearing ?? 0 : 0,
        riderLocationUpdatedAt: order.pickedUpAt ? order.riderLocationUpdatedAt ?? null : null,
        destinationCoordinates: order.deliveryCoordinates ?? null,
        /*
         * WHERE THE FOOD IS BEING COOKED, for the map's first phase.
         *
         * The owner asked that a customer see the restaurant and the distance to
         * it from the moment the partner accepts, rather than a line of text
         * until the rider collects. This is the only backend change the whole of
         * §8B needs.
         *
         * Sent from acceptance onward rather than from placement: before anybody
         * has accepted there is nothing to show a customer about a kitchen that
         * may yet decline.
         */
        restaurantCoordinates: trackedRestaurant?.coordinates ?? null,
        restaurantName: order.restaurantName ?? null,
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
      req.body.razorpaySignature,
      { id: req.user!.id, role: req.user!.role }
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

/*
 * The statuses a partner or a customer may ask for over this route.
 *
 * A z.enum takes string literals, so this does NOT track OrderStatus and will
 * not fail to compile when that type changes. HANDED_TO_RIDER was added to the
 * type, to the state machine, to the kitchen's screen and to the admin route,
 * and omitted here - so the button existed, the transition was legal, and the
 * request was rejected with a validation error before any of that was
 * consulted. Found by driving the flow, not by the typechecker or any unit
 * test, because there is nothing here for either of them to catch.
 *
 * Anything added to OrderStatus that a partner can set has to be added here.
 */
const StatusTransitionSchema = z.object({
  status: z.enum([
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'HANDED_TO_RIDER',
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
const KITCHEN_MAY_SET = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'HANDED_TO_RIDER', 'CANCELLED'];
const KITCHEN_MAY_CANCEL_FROM = ['ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];

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
    /*
     * The kitchen's four taps, and a cancellation while the food is still
     * theirs. This used to let the kitchen move its own order to ANY state the
     * machine allowed: out for delivery with no rider, or cancelled after a
     * rider had already driven off with it.
     */
    if (!KITCHEN_MAY_SET.includes(nextStatus)) {
      throw new AppError(
        'The kitchen can accept, prepare, mark ready and hand over. The rider confirms collection and delivery.',
        403,
        'NOT_A_KITCHEN_STEP'
      );
    }
    if (nextStatus === 'HANDED_TO_RIDER' && !order.riderId) {
      throw new AppError('No rider has taken this order yet, so it cannot be handed over.', 409, 'NO_RIDER_ASSIGNED');
    }
    if (nextStatus === 'CANCELLED' && !KITCHEN_MAY_CANCEL_FROM.includes(order.status)) {
      throw new AppError(
        'The food has left the kitchen, so the kitchen can no longer cancel it. Contact Quick Bites support.',
        409,
        'KITCHEN_CANNOT_CANCEL_NOW'
      );
    }
    return;
  }

  /*
   * A rider moves an order only through the rider routes, which check the
   * pickup code, the stage and the doorstep code. Through this route an
   * assigned rider could skip the pickup code, or cancel a prepaid order they
   * were holding (with the operations reason list), so the customer was
   * refunded in full and the kitchen never paid.
   */
  if (role === 'rider') {
    throw new AppError(
      'Use the trip screen in the rider app to collect or deliver this order.',
      403,
      'RIDER_USES_TRIP_ROUTES'
    );
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


/**
 * POST /api/orders/:id/call — put the rider and the customer on a call without
 * either learning the other's number.
 *
 * The operator rings whoever tapped Call, then rings the other party and joins
 * the legs. Both handsets show the rented virtual number. Nothing in the
 * response carries a real number, so a client that logs its own responses
 * cannot leak one either.
 *
 * Refused rather than faked when no operator is configured. Pretending to mask
 * a call would be worse than not masking it: the direct number would still be
 * on the screen and everybody would believe it was hidden.
 */
orderRouter.post('/:id/call', authMiddleware(), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    /*
     * ONLY THE TWO PEOPLE ON THIS DELIVERY, AND ONLY WHILE IT IS LIVE.
     *
     * Without the first check this endpoint dials any customer on the platform
     * for anyone who can guess an order id - a cold-calling machine with our
     * own virtual number on the display. Without the second, a rider who
     * delivered last Tuesday can still ring that address today, which is the
     * exact harm masking exists to prevent.
     */
    const userId = req.user!.id;
    const isCustomer = order.customerId === userId;

    const ridersSelf = order.riderId ? await riderRepository.findById(order.riderId) : null;
    const isRider = Boolean(ridersSelf && ridersSelf.userId === userId);

    if (!isCustomer && !isRider) {
      throw new AppError('This order is not yours.', 403, 'NOT_YOUR_ORDER');
    }
    if (!isContactable(order.status)) {
      throw new AppError(
        'This delivery has finished, so the line is closed.',
        409,
        'ORDER_NOT_CONTACTABLE'
      );
    }
    if (!order.riderId || !order.riderPhone) {
      throw new AppError('No delivery partner is on this order yet.', 409, 'NO_RIDER_ASSIGNED');
    }

    if (!isCallMaskingConfigured()) {
      // Said plainly, with a code the apps read to fall back to the direct
      // number they are already allowed to show for the life of the trip.
      throw new AppError(
        'Connected calling is not switched on for this deployment.',
        503,
        'CALL_MASKING_NOT_CONFIGURED'
      );
    }

    const customerPhone = order.customerPhone || '';
    const caller = isRider ? order.riderPhone : customerPhone;
    const callee = isRider ? customerPhone : order.riderPhone;

    if (!caller || !callee) {
      throw new AppError('A number is missing for this order.', 409, 'CONTACT_UNAVAILABLE');
    }

    const result = await placeMaskedCall({
      callerNumber: caller,
      calleeNumber: callee,
      orderNumber: order.orderNumber
    });

    if (!result.ok) {
      throw new AppError(
        'Could not connect the call. Try again in a moment.',
        502,
        result.error || 'CALL_NOT_CONNECTED'
      );
    }

    res.json({
      success: true,
      data: {
        connecting: true,
        // The rented number, which is safe to show: it is the one their own
        // handset will display when the call arrives.
        displayNumber: result.displayNumber,
        callSid: result.callSid,
        message: 'Connecting your call. Answer when your phone rings.'
      }
    });
  } catch (err) {
    next(err);
  }
});
