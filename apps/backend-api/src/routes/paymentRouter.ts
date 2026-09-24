/**
 * Payments.
 *
 * Two routes: one the customer app calls to start a payment, and one Razorpay
 * calls to say what happened. The second is the authority. A phone reporting
 * success is a claim; a signed webhook is evidence.
 *
 * -------------------------------------------------------------------------
 * WHY THE WEBHOOK NEEDS THE RAW BODY
 * -------------------------------------------------------------------------
 * Razorpay signs the exact bytes it sent. `JSON.parse` followed by
 * `JSON.stringify` reorders keys and drops whitespace, so the digest of a
 * re-serialised body will not match and every webhook would be rejected — which
 * presents as "Razorpay is broken" rather than as a bug here. The raw body is
 * captured by a verify hook on the JSON parser in `app.ts`.
 *
 * -------------------------------------------------------------------------
 * IDEMPOTENCY
 * -------------------------------------------------------------------------
 * Razorpay retries a webhook until it gets a 2xx, so the same event arrives
 * more than once as a matter of course. Each event id is recorded and a repeat
 * is acknowledged without being applied — otherwise a retry credits a wallet
 * twice, and the retry is not the customer's fault.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { razorpayAdapter, isRazorpayConfigured } from '../modules/payments/razorpayAdapter.ts';
import { bookCapture } from '../modules/payments/capture.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';
import { config } from '../config/env.ts';

export const paymentRouter = Router();

/** Events already applied, so a retry changes nothing. */
const seenKey = (eventId: string) => `rzp:event:${eventId}`;

/**
 * GET /api/payments/config
 *
 * Lets an app decide whether to offer online payment at all, rather than
 * offering it and failing at the last step of a checkout.
 */
paymentRouter.get('/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      online: isRazorpayConfigured(),
      // The publishable key. Not a secret — it identifies the merchant to the
      // checkout. The key secret never leaves the server.
      keyId: isRazorpayConfigured() ? config.RAZORPAY_KEY_ID : null,
      /**
       * The values the ORDER endpoint accepts, not prettier synonyms of them.
       *
       * This advertised 'RAZORPAY' while `POST /orders` has only ever accepted
       * 'RAZORPAY_SANDBOX', so a client that believed this endpoint was refused
       * at the moment it tried to place the order. The name is historical — the
       * same path now carries live keys — but it is the value stored on every
       * existing order, so it is the value that stays.
       */
      methods: isRazorpayConfigured()
        ? ['CASH_ON_DELIVERY', 'RAZORPAY_SANDBOX']
        : ['CASH_ON_DELIVERY']
    }
  });
});

const StartPaymentSchema = z.object({ orderId: z.string().min(1) });

/**
 * POST /api/payments/start
 *
 * Creates a Razorpay order for an order this customer owns.
 *
 * The amount comes from the stored bill, never from the request. A client that
 * can name its own price eventually will.
 */
paymentRouter.post(
  '/start',
  authMiddleware('customer'),
  validate({ body: StartPaymentSchema }),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.body.orderId);
      if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
      if (order.customerId !== req.user!.id) {
        throw new AppError('That is not your order.', 403, 'NOT_YOUR_ORDER');
      }
      if (order.paymentStatus === 'PAID') {
        throw new AppError('This order has already been paid for.', 409, 'ALREADY_PAID');
      }

      const rzpOrder = await razorpayAdapter.createOrder({
        amountInPaise: Math.round(order.bill.totalAmount * 100),
        orderNumber: order.orderNumber,
        notes: { quickBitesOrderId: order.id, customerId: order.customerId }
      });

      await orderRepository.setPaymentReference(order.id, { razorpayOrderId: rzpOrder.id });

      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'PAYMENT_STARTED',
        orderId: order.id,
        razorpayOrderId: rzpOrder.id,
        amountPaise: rzpOrder.amount
      }));

      res.json({ success: true, data: { razorpayOrder: rzpOrder, order: { id: order.id, orderNumber: order.orderNumber } } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payments/webhook
 *
 * Razorpay's own account of what happened. Unauthenticated by design — it is
 * authenticated by its signature, which is the only thing that makes it
 * trustworthy. An endpoint that marked orders paid without checking that
 * signature would be an open instruction to do so.
 */
paymentRouter.post('/webhook', async (req, res, next) => {
  try {
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const rawBody = (req as any).rawBody as string | undefined;

    if (!rawBody) {
      // Without the raw bytes no signature can be checked, so nothing is applied.
      throw new AppError('Webhook body unavailable.', 400, 'NO_RAW_BODY');
    }

    if (!razorpayAdapter.verifyWebhook(rawBody, signature)) {
      console.log(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        event: 'RAZORPAY_WEBHOOK_REJECTED',
        reason: 'SIGNATURE_MISMATCH'
      }));
      throw new AppError('Signature verification failed.', 401, 'INVALID_WEBHOOK_SIGNATURE');
    }

    const payload = req.body || {};
    const eventId = String(req.headers['x-razorpay-event-id'] || payload.id || '');
    const eventType = String(payload.event || '');

    if (eventId && memoryStore.settings.get(seenKey(eventId))) {
      // Already applied. Acknowledged so Razorpay stops retrying.
      return res.json({ success: true, data: { duplicate: true } });
    }

    const entity = payload?.payload?.payment?.entity;
    const quickBitesOrderId = entity?.notes?.quickBitesOrderId;

    if (eventType === 'payment.captured' && quickBitesOrderId) {
      const order = await orderRepository.findById(quickBitesOrderId);
      if (order && order.paymentStatus !== 'PAID') {
        await orderService.markPaidByGateway(order.id, {
          razorpayPaymentId: entity.id,
          amountPaise: entity.amount
        });
        console.log(JSON.stringify({
          level: 'INFO',
          timestamp: new Date().toISOString(),
          event: 'PAYMENT_CAPTURED',
          orderId: order.id,
          razorpayPaymentId: entity.id
        }));
      }
    } else if (eventType === 'qr_code.credited') {
      /*
       * Somebody paid a doorstep QR.
       *
       * This is the AUTHORITATIVE path for a door payment, and one of exactly
       * two things on the platform that can mark such an order paid — the other
       * being a direct query to Razorpay from the rider's polling route. The
       * rider's app can ask; it cannot assert. A delivery app is an
       * attacker-controlled environment being handed other people's money, and
       * "tell the server it was paid" is the one lie that pays.
       *
       * The order id travels in the QR's own notes, which we set when we
       * created it, so a credited code can be matched back to an order without
       * trusting anything the phone says.
       */
      const qrEntity = payload?.payload?.qr_code?.entity;
      const qrPayment = payload?.payload?.payment?.entity;
      const doorOrderId = qrEntity?.notes?.orderId;

      if (doorOrderId) {
        const order = await orderRepository.findById(doorOrderId);
        if (order && order.paymentStatus !== 'PAID') {
          order.paymentStatus = 'PAID';
          (order as any).paymentMethod = 'UPI_AT_DOOR';
          if (qrPayment?.id) order.razorpayPaymentId = qrPayment.id;
          order.updatedAt = new Date().toISOString();
          memoryStore.orders.set(order.id, order);
          triggerAutoSave();

          // A door QR goes through Razorpay like any other online payment, so
          // the money is at the gateway and not in the bank. Booked here, and
          // idempotent against the rider's polling route seeing it too.
          bookCapture(order, Number(qrPayment?.amount) || 0);

          console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            event: 'DOOR_PAYMENT_CONFIRMED_BY_WEBHOOK',
            orderId: order.id,
            qrId: qrEntity?.id,
            razorpayPaymentId: qrPayment?.id
          }));
        }
      }
    } else if (eventType === 'payment.failed' && quickBitesOrderId) {
      console.log(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        event: 'PAYMENT_FAILED',
        orderId: quickBitesOrderId,
        reason: entity?.error_description
      }));
    }

    if (eventId) {
      memoryStore.settings.set(seenKey(eventId), { appliedAt: new Date().toISOString(), eventType });
      triggerAutoSave();
    }

    res.json({ success: true, data: { received: true } });
  } catch (err) {
    next(err);
  }
});
