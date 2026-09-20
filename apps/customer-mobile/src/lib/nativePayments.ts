/**
 * Razorpay's checkout sheet, loaded safely.
 *
 * Same shape of problem as `nativeMap.ts`, and the same answer: this is a
 * native module, so in Expo Go, in a build made before the dependency was
 * added, or in any JS-only context, importing it throws or hands back
 * something that throws on first use. A crash here is worse than a crash on a
 * map, because it happens with a full basket at the moment somebody is trying
 * to give us money.
 *
 * So the import is attempted once, inside a try/catch, and the result is a
 * value the checkout screen can branch on. A build that cannot open the sheet
 * offers cash on delivery only, which is exactly what this app did before.
 *
 * `require` rather than `import`, because a static import is hoisted and
 * evaluated before any surrounding code and therefore cannot be guarded.
 */

/** What Razorpay hands back when a payment succeeds. */
export interface RazorpayResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  /** HMAC of `order_id|payment_id`. The server re-computes it; we never trust this alone. */
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { contact?: string; email?: string; name?: string };
  theme?: { color?: string };
}

interface CheckoutModule {
  open(options: RazorpayOptions): Promise<RazorpayResult>;
}

function load(): CheckoutModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-razorpay');
    const checkout = mod?.default ?? mod;
    if (typeof checkout?.open !== 'function') return null;
    return checkout as CheckoutModule;
  } catch {
    return null;
  }
}

const checkout = load();

/** True when this build can actually open a checkout sheet. */
export const razorpayAvailable: boolean = checkout !== null;

/**
 * Open the sheet and wait for it.
 *
 * Rejects when the payment fails AND when the customer simply closes the sheet
 * — Razorpay reports both through the same error path, and they need different
 * words on screen, so `isCancellation` below tells them apart. Treating a
 * dismissal as a failure would tell somebody their payment had gone wrong when
 * they had merely changed their mind.
 */
export async function openRazorpay(options: RazorpayOptions): Promise<RazorpayResult> {
  if (!checkout) {
    throw new Error('Online payment is not available in this build.');
  }
  return checkout.open(options);
}

/**
 * Whether this error is "the customer closed the sheet" rather than "the
 * payment failed".
 *
 * Razorpay's cancellation code is 0 (BAsE_REQUEST_ERROR / payment cancelled),
 * and the description carries "cancelled" in the cases where the code is
 * missing. Both are checked because the shape of this error object differs
 * between the Android and iOS bridges, and an unrecognised cancellation shown
 * as "your payment failed" is a support call about money that was never taken.
 */
export function isCancellation(err: unknown): boolean {
  const e = err as { code?: number; description?: string; error?: { description?: string } };
  if (e?.code === 0 || e?.code === 2) return true;
  const text = `${e?.description ?? ''} ${e?.error?.description ?? ''}`.toLowerCase();
  return text.includes('cancel');
}

/** A readable reason, for the cases that are genuinely failures. */
export function paymentErrorMessage(err: unknown): string {
  const e = err as { description?: string; error?: { description?: string }; message?: string };
  return (
    e?.error?.description ||
    e?.description ||
    e?.message ||
    'The payment could not be completed. You have not been charged.'
  );
}
