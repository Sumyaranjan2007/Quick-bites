import { Router } from 'express';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { z } from 'zod';

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
  distanceKm: z.number().positive().optional()
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
  preparationMinutes: z.number().int().positive().optional(),
  otp: z.string().length(4).optional()
});

orderRouter.put('/:id/status', authMiddleware(), validate({ body: StatusTransitionSchema }), async (req, res, next) => {
  try {
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
