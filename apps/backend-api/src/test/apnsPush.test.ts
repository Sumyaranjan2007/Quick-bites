/**
 * IPHONE PUSH: Apple's service carries iPhone tokens, FCM keeps Android's.
 *
 * Before this, an iPhone token went to FCM, FCM answered 400, and the token was
 * marked dead — so an iPhone customer was never told their food had arrived.
 *
 * Two fake Apple hosts stand in for production and sandbox (plain HTTP/2 on
 * localhost). The checks assert what Apple actually needs: a JWT signed ES256
 * with our key id and team, the bundle id as topic, an alert payload, and the
 * pruning rule — 410 and a token BOTH hosts refuse are dead, a 5xx is not.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import jwt from 'jsonwebtoken';

const PROD_PORT = 5231;
const SANDBOX_PORT = 5232;

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

// Set before the config module is first imported, which reads them once.
process.env.APNS_KEY_ID = 'KEY1234567';
process.env.APNS_TEAM_ID = 'TEAM765432';
// Escaped newlines, the way Railway stores a pasted multi-line key.
process.env.APNS_PRIVATE_KEY = pem.replace(/\n/g, '\\n');
process.env.APNS_HOST = `http://127.0.0.1:${PROD_PORT},http://127.0.0.1:${SANDBOX_PORT}`;
delete process.env.FCM_SERVICE_ACCOUNT_JSON;

const { sendToApns, apnsIsConfigured } = await import('../notifications/apnsTransport.ts');
const { fcmDispatcher } = await import('../notifications/fcmDispatcher.ts');
const { deviceTokenRepository } = await import('../db/repositories/deviceTokenRepository.ts');

interface Seen {
  host: 'prod' | 'sandbox';
  token: string;
  headers: http2.IncomingHttpHeaders;
  body: any;
}
const seen: Seen[] = [];

/** What each fake host answers, by token. */
function reply(host: 'prod' | 'sandbox', token: string): [number, string?] {
  if (token === 'gone') return [410, 'Unregistered'];
  if (token === 'nowhere') return [400, 'BadDeviceToken'];
  if (token === 'sandboxonly') return host === 'prod' ? [400, 'BadDeviceToken'] : [200];
  if (token === 'flaky') return [500, 'InternalServerError'];
  if (token === 'wrongtopic') return [400, 'BadTopic'];
  return [200];
}

function fakeApple(host: 'prod' | 'sandbox', port: number): Promise<http2.Http2Server> {
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let raw = '';
    stream.on('data', c => (raw += c));
    stream.on('end', () => {
      const token = String(headers[':path']).replace('/3/device/', '');
      seen.push({ host, token, headers, body: raw ? JSON.parse(raw) : null });
      const [status, reason] = reply(host, token);
      stream.respond({ ':status': status });
      stream.end(reason ? JSON.stringify({ reason }) : '');
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
}

const servers = [await fakeApple('prod', PROD_PORT), await fakeApple('sandbox', SANDBOX_PORT)];

try {
  it('is configured from the three Apple values', () => assert.equal(apnsIsConfigured(), true));

  const message = {
    title: 'Out for delivery',
    body: 'Your order #QB1 is on its way.',
    data: { orderId: 'ord_1', count: 3 as any },
    androidTag: 'order-ord_1'
  };
  const outcome = await sendToApns(
    ['good', 'gone', 'nowhere', 'sandboxonly', 'flaky', 'wrongtopic'],
    message
  );

  it('delivers to a production token and to a sandbox (Xcode) token', () =>
    assert.equal(outcome.delivered, 2));
  it('prunes only 410 and a token both hosts refuse', () =>
    assert.deepEqual([...outcome.invalid].sort(), ['gone', 'nowhere']));
  it('tries sandbox only after production says BadDeviceToken', () => {
    const sandboxTokens = seen.filter(s => s.host === 'sandbox').map(s => s.token).sort();
    assert.deepEqual(sandboxTokens, ['nowhere', 'sandboxonly']);
  });

  const good = seen.find(s => s.token === 'good' && s.host === 'prod')!;
  it('signs a JWT Apple accepts: ES256, our key id, our team', () => {
    const token = String(good.headers.authorization).replace(/^bearer /, '');
    const decoded = jwt.verify(token, publicKey.export({ type: 'spki', format: 'pem' }).toString(), {
      algorithms: ['ES256'],
      complete: true
    }) as any;
    assert.equal(decoded.header.kid, 'KEY1234567');
    assert.equal(decoded.payload.iss, 'TEAM765432');
  });
  it('addresses the customer app as an alert, high priority, collapsing by tag', () => {
    assert.equal(good.headers['apns-topic'], 'com.quickbite.app');
    assert.equal(good.headers['apns-push-type'], 'alert');
    assert.equal(good.headers['apns-priority'], '10');
    assert.equal(good.headers['apns-collapse-id'], 'order-ord_1');
  });
  it('sends the title, body, a sound, and the data as strings', () => {
    assert.deepEqual(good.body.aps, {
      alert: { title: 'Out for delivery', body: 'Your order #QB1 is on its way.' },
      sound: 'default'
    });
    assert.equal(good.body.orderId, 'ord_1');
    assert.equal(good.body.count, '3');
  });

  // The dispatcher: one customer with an iPhone and an Android phone.
  seen.length = 0;
  const userId = 'usr_apns_test';
  await deviceTokenRepository.register({ userId, role: 'CUSTOMER' as any, token: 'gone', platform: 'IOS' });
  await deviceTokenRepository.register({ userId, role: 'CUSTOMER' as any, token: 'android-fcm-token', platform: 'ANDROID' });
  await fcmDispatcher.sendPushNotification({ userId, title: 'Order Confirmed', body: 'Received.' });
  for (let i = 0; i < 50 && !(await deviceTokenRepository.listForUser(userId)).every(d => d.platform !== 'IOS'); i++) {
    await new Promise(r => setTimeout(r, 50));
  }

  it('routes only the iPhone token to Apple, never the Android one', () =>
    assert.deepEqual([...new Set(seen.map(s => s.token))], ['gone']));
  const live = await deviceTokenRepository.listForUser(userId);
  it('marks the uninstalled iPhone dead and leaves the Android phone alone', () =>
    assert.deepEqual(live.map(d => d.token), ['android-fcm-token']));
} finally {
  for (const s of servers) s.close();
}

console.log(`\napnsPush: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
