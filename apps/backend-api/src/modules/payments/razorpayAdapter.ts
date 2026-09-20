/**
 * Razorpay, for real.
 *
 * This used to fabricate an order id locally and never speak to Razorpay at
 * all: `createOrder` returned `order_rzp_mock_<uuid>` and the customer app
 * showed a payment that had never existed. It looked like an integration and
 * was a stub, which is the most expensive kind of code to leave lying around —
 * everything downstream of it is written as though money moved.
 *
 * It now calls the Orders API, verifies signatures against what Razorpay
 * actually signed, and treats webhooks as the authority on whether a payment
 * happened.
 *
 * -------------------------------------------------------------------------
 * WHAT THE CLIENT IS NEVER BELIEVED ABOUT
 * -------------------------------------------------------------------------
 * A mobile app is an attacker-controlled environment. It may report that a
 * payment succeeded; that report is worth nothing on its own. An order becomes
 * paid only when one of these agrees:
 *
 *   1. A signature the client presents verifies against `order_id|payment_id`
 *      HMAC-SHA256 with the key secret — which only Razorpay could produce.
 *   2. A webhook arrives from Razorpay whose body verifies against the webhook
 *      secret.
 *
 * -------------------------------------------------------------------------
 * TEST MODE
 * -------------------------------------------------------------------------
 * `rzp_test_` keys are free, need no business KYC, and talk to Razorpay's real
 * servers — nothing here is simulated. Going live is a matter of swapping two
 * keys once KYC is complete; no code changes.
 */
import crypto from 'crypto';
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { breakers } from '../platform/circuitBreaker.ts';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

export interface CreatePaymentParams {
  amountInPaise: number;
  orderNumber: string;
  /** Carried into the Razorpay dashboard so a support query can be traced back. */
  notes?: Record<string, string>;
}

export interface VerifySignatureParams {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  keyId: string;
  status?: string;
}

/** Whether this deployment holds keys at all. */
export function isRazorpayConfigured(): boolean {
  return Boolean(
    config.RAZORPAY_KEY_ID &&
      config.RAZORPAY_KEY_SECRET &&
      config.RAZORPAY_KEY_ID.startsWith('rzp_')
  );
}

function authHeader(): string {
  const raw = `${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

/**
 * Constant-time compare of two hex digests.
 *
 * `===` on a signature leaks, through how long the comparison takes, how many
 * leading characters were correct. The window is small over a network and the
 * defence costs nothing.
 */
function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const razorpayAdapter = {
  /**
   * Creates an order at Razorpay and returns what the checkout needs.
   *
   * The amount is sent in paise and is taken from the server's own bill, never
   * from the request: a client that can name its own price will.
   */
  async createOrder(params: CreatePaymentParams): Promise<RazorpayOrder> {
    if (!isRazorpayConfigured()) {
      throw new AppError(
        'Online payment is not available on this deployment.',
        503,
        'PAYMENTS_NOT_CONFIGURED'
      );
    }

    // Through the breaker: a gateway that has failed its last five calls is
    // refused here in microseconds rather than holding this checkout open for
    // twelve seconds to prove the same thing again.
    const response = await breakers.razorpay.run(
      signal => fetch(`${RAZORPAY_API}/orders`, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader()
      },
      body: JSON.stringify({
        amount: Math.round(params.amountInPaise),
        currency: 'INR',
        receipt: params.orderNumber,
        // Razorpay captures automatically rather than leaving an authorisation
        // for someone to remember to settle. A hold that is never captured
        // expires and the customer is left believing they paid.
        payment_capture: 1,
        notes: params.notes || {}
      })
      }),
      // A 400 here means we sent something the gateway rejected — our bug, not
      // its outage. Only 5xx counts against the breaker.
      res => res.status >= 500
    );

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'RAZORPAY_ORDER_CREATE_FAILED',
        status: response.status,
        // Razorpay's own description, which is safe to log and useful; the key
        // secret is never part of a response body.
        razorpayError: body?.error?.description
      }));
      throw new AppError(
        'Could not start the payment. Try again, or pay cash on delivery.',
        502,
        'PAYMENT_GATEWAY_ERROR'
      );
    }

    return {
      id: body.id,
      amount: body.amount,
      currency: body.currency,
      receipt: body.receipt,
      status: body.status,
      // The publishable key id, which the checkout needs and which is not a
      // secret. The key SECRET never leaves this process.
      keyId: config.RAZORPAY_KEY_ID
    };
  },

  /**
   * Verifies the signature a successful checkout hands back.
   *
   * Razorpay signs `razorpay_order_id|razorpay_payment_id` with the key secret,
   * so a valid signature can only have come from Razorpay.
   */
  verifySignature(params: VerifySignatureParams): boolean {
    if (!params.razorpayOrderId || !params.razorpayPaymentId || !params.razorpaySignature) {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
      .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
      .digest('hex');

    return signaturesMatch(expected, params.razorpaySignature);
  },

  /**
   * Verifies a webhook body against the webhook secret.
   *
   * The RAW body must be used, not a re-serialised object: `JSON.stringify` of
   * a parsed body reorders keys and drops whitespace, and the resulting digest
   * will not match what Razorpay signed. Every webhook would then be rejected,
   * which looks like Razorpay being broken.
   */
  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!config.RAZORPAY_WEBHOOK_SECRET || !signature) return false;

    const expected = crypto
      .createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    return signaturesMatch(expected, signature);
  },

  /**
   * Asks Razorpay what it thinks the state of a payment is.
   *
   * Used when a customer returns to the app and the webhook has not arrived
   * yet — the gateway is the authority, not the phone that came back.
   */
  async fetchPayment(paymentId: string): Promise<{ status: string; orderId?: string; amount?: number } | null> {
    if (!isRazorpayConfigured()) return null;

    // Wrapped in its own try: this is called to reconcile a payment whose
    // webhook has not arrived, and an open breaker there must read as "not
    // known yet" rather than throwing at a customer refreshing their order.
    let response: Response;
    try {
      response = await breakers.razorpay.run(
        signal => fetch(`${RAZORPAY_API}/payments/${paymentId}`, {
          signal,
          headers: { Authorization: authHeader() }
        }),
        res => res.status >= 500
      );
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const body: any = await response.json().catch(() => null);
    if (!body) return null;

    return { status: body.status, orderId: body.order_id, amount: body.amount };
  },

  /**
   * Every payment attempt Razorpay has recorded against one of our orders.
   *
   * This is what reconciliation needs and `fetchPayment` cannot give it. When a
   * webhook is lost we know our order id and nothing else: there is no payment
   * id to look up, because the payment id only ever arrived in the message that
   * went missing. Asking the gateway what it holds against the order is the
   * only way to find money that was taken and never recorded.
   */
  async listPaymentsForOrder(
    razorpayOrderId: string
  ): Promise<Array<{ id: string; status: string; amount: number }>> {
    if (!isRazorpayConfigured()) return [];

    let response: Response;
    try {
      response = await breakers.razorpay.run(
        signal => fetch(`${RAZORPAY_API}/orders/${razorpayOrderId}/payments`, {
          signal,
          headers: { Authorization: authHeader() }
        }),
        res => res.status >= 500
      );
    } catch {
      // An empty list, not a throw. Reconciliation runs on a timer and must
      // survive the gateway being unreachable; it will find the same order on
      // the next pass.
      return [];
    }
    if (!response.ok) return [];

    const body: any = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.items)) return [];

    return body.items.map((p: any) => ({ id: p.id, status: p.status, amount: p.amount }));
  },

  /**
   * Refunds a captured payment, in full or in part.
   *
   * Amount in paise. Razorpay is idempotent on its own refund ids, but the
   * caller is responsible for not issuing two refunds for one cancellation —
   * see the settlement ledger.
   */
  async refund(paymentId: string, amountInPaise?: number): Promise<{ id: string; status: string } | null> {
    if (!isRazorpayConfigured()) return null;

    let response: Response;
    try {
      response = await breakers.razorpay.run(
        signal => fetch(`${RAZORPAY_API}/payments/${paymentId}/refund`, {
          signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader()
          },
          body: JSON.stringify(amountInPaise ? { amount: Math.round(amountInPaise) } : {})
        }),
        res => res.status >= 500
      );
    } catch (error) {
      // Null, not a throw: the caller opens a refund case when the gateway
      // cannot settle, and a throw here would lose the cancellation itself.
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'RAZORPAY_REFUND_UNREACHABLE',
        paymentId,
        reason: error instanceof Error ? error.message : String(error)
      }));
      return null;
    }

    if (!response.ok) {
      const body: any = await response.json().catch(() => ({}));
      console.log(JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'RAZORPAY_REFUND_FAILED',
        paymentId,
        razorpayError: body?.error?.description
      }));
      return null;
    }

    const body: any = await response.json();
    return { id: body.id, status: body.status };
  }
};
