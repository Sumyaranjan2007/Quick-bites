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
 * MSG91 (owner's choice, 4 Oct 2026) — sends the code this server made through
 * MSG91's SendOTP API, using the owner's DLT-approved OTP template.
 * https://msg91.com/help/sendotp/where-to-find-the-sendotp-api-how-to-get-template-id
 *
 *   POST https://control.msg91.com/api/v5/otp?template_id=..&mobile=91XXXXXXXXXX&otp=..
 *   header authkey: MSG91_AUTH_KEY
 *   -> {"type":"success","request_id":".."} | {"type":"error","message":".."}
 *
 * The template must contain the OTP variable (##OTP##) and be approved on DLT,
 * or operators drop the message. The key travels in a header and is never logged.
 */
export const msg91Driver: OtpDriver = {
  name: 'msg91',
  delivers: true,
  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
    const key = process.env.MSG91_AUTH_KEY || '';
    const template = process.env.MSG91_TEMPLATE_ID || '';
    if (!key || !template) {
      return { accepted: false, error: 'MSG91_AUTH_KEY and MSG91_TEMPLATE_ID must both be set.' };
    }
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    const query = new URLSearchParams({
      template_id: template,
      mobile: `91${digits}`,
      otp: code,
      otp_expiry: String(config.OTP_TTL_MINUTES),
      realTimeResponse: '1'
    });
    try {
      const res = await fetch(`https://control.msg91.com/api/v5/otp?${query.toString()}`, {
        method: 'POST',
        headers: { authkey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10_000)
      });
      const body: any = await res.json().catch(() => null);
      if (res.ok && body?.type === 'success') return { accepted: true, reference: String(body.request_id || '') };
      return { accepted: false, error: `MSG91 refused: ${String(body?.message || res.status)}` };
    } catch (err: any) {
      return { accepted: false, error: `MSG91 unreachable: ${err?.name || 'error'}` };
    }
  }
};

/**
 * Twilio Verify — best documentation, highest per-message cost to India, and
 * still subject to the same DLT registration. Only the shape is here; the
 * network call is not written.
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

/**
 * 2Factor.in (owner's choice, 4 Oct 2026): sends the code this server made,
 * through 2Factor's own DLT-approved OTP template unless TWOFACTOR_TEMPLATE
 * names one of yours. https://2factor.in/API/DOCS/SMS_OTP.html
 *
 *   GET https://2factor.in/API/V1/{key}/SMS/{phone}/{code}[/{template}]
 *   -> {"Status":"Success","Details":"<session id>"} | {"Status":"Error","Details":"..."}
 *
 * The key is part of the URL, so the URL is never logged; only the provider's
 * answer is.
 */
export const twoFactorDriver: OtpDriver = {
  name: '2factor',
  delivers: true,
  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
    const key = process.env.TWOFACTOR_API_KEY || '';
    if (!key) return { accepted: false, error: 'TWOFACTOR_API_KEY is not set.' };
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    const template = (process.env.TWOFACTOR_TEMPLATE || '').trim();
    const url =
      `https://2factor.in/API/V1/${encodeURIComponent(key)}/SMS/${digits}/${encodeURIComponent(code)}` +
      (template ? `/${encodeURIComponent(template)}` : '');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body: any = await res.json().catch(() => null);
      if (res.ok && body?.Status === 'Success') return { accepted: true, reference: String(body.Details || '') };
      return { accepted: false, error: `2Factor refused: ${String(body?.Details || res.status)}` };
    } catch (err: any) {
      return { accepted: false, error: `2Factor unreachable: ${err?.name || 'error'}` };
    }
  }
};

const DRIVERS: Record<string, OtpDriver> = {
  fixed: fixedDriver,
  '2factor': twoFactorDriver,
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
