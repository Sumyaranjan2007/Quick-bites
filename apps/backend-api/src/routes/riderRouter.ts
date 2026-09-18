import { Router } from 'express';
import { z } from 'zod';
import {
  riderRepository,
  MANDATORY_RIDER_DOCUMENTS,
  RIDER_DOCUMENT_TYPES
} from '../db/repositories/riderRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { payoutRepository } from '../db/repositories/payoutRepository.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import {
  emitOrderStatusUpdate,
  emitRiderLocation,
  emitOrderAvailableForPickup,
  emitSosAlert,
  setRiderOfferPoolMembership
} from '../sockets/socketServer.ts';
import {
  computeRiderMetrics,
  evaluateIncentives,
  summariseTrip,
  startOfIstWeek
} from '../modules/riders/riderMetrics.ts';
import { RIDER_POLICIES, findPolicy } from '../modules/riders/riderPolicies.ts';
import { memoryStore, triggerAutoSave, calculateDistanceKm } from '../db/client.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import type { DeliveryRider, Order, SosAlert } from '@quick-bites/shared-types';

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
async function requireRiderSelf(req: any): Promise<DeliveryRider> {
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
 *
 * The customer's tip is added on top, in full and untouched. The platform takes
 * nothing from it: a tip with a commission deducted is not a tip, and a rider
 * who works that out once stops believing the earnings screen.
 */
const RIDER_BASE_PAYOUT = 40.0;

function calculateTripPayout(order: { bill?: { deliveryFee?: number; tipAmount?: number } }): number {
  const distanceComponent = Number(order.bill?.deliveryFee) || 0;
  const tip = Math.max(0, Number(order.bill?.tipAmount) || 0);
  return Math.round((RIDER_BASE_PAYOUT + Math.max(0, distanceComponent) + tip) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Profile completeness
// ---------------------------------------------------------------------------

/**
 * A rider may not go on shift until operations know who is turning up at the
 * customer's door: a real name, a photograph, a partner ID, and the licence and
 * registration approved. The app enforces the same list, but the rule lives here
 * because the app is the part a determined rider can modify.
 */
export interface ProfileCompletion {
  complete: boolean;
  missing: string[];
  requirements: Array<{ key: string; label: string; satisfied: boolean; detail?: string }>;
}

async function assessProfile(rider: DeliveryRider): Promise<ProfileCompletion> {
  const documents = await kycRepository.findByEntity('RIDER', rider.id);
  const approved = (type: string) =>
    documents.find(d => d.documentType === type && d.status === 'APPROVED');
  const submitted = (type: string) => documents.find(d => d.documentType === type);

  const requirements = [
    {
      key: 'fullName',
      label: 'Full name',
      satisfied: Boolean(rider.fullName && rider.fullName.trim().length >= 3),
      detail: rider.fullName
    },
    {
      key: 'profilePhoto',
      label: 'Profile photo',
      satisfied: Boolean(rider.profilePhotoUrl),
      detail: rider.profilePhotoUrl ? 'Uploaded' : undefined
    },
    {
      key: 'driverCode',
      label: 'Delivery partner ID',
      satisfied: Boolean(rider.driverCode),
      detail: rider.driverCode
    },
    {
      key: 'phone',
      label: 'Phone number',
      satisfied: Boolean(rider.phone && rider.phone.replace(/\D/g, '').length >= 10),
      detail: rider.phone
    },
    ...MANDATORY_RIDER_DOCUMENTS.map(type => ({
      key: type,
      label: type === 'DRIVING_LICENSE' ? 'Driving licence' : 'Vehicle registration (RC)',
      satisfied: Boolean(approved(type)),
      detail: submitted(type)
        ? `${submitted(type)!.status.charAt(0) + submitted(type)!.status.slice(1).toLowerCase()}`
        : 'Not uploaded'
    }))
  ];

  const missing = requirements.filter(r => !r.satisfied).map(r => r.label);
  return { complete: missing.length === 0, missing, requirements };
}

/** Records the moment a profile first became complete, for the admin queue. */
async function refreshProfileCompletion(rider: DeliveryRider): Promise<ProfileCompletion> {
  const completion = await assessProfile(rider);
  if (completion.complete && !rider.profileCompletedAt) {
    await riderRepository.update(rider.id, { profileCompletedAt: new Date().toISOString() });
  } else if (!completion.complete && rider.profileCompletedAt) {
    await riderRepository.update(rider.id, { profileCompletedAt: undefined });
  }
  return completion;
}

// ---------------------------------------------------------------------------
// Trip shaping
// ---------------------------------------------------------------------------

/**
 * The rider's view of an order.
 *
 * The pickup half used to be missing entirely: the app fell back to the words
 * "Restaurant pickup counter" and a made-up 3.5 km, so an accepted trip gave the
 * rider no address to head for and nothing to hand to a maps app. The
 * restaurant's address and coordinates are put on the order when it is created;
 * older orders are backfilled from the restaurant record here.
 */
async function shapeTripForRider(order: Order) {
  let pickupAddress = order.restaurantAddressText;
  let pickupCoordinates = order.restaurantCoordinates;
  let pickupPhone = order.restaurantPhone;

  if (!pickupAddress || !pickupCoordinates) {
    const restaurant = await restaurantRepository.findById(order.restaurantId);
    if (restaurant) {
      pickupAddress = pickupAddress || [restaurant.addressLine, restaurant.city, restaurant.pincode]
        .filter(Boolean)
        .join(', ');
      pickupCoordinates = pickupCoordinates || restaurant.coordinates;
      pickupPhone = pickupPhone || restaurant.phone;
    }
  }

  const distanceKm = order.distanceKm ??
    (pickupCoordinates && order.deliveryCoordinates
      ? calculateDistanceKm(
          pickupCoordinates.latitude,
          pickupCoordinates.longitude,
          order.deliveryCoordinates.latitude,
          order.deliveryCoordinates.longitude
        )
      : undefined);

  const isCod = order.paymentMethod === 'CASH_ON_DELIVERY';

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    stage: order.riderStage || 'HEADING_TO_RESTAURANT',
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName || 'Restaurant partner',
    pickupAddress: pickupAddress || 'Restaurant pickup counter',
    pickupCoordinates,
    pickupPhone,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    dropAddress: order.deliveryAddressText || 'Customer doorstep',
    dropCoordinates: order.deliveryCoordinates,
    distanceKm,
    itemCount: (order.items || []).reduce((t, i) => t + (i.quantity || 0), 0),
    items: (order.items || []).map(i => ({ name: i.name, quantity: i.quantity })),
    estimatedEarnings: order.riderPayout ?? calculateTripPayout(order),
    paymentMode: isCod ? 'COD' : 'PREPAID',
    cashToCollect: isCod ? Number(order.bill?.totalAmount) || 0 : 0,
    orderTotal: Number(order.bill?.totalAmount) || 0,
    placedAt: order.createdAt,
    assignedAt: order.riderAssignedAt,
    pickedUpAt: order.pickedUpAt,
    deliveredAt: order.deliveredAt
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** GET /api/riders/me — the signed-in rider's profile, wallet and readiness. */
riderRouter.get('/me', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const [wallet, completion, documents] = await Promise.all([
      walletRepository.getByUserId(rider.userId),
      refreshProfileCompletion(rider),
      kycRepository.findByEntity('RIDER', rider.id)
    ]);
    const user = await userRepository.findById(rider.userId);

    res.json({
      success: true,
      data: {
        rider: { ...rider, email: user?.email },
        wallet,
        profile: completion,
        documents: documents.sort((a, b) => a.documentType.localeCompare(b.documentType))
      }
    });
  } catch (err) {
    next(err);
  }
});

const ProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name as printed on your licence.').max(80).optional(),
  phone: z.string().trim().min(10, 'Enter a valid phone number.').max(20).optional(),
  vehicleType: z.enum(['BIKE', 'EV', 'CYCLE']).optional(),
  licenseNumber: z.string().trim().min(4).max(40).optional(),
  vehicleRcNumber: z.string().trim().min(4).max(40).optional(),
  /** A data URI. Capped well below the 1 MB body limit so a large photo fails
   *  with a readable message rather than a truncated request. */
  profilePhotoUrl: z
    .string()
    .max(700_000, 'That photo is too large. Take a new one from inside the app.')
    .refine(v => v.startsWith('data:image/'), 'Profile photo must be an image.')
    .optional()
});

/** PATCH /api/riders/me — the rider edits their own profile. */
riderRouter.patch('/me', validate({ body: ProfileUpdateSchema }), async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const patch = { ...req.body } as Partial<DeliveryRider>;

    const updated = await riderRepository.update(rider.id, patch);
    if (!updated) throw new AppError('Rider profile not found.', 404, 'RIDER_NOT_FOUND');

    // Keep the login account's name in step, so the name on an order matches
    // the name on the badge the customer is shown.
    if (patch.fullName) {
      await userRepository.update(rider.userId, { fullName: patch.fullName });
    }

    const completion = await refreshProfileCompletion(updated);
    res.json({
      success: true,
      data: { rider: updated, profile: completion },
      message: 'Profile updated.'
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DOCUMENT_GUIDE: Record<string, { label: string; required: boolean; instructions: string }> = {
  DRIVING_LICENSE: {
    label: 'Driving licence',
    required: true,
    instructions:
      'Photograph the front of your licence on a flat surface. All four corners must be visible and the licence number readable. Expired licences are rejected.'
  },
  VEHICLE_RC: {
    label: 'Vehicle registration (RC)',
    required: true,
    instructions:
      'Photograph the RC card for the vehicle you deliver on. The registration number must match the number on your profile.'
  },
  AADHAAR: {
    label: 'Aadhaar card',
    required: false,
    instructions:
      'Used to confirm your identity and address. Mask the first eight digits — Quick Bites only needs the last four.'
  },
  PAN: {
    label: 'PAN card',
    required: false,
    instructions: 'Needed before payouts cross Rs 20,000 in a financial year.'
  },
  INSURANCE: {
    label: 'Vehicle insurance',
    required: false,
    instructions: 'Upload the current policy schedule. We will remind you two weeks before it expires.'
  }
};

/** GET /api/riders/documents — what is required, what is uploaded, what state it is in. */
riderRouter.get('/documents', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const documents = await kycRepository.findByEntity('RIDER', rider.id);

    const checklist = RIDER_DOCUMENT_TYPES.map(type => {
      const latest = documents
        .filter(d => d.documentType === type)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];
      const guide = DOCUMENT_GUIDE[type];
      return {
        documentType: type,
        label: guide.label,
        required: guide.required,
        instructions: guide.instructions,
        status: latest?.status || 'NOT_UPLOADED',
        documentNumber: latest?.documentNumber,
        rejectionReason: latest?.rejectionReason,
        submittedAt: latest?.submittedAt,
        reviewedAt: latest?.reviewedAt,
        // Rejected papers must be replaceable, otherwise a rider whose licence
        // photo was blurred is stuck with no way back onto the road.
        canReupload: !latest || latest.status === 'REJECTED'
      };
    });

    res.json({ success: true, data: { documents: checklist } });
  } catch (err) {
    next(err);
  }
});

const DocumentUploadSchema = z.object({
  documentType: z.enum(RIDER_DOCUMENT_TYPES),
  documentNumber: z.string().trim().min(4, 'Enter the number printed on the document.').max(40),
  fileUrl: z
    .string()
    .max(700_000, 'That photo is too large. Take a new one from inside the app.')
    .refine(v => v.startsWith('data:image/') || /^https?:\/\//.test(v), 'Upload a photo of the document.')
});

/** POST /api/riders/documents — upload or replace one document. */
riderRouter.post('/documents', validate({ body: DocumentUploadSchema }), async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const { documentType, documentNumber, fileUrl } = req.body;

    const existing = await kycRepository.findByEntity('RIDER', rider.id);
    const current = existing
      .filter(d => d.documentType === documentType)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

    // An approved document is not silently replaceable: a rider could otherwise
    // pass verification on a real licence and then swap in someone else's.
    if (current && current.status === 'APPROVED') {
      throw new AppError(
        'That document is already approved. Contact support to replace it.',
        409,
        'DOCUMENT_ALREADY_APPROVED'
      );
    }
    if (current && current.status === 'PENDING') {
      memoryStore.kycDocuments.delete(current.id);
    }

    const doc = await kycRepository.submitDocument({
      entityType: 'RIDER',
      entityId: rider.id,
      entityName: rider.fullName,
      documentType,
      documentNumber,
      entityPhone: rider.phone,
      fileUrl
    });

    // Mirror the number onto the profile so the rest of the app can show it.
    if (documentType === 'DRIVING_LICENSE') {
      await riderRepository.update(rider.id, { licenseNumber: documentNumber });
    } else if (documentType === 'VEHICLE_RC') {
      await riderRepository.update(rider.id, { vehicleRcNumber: documentNumber });
    }

    const refreshed = (await riderRepository.findById(rider.id))!;
    const completion = await refreshProfileCompletion(refreshed);

    res.status(201).json({
      success: true,
      data: { document: doc, profile: completion },
      message: 'Document submitted for verification.'
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

const ShiftStatusSchema = z.object({
  isOnline: z.boolean()
});

/**
 * POST /api/riders/shift
 *
 * The answer this returns is read back from the stored rider, so the app can
 * only ever show what the server actually recorded. The toggle previously
 * flipped the app's own state first and kept it even when the write behind it
 * failed, which is how a rider ended up "Online" on their screen while dispatch
 * still had them at home.
 */
riderRouter.post('/shift', validate({ body: ShiftStatusSchema }), async (req, res, next) => {
  try {
    const { isOnline } = req.body;
    const self = await requireRiderSelf(req);

    if (isOnline) {
      const completion = await assessProfile(self);
      if (!completion.complete) {
        throw new AppError(
          `Finish your profile before going online: ${completion.missing.join(', ')}.`,
          409,
          'PROFILE_INCOMPLETE'
        );
      }
      if (self.kycStatus !== 'ACTIVE') {
        throw new AppError(
          'Your account is still being verified. You will be able to go online once operations approve it.',
          409,
          'KYC_NOT_ACTIVE'
        );
      }
    }

    const rider = await riderRepository.updateOnlineStatus(self.id, Boolean(isOnline));
    if (!rider) throw new AppError('Rider profile not found.', 404, 'RIDER_NOT_FOUND');

    // The offer pool follows the shift toggle. The app asks to join once, when
    // its socket connects, which for a rider who opened the app before starting
    // work happens while they are still off shift and is refused. Moving them
    // here means going online is enough, and going offline actually stops the
    // offers rather than leaving a socket subscribed until it reconnects.
    setRiderOfferPoolMembership(req.user!.id, rider.isOnline);

    res.json({
      success: true,
      data: { rider, isOnline: rider.isOnline },
      message: `You are now ${rider.isOnline ? 'Online' : 'Offline'}.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/riders/logout
 *
 * Signing out takes the rider off the dispatch list. Without this a rider who
 * closed the app stayed "Online" forever and kept being counted as available.
 */
riderRouter.post('/logout', async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    await riderRepository.updateOnlineStatus(self.id, false);
    setRiderOfferPoolMembership(req.user!.id, false);
    res.json({ success: true, message: 'Signed out and taken off shift.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/riders/profile/:userId — a rider may read only their own profile and wallet.
riderRouter.get('/profile/:userId', async (req, res, next) => {
  try {
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    if (req.params.userId !== req.user?.id && !isStaff) {
      throw new AppError('You can only view your own rider profile.', 403, 'FORBIDDEN');
    }

    const rider = await riderRepository.findByUserId(req.params.userId);
    if (!rider) throw new AppError('Rider profile not found.', 404, 'RIDER_NOT_FOUND');

    const wallet = await walletRepository.getByUserId(req.params.userId);
    const profile = await assessProfile(rider);
    res.json({ success: true, data: { rider, wallet, profile } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * GET /api/riders/dashboard
 *
 * One call behind every number on the rider's home screen. It is re-fetched
 * after each accept, delivery and cancellation, so the dashboard reflects the
 * trip that just happened rather than a figure the app has been carrying since
 * it launched.
 */
riderRouter.get('/dashboard', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const [{ metrics, delivered, activeOrder }, wallet, completion] = await Promise.all([
      computeRiderMetrics(rider),
      walletRepository.getByUserId(rider.userId),
      refreshProfileCompletion(rider)
    ]);

    // Evaluating here as well as after a delivery means a target that became
    // reachable some other way — a rating arriving late, a trip closed by
    // support — still pays out the next time the rider looks at the screen.
    const { incentives } = await evaluateIncentives(rider);

    const recentTrips = delivered.slice(0, 5).map(summariseTrip);

    res.json({
      success: true,
      data: {
        rider,
        wallet,
        profile: completion,
        metrics: { ...metrics, walletBalance: wallet.balance, codCashInHand: rider.codCashInHand || 0 },
        incentives,
        activeOrder: activeOrder ? await shapeTripForRider(activeOrder) : null,
        recentTrips,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/trips?range=today|week|all — the trip history behind the numbers. */
riderRouter.get('/trips', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const range = String(req.query.range || 'week');
    const orders = await orderRepository.listByRiderId(rider.id);
    const delivered = orders.filter(o => o.status === 'DELIVERED');

    const weekStart = startOfIstWeek().getTime();
    const filtered = range === 'all'
      ? delivered
      : delivered.filter(o => new Date(o.deliveredAt || o.updatedAt).getTime() >= weekStart);

    const trips = filtered.map(summariseTrip);
    const totals = {
      trips: trips.length,
      earnings: Math.round(trips.reduce((t, x) => t + x.payout, 0) * 100) / 100,
      distanceKm: Math.round(trips.reduce((t, x) => t + (x.distanceKm || 0), 0) * 10) / 10,
      cashCollected: Math.round(trips.reduce((t, x) => t + x.cashCollected, 0) * 100) / 100
    };

    // Trips per weekday, so the weekly view can be read at a glance.
    const byDay = Array.from({ length: 7 }, (_, index) => {
      const dayStart = weekStart + index * 24 * 60 * 60_000;
      const dayEnd = dayStart + 24 * 60 * 60_000;
      const dayTrips = trips.filter(t => {
        const at = new Date(t.deliveredAt || 0).getTime();
        return at >= dayStart && at < dayEnd;
      });
      return {
        day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index],
        trips: dayTrips.length,
        earnings: Math.round(dayTrips.reduce((t, x) => t + x.payout, 0) * 100) / 100
      };
    });

    res.json({ success: true, data: { range, trips, totals, byDay } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/ratings — every star and comment a customer left for this rider. */
riderRouter.get('/ratings', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const orders = await orderRepository.listByRiderId(rider.id);
    const rated = orders
      .filter(o => o.status === 'DELIVERED' && typeof o.riderRating === 'number')
      .sort((a, b) => new Date(b.ratedAt || b.deliveredAt || 0).getTime() - new Date(a.ratedAt || a.deliveredAt || 0).getTime());

    const distribution = [5, 4, 3, 2, 1].map(stars => ({
      stars,
      count: rated.filter(o => Math.round(o.riderRating as number) === stars).length
    }));

    const average = rated.length
      ? Math.round((rated.reduce((t, o) => t + (o.riderRating as number), 0) / rated.length) * 10) / 10
      : null;

    res.json({
      success: true,
      data: {
        average,
        total: rated.length,
        distribution,
        reviews: rated.slice(0, 50).map(o => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          rating: o.riderRating,
          comment: o.riderRatingComment || o.ratingComment || null,
          customerName: o.customerName,
          restaurantName: o.restaurantName,
          ratedAt: o.ratedAt || o.deliveredAt
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/incentives — targets, progress and what has already been paid. */
riderRouter.get('/incentives', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const { incentives } = await evaluateIncentives(rider);
    const earned = incentives.filter(i => i.paid);
    res.json({
      success: true,
      data: {
        incentives,
        earnedThisPeriod: Math.round(earned.reduce((t, i) => t + i.reward, 0) * 100) / 100,
        nextTarget: incentives.find(i => !i.achieved) || null
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/policies — the rider-facing policy library. */
riderRouter.get('/policies', (_req, res) => {
  res.json({
    success: true,
    data: {
      policies: RIDER_POLICIES.map(({ id, title, summary, updatedAt }) => ({ id, title, summary, updatedAt }))
    }
  });
});

/** GET /api/riders/policies/:id — one policy in full. */
riderRouter.get('/policies/:id', (req, res, next) => {
  const policy = findPolicy(req.params.id);
  if (!policy) {
    next(new AppError('Policy not found.', 404, 'POLICY_NOT_FOUND'));
    return;
  }
  res.json({ success: true, data: { policy } });
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * GET /api/riders/orders/broadcast
 *
 * Trips on offer. Every trip returned is counted, once, as an offer made to
 * this rider — that count is the denominator of the acceptance rate. Riders who
 * are off shift are shown nothing, because accepting work while marked offline
 * is exactly the inconsistency the status toggle is supposed to prevent.
 */
riderRouter.get('/orders/broadcast', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);

    if (!rider.isOnline) {
      res.json({ success: true, data: { broadcasts: [], offline: true } });
      return;
    }

    // A rider already carrying an order is not offered another one.
    const mine = await orderRepository.listByRiderId(rider.id);
    if (mine.some(o => o.status === 'RIDER_ASSIGNED' || o.status === 'OUT_FOR_DELIVERY')) {
      res.json({ success: true, data: { broadcasts: [], busy: true } });
      return;
    }

    const broadcasts = await orderRepository.listAvailableBroadcasts(rider.id);
    const shaped = await Promise.all(broadcasts.map(o => shapeTripForRider(withoutDeliveryOtp(o) as Order)));

    for (const order of broadcasts) {
      const isNew = await orderRepository.markOfferedToRider(order.id, rider.id);
      if (isNew) await riderRepository.recordOffer(rider.id);
    }

    res.json({ success: true, data: { broadcasts: shaped } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/orders/active — the trip in progress, so a restart resumes it. */
riderRouter.get('/orders/active', async (req, res, next) => {
  try {
    const rider = await requireRiderSelf(req);
    const orders = await orderRepository.listByRiderId(rider.id);
    const active = orders.find(o => o.status === 'RIDER_ASSIGNED' || o.status === 'OUT_FOR_DELIVERY');
    res.json({
      success: true,
      data: { order: active ? await shapeTripForRider(withoutDeliveryOtp(active) as Order) : null }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/riders/orders/:id/claim — the caller claims the order for themselves.
riderRouter.post('/orders/:id/claim', async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);

    if (!self.isOnline) {
      throw new AppError('Go online before accepting a trip.', 409, 'RIDER_OFFLINE');
    }
    const completion = await assessProfile(self);
    if (!completion.complete) {
      throw new AppError(
        `Finish your profile before accepting trips: ${completion.missing.join(', ')}.`,
        409,
        'PROFILE_INCOMPLETE'
      );
    }

    const target = await orderRepository.findById(req.params.id);
    if (!target) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    const payout = calculateTripPayout(target);
    const order = await orderRepository.assignRider(
      req.params.id,
      self.id,
      self.fullName || req.user!.fullName,
      self.phone,
      payout
    );
    if (!order) {
      throw new AppError(
        'That trip has already been claimed by another rider.',
        409,
        'ALREADY_CLAIMED'
      );
    }

    // Counts toward the acceptance rate. A trip taken straight off the list
    // without having been counted as an offer is counted as both.
    const wasOffered = (order.offeredToRiderIds || []).includes(self.id);
    if (!wasOffered) await orderRepository.markOfferedToRider(order.id, self.id);
    await riderRepository.recordAcceptance(self.id, !wasOffered);

    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'RIDER_ASSIGNED',
      updatedAt: new Date().toISOString(),
      restaurantId: order.restaurantId
    });

    res.json({
      success: true,
      data: { order: await shapeTripForRider(withoutDeliveryOtp(order) as Order) },
      message: 'Trip accepted. Head to the restaurant to collect.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/riders/orders/:id/decline
 *
 * Passing on a trip is recorded rather than just dismissed on the device: the
 * trip stops being offered back to this rider, and the pass is counted against
 * their acceptance rate.
 */
riderRouter.post('/orders/:id/decline', async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.riderId === self.id) {
      throw new AppError('You have already accepted this trip.', 409, 'ALREADY_ASSIGNED');
    }

    const wasOffered = (order.offeredToRiderIds || []).includes(self.id);
    if (!wasOffered) {
      await orderRepository.markOfferedToRider(order.id, self.id);
      await riderRepository.recordOffer(self.id);
    }
    await orderRepository.declineByRider(order.id, self.id);

    res.json({ success: true, message: 'Trip passed. It has been offered to other riders.' });
  } catch (err) {
    next(err);
  }
});

const StageSchema = z.object({
  stage: z.enum(['HEADING_TO_RESTAURANT', 'AT_RESTAURANT', 'OUT_FOR_DELIVERY', 'AT_DOORSTEP'])
});

/**
 * POST /api/riders/orders/:id/stage
 *
 * Where the rider is in the trip. Held server-side so a rider who reinstalls
 * mid-delivery resumes at the step they had reached, instead of being sent back
 * to the restaurant.
 */
riderRouter.post('/orders/:id/stage', validate({ body: StageSchema }), async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.riderId !== self.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
    }
    // Pickup and delivery move the trip on through their own verified routes;
    // letting this endpoint jump straight to them would skip the codes.
    if (req.body.stage === 'OUT_FOR_DELIVERY' && order.status !== 'OUT_FOR_DELIVERY') {
      throw new AppError('Verify the pickup code first.', 409, 'PICKUP_NOT_VERIFIED');
    }

    const updated = await orderRepository.setRiderStage(order.id, req.body.stage);
    res.json({ success: true, data: { stage: updated!.riderStage } });
  } catch (err) {
    next(err);
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
      throw new AppError(result.error || 'Invalid pickup code.', 400, 'INVALID_PICKUP_CODE');
    }

    emitOrderStatusUpdate(result.order!.id, {
      orderId: result.order!.id,
      status: 'OUT_FOR_DELIVERY',
      updatedAt: new Date().toISOString(),
      restaurantId: result.order!.restaurantId
    });

    res.json({
      success: true,
      data: { order: await shapeTripForRider(withoutDeliveryOtp(result.order!) as Order) },
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
      throw new AppError(result.error || 'Invalid delivery OTP.', 400, 'INVALID_OTP');
    }

    // The payout is computed server-side from the order. It used to be taken from the
    // request body along with the destination wallet, so a rider could credit any
    // account any amount simply by asking.
    const payout = result.order!.riderPayout ?? calculateTripPayout(result.order!);
    const wallet = await walletRepository.credit(
      req.user!.id,
      payout,
      `Trip Payout for Order #${result.order!.orderNumber}`,
      result.order!.id
    );

    // Cash the rider is now holding is tracked on the server, so it survives the
    // app being closed and can be offset against the next payout.
    const cashCollected = result.order!.paymentMethod === 'CASH_ON_DELIVERY'
      ? Number(result.order!.bill?.totalAmount) || 0
      : 0;
    if (cashCollected > 0) {
      await riderRepository.adjustCashInHand(self.id, cashCollected);
    }

    emitOrderStatusUpdate(result.order!.id, {
      orderId: result.order!.id,
      status: 'DELIVERED',
      updatedAt: new Date().toISOString(),
      restaurantId: result.order!.restaurantId
    });

    // The completed trip immediately moves every number the rider is measured
    // on, including any incentive it just completed.
    const refreshed = (await riderRepository.findById(self.id))!;
    const { newlyAwarded } = await evaluateIncentives(refreshed);
    const { metrics } = await computeRiderMetrics(refreshed);
    const finalWallet = await walletRepository.getByUserId(req.user!.id);

    res.json({
      success: true,
      data: {
        order: result.order,
        payout,
        walletBalance: finalWallet?.balance ?? wallet?.balance ?? null,
        cashCollected,
        codCashInHand: refreshed.codCashInHand || 0,
        metrics,
        incentivesAwarded: newlyAwarded
      },
      message: 'Doorstep OTP verified! Order marked DELIVERED and earnings credited.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/riders/orders/:id/cancel
 *
 * A trip a rider genuinely cannot finish — a breakdown, an unsafe address —
 * goes back to dispatch rather than being abandoned silently. The order returns
 * to the broadcast pool and every rider on shift is told about it again.
 */
const CancelSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us briefly why.').max(200)
});

riderRouter.post('/orders/:id/cancel', validate({ body: CancelSchema }), async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.riderId !== self.id) {
      throw new AppError('This order is not assigned to you.', 403, 'NOT_YOUR_DELIVERY');
    }
    if (order.status === 'DELIVERED') {
      throw new AppError('That order has already been delivered.', 409, 'ALREADY_DELIVERED');
    }

    order.riderId = undefined;
    order.riderName = undefined;
    order.riderPhone = undefined;
    order.riderStage = undefined;
    order.riderAssignedAt = undefined;
    order.cancellationReason = req.body.reason;
    order.cancelledAt = new Date().toISOString();
    // Back into the pool the kitchen released it into, so dispatch can offer it
    // to somebody else. Food already collected still has to reach the customer,
    // so the reason is kept on the order for operations to chase.
    order.status = 'READY_FOR_PICKUP';
    order.declinedByRiderIds = Array.from(new Set([...(order.declinedByRiderIds || []), self.id]));
    order.updatedAt = order.cancelledAt;
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();

    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'READY_FOR_PICKUP',
      updatedAt: order.updatedAt,
      restaurantId: order.restaurantId
    });
    emitOrderAvailableForPickup({
      id: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurantName
    });

    const { metrics } = await computeRiderMetrics((await riderRepository.findById(self.id))!);
    res.json({
      success: true,
      data: { metrics },
      message: 'Trip released back to dispatch.'
    });
  } catch (err) {
    next(err);
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
    // Tracking begins at pickup, as it does on every delivery app a customer
    // has used: the map appears when the food is actually moving. It is also
    // the rider's own privacy — where they are while waiting at a kitchen, or
    // between trips, is not something the customer is entitled to watch. This
    // is the path the rider app actually uses (the socket event is gated the
    // same way in socketAuth.ts); leaving it open here would have made that
    // gate decorative.
    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new AppError(
        'Live tracking starts once the order has been collected.',
        409,
        'NOT_YET_OUT_FOR_DELIVERY'
      );
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

    res.json({ success: true, data: { updatedAt } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Safety & SOS
// ---------------------------------------------------------------------------

const SosSchema = z.object({
  category: z.enum(['ACCIDENT', 'UNSAFE_LOCATION', 'MEDICAL', 'VEHICLE_BREAKDOWN', 'HARASSMENT', 'OTHER']),
  note: z.string().trim().max(500).optional(),
  orderId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional()
});

/**
 * POST /api/riders/sos
 *
 * Raises an emergency with operations. Distinct from the support thread on an
 * order on purpose: this reaches the control room immediately, carries the
 * rider's live position, and is never queued behind ordinary questions.
 */
riderRouter.post('/sos', validate({ body: SosSchema }), async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const { category, note, orderId, lat, lng } = req.body;

    const coordinates = typeof lat === 'number' && typeof lng === 'number'
      ? { latitude: lat, longitude: lng }
      : self.currentCoordinates;

    const alert: SosAlert = {
      id: `sos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      riderId: self.id,
      riderName: self.fullName,
      riderPhone: self.phone,
      userId: self.userId,
      orderId,
      category,
      note,
      coordinates,
      status: 'OPEN',
      raisedAt: new Date().toISOString()
    };

    memoryStore.sosAlerts.set(alert.id, alert);
    triggerAutoSave();
    if (coordinates) await riderRepository.updateLocation(self.id, coordinates);
    emitSosAlert(alert);

    res.status(201).json({
      success: true,
      data: { alert },
      message: 'Operations have been alerted and will call you on your registered number.'
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/riders/sos — the rider's own alert history. */
riderRouter.get('/sos', async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const alerts: SosAlert[] = [];
    for (const alert of memoryStore.sosAlerts.values()) {
      if (alert.riderId === self.id) alerts.push(alert);
    }
    alerts.sort((a, b) => new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime());
    res.json({ success: true, data: { alerts } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/riders/settlements — what the platform owes this rider, and what it
 * has already paid.
 *
 * The rider app could show earnings and a wallet balance, but nothing about
 * settlement: a rider could see that they had earned money without being able to
 * see whether it had been paid, when, or against which trips. The figures come
 * from the same records the admin console drafts payouts from, so both sides are
 * reading one ledger rather than two that can disagree.
 */
riderRouter.get('/settlements', async (req, res, next) => {
  try {
    const self = await requireRiderSelf(req);
    const trips = (await orderRepository.listByRiderId(self.id)).filter(o => o.status === 'DELIVERED');
    const unsettled = trips.filter(o => !o.payoutId);
    const payouts = await payoutRepository.list({ riderId: self.id });

    const pendingAmount = Math.round(unsettled.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100;
    const paidToDate = await payoutRepository.paidTotal(self.id);

    // Cash taken at the door belongs to the platform and is netted off the next
    // payout. Showing it here is the difference between a rider understanding
    // their settlement and being surprised by a deduction.
    const cashInHand =
      Math.round(
        unsettled
          .filter(o => o.paymentMethod === 'CASH_ON_DELIVERY')
          .reduce((t, o) => t + (Number(o.bill?.totalAmount) || 0), 0) * 100
      ) / 100;

    const incentives = Array.from(memoryStore.riderIncentives.values()).filter(
      (i: any) => i.riderId === self.id
    );
    const incentivesPending =
      Math.round(incentives.filter((i: any) => !i.payoutId).reduce((t: number, i: any) => t + (i.amount || 0), 0) * 100) /
      100;

    res.json({
      success: true,
      data: {
        summary: {
          tripsAllTime: trips.length,
          tripsAwaitingSettlement: unsettled.length,
          tripEarningsPending: pendingAmount,
          incentivesPending,
          cashInHand,
          /** What a payout drafted right now would transfer. */
          netPending: Math.round((pendingAmount + incentivesPending - cashInHand) * 100) / 100,
          paidToDate,
          lastSettledAt: payouts.find(p => p.status === 'PAID')?.paidAt || null
        },
        history: payouts,
        pendingTrips: unsettled.map(o => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          deliveredAt: o.deliveredAt || o.updatedAt,
          earning: Number(o.riderPayout) || 0,
          paymentMethod: o.paymentMethod,
          cashCollected: o.paymentMethod === 'CASH_ON_DELIVERY' ? Number(o.bill?.totalAmount) || 0 : 0
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});
