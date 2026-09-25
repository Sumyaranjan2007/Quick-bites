import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';

/**
 * How long we wait on Google before giving up.
 *
 * Both calls below were bare `fetch()`. Node's fetch is undici, whose header
 * timeout defaults to five minutes, and a connection that BLACKHOLES rather
 * than refuses does not error -- it goes quiet. A try/catch does not help with
 * silence; it catches rejections, and there is no rejection to catch.
 *
 * Delivery is not awaited by the caller, so a hang does not hold up an order --
 * there is a check in kitchenPush.test.ts that hangs the transport deliberately
 * and fails if placing an order ever starts waiting on it. But an un-timed
 * request still holds a socket and its buffers for those five minutes, once per
 * device token, and every order dispatches at least two. That is a resource
 * leak with a slow outage as its trigger, which is exactly when the platform
 * can least afford one.
 */
const PUSH_TIMEOUT_MS = 5000;

/**
 * Actually delivering a notification to a phone.
 *
 * Everything above this file already existed: nine call sites, a dispatcher, a
 * payload with a title and a body. What did not exist was any way for any of
 * it to reach a device. `sendPushNotification` appended to an array and wrote
 * a line to standard output, and that was the entire notification system.
 *
 * TURNED ON BY A CREDENTIAL, NOT BY A RELEASE.
 *
 * With no `FCM_SERVICE_ACCOUNT_JSON`, every notification is logged exactly as
 * it was before, and nothing crashes. The moment that variable is set, the
 * same notifications are delivered. There is no flag to flip, no second code
 * path to keep in step, and no build to cut — the same rule the owner asked
 * for over Maps billing, applied here.
 *
 * That is deliberate and it is why this is a transport rather than a switch:
 * a system that behaves differently in development from production is one
 * whose production behaviour nobody has run.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let parsed: ServiceAccount | null | undefined;

/**
 * Reads the service account once, and remembers a failure as a failure.
 *
 * `undefined` means not yet looked at; `null` means looked at and unusable.
 * Without that distinction a malformed credential is re-parsed on every
 * notification, and every one of them logs the same error.
 */
function serviceAccount(): ServiceAccount | null {
  if (parsed !== undefined) return parsed;

  const raw = config.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    parsed = null;
    return parsed;
  }

  try {
    const json = JSON.parse(raw) as ServiceAccount;
    if (!json.project_id || !json.client_email || !json.private_key) {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          event: 'FCM_CREDENTIAL_INCOMPLETE',
          // Never the key itself. This is a public repository and these logs
          // are read in a hosting dashboard.
          has: {
            project_id: Boolean(json.project_id),
            client_email: Boolean(json.client_email),
            private_key: Boolean(json.private_key)
          }
        })
      );
      parsed = null;
      return parsed;
    }
    // Railway and most dashboards store a multi-line value with the newlines
    // escaped. Left as-is, the PEM is one line and every signature fails with
    // an error that says nothing about why.
    json.private_key = json.private_key.replace(/\\n/g, '\n');
    parsed = json;
  } catch (err: any) {
    console.error(
      JSON.stringify({ level: 'ERROR', event: 'FCM_CREDENTIAL_UNREADABLE', message: err?.message })
    );
    parsed = null;
  }
  return parsed;
}

/** True when this deployment can actually deliver a notification. */
export function pushIsConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * An OAuth2 access token for FCM, from the service account.
 *
 * Cached until shortly before it expires. Google issues these for an hour and
 * rate-limits the exchange, so minting one per notification would fail under
 * exactly the load that matters — a busy dinner service.
 */
async function accessToken(): Promise<string | null> {
  const account = serviceAccount();
  if (!account) return null;

  // Sixty seconds of slack, so a token cannot expire between the check and the
  // request that uses it.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    },
    account.private_key,
    { algorithm: 'RS256' }
  );

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });

    if (!res.ok) {
      console.error(
        JSON.stringify({ level: 'ERROR', event: 'FCM_TOKEN_EXCHANGE_FAILED', status: res.status })
      );
      return null;
    }

    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;

    cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
    };
    return cachedToken.value;
  } catch (err: any) {
    console.error(
      JSON.stringify({ level: 'ERROR', event: 'FCM_TOKEN_EXCHANGE_ERROR', message: err?.message })
    );
    return null;
  }
}

export interface DeliveryOutcome {
  delivered: number;
  /** Tokens the service rejected as dead. The caller stops using them. */
  invalid: string[];
  /** True when no credential is configured, so nothing was attempted. */
  skipped: boolean;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
  /**
   * The Android notification channel. The partner and rider apps create
   * channels with their own sounds, and a message with no channel is delivered
   * silently — which for a kitchen alert is the same as not delivering it.
   */
  androidChannelId?: string;
  /**
   * Android's notification tag. A later message with the SAME tag REPLACES the
   * earlier one in the tray instead of stacking beside it.
   *
   * This is what stops a rider accumulating one entry per wave for a single
   * trip. Dispatch re-offers an order every few minutes until somebody takes it,
   * and without a tag a trip nobody accepts for twenty minutes leaves four
   * identical alarms — at which point the rider clears the lot and stops
   * looking.
   */
  androidTag?: string;
  /**
   * Send DATA ONLY, with no notification block.
   *
   * Android shows nothing for such a message and hands it to the app, which is
   * the only way to WITHDRAW something already in the tray: there is no "delete
   * that notification" message type, so the app has to be told and do it itself.
   *
   * A visible replacement is not an option here. Channel importance and sound
   * are fixed when the app creates the channel, so a "that trip is gone" message
   * on the rider's `new-orders` channel would play the looping alarm again — a
   * worse outcome than the stale entry it was trying to clear.
   */
  dataOnly?: boolean;
}

/**
 * Sends one message to a set of device tokens.
 *
 * Each token is sent individually rather than through the multicast endpoint,
 * because the per-token result is what tells us which devices are dead — and a
 * dead token that is never pruned means a notification is "sent" successfully
 * forever to a phone that uninstalled the app months ago.
 */
export async function sendToTokens(tokens: string[], message: PushMessage): Promise<DeliveryOutcome> {
  const account = serviceAccount();
  if (!account || tokens.length === 0) {
    return { delivered: 0, invalid: [], skipped: !account };
  }

  const auth = await accessToken();
  if (!auth) return { delivered: 0, invalid: [], skipped: false };

  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  let delivered = 0;
  const invalid: string[] = [];

  const results = await Promise.allSettled(
    tokens.map(async token => {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            // Omitted entirely for a data-only message. An empty notification
            // block is not the same thing: Android draws a blank entry for it.
            ...(message.dataOnly
              ? {}
              : { notification: { title: message.title, body: message.body } }),
            // Data values must be strings; a number here is rejected by the
            // API with a message that does not say which field.
            data: Object.fromEntries(
              Object.entries(message.data || {}).map(([k, v]) => [k, String(v)])
            ),
            android: {
              priority: 'HIGH',
              ...(message.dataOnly
                ? {}
                : {
                    notification: {
                      channel_id: message.androidChannelId || 'default',
                      sound: 'default',
                      ...(message.androidTag ? { tag: message.androidTag } : {})
                    }
                  })
            }
          }
        })
      });

      if (res.ok) return { token, ok: true as const };

      /*
       * 404 UNREGISTERED and 400 INVALID_ARGUMENT on the token mean this
       * device is gone. Anything else — a 500, a timeout, a rate limit — is
       * the service having a bad moment and must NOT cost somebody their
       * notifications permanently.
       */
      const dead = res.status === 404 || res.status === 400;
      return { token, ok: false as const, dead };
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.ok) delivered += 1;
    else if ((result.value as any).dead) invalid.push(result.value.token);
  }

  return { delivered, invalid, skipped: false };
}
