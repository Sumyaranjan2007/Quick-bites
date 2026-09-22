import { config } from '../../config/env.ts';

/**
 * Letting a rider and a customer speak without either learning the other's number.
 *
 * WHAT THE INDUSTRY ACTUALLY DOES. Every large delivery platform rents a small
 * pool of virtual numbers from a telephony operator. When a rider taps Call,
 * the platform asks the operator to bridge the two parties: the operator rings
 * the rider, and when they answer, rings the customer and joins the legs. Both
 * handsets show the VIRTUAL number, never each other's. The mapping lives on
 * the platform for the life of the trip and is thrown away afterwards, so a
 * redial the next day reaches nobody.
 *
 * This is "call masking", or "number masking". It is not something that can be
 * done in software alone — a phone call has to be carried by somebody licensed
 * to carry phone calls, which is why it costs money per minute and why there is
 * no free version of it.
 *
 * WHY IT MATTERS HERE, beyond privacy in the abstract: a delivery app that
 * hands out permanent numbers has, over a year, handed every rider a contact
 * list of the women whose flats they have been to. `contactVisibility.ts`
 * already narrows that window to the life of the trip, which is the best that
 * can be done without an operator. This closes it completely.
 *
 * PROVIDER-AGNOSTIC ON PURPOSE. Exotel is the default because it is what most
 * Indian food platforms use and its connect-two-numbers call is a single
 * request, but nothing above this file knows that. A different operator is a
 * different `placeCall` and no change anywhere else.
 *
 * WITHOUT CREDENTIALS NOTHING BREAKS. Masked calling reports itself
 * unconfigured, the apps keep showing the direct number for the life of the
 * trip exactly as they do today, and no call is attempted. The moment the
 * credentials exist, the apps switch to the masked route and the direct number
 * stops being sent at all.
 */

export type CallMaskingProvider = 'EXOTEL' | 'NONE';

export function callMaskingProvider(): CallMaskingProvider {
  return config.EXOTEL_SID && config.EXOTEL_API_KEY && config.EXOTEL_API_TOKEN && config.EXOTEL_CALLER_ID
    ? 'EXOTEL'
    : 'NONE';
}

export function isCallMaskingConfigured(): boolean {
  return callMaskingProvider() !== 'NONE';
}

export interface MaskedCallRequest {
  /** The party who tapped Call. The operator rings this one first. */
  callerNumber: string;
  /** The party they want to reach. Rung once the caller picks up. */
  calleeNumber: string;
  /** Ours, for the audit trail. Never sent to either handset. */
  orderNumber: string;
}

export interface MaskedCallResult {
  ok: boolean;
  /** The operator's id for this call, for support to trace a complaint. */
  callSid?: string;
  /** The virtual number both parties will see. Safe to show in the app. */
  displayNumber?: string;
  error?: string;
}

/** Ten digits become +91XXXXXXXXXX. Exotel rejects bare local numbers. */
function toE164(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

/** Last three digits only, for logs. A full number in a log is the same leak. */
function tail(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 3 ? `*****${digits.slice(-3)}` : '*****';
}

/**
 * Bridges two people through a rented number.
 *
 * Returns a result rather than throwing, because the caller is a route that
 * has to tell a rider standing at a gate something useful. "Could not connect,
 * try again" is actionable; a 500 is not.
 */
export async function placeMaskedCall(request: MaskedCallRequest): Promise<MaskedCallResult> {
  if (!isCallMaskingConfigured()) {
    return { ok: false, error: 'CALL_MASKING_NOT_CONFIGURED' };
  }

  const endpoint = `https://api.exotel.com/v1/Accounts/${config.EXOTEL_SID}/Calls/connect.json`;
  const auth = Buffer.from(`${config.EXOTEL_API_KEY}:${config.EXOTEL_API_TOKEN}`).toString('base64');

  const body = new URLSearchParams({
    From: toE164(request.callerNumber),
    To: toE164(request.calleeNumber),
    // The rented number. This is what both handsets display, and it is the
    // whole point: neither leg ever carries the other party's digits.
    CallerId: config.EXOTEL_CALLER_ID,
    // Bounded so a forgotten open line cannot run up a bill for an hour.
    TimeLimit: '600',
    TimeOut: '30',
    CallType: 'trans'
  });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          event: 'MASKED_CALL_FAILED',
          status: res.status,
          orderNumber: request.orderNumber,
          caller: tail(request.callerNumber),
          callee: tail(request.calleeNumber)
        })
      );
      return { ok: false, error: 'CALL_NOT_CONNECTED' };
    }

    const payload = (await res.json()) as any;
    const callSid = payload?.Call?.Sid ? String(payload.Call.Sid) : undefined;

    console.log(
      JSON.stringify({
        level: 'INFO',
        event: 'MASKED_CALL_PLACED',
        orderNumber: request.orderNumber,
        callSid,
        // Never the numbers themselves. A support engineer reading this needs
        // to know a call happened and which order it belonged to.
        caller: tail(request.callerNumber),
        callee: tail(request.calleeNumber)
      })
    );

    return { ok: true, callSid, displayNumber: config.EXOTEL_CALLER_ID };
  } catch (err: any) {
    console.error(
      JSON.stringify({ level: 'ERROR', event: 'MASKED_CALL_ERROR', message: err?.message })
    );
    return { ok: false, error: 'CALL_NOT_CONNECTED' };
  }
}
