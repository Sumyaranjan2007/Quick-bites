import { Router } from 'express';
import { z } from 'zod';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { emitOrderStatusUpdate, emitRiderLocation } from '../sockets/socketServer.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';

export const riderRouter = Router();

/**
 * The customer's doorstep OTP must never reach the rider's device — otherwise a rider
 * could close out a delivery without ever handing the food over. It is verified
 * server-side by POST /riders/orders/:id/verify-otp instead.
 */
function withoutDeliveryOtp<T extends { deliveryOtp?: string }>(order: T): Omit<T, 'deliveryOtp'> {
  const { deliveryOtp, ...safe } = order;
  return safe;
}

const ShiftStatusSchema = z.object({
  riderId: z.string().min(1, 'riderId is required'),
  isOnline: z.boolean()
});

// POST /api/riders/shift
riderRouter.post('/shift', validate({ body: ShiftStatusSchema }), async (req, res) => {
  try {
    const { riderId, isOnline } = req.body;

    const rider = await riderRepository.updateOnlineStatus(riderId, Boolean(isOnline));
    if (!rider) {
      return res.status(404).json({ success: false, error: 'Rider not found' });
    }

    return res.json({
      success: true,
      data: { rider },
      message: `Shift status updated to ${rider.isOnline ? 'Online' : 'Offline'}`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/riders/profile/:userId
riderRouter.get('/profile/:userId', async (req, res) => {
  try {
    const rider = await riderRepository.findByUserId(req.params.userId);
    if (!rider) {
      return res.status(404).json({ success: false, error: 'Rider profile not found' });
    }
    const wallet = await walletRepository.getByUserId(req.params.userId);
    return res.json({
      success: true,
      data: {
        rider,
        wallet
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/riders/orders/broadcast
riderRouter.get('/orders/broadcast', async (req, res) => {
  try {
    const broadcasts = await orderRepository.listAvailableBroadcasts();
    return res.json({ success: true, data: { broadcasts: broadcasts.map(withoutDeliveryOtp) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const ClaimOrderSchema = z.object({
  riderId: z.string().min(1, 'riderId is required'),
  riderName: z.string().min(1, 'riderName is required'),
  riderPhone: z.string().optional()
});

// POST /api/riders/orders/:id/claim
riderRouter.post('/orders/:id/claim', validate({ body: ClaimOrderSchema }), async (req, res) => {
  try {
    const { riderId, riderName, riderPhone } = req.body;

    const order = await orderRepository.assignRider(req.params.id, riderId, riderName, riderPhone);
    if (!order) {
      return res.status(409).json({ success: false, error: 'Order has already been claimed by another rider or does not exist' });
    }

    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'RIDER_ASSIGNED',
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: { order: withoutDeliveryOtp(order) },
      message: 'Order successfully claimed. Navigate to restaurant pickup counter.'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const VerifyPickupSchema = z.object({
  pickupCode: z.string().min(1, 'pickupCode is required')
});

// POST /api/riders/orders/:id/verify-pickup
riderRouter.post('/orders/:id/verify-pickup', validate({ body: VerifyPickupSchema }), async (req, res) => {
  try {
    const { pickupCode } = req.body;

    const result = await orderRepository.verifyPickup(req.params.id, pickupCode);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    emitOrderStatusUpdate(result.order!.id, {
      orderId: result.order!.id,
      status: 'OUT_FOR_DELIVERY',
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: { order: withoutDeliveryOtp(result.order!) },
      message: 'Pickup verified. Order is now out for delivery.'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const VerifyOtpSchema = z.object({
  deliveryOtp: z.string().min(1, 'deliveryOtp is required'),
  riderUserId: z.string().optional(),
  tripEarnings: z.number().positive().optional()
});

// POST /api/riders/orders/:id/verify-otp
riderRouter.post('/orders/:id/verify-otp', validate({ body: VerifyOtpSchema }), async (req, res) => {
  try {
    const { deliveryOtp, riderUserId, tripEarnings } = req.body;

    const result = await orderRepository.verifyDeliveryOtp(req.params.id, deliveryOtp);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Credit trip earnings to rider wallet
    if (riderUserId) {
      const payout = tripEarnings ? Number(tripEarnings) : 65.00;
      await walletRepository.credit(
        riderUserId,
        payout,
        `Trip Payout for Order #${result.order!.orderNumber}`,
        result.order!.id
      );
    }

    emitOrderStatusUpdate(result.order!.id, {
      orderId: result.order!.id,
      status: 'DELIVERED',
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: { order: result.order },
      message: 'Doorstep OTP verified! Order marked DELIVERED and earnings credited.'
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const TelemetrySchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  lat: z.number(),
  lng: z.number(),
  bearing: z.number().optional()
});

// POST /api/riders/telemetry
riderRouter.post('/telemetry', validate({ body: TelemetrySchema }), async (req, res, next) => {
  try {
    const { orderId, lat, lng, bearing } = req.body;

    const order = await orderRepository.findById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    // Only the rider actually carrying this order may report its position,
    // otherwise any signed-in rider could spoof another trip's location.
    if (!order.riderId) {
      throw new AppError('This order has no rider assigned.', 409, 'NO_RIDER_ASSIGNED');
    }

    const updatedAt = new Date().toISOString();
    const coords = { latitude: Number(lat), longitude: Number(lng) };

    // Persist, so a customer who opens the app mid-trip sees the last known
    // position instead of nothing. Previously this was emit-only: the reading
    // was broadcast to a socket room and then thrown away.
    await riderRepository.updateLocation(order.riderId, coords);
    await orderRepository.updateRiderLocation(orderId, coords, bearing ? Number(bearing) : 0, updatedAt);

    emitRiderLocation(orderId, {
      orderId,
      lat: coords.latitude,
      lng: coords.longitude,
      bearing: bearing ? Number(bearing) : 0,
      updatedAt
    });

    return res.json({ success: true, data: { updatedAt } });
  } catch (err) {
    next(err);
  }
});
