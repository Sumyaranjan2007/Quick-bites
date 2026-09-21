/**
 * RazorpayX: verifying an account, and sending money to it.
 *
 * Separate from `razorpayAdapter.ts`, which takes money IN, because they are
 * different products with different credentials. Razorpay Payments uses a key
 * pair; RazorpayX uses its own key pair plus a current account number that every
 * payout is debited from. Conflating them would mean a deployment that can
 * collect believing it can also pay.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS MODULE REFUSES TO DO
 * -------------------------------------------------------------------------
 * It will not send money without an idempotency key. Razorpay has required one
 * on every payout since 15 March 2025, and the reason is the reason it is not
 * optional here either: a request that times out has an unknown outcome, and
 * retrying it blind is how somebody gets paid twice.
 *
 * -------------------------------------------------------------------------
 * AN UNKNOWN OUTCOME IS NOT A FAILURE
 * -------------------------------------------------------------------------
 * A network error on a payout does NOT mean the payout did not happen. The
 * request may have reached Razorpay and the response may have been lost. So a
 * throw here returns `UNCERTAIN`, never `FAILED`, and an `UNCERTAIN` payout is
 * never retried automatically — reconciliation asks the gateway what actually
 * happened first. Treating unknown as failed is how a rider gets paid twice for
 * one week's work.
 *
 * -------------------------------------------------------------------------
 * IP ALLOWLISTING
 * -------------------------------------------------------------------------
 * RazorpayX refuses API calls from addresses that are not on its allowlist.
 * Railway's egress address is not static. That is an infrastructure problem
 * rather than a code one and it is recorded in PAYMENTS_PLAN §12, but it is
 * mentioned here because the failure it produces is an authentication error
 * that reads like a wrong key, and somebody will otherwise spend an afternoon
 * rotating a perfectly good secret.
 */
import crypto from 'crypto';
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { breakers } from '../platform/circuitBreaker.ts';
import type { RailResultStatus } from '@quick-bites/shared-types';

const RAZORPAYX_API = 'https://api.razorpay.com/v1';

/** Whether this deployment holds RazorpayX credentials at all. */
export function isRazorpayXConfigured(): boolean {
  return Boolean(
    config.RAZORPAYX_KEY_ID &&
      config.RAZORPAYX_KEY_SECRET &&
      config.RAZORPAYX_ACCOUNT_NUMBER &&
      config.RAZORPAYX_KEY_ID.startsWith('rzp_') &&
      // `requireSecret` hands back a random `dev-only-...` value outside
      // production when a secret is absent. A key id paired with that reports
      // itself configured and then fails every call — the same trap
      // `isRazorpayConfigured` guards against for payments in.
      !config.RAZORPAYX_KEY_SECRET.startsWith('dev-only-')
  );
}

function authHeader(): string {
  const raw = `${config.RAZORPAYX_KEY_ID}:${config.RAZORPAYX_KEY_SECRET}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

export interface ValidationRequest {
  holderName: string;
  accountNumber: string;
  ifsc: string;
  /** Carried to Razorpay so a support query can be traced back to a person. */
  contact: { name: string; phone?: string; type: 'vendor' | 'employee' | 'customer' };
  referenceId: string;
}

export interface ValidationResult {
  /** Whether we got an answer at all, as opposed to whether it was a good one. */
  completed: boolean;
  accountStatus?: 'active' | 'invalid';
  /** The name the BANK holds. The authority; our copy is just a claim. */
  registeredName?: string;
  /** Razorpay's own 0–100 comparison of the two names. */
  nameMatchScore?: number;
  fundAccountId?: string;
  contactId?: string;
  /** Why it could not be completed, for a human. */
  reason?: string;
}

export const razorpayXAdapter = {
  /**
   * Penny drop: deposits Rs 1 and reports what the bank says the account is.
   *
   * This is the single most valuable call in the payouts system. It answers a
   * question nothing else can: **is this really their account?** A digit typed
   * wrong sends a settlement to a stranger, and the platform finds out weeks
   * later from the partner who was never paid. A rider entering a relative's
   * account — or somebody else's entirely — is caught here rather than by an
   * auditor months afterwards.
   *
   * `validation_type: 'pennydrop'` rather than `'penniless'` deliberately. The
   * penniless check is free and only asks whether the account exists; the penny
   * drop costs Rs 1 and returns the REGISTERED NAME, which is the part that
   * matters. One rupee to know whose account it is, once, is not a saving worth
   * making.
   */
  async validateBankAccount(params: ValidationRequest): Promise<ValidationResult> {
    if (!isRazorpayXConfigured()) {
      return {
        completed: false,
        reason: 'Bank verification is not available on this deployment.'
      };
    }

    let response: Response;
    try {
      response = await breakers.razorpay.run(
        signal =>
          fetch(`${RAZORPAYX_API}/fund_accounts/validations`, {
            signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader()
            },
            body: JSON.stringify({
              account_number: config.RAZORPAYX_ACCOUNT_NUMBER,
              fund_account: {
                account_type: 'bank_account',
                bank_account: {
                  name: params.holderName,
                  ifsc: params.ifsc.toUpperCase(),
                  account_number: params.accountNumber
                },
                contact: {
                  name: params.contact.name,
                  ...(params.contact.phone ? { contact: params.contact.phone } : {}),
                  type: params.contact.type
                }
              },
              // Razorpay caps this at 40 characters and rejects the whole call
              // if it is longer, which is an unhelpful way to discover a limit.
              reference_id: params.referenceId.slice(0, 40),
              amount: 100,
              currency: 'INR'
            })
          }),
        res => res.status >= 500
      );
    } catch (error) {
      // A verification that could not be reached is not a verification that
      // failed. The account stays UNVERIFIED and the payee is told to try
      // again, rather than being told their account is invalid.
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'RAZORPAYX_VALIDATION_UNREACHABLE',
          referenceId: params.referenceId,
          reason: error instanceof Error ? error.message : String(error)
        })
      );
      return { completed: false, reason: 'Could not reach the bank verification service. Try again shortly.' };
    }

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'RAZORPAYX_VALIDATION_REFUSED',
          status: response.status,
          referenceId: params.referenceId,
          // Razorpay's own description. Safe to log — no secret is ever in a
          // response body — and it is usually the actual answer, e.g. "The ifsc
          // provided is invalid".
          razorpayError: body?.error?.description
        })
      );
      return {
        completed: false,
        reason: body?.error?.description || 'The bank refused to verify that account.'
      };
    }

    const results = body?.results || body?.validation_results || {};
    return {
      completed: body?.status === 'completed',
      accountStatus: results.account_status,
      registeredName: results.registered_name,
      nameMatchScore: typeof results.name_match_score === 'number' ? results.name_match_score : undefined,
      fundAccountId: body?.fund_account?.id,
      contactId: body?.fund_account?.contact_id || body?.fund_account?.contact?.id,
      reason: body?.status_details?.description
    };
  },

  /**
   * Creates a fund account for a UPI id.
   *
   * A VPA cannot be penny-dropped the same way a bank account can, so it is
   * registered and validated separately. Razorpay's VPA validation returns the
   * name behind the handle, which is the same protection by a different route.
   */
  async createVpaFundAccount(params: {
    contactName: string;
    contactPhone?: string;
    vpa: string;
    type: 'vendor' | 'employee' | 'customer';
  }): Promise<{ fundAccountId?: string; contactId?: string; reason?: string }> {
    if (!isRazorpayXConfigured()) {
      return { reason: 'Payouts are not configured on this deployment.' };
    }

    try {
      const contactRes = await fetch(`${RAZORPAYX_API}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({
          name: params.contactName,
          ...(params.contactPhone ? { contact: params.contactPhone } : {}),
          type: params.type
        })
      });
      const contact: any = await contactRes.json().catch(() => ({}));
      if (!contactRes.ok) {
        return { reason: contact?.error?.description || 'Could not register that payee.' };
      }

      const fundRes = await fetch(`${RAZORPAYX_API}/fund_accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
        body: JSON.stringify({
          contact_id: contact.id,
          account_type: 'vpa',
          vpa: { address: params.vpa }
        })
      });
      const fund: any = await fundRes.json().catch(() => ({}));
      if (!fundRes.ok) {
        return { reason: fund?.error?.description || 'Could not register that UPI id.' };
      }

      return { fundAccountId: fund.id, contactId: contact.id };
    } catch (error) {
      return {
        reason: 'Could not reach the payouts service. Try again shortly.'
      };
    }
  },

  /**
   * Sends money.
   *
   * `queue_if_low_balance` is true on purpose. A payout run that hits an empty
   * current account at nine in the morning should wait for the account to be
   * funded, not fail forty riders and leave an administrator to work out which
   * of them to re-draft.
   */
  async createPayout(params: {
    fundAccountId: string;
    amountPaise: number;
    /** Ours, and Razorpay's, so neither can pay twice. */
    idempotencyKey: string;
    referenceId: string;
    narration: string;
    purpose: 'payout' | 'refund' | 'salary' | 'vendor bill';
    mode?: 'IMPS' | 'NEFT' | 'UPI' | 'RTGS';
  }): Promise<{ status: RailResultStatus; payoutId?: string; reason?: string }> {
    if (!isRazorpayXConfigured()) {
      throw new AppError('Payouts are not configured on this deployment.', 503, 'PAYOUTS_NOT_CONFIGURED');
    }
    if (!params.idempotencyKey) {
      throw new AppError(
        'A payout needs an idempotency key. Without one a retry pays twice.',
        500,
        'PAYOUT_KEY_REQUIRED'
      );
    }

    let response: Response;
    try {
      response = await fetch(`${RAZORPAYX_API}/payouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader(),
          // Mandatory since 15 March 2025, and the last line of defence: even a
          // retry that gets past our own ledger cannot pay twice at the bank.
          'X-Payout-Idempotency': params.idempotencyKey
        },
        body: JSON.stringify({
          account_number: config.RAZORPAYX_ACCOUNT_NUMBER,
          fund_account_id: params.fundAccountId,
          amount: Math.round(params.amountPaise),
          currency: 'INR',
          mode: params.mode || 'IMPS',
          purpose: params.purpose,
          queue_if_low_balance: true,
          reference_id: params.referenceId.slice(0, 40),
          narration: params.narration.slice(0, 30)
        })
      });
    } catch (error) {
      // NOT 'FAILED'. The request may have arrived and the answer been lost.
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'RAZORPAYX_PAYOUT_UNCERTAIN',
          idempotencyKey: params.idempotencyKey,
          reason: error instanceof Error ? error.message : String(error)
        })
      );
      return {
        status: 'UNCERTAIN',
        reason: 'The payout request could not be completed and its outcome is unknown.'
      };
    }

    const body: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      // A 5xx is also an unknown outcome — the gateway may have taken it before
      // failing to answer. Only a 4xx is a definite refusal, because Razorpay
      // rejected it before doing anything.
      if (response.status >= 500) {
        return { status: 'UNCERTAIN', reason: body?.error?.description || 'The payouts service failed.' };
      }
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'RAZORPAYX_PAYOUT_REFUSED',
          status: response.status,
          razorpayError: body?.error?.description
        })
      );
      return { status: 'FAILED', reason: body?.error?.description || 'The payout was refused.' };
    }

    return {
      status: body.status === 'queued' ? 'QUEUED' : 'SENT',
      payoutId: body.id
    };
  },

  /**
   * A link the recipient opens and puts their own account into.
   *
   * How a cash order is refunded. There is nothing to reverse on a cash
   * payment, and the alternative — storing the customer's bank details — would
   * make this platform hold the most dangerous data it could hold, for the sake
   * of a refund that happens to a small fraction of orders.
   */
  async createPayoutLink(params: {
    amountPaise: number;
    contactName: string;
    contactPhone: string;
    purpose: 'refund' | 'payout';
    description: string;
    referenceId: string;
    expiryUnix: number;
    sendSms: boolean;
  }): Promise<{ status: RailResultStatus; linkId?: string; shortUrl?: string; reason?: string }> {
    if (!isRazorpayXConfigured()) {
      throw new AppError('Payouts are not configured on this deployment.', 503, 'PAYOUTS_NOT_CONFIGURED');
    }

    let response: Response;
    try {
      response = await fetch(`${RAZORPAYX_API}/payout-links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader(),
          'X-Payout-Idempotency': params.referenceId
        },
        body: JSON.stringify({
          account_number: config.RAZORPAYX_ACCOUNT_NUMBER,
          contact: {
            name: params.contactName,
            contact: params.contactPhone,
            type: 'customer'
          },
          amount: Math.round(params.amountPaise),
          currency: 'INR',
          purpose: params.purpose,
          description: params.description.slice(0, 200),
          // SMS to Indian numbers needs TRAI DLT registration, which is not
          // done. Off by default, so the link is handed over in the app rather
          // than sent into a void and assumed delivered.
          send_sms: params.sendSms,
          send_email: false,
          expire_by: params.expiryUnix,
          receipt: params.referenceId.slice(0, 40)
        })
      });
    } catch {
      return { status: 'UNCERTAIN', reason: 'Could not reach the payouts service.' };
    }

    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status >= 500) return { status: 'UNCERTAIN', reason: body?.error?.description };
      return { status: 'FAILED', reason: body?.error?.description || 'The refund link could not be created.' };
    }

    return { status: 'SENT', linkId: body.id, shortUrl: body.short_url };
  },

  /** What Razorpay says the state of a payout is. The authority, not our record. */
  async fetchPayout(payoutId: string): Promise<{ status: string; failureReason?: string } | null> {
    if (!isRazorpayXConfigured()) return null;
    try {
      const response = await fetch(`${RAZORPAYX_API}/payouts/${payoutId}`, {
        headers: { Authorization: authHeader() }
      });
      if (!response.ok) return null;
      const body: any = await response.json();
      return { status: body.status, failureReason: body.failure_reason };
    } catch {
      return null;
    }
  },

  /**
   * Every payout carrying one of our reference ids.
   *
   * What reconciliation needs when an outcome is UNCERTAIN: we know our own
   * reference and nothing else, because the payout id only ever existed in the
   * response that went missing. Asking the gateway what it holds against our
   * reference is the only way to find money that left and was never recorded.
   */
  async findPayoutsByReference(referenceId: string): Promise<Array<{ id: string; status: string; amount: number }>> {
    if (!isRazorpayXConfigured()) return [];
    try {
      const response = await fetch(
        `${RAZORPAYX_API}/payouts?account_number=${encodeURIComponent(config.RAZORPAYX_ACCOUNT_NUMBER)}&count=100`,
        { headers: { Authorization: authHeader() } }
      );
      if (!response.ok) return [];
      const body: any = await response.json();
      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      return items
        .filter(p => p.reference_id === referenceId.slice(0, 40))
        .map(p => ({ id: p.id, status: p.status, amount: p.amount }));
    } catch {
      return [];
    }
  },

  /**
   * Verifies a RazorpayX webhook.
   *
   * The RAW body, not a re-serialised object: `JSON.stringify` of a parsed body
   * reorders keys and drops whitespace, and the digest will not match what
   * Razorpay signed. Every webhook would then be rejected, which looks like
   * Razorpay being broken. The payments adapter learned this already; it is
   * repeated rather than shared because the two use different secrets.
   */
  verifyWebhook(rawBody: string, signature: string): boolean {
    const secret = config.RAZORPAYX_WEBHOOK_SECRET || config.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
};
