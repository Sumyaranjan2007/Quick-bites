import { Router } from 'express';
import { orderService } from '../modules/orders/orderService.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { z } from 'zod';

export const orderRouter = Router();

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
  idempotencyKey: z.string().uuid('Idempotency key must be a valid UUID'),
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
