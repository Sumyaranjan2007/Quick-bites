/**
 * Cash at the door, and getting it back off the doorstep.
 *
 * In its own router rather than appended to `riderRouter`, for the same reason
 * payee accounts are: a second session is working in this repository and holds
 * that file, and a new file cannot collide with anything they write.
 *
 * Everything here resolves the rider from the SIGNED-IN TOKEN. There is no
 * rider id in any path, so there is nothing to change in a request to collect
 * against somebody else's order or deposit against somebody else's cash.
 */
import { settleLateDoorPayment } from '../modules/payments/duplicateCapture.ts';
import { durable } from '../middlewares/durable.ts';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';
import { bookCapture } from '../modules/payments/capture.ts';
import {
  cashStanding,
  declareDeposit,
  cancelDeposit,
  listDeposits
} from '../modules/payments/cashDeposits.ts';
import {
  createDoorQr,
  checkDoorQr,
  closeDoorQr,
  assertCollectable,
  doorQrView
} from '../modules/payments/doorPayment.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';
import { notifyAdminsCashDeclared } from '../notifications/adminNotifier.ts';

export const cashRouter = Router();

// Money writes answer only once they are in the database (N19).
cashRouter.use(durable);

/** The signed-in rider, resolved from the token and never from the body. */
async function self(req: any) {
  const rider = await riderRepository.findByUserId(req.user!.id);
  if (!rider) throw new AppError('No rider profile for this account.', 404, 'RIDER_NOT_FOUND');
  return rider;
}

/** The order, and a check that it is actually this rider's to collect on. */
async function ownTrip(req: any, riderId: string) {
  const order = await orderRepository.findById(req.params.orderId);
  if (!order) throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
  if (order.riderId !== riderId) {
    // Not "forbidden": a rider has no business knowing that somebody else's
    // order exists, so this reads the same as an order that is not there.
    throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
  }
  return order;
}

/* ------------------------------------------------------------------ *
 *  COLLECTING ONLINE AT THE DOOR                                      *
 * ------------------------------------------------------------------ */

/**
 * POST /api/cash/orders/:orderId/collect-online
 *
 * Creates a single-use UPI QR for exactly this order's amount, from the
 * SERVER's copy of the bill. The rider shows it; the customer scans it.
 *
 * Every rupee taken this way is a rupee that never becomes cash the rider has
 * to guard, deposit and have counted.
 */
cashRouter.post('/orders/:orderId/collect-online', authMiddleware('rider'), async (req, res, next) => {
  try {
    const rider = await self(req);
    const order = await ownTrip(req, rider.id);

    assertCollectable(order);

    const qr = await createDoorQr(order);

    // Kept on the order so a rider who closes the app, or whose screen is
    // killed by Android mid-delivery, gets the same QR back rather than
    // creating a second live code for one order.
    (order as any).doorQrId = qr.qrId;
    (order as any).doorQrImageUrl = qr.imageUrl;
    (order as any).doorQrExpiresAt = qr.expiresAt;
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();

    res.status(201).json({ success: true, data: { qr: doorQrView(qr, order) } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cash/orders/:orderId/door-payment
 *
 * Has it been paid? Asked of RAZORPAY, not of the app and not of our own
 * record, because a webhook can be seconds late and a rider is standing on a
 * doorstep deciding whether to ask for cash.
 *
 * This is also the route that marks the order paid — and it is one of exactly
 * two places that can, the other being the verified webhook. The rider's app
 * can ask; it cannot assert.
 */
cashRouter.get('/orders/:orderId/door-payment', authMiddleware('rider'), async (req, res, next) => {
  try {
    const rider = await self(req);
    const order = await ownTrip(req, rider.id);
    const qrId = (order as any).doorQrId;

    if (order.paymentStatus === 'PAID') {
      // N24: settled already (the cash was taken), yet the QR may have been
      // paid as well. A second payment goes back; the webhook does the same.
      if (qrId) {
        // Adopted if this is the order's own payment seen for the first time
        // with its id; refunded only if the order was paid by something else.
        const late = await checkDoorQr(qrId).catch(() => null);
        if (late?.paid) {
          await settleLateDoorPayment(order, late.paymentId, late.amountReceivedPaise);
        }
      }
      return res.json({
        success: true,
        data: { paid: true, alreadySettled: true, message: 'Paid. No cash to collect.' }
      });
    }

    if (!qrId) {
      return res.json({
        success: true,
        data: { paid: false, message: 'No online payment has been started for this order.' }
      });
    }

    const result = await checkDoorQr(qrId);

    if (result.paid) {
      order.paymentStatus = 'PAID';
      (order as any).paymentMethod = 'UPI_AT_DOOR';
      if (result.paymentId) order.razorpayPaymentId = result.paymentId;
      order.updatedAt = new Date().toISOString();
      memoryStore.orders.set(order.id, order);
      triggerAutoSave();

      // Whichever of this route and the webhook gets there first books the
      // money; the second is a no-op on the same key.
      bookCapture(order, result.amountReceivedPaise);

      console.log(
        JSON.stringify({
          level: 'INFO',
          timestamp: new Date().toISOString(),
          event: 'DOOR_PAYMENT_CONFIRMED',
          orderId: order.id,
          qrId,
          riderId: rider.id
        })
      );
    }

    res.json({
      success: true,
      data: {
        paid: result.paid,
        status: result.status,
        message: result.paid
          ? 'Paid. Do not collect cash for this order.'
          : result.status === 'unreachable'
          ? 'Could not check just now. Try again before taking cash.'
          : 'Not paid yet.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/cash/orders/:orderId/cancel-online — customer would rather pay cash. */
cashRouter.post('/orders/:orderId/cancel-online', authMiddleware('rider'), async (req, res, next) => {
  try {
    const rider = await self(req);
    const order = await ownTrip(req, rider.id);
    const qrId = (order as any).doorQrId;

    if (order.paymentStatus === 'PAID') {
      throw new AppError('This order has already been paid online.', 409, 'ALREADY_PAID');
    }

    if (qrId) {
      await closeDoorQr(qrId);
      (order as any).doorQrId = undefined;
      (order as any).doorQrImageUrl = undefined;
      (order as any).doorQrExpiresAt = undefined;
      memoryStore.orders.set(order.id, order);
      triggerAutoSave();
    }

    res.json({ success: true, message: 'Closed. Take cash as usual.' });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 *  CASH THE RIDER IS CARRYING                                         *
 * ------------------------------------------------------------------ */

/** GET /api/cash/me — what they are holding, and whether it is blocking them. */
cashRouter.get('/me', authMiddleware('rider'), async (req, res, next) => {
  try {
    const rider = await self(req);
    const standing = cashStanding(rider.id);

    res.json({
      success: true,
      data: {
        cashInHand: toRupees(standing.cashInHandPaise),
        ceiling: toRupees(standing.ceilingPaise),
        canTakeCod: standing.canTakeCod,
        shouldWarn: standing.shouldWarn,
        message: standing.message,
        pendingDeposit: standing.pendingDeposit,
        history: listDeposits({ riderId: rider.id }).slice(0, 20)
      }
    });
  } catch (err) {
    next(err);
  }
});

const DeclareSchema = z.object({
  amount: z.number().positive().max(1000000),
  /** A photo of the cash or a deposit slip, as a data URI. Optional. */
  proofUrl: z.string().trim().max(700000).optional()
});

/**
 * POST /api/cash/deposits — the rider says what they are bringing in.
 *
 * Nothing moves. The value of a declaration is that it exists BEFORE the
 * counting: one made afterwards is not evidence of anything.
 */
cashRouter.post('/deposits', authMiddleware('rider'), validate({ body: DeclareSchema }), async (req, res, next) => {
  try {
    const rider = await self(req);
    const deposit = declareDeposit({
      riderId: rider.id,
      riderUserId: req.user!.id,
      riderName: rider.fullName,
      amountPaise: toPaise(req.body.amount),
      proofUrl: req.body.proofUrl
    });

    /*
     * From the route, not from `declareDeposit` — cash.test.ts calls that helper
     * nine times, and a notifier inside it would make every one of those a push.
     */
    void notifyAdminsCashDeclared({
      depositId: deposit.id,
      riderName: rider.fullName || 'A rider',
      amountLabel: `Rs ${req.body.amount}`
    });

    res.status(201).json({
      success: true,
      data: { deposit },
      message: 'Recorded. Bring it to the office and an administrator will confirm what they count.'
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/cash/deposits/:id — withdraw a declaration before coming in. */
cashRouter.delete('/deposits/:id', authMiddleware('rider'), async (req, res, next) => {
  try {
    const rider = await self(req);
    const deposit = cancelDeposit(req.params.id, rider.id);
    res.json({ success: true, data: { deposit }, message: 'Cancelled.' });
  } catch (err) {
    next(err);
  }
});
