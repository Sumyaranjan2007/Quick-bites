import { config } from '../config/env.ts';

/**
 * Transactional email, over whatever provider the deployment has configured.
 *
 * Password recovery was implemented end to end — request a code, verify it, set
 * a new password — but in production nothing ever delivered the code. The
 * endpoint answered "a reset code is on its way", the code went to the server
 * log, and a customer who had forgotten their password had no way to obtain it
 * short of telephoning someone with log access. The flow was not broken so much
 * as unreachable, which from the outside is the same thing.
 *
 * Deliberately provider-agnostic and dependency-free: every transactional email
 * service worth using accepts a JSON POST with a bearer token, so the deployment
 * supplies the URL, the key and the sender rather than this codebase taking on
 * an SDK it would then have to keep current.
 *
 * When no provider is configured this reports that plainly instead of claiming
 * a send. The caller uses that to tell the customer the truth.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailOutcome =
  | { delivered: true }
  | { delivered: false; reason: 'NOT_CONFIGURED' | 'PROVIDER_ERROR'; detail?: string };

export function isEmailConfigured(): boolean {
  return Boolean(config.EMAIL_API_URL && config.EMAIL_API_KEY && config.EMAIL_FROM);
}

export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  if (!isEmailConfigured()) {
    return { delivered: false, reason: 'NOT_CONFIGURED' };
  }

  try {
    const response = await fetch(config.EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.EMAIL_API_KEY}`
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text
      }),
      // A recovery request must not hang on a slow provider; the caller has a
      // response to return either way.
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'EMAIL_SEND_FAILED',
          status: response.status,
          // The body may name the rejected address; it never contains the code,
          // which is assembled by the caller and not passed through here.
          detail: detail.slice(0, 300)
        })
      );
      return { delivered: false, reason: 'PROVIDER_ERROR', detail: `HTTP ${response.status}` };
    }

    return { delivered: true };
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'EMAIL_SEND_FAILED',
        detail: String(err?.message || err).slice(0, 300)
      })
    );
    return { delivered: false, reason: 'PROVIDER_ERROR', detail: String(err?.message || err) };
  }
}
