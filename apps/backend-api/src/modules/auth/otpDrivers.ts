/**
 * How a one-time code reaches a phone.
 *
 * The vendor has not been chosen yet, so the platform is built against this
 * interface rather than against anyone's SDK. Adding a real provider is a new
 * object in this file and a change to `OTP_PROVIDER` — no route, service or
 * screen changes.
 *
 * ------------------------------------------------------------------------
 * BEFORE ANY OF THIS DELIVERS AN SMS IN INDIA
 * ------------------------------------------------------------------------
 * TRAI DLT registration is mandatory and is law, not a vendor requirement.
 * Every commercial SMS to an Indian number is blocked by the operators
 * without it. Three separate approvals are needed:
 *
 *   1. Entity registration — the business registers on a DLT platform
 *      (Jio, Airtel, Vodafone Idea, BSNL all run one; registering on one
 *      propagates to the others).
 *   2. Sender header — the six-character id the message appears to come
 *      from, e.g. QCKBTE. Approved per entity.
 *   3. Template — the exact message body, with variables marked. The text
 *      that is sent must match the approved template or the operator drops
 *      it silently. An OTP template looks like:
 *          "{#var#} is your Quick Bites verification code. Valid for 5
 *           minutes. Do not share it with anyone."
 *
 * Approval takes days, not minutes. It is the long-pole item for launch and
 * it cannot be shortened by changing provider.
 * ------------------------------------------------------------------------
 */
import { config } from '../../config/env.ts';

export interface OtpDeliveryResult {
  /** Whether the provider accepted the message for delivery. */
  accepted: boolean;
  /** Provider-side id, for tracing a complaint back to a send. */
  reference?: string;
  /** Present when the provider refused. Logged, never shown to the caller. */
  error?: string;
}

export interface OtpDriver {
  readonly name: string;
  /** True when this driver can actually deliver to a handset. */
  readonly delivers: boolean;
  send(phone: string, code: string): Promise<OtpDeliveryResult>;
}

/**
 * Delivers nothing, and accepts one known code.
 *
 * This is how the platform is tested before a vendor exists: a tester types
 * any phone number and the code from `OTP_FIXED_CODE`. It is refused in
 * production unless `OTP_ALLOW_FIXED_IN_PRODUCTION` is set deliberately —
 * see `otpService.ts`, which enforces that rather than this file.
 *
 * The code is never written to the logs. A fixed code in a log is a
 * credential in a log.
 */
export const fixedDriver: OtpDriver = {
  name: 'fixed',
  delivers: false,
  async send(phone: string): Promise<OtpDeliveryResult> {
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'OTP_FIXED_DRIVER_NOOP',
      phone: maskPhone(phone),
      note: 'No SMS sent. The configured fixed code is accepted.'
    }));
    return { accepted: true, reference: 'fixed-no-delivery' };
  }
};

/**
 * MSG91 — the usual choice for Indian OTP traffic.
 *
 * Not wired to the network yet because there is no account and no approved
 * template; it refuses rather than pretending to send. To finish it: POST to
 * https://control.msg91.com/api/v5/flow/ with `authkey`, the approved
 * `template_id`, the DLT sender header, and the recipient in `mobiles` as
 * 91XXXXXXXXXX. Everything else here already fits.
 */
export const msg91Driver: OtpDriver = {
  name: 'msg91',
  delivers: true,
  async send(phone: string, _code: string): Promise<OtpDeliveryResult> {
    if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_TEMPLATE_ID) {
      return {
        accepted: false,
        error: 'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are not set, and the DLT template must be approved first.'
      };
    }
    return {
      accepted: false,
      error: 'MSG91 driver is not implemented. Complete the flow call described above before selecting this provider.'
    };
  }
};

/**
 * Twilio Verify — best documentation, highest per-message cost to India, and
 * still subject to the same DLT registration. Same state as MSG91: the shape
 * is here, the network call is not.
 */
export const twilioDriver: OtpDriver = {
  name: 'twilio',
  delivers: true,
  async send(): Promise<OtpDeliveryResult> {
    return {
      accepted: false,
      error: 'Twilio driver is not implemented. Provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a verify service id.'
    };
  }
};

const DRIVERS: Record<string, OtpDriver> = {
  fixed: fixedDriver,
  msg91: msg91Driver,
  twilio: twilioDriver
};

export function activeDriver(): OtpDriver {
  return DRIVERS[config.OTP_PROVIDER] || fixedDriver;
}

/**
 * `98765*****` — enough to recognise a number in a log line, not enough to
 * dial it. Phone numbers are personal data and logs are read by more people,
 * and kept for longer, than anyone intends.
 */
export function maskPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 5) return '*****';
  return `${digits.slice(0, 5)}${'*'.repeat(digits.length - 5)}`;
}
