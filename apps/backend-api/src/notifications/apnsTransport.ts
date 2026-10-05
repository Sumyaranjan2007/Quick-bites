import http2 from 'node:http2';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import type { DeliveryOutcome, PushMessage } from './fcmTransport.ts';

/**
 * Apple's push service, for the customer app on iPhone.
 *
 * FCM cannot carry these. An iPhone registers a raw APNs device token, and
 * FCM's send endpoint answers 400 INVALID_ARGUMENT for it — which the FCM
 * transport reads, correctly for Android, as "this device is gone" and marks
 * the token dead. So iPhone tokens come here instead, and nothing about the
 * Android path changes.
 *
 * Signed with the team's .p8 key (token-based auth), so there is no
 * certificate to renew every year. Unset, every iPhone notification is
 * skipped and the order still reaches the app over the socket while it is open.
 *
 * TWO HOSTS. An App Store or TestFlight install has a production token; an
 * Xcode run on a test phone has a sandbox one, and each host refuses the
 * other's with 400 BadDeviceToken. Trying production first and then sandbox
 * means no setting to get wrong; only a token BOTH refuse is dead.
 */

const TIMEOUT_MS = 5000;
const HOSTS = ['https://api.push.apple.com', 'https://api.sandbox.push.apple.com'];

export function apnsIsConfigured(): boolean {
  return Boolean(config.APNS_KEY_ID && config.APNS_TEAM_ID && config.APNS_PRIVATE_KEY);
}

let cachedJwt: { value: string; issuedAt: number } | null = null;

/** Apple accepts a token for an hour and throttles one refreshed more often than every 20 minutes. */
function providerToken(): string {
  const now = Date.now();
  if (cachedJwt && now - cachedJwt.issuedAt < 50 * 60 * 1000) return cachedJwt.value;
  // Railway stores a multi-line value with its newlines escaped.
  const key = config.APNS_PRIVATE_KEY.replace(/\\n/g, '\n');
  const value = jwt.sign({ iss: config.APNS_TEAM_ID }, key, {
    algorithm: 'ES256',
    keyid: config.APNS_KEY_ID
  });
  cachedJwt = { value, issuedAt: now };
  return value;
}

/** Test hook: forget the signed token, so a suite can change the key. */
export function resetApnsForTesting(): void {
  cachedJwt = null;
}

function payload(message: PushMessage): string {
  const data = Object.fromEntries(
    Object.entries(message.data || {}).map(([k, v]) => [k, String(v)])
  );
  const aps = message.dataOnly
    ? { 'content-available': 1 }
    : { alert: { title: message.title, body: message.body }, sound: 'default' };
  return JSON.stringify({ aps, ...data });
}

interface ApnsReply {
  status: number;
  reason?: string;
}

function post(session: http2.ClientHttp2Session, token: string, message: PushMessage): Promise<ApnsReply> {
  return new Promise(resolve => {
    const headers: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': config.APNS_BUNDLE_ID,
      'apns-push-type': message.dataOnly ? 'background' : 'alert',
      'apns-priority': message.dataOnly ? '5' : '10',
      // The iPhone counterpart of Android's tag: a later push with the same id replaces this one.
      ...(message.androidTag ? { 'apns-collapse-id': message.androidTag.slice(0, 64) } : {})
    };
    const req = session.request(headers);
    let status = 0;
    let body = '';
    req.setTimeout(TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on('response', h => (status = Number(h[':status']) || 0));
    req.on('data', chunk => (body += chunk));
    req.on('close', () => {
      let reason: string | undefined;
      try {
        reason = body ? JSON.parse(body).reason : undefined;
      } catch {
        // Not JSON: a proxy page or a cut connection. Treated as a transient failure.
      }
      resolve({ status, reason });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end(payload(message));
  });
}

function connect(host: string): http2.ClientHttp2Session {
  const session = http2.connect(host);
  // A refused connection must not crash the server; each request then resolves with status 0.
  session.on('error', () => undefined);
  return session;
}

export async function sendToApns(tokens: string[], message: PushMessage): Promise<DeliveryOutcome> {
  if (!apnsIsConfigured() || tokens.length === 0) {
    return { delivered: 0, invalid: [], skipped: !apnsIsConfigured() };
  }

  const hosts = config.APNS_HOST ? config.APNS_HOST.split(',') : HOSTS;
  const sessions = new Map<string, http2.ClientHttp2Session>();
  const sessionFor = (host: string) => {
    if (!sessions.has(host)) sessions.set(host, connect(host));
    return sessions.get(host)!;
  };

  let delivered = 0;
  const invalid: string[] = [];

  try {
    await Promise.all(
      tokens.map(async token => {
        let reply: ApnsReply = { status: 0 };
        for (const host of hosts) {
          reply = await post(sessionFor(host), token, message);
          // Only a wrong-environment token is worth trying on the other host.
          if (!(reply.status === 400 && reply.reason === 'BadDeviceToken')) break;
        }
        if (reply.status === 200) {
          delivered += 1;
          return;
        }
        /*
         * 410 is Apple saying the app was removed. BadDeviceToken from every
         * host is a token that belongs nowhere. Anything else — a 5xx, a
         * timeout, a wrong topic or key — is ours or Apple's to fix and must
         * not cost the customer their notifications permanently.
         */
        if (reply.status === 410 || (reply.status === 400 && reply.reason === 'BadDeviceToken')) {
          invalid.push(token);
        } else {
          console.error(
            JSON.stringify({ level: 'ERROR', event: 'APNS_SEND_FAILED', status: reply.status, reason: reply.reason })
          );
        }
      })
    );
  } catch (err: any) {
    // A key that cannot sign (pasted wrongly on Railway) lands here, for every token at once.
    console.error(JSON.stringify({ level: 'ERROR', event: 'APNS_SEND_FAILED', message: err?.message }));
  } finally {
    for (const session of sessions.values()) session.close();
  }

  return { delivered, invalid, skipped: false };
}
