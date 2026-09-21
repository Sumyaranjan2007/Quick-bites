/**
 * Taking payment at the door, online.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS THE MOST VALUABLE THING IN THE CASH STORY
 * -------------------------------------------------------------------------
 * Every rupee collected this way is a rupee that never becomes cash. No bag to
 * guard, no deposit trip, no counting, no variance, no rider carrying the
 * platform's money around a city. It deletes the entire cash-handling problem
 * one order at a time, rather than managing it.
 *
 * So it is offered first at the door and cash is the fallback, not the other
 * way round.
 *
 * -------------------------------------------------------------------------
 * THE RIDER'S APP CAN NEVER MARK AN ORDER PAID
 * -------------------------------------------------------------------------
 * This is the single most important rule in this file, and the reason it is
 * stated twice. A delivery app is an attacker-controlled environment being
 * handed other people's money, and "tell the server it was paid" is the one lie
 * that pays. Only a verified webhook from Razorpay, or a direct query to
 * Razorpay, can move an order to PAID. The app can ask; it cannot assert.
 *
 * The consequence is deliberate: a rider whose customer has genuinely paid, on
 * a phone with no signal, cannot force it through. They take the cash instead
 * and the QR expires unpaid. That is the correct trade — the alternative lets
 * every rider on the platform close any order for free.
 */
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { getActiveRates } from './pricingConfig.ts';
import { toPaise, formatPaise } from './money.ts';
import { breakers } from '../platform/circuitBreaker.ts';
import { isRazorpayConfigured } from './razorpayAdapter.ts';
import type { Order } from '@quick-bites/shared-types';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

function authHeader(): string {
  const raw = `${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

export interface DoorQr {
  qrId: string;
  /** The image the rider shows. Razorpay hosts it. */
  imageUrl: string;
  amountPaise: number;
  expiresAt: string;
  status: 'active' | 'closed';
}

/**
 * Creates a single-use QR for exactly this order's amount.
 *
 * `usage: single_use` with `fixed_amount: true` is the whole safety model:
 *
 *   - single-use closes the moment it is paid, so a customer cannot be charged
 *     twice by scanning again, and a rider cannot reuse yesterday's code;
 *   - fixed amount means the customer cannot pay Rs 50 against a Rs 580 order,
 *     and — more to the point — a rider cannot present a code for a different
 *     amount than the one the platform is owed.
 *
 * The amount comes from the SERVER's copy of the bill. Nothing the rider's app
 * sends is used to decide what to charge.
 */
export async function createDoorQr(order: Order): Promise<DoorQr> {
  if (!isRazorpayConfigured()) {
    throw new AppError(
      'Online collection is not available on this deployment. Take cash and the order will settle as usual.',
      503,
      'DOOR_PAYMENT_NOT_CONFIGURED'
    );
  }

  const amountPaise = toPaise(Number(order.bill?.totalAmount) || 0);
  if (amountPaise <= 0) {
    throw new AppError('This order has no amount to collect.', 400, 'NOTHING_TO_COLLECT');
  }

  const rates = getActiveRates();
  // Razorpay caps a single-use QR at two hours and rejects anything under two
  // minutes. Clamped here so a misconfigured rate produces a working QR rather
  // than a gateway error a rider cannot interpret at somebody's front door.
  const minutes = Math.min(120, Math.max(2, rates.doorQrExpiryMinutes));
  const closeBy = Math.floor(Date.now() / 1000) + minutes * 60;

  let response: Response;
  try {
    response = await breakers.razorpay.run(
      signal =>
        fetch(`${RAZORPAY_API}/payments/qr_codes`, {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
          body: JSON.stringify({
            type: 'upi_qr',
            name: `Quick Bites ${order.orderNumber}`,
            usage: 'single_use',
            fixed_amount: true,
            payment_amount: amountPaise,
            description: `Order ${order.orderNumber}`,
            close_by: closeBy,
            // Carried into the Razorpay dashboard and back out on the webhook,
            // which is how a credited QR is matched to an order.
            notes: { orderId: order.id, orderNumber: order.orderNumber }
          })
        }),
      res => res.status >= 500
    );
  } catch {
    throw new AppError(
      'Could not reach the payment service. Take cash for this one.',
      503,
      'DOOR_PAYMENT_UNREACHABLE'
    );
  }

  const body: any = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.log(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'DOOR_QR_CREATE_FAILED',
        status: response.status,
        orderId: order.id,
        razorpayError: body?.error?.description
      })
    );
    throw new AppError(
      'That QR code could not be created. Take cash for this one.',
      502,
      'DOOR_PAYMENT_FAILED'
    );
  }

  return {
    qrId: body.id,
    imageUrl: body.image_url,
    amountPaise: body.payment_amount ?? amountPaise,
    expiresAt: new Date(closeBy * 1000).toISOString(),
    status: body.status === 'closed' ? 'closed' : 'active'
  };
}

/**
 * Asks Razorpay whether a QR has been paid.
 *
 * The rider's screen polls this, because a webhook can be seconds late and a
 * rider is standing on a doorstep. The gateway is the authority — not the
 * customer saying "it's done", and not the app.
 */
export async function checkDoorQr(qrId: string): Promise<{
  paid: boolean;
  amountReceivedPaise: number;
  status: string;
  paymentId?: string;
}> {
  if (!isRazorpayConfigured()) {
    return { paid: false, amountReceivedPaise: 0, status: 'unavailable' };
  }

  try {
    const response = await fetch(`${RAZORPAY_API}/payments/qr_codes/${qrId}`, {
      headers: { Authorization: authHeader() }
    });
    if (!response.ok) return { paid: false, amountReceivedPaise: 0, status: 'unknown' };

    const body: any = await response.json();
    const received = Number(body.payments_amount_received) || 0;

    // Paid means the gateway says money arrived against this code. `close_reason
    // === 'paid'` is the definitive signal; a received amount covers the window
    // where the QR is credited but not yet closed.
    const paid = body.close_reason === 'paid' || received > 0;

    let paymentId: string | undefined;
    if (paid) {
      const payments: any = await fetch(`${RAZORPAY_API}/payments/qr_codes/${qrId}/payments`, {
        headers: { Authorization: authHeader() }
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
      // The payment id matters: it is what a refund on this order will later be
      // issued against. Without it a door-paid order could only be refunded by
      // link, which is the slower path for no reason.
      paymentId = payments?.items?.[0]?.id;
    }

    return { paid, amountReceivedPaise: received, status: body.status, paymentId };
  } catch {
    // Unknown, not unpaid. A rider must not be told "not paid" because our
    // network blinked — they would take cash for an order already paid for.
    return { paid: false, amountReceivedPaise: 0, status: 'unreachable' };
  }
}

/** Closes a QR that is no longer wanted, so it cannot be paid later. */
export async function closeDoorQr(qrId: string): Promise<void> {
  if (!isRazorpayConfigured()) return;
  try {
    await fetch(`${RAZORPAY_API}/payments/qr_codes/${qrId}/close`, {
      method: 'POST',
      headers: { Authorization: authHeader() }
    });
  } catch {
    /* It expires by itself. Nothing here is worth failing a delivery over. */
  }
}

/**
 * Whether this order can still be collected online.
 *
 * Checked on the server rather than trusted from the app, because the app's
 * idea of an order's state is a copy that may be minutes old.
 */
export function assertCollectable(order: Order): void {
  if (order.paymentStatus === 'PAID') {
    throw new AppError('This order has already been paid for.', 409, 'ALREADY_PAID');
  }
  if (order.paymentMethod !== 'CASH_ON_DELIVERY') {
    throw new AppError(
      'This order was not placed as cash on delivery.',
      409,
      'NOT_A_CASH_ORDER'
    );
  }
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    throw new AppError('This order has been cancelled.', 409, 'ORDER_CANCELLED');
  }
}

/** What the rider's screen is told while a QR is live. */
export function doorQrView(qr: DoorQr, order: Order) {
  return {
    qrId: qr.qrId,
    imageUrl: qr.imageUrl,
    amount: Number(order.bill?.totalAmount) || 0,
    amountLabel: formatPaise(qr.amountPaise),
    expiresAt: qr.expiresAt,
    orderNumber: order.orderNumber
  };
}
