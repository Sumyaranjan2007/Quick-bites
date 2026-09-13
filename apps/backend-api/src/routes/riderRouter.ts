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

/**
 * Every route here is mounted behind authMiddleware('rider'), which proves the caller
 * is *a* rider — not *which* rider. These endpoints used to read the rider's identity
 * out of the request body, so any signed-in rider could act as any other: toggle their
 * shift, claim on their behalf, or credit their wallet. Identity now comes from the
 * verified token, and the body fields are ignored.
 */
async function requireRiderSelf(req: any) {
  const rider = await riderRepository.findByUserId(req.user!.id);
  if (!rider) {
    throw new AppError('No rider profile exists for this account.', 404, 'RIDER_NOT_FOUND');
  }
  return rider;
}

/**
 * Trip payout, derived from the order itself rather than supplied by the caller.
 * A flat base covers the rider's time; the delivery fee the customer was charged
 * covers distance. Gold orders can carry a zero delivery fee, so the base is a floor.
 */
const RIDER_BASE_PAYOUT = 40.0;

function calculateTripPayout(order: { bill?: { deliveryFee?: number } }): number {
  const distanceComponent = Number(order.bill?.deliveryFee) || 0;
  return Math.round((RIDER_BASE_PAYOUT + Math.max(0, distanceComponent)) * 100) / 100;
}

const ShiftStatusSchema = z.object({
  isOnline: z.boolean()
});

// POST /api/riders/shift
riderRouter.post('/shift', validate({ body: ShiftStatusSchema }), async (req, res) => {
  try {
    const { isOnline } = req.body;
    const self = await requireRiderSelf(req);

    const rider = await riderRepository.updateOnlineStatus(self.id, Boolean(isOnline));
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

// GET /api/riders/profile/:userId — a rider may read only their own profile and wallet.
riderRouter.get('/profile/:userId', async (req, res) => {
  try {
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    if (req.params.userId !== req.user?.id && !isStaff) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: you can only view your own rider profile.'
      });
    }

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

// POST /api/riders/orders/:id/claim — the caller claims the order for themselves.
riderRouter.post('/orders/:id/claim', async (req, res) => {
  try {
    const self = await requireRiderSelf(req);

    const order = await orderRepository.assignRider(
      req.params.id,
      self.id,
      self.fullName || req.user!.fullName,
      self.phone
    );
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
riderRouter.post('/orders/:id/verify-pickup', validate({ body: VerifyPickupSchema }), async (req, res, next) => {
  try {
    const { pickupCode } = req.body;
    const self = await requireRiderSelf(req);

    const existing = await orderRepository.findById(req.params.id);
    if (!existing) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    if (existing.riderId !== self.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
    }

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
  } catch (err) {
    next(err);
  }
});

const VerifyOtpSchema = z.object({
  deliveryOtp: z.string().min(1, 'deliveryOtp is required')
});

// POST /api/riders/orders/:id/verify-otp
riderRouter.post('/orders/:id/verify-otp', validate({ body: VerifyOtpSchema }), async (req, res, next) => {
  try {
    const { deliveryOtp } = req.body;
    const self = await requireRiderSelf(req);

    // Only the rider carrying this order may close it out.
    const existing = await orderRepository.findById(req.params.id);
    if (!existing) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    if (existing.riderId !== self.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
    }

    const result = await orderRepository.verifyDeliveryOtp(req.params.id, deliveryOtp);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // The payout is computed server-side from the order. It used to be taken from the
    // request body along with the destination wallet, so a rider could credit any
    // account any amount simply by asking.
    await walletRepository.credit(
      req.user!.id,
      calculateTripPayout(result.order!),
      `Trip Payout for Order #${result.order!.orderNumber}`,
      result.order!.id
    );

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

    const self = await requireRiderSelf(req);

    const order = await orderRepository.findById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    // Only the rider actually carrying this order may report its position,
    // otherwise any signed-in rider could spoof another trip's location.
    if (!order.riderId) {
      throw new AppError('This order has no rider assigned.', 409, 'NO_RIDER_ASSIGNED');
    }
    if (order.riderId !== self.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
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
