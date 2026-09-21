/**
 * Notifications that can actually reach a phone.
 *
 * Before this, `fcmDispatcher` was called from nine places and every one of
 * them appended to an array and wrote a line to standard output. There was no
 * device token anywhere in the system, no transport, and no way for any
 * notification this platform has ever "sent" to reach anybody.
 *
 * The delivery itself cannot be asserted here — that needs a Firebase project,
 * which is the owner's to create. What IS asserted is everything up to the
 * wire, and the two properties that decide whether the feature works at all
 * on the day that credential arrives:
 *
 *   registering is idempotent on the token, or one phone collects a row per
 *   launch and receives every notification a dozen times
 *
 *   a deployment with no credential behaves exactly as it did before and says
 *   so, rather than promising a notification it cannot send
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';
import { deviceTokenRepository } from '../db/repositories/deviceTokenRepository.ts';
import { pushIsConfigured } from '../notifications/fcmTransport.ts';

const PORT = 5203;
const API = `http://127.0.0.1:${PORT}/api`;

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(email: string, password = 'pass123') {
  resetAuthRateLimit();
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

const TOKEN_A = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function run() {
  console.log('====================================================');
  console.log('   NOTIFICATIONS REACH A DEVICE, NOT A LOG FILE     ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 300));

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');

  // -------------------------------------------------------------------
  console.log('\n-- Registering a device');

  const first = await api(
    '/devices',
    { method: 'POST', body: { token: TOKEN_A, platform: 'ANDROID', appVersion: '1.0.0' } },
    customer.token
  );
  check('An app can register its push token', first.status === 201, `status ${first.status}`);
  check(
    'and is told whether this deployment can actually deliver',
    typeof first.json?.data?.deliveryConfigured === 'boolean',
    JSON.stringify(first.json?.data)
  );
  check(
    'which is false here, because no Firebase credential is configured',
    first.json?.data?.deliveryConfigured === false && pushIsConfigured() === false
  );

  /*
   * THE PROPERTY THAT DECIDES WHETHER THIS WORKS AT ALL.
   *
   * Every app registers on every launch, because FCM rotates tokens. If that
   * created a row each time, one phone would hold twenty rows within a week
   * and every notification would arrive twenty times.
   */
  for (let i = 0; i < 5; i += 1) {
    await api(
      '/devices',
      { method: 'POST', body: { token: TOKEN_A, platform: 'ANDROID', appVersion: '1.0.1' } },
      customer.token
    );
  }
  const afterRepeats = await deviceTokenRepository.listForUser(customer.user.id);
  check(
    'Registering the same token repeatedly keeps ONE row',
    afterRepeats.filter(d => d.token === TOKEN_A).length === 1,
    String(afterRepeats.filter(d => d.token === TOKEN_A).length)
  );
  check(
    'and the row is refreshed rather than stale',
    afterRepeats.find(d => d.token === TOKEN_A)?.appVersion === '1.0.1',
    afterRepeats.find(d => d.token === TOKEN_A)?.appVersion
  );

  // A person with two devices must be reached on both.
  await api(
    '/devices',
    { method: 'POST', body: { token: TOKEN_B, platform: 'ANDROID' } },
    customer.token
  );
  const twoDevices = await deviceTokenRepository.listForUser(customer.user.id);
  check('A second device is a second row', twoDevices.length === 2, String(twoDevices.length));

  // -------------------------------------------------------------------
  console.log('\n-- A phone that changes hands');

  /*
   * A shared kitchen phone is re-registered by the next partner on the same
   * token. The row has to follow the person now holding it, or the previous
   * one keeps receiving somebody else's orders.
   */
  await api(
    '/devices',
    { method: 'POST', body: { token: TOKEN_B, platform: 'ANDROID' } },
    partner.token
  );
  const oldOwner = await deviceTokenRepository.listForUser(customer.user.id);
  const newOwner = await deviceTokenRepository.listForUser(partner.user.id);
  check(
    'The device follows whoever signed in last',
    newOwner.some(d => d.token === TOKEN_B),
    JSON.stringify(newOwner.map(d => d.token))
  );
  check(
    'and stops reaching the previous person',
    !oldOwner.some(d => d.token === TOKEN_B),
    JSON.stringify(oldOwner.map(d => d.token))
  );

  // -------------------------------------------------------------------
  console.log('\n-- Signing out');

  const removed = await api(`/devices/${TOKEN_A}`, { method: 'DELETE' }, customer.token);
  check('Signing out removes that device', removed.status === 200 && removed.json?.data?.removed === true);
  check(
    'and it is gone',
    !(await deviceTokenRepository.listForUser(customer.user.id)).some(d => d.token === TOKEN_A)
  );

  // One person must not be able to unregister another's device by guessing.
  await api('/devices', { method: 'POST', body: { token: TOKEN_A, platform: 'ANDROID' } }, partner.token);
  const trespass = await api(`/devices/${TOKEN_A}`, { method: 'DELETE' }, customer.token);
  check(
    'and a customer cannot unregister somebody else’s device',
    trespass.json?.data?.removed === false,
    JSON.stringify(trespass.json?.data)
  );
  check(
    'so it still reaches its real owner',
    (await deviceTokenRepository.listForUser(partner.user.id)).some(d => d.token === TOKEN_A)
  );

  // -------------------------------------------------------------------
  console.log('\n-- What may be registered');

  const noAuth = await api('/devices', {
    method: 'POST',
    body: { token: TOKEN_A, platform: 'ANDROID' }
  });
  check('An unauthenticated caller is refused', noAuth.status === 401, `status ${noAuth.status}`);

  const rubbish = await api(
    '/devices',
    { method: 'POST', body: { token: 'short', platform: 'ANDROID' } },
    customer.token
  );
  check('A token too short to be one is refused', rubbish.status === 400, `status ${rubbish.status}`);

  const badPlatform = await api(
    '/devices',
    { method: 'POST', body: { token: TOKEN_B, platform: 'SYMBIAN' } },
    customer.token
  );
  check('An unknown platform is refused', badPlatform.status === 400, `status ${badPlatform.status}`);

  /*
   * The role is taken from the SESSION, never from the request. An app that
   * could name its own role could register as a rider and receive other
   * people's delivery offers.
   */
  const claimed = await api(
    '/devices',
    { method: 'POST', body: { token: TOKEN_B, platform: 'ANDROID', role: 'rider' } },
    customer.token
  );
  const claimedRow = (await deviceTokenRepository.listForUser(customer.user.id)).find(
    d => d.token === TOKEN_B
  );
  check(
    'An app cannot name its own role',
    claimed.status === 201 && claimedRow?.role === 'customer',
    claimedRow?.role
  );

  // -------------------------------------------------------------------
  console.log('\n-- A dead token is not used forever');

  await deviceTokenRepository.invalidate(TOKEN_B);
  check(
    'A token the service rejected stops being delivered to',
    !(await deviceTokenRepository.listForUser(customer.user.id)).some(d => d.token === TOKEN_B)
  );
  check(
    'but is kept on record rather than deleted',
    Array.from(memoryStore.deviceTokens.values()).some(
      (d: any) => d.token === TOKEN_B && d.invalidatedAt
    )
  );

  /*
   * And re-registering brings it back. A token that failed once in a network
   * blip must not be dead permanently — the phone is still there and the app
   * will register again on its next launch.
   */
  await api('/devices', { method: 'POST', body: { token: TOKEN_B, platform: 'ANDROID' } }, customer.token);
  check(
    'Re-registering revives it, so one bad moment is not permanent',
    (await deviceTokenRepository.listForUser(customer.user.id)).some(d => d.token === TOKEN_B)
  );

  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  THERE IS SOMEWHERE FOR A NOTIFICATION TO GO      ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
    return;
  }
  console.log(`  NOTIFICATIONS BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  setTimeout(() => process.exit(1), 100);
}

run().catch(err => {
  console.error('[FAIL] Notifications suite aborted:', err.message);
  process.exit(1);
});
