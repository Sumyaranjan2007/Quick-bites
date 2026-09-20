/**
 * Buying and holding a Quick Bites Gold membership.
 *
 * The purchase is deliberately the same shape as paying for an order: the
 * server creates something to pay for, the app opens Razorpay's sheet, and the
 * server verifies the signature before anything is granted. Membership is not
 * special-cased into a cheaper path, because a benefit granted on a client's
 * say-so is a benefit anyone can grant themselves.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { razorpayAdapter, isRazorpayConfigured } from '../modules/payments/razorpayAdapter.ts';
import {
  listPlans,
  findPlan,
  savePlans,
  statusFor,
  activate,
  type MembershipPlan
} from '../modules/membership/membershipService.ts';

export const membershipRouter = Router();

/**
 * GET /api/v1/membership/plans
 *
 * Public: the price of a membership is not a secret, and an app should be able
 * to show what it costs before asking anyone to sign in.
 */
membershipRouter.get('/plans', (_req, res) => {
  res.json({
    success: true,
    data: { plans: listPlans(), online: isRazorpayConfigured() }
  });
});

/** GET /api/v1/membership/me — what this customer currently holds. */
membershipRouter.get('/me', authMiddleware(), async (req, res, next) => {
  try {
    res.json({ success: true, data: await statusFor(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

const PurchaseSchema = z.object({ planId: z.string().min(1).max(60) });

/**
 * POST /api/v1/membership/purchase
 *
 * Creates the Razorpay order. Grants nothing — the membership starts only once
 * /confirm has checked the signature.
 *
 * The amount is taken from the stored plan, never from the request. A client
 * that can name its own price for a year of free delivery certainly will.
 */
membershipRouter.post(
  '/purchase',
  authMiddleware('customer'),
  validate({ body: PurchaseSchema }),
  async (req, res, next) => {
    try {
      if (!isRazorpayConfigured()) {
        throw new AppError(
          'Online payment is not switched on for this server, so memberships cannot be bought yet.',
          503,
          'PAYMENTS_NOT_CONFIGURED'
        );
      }
      const plan = findPlan(req.body.planId);
      if (!plan || !plan.isActive) {
        throw new AppError('That membership plan is not available.', 404, 'PLAN_NOT_FOUND');
      }

      const rzpOrder = await razorpayAdapter.createOrder({
        amountInPaise: Math.round(plan.price * 100),
        // Prefixed so a membership payment is distinguishable from an order
        // payment in Razorpay's own dashboard, where the two would otherwise be
        // an undifferentiated list of receipts.
        orderNumber: `MEM-${plan.id}-${Date.now()}`,
        notes: { kind: 'membership', planId: plan.id, customerId: req.user!.id }
      });

      res.json({
        success: true,
        data: {
          razorpayOrder: rzpOrder,
          plan,
          // The publishable key, returned with the thing it is needed for.
          // Making the client fetch it separately from /payments/config is one
          // more call that can fail between choosing a plan and paying for it.
          keyId: process.env.RAZORPAY_KEY_ID
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const ConfirmSchema = z.object({
  planId: z.string().min(1).max(60),
  razorpayOrderId: z.string().min(1).max(120),
  razorpayPaymentId: z.string().min(1).max(120),
  razorpaySignature: z.string().min(1).max(256)
});

/**
 * POST /api/v1/membership/confirm
 *
 * The signature is re-computed here from the key secret, which never leaves the
 * server. What the client posts is evidence, not proof.
 */
membershipRouter.post(
  '/confirm',
  authMiddleware('customer'),
  validate({ body: ConfirmSchema }),
  async (req, res, next) => {
    try {
      const ok = razorpayAdapter.verifySignature({
        razorpayOrderId: req.body.razorpayOrderId,
        razorpayPaymentId: req.body.razorpayPaymentId,
        razorpaySignature: req.body.razorpaySignature
      });
      if (!ok) {
        console.log(JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'MEMBERSHIP_SIGNATURE_REJECTED',
          userId: req.user!.id,
          razorpayOrderId: req.body.razorpayOrderId
        }));
        throw new AppError(
          'We could not verify that payment. If money has left your account, contact support and do not pay again.',
          400,
          'INVALID_PAYMENT_SIGNATURE'
        );
      }

      const status = await activate(req.user!.id, req.body.planId);
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------------------------------------------------- *
 *                              ADMINISTRATION                                 *
 * -------------------------------------------------------------------------- */

const PlanSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  price: z.number().min(0).max(100000),
  durationDays: z.number().int().min(1).max(3650),
  extraDiscountPercent: z.number().min(0).max(50),
  benefits: z.array(z.string().max(120)).max(10),
  isActive: z.boolean()
});

/**
 * PUT /api/v1/membership/plans — what Gold costs and what it is worth.
 *
 * Admin-only, and deliberately a whole-set replacement so a plan removed from
 * the list is really removed rather than lingering as an orphan somebody can
 * still buy by id.
 */
membershipRouter.put(
  '/plans',
  authMiddleware('admin'),
  validate({ body: z.object({ plans: z.array(PlanSchema).min(1).max(10) }) }),
  (req, res, next) => {
    try {
      const plans = savePlans(req.body.plans as MembershipPlan[]);
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'MEMBERSHIP_PLANS_UPDATED',
        adminId: req.user!.id,
        planCount: plans.length
      }));
      res.json({ success: true, data: { plans } });
    } catch (err) {
      next(err);
    }
  }
);
