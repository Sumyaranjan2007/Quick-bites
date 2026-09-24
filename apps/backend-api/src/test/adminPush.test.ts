/**
 * TELLING AN ADMINISTRATOR, AND TELLING ONLY THE RIGHT ONE.
 *
 * -------------------------------------------------------------------------
 * THE CHECK THAT DECIDES WHETHER THIS FEATURE WORKS
 * -------------------------------------------------------------------------
 * "An administrator was notified" passes just as well when the notification went
 * to every administrator, and going to everybody is the failure this whole
 * feature is built to avoid: a support administrator who keeps receiving payout
 * alerts they cannot act on learns that admin notifications are noise, and the
 * next one they dismiss is the one that mattered.
 *
 * So every check here asserts BOTH halves — it reached somebody who can act, and
 * it did NOT reach somebody who cannot. The seed gives us exactly the two people
 * needed: a finance administrator and a support administrator, with disjoint
 * permissions.
 *
 * -------------------------------------------------------------------------
 * AND THE CHANNEL IDS ARE READ OUT OF THE APP
 * -------------------------------------------------------------------------
 * A channel id is one contract written twice, in two packages. Comparing the
 * server's constant with a copy of the same string in this file proves only that
 * this file is self-consistent — which is exactly how three different spellings
 * of one channel survived in production until §8.1, with an alarm built to wake a
 * kitchen addressed to a channel that existed on no phone.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING. Session A hit this in step 9: a grep
 * over app source matches the comment explaining the code as readily as the code,
 * and `adminChannels.ts` documents both ids at length. Deleting the explanation
 * to satisfy a grep throws away the only thing stopping the next person undoing
 * the change, so the check is made to assert what it claims instead.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resolveAccess } from '../modules/admin/permissions.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import {
  ADMIN_CHANNEL,
  notifyAdminsSosRaised,
  notifyAdminsBankAccountFiled,
  notifyAdminsRefundRaised,
  notifyAdminsSupportTicketOpened,
  resetAdminNotificationDedupeForTesting
} from '../notifications/adminNotifier.ts';

const PORT = 5218;
const API = `http://127.0.0.1:${PORT}/api`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const OWNER = 'usr_admin_01';
const FINANCE = 'usr_admin_fin';
const SUPPORT = 'usr_admin_sup';

let failed = 0;
let passed = 0;

function check(name: string, fn: () => void) {
  /*
   * An async check could never fail in this runner: the body returns a promise at
   * its first await, [PASS] is logged, and a rejected assertion becomes an
   * unhandled rejection nobody reads. Refuse the shape.
   */
  const result: any = fn();
  if (result && typeof result.then === 'function') {
    failed++;
    console.log(
      `[FAIL] ${name}: this check is async and this runner does not await, so its assertions could never fail.`
    );
    return;
  }
  passed++;
  console.log(`[PASS] ${name}`);
}

function it(name: string, fn: () => void) {
  try {
    check(name, fn);
  } catch (err: any) {
    failed++;
    passed--;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

async function api(route: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${route}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  }).catch((err: any) => ({ status: 0, __error: err?.name || String(err) }) as any);
  if (!('json' in res)) return { status: 0, json: { error: (res as any).__error } };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** App source with its comments removed. See the header. */
const appSource = (relative: string) =>
  fs
    .readFileSync(path.join(REPO, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ADMIN_CHANNELS_FILE = 'apps/admin-mobile/src/lib/adminChannels.ts';
const ADMIN_APP = 'apps/admin-mobile/App.tsx';

/**
 * What the dispatcher was actually asked to send.
 *
 * Replaces the real method rather than reading the dispatch history, because the
 * history is appended to by every other notification on the platform and a check
 * that filters a shared list is a check that can be fooled by ordering.
 */
type Sent = { userId: string; title: string; body: string; channel?: string; data?: any };
let sent: Sent[] = [];
const realSend = fcmDispatcher.sendPushNotification.bind(fcmDispatcher);

function captureSends() {
  sent = [];
  (fcmDispatcher as any).sendPushNotification = async (payload: any) => {
    sent.push({
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      channel: payload.androidChannelId,
      data: payload.data
    });
    return { ...payload, sentAt: new Date().toISOString() };
  };
}

const to = (userId: string) => sent.filter(s => s.userId === userId);

console.log('====================================================');
console.log('  THE ADMINISTRATOR GETS TOLD, AND ONLY THE RIGHT ONE');
console.log('====================================================\n');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');

try {
  /* ---------------------------------------------------------------- *
   *  PRECONDITIONS — THESE HALT                                      *
   * ---------------------------------------------------------------- */
  console.log('-- The two people this suite needs');

  /*
   * EVERY TARGETING CHECK BELOW IS VACUOUS WITHOUT THESE.
   *
   * If the finance and support accounts are not both present with different
   * permissions, "it reached finance and not support" is true because support
   * does not exist — and it stays true when the targeting is removed entirely.
   * So this throws rather than failing one check.
   */
  const financeUser = memoryStore.users.get(FINANCE) as any;
  const supportUser = memoryStore.users.get(SUPPORT) as any;
  const ownerUser = memoryStore.users.get(OWNER) as any;

  if (!financeUser || !supportUser || !ownerUser) {
    throw new Error(
      `PRECONDITION: need three staff accounts (owner ${Boolean(ownerUser)}, finance ${Boolean(
        financeUser
      )}, support ${Boolean(supportUser)}). Every targeting check would pass against whoever is missing.`
    );
  }

  const financePerms = resolveAccess(financeUser).permissions;
  const supportPerms = resolveAccess(supportUser).permissions;

  if (financePerms.includes('support.tickets.manage' as any)) {
    throw new Error(
      'PRECONDITION: the finance role holds support.tickets.manage, so "an SOS did not reach finance" cannot fail.'
    );
  }
  if (supportPerms.includes('finance.payouts.manage' as any)) {
    throw new Error(
      'PRECONDITION: the support role holds finance.payouts.manage, so "a bank account did not reach support" cannot fail.'
    );
  }

  /*
   * SOMEBODY WHO CANNOT DECIDE A REFUND, chosen by asking rather than assuming.
   *
   * I assumed this was the support administrator and the check failed: support
   * holds `finance.refunds.manage`, and rightly so. Finding the account by its
   * permissions instead means this cannot go stale when a role changes.
   */
  const refundBlind = [ownerUser, financeUser, supportUser, memoryStore.users.get('usr_admin_ops') as any]
    .filter(Boolean)
    .find(u => !resolveAccess(u).permissions.includes('finance.refunds.manage' as any));

  if (!refundBlind) {
    throw new Error(
      'PRECONDITION: every seeded staff account can decide a refund, so "it did not reach somebody who cannot" is unfalsifiable.'
    );
  }
  const REFUND_BLIND = refundBlind.id as string;
  const refundBlindPerms = resolveAccess(refundBlind).permissions;

  it('A finance administrator and a support administrator exist with disjoint powers', () => {
    assert.ok(financePerms.includes('finance.payouts.manage' as any), 'finance cannot manage payouts');
    assert.ok(supportPerms.includes('support.tickets.manage' as any), 'support cannot manage tickets');
  });

  it('and the owner, as super admin, holds both', () => {
    /*
     * The literal request — "notification of everything" — implemented correctly.
     * The owner receives every event not because the code special-cases them but
     * because a super admin holds every permission.
     */
    const owner = resolveAccess(ownerUser).permissions;
    assert.ok(owner.includes('finance.payouts.manage' as any));
    assert.ok(owner.includes('support.tickets.manage' as any));
  });

  /* ---------------------------------------------------------------- *
   *  THE TARGETING                                                   *
   * ---------------------------------------------------------------- */
  console.log('\n-- Reaching the person who can act, and nobody else');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  const bankRecipients = await notifyAdminsBankAccountFiled({
    accountId: 'pa_targeting_1',
    ownerName: 'Biryani House',
    ownerKind: 'restaurant'
  });

  it('A BANK ACCOUNT REACHES FINANCE', () => {
    assert.equal(to(FINANCE).length, 1, `finance got ${to(FINANCE).length}`);
    assert.ok(bankRecipients.includes(FINANCE));
  });

  it('AND DOES NOT REACH SUPPORT', () => {
    /*
     * The half that makes the check worth having. Remove the permission filter
     * and the check above still passes; this one stops.
     */
    assert.equal(to(SUPPORT).length, 0, `support was told about a bank account they cannot apply`);
    assert.ok(!bankRecipients.includes(SUPPORT));
  });

  it('and it does reach the owner, who can act on everything', () => {
    assert.equal(to(OWNER).length, 1);
  });

  captureSends();
  resetAdminNotificationDedupeForTesting();
  const sosRecipients = await notifyAdminsSosRaised({
    alertId: 'sos_targeting_1',
    riderName: 'Vikram Singh'
  });

  it('AN SOS REACHES SUPPORT', () => {
    assert.equal(to(SUPPORT).length, 1, `support got ${to(SUPPORT).length}`);
    assert.ok(sosRecipients.includes(SUPPORT));
  });

  it('AND DOES NOT REACH FINANCE', () => {
    assert.equal(to(FINANCE).length, 0, 'finance was told about an emergency they cannot answer');
  });

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await notifyAdminsRefundRaised({
    requestId: 'ref_targeting_1',
    orderNumber: 'QB-900001',
    amountLabel: 'Rs 240'
  });

  it('A refund reaches BOTH finance and support, because both can decide one', () => {
    /*
     * My first version of this asserted support was NOT told, and it failed —
     * correctly. `support_admin` holds `finance.refunds.manage`
     * (permissions.ts:125), which is right: a support agent handling the
     * complaint is exactly who should be able to refund it.
     *
     * So the premise was wrong, not the code. Keeping the check but asserting the
     * real rule — everybody who can decide it is told — and the negative moved to
     * the operations administrator below, who genuinely cannot.
     */
    assert.ok(to(FINANCE).length >= 1, 'finance was not told about a refund');
    assert.ok(to(SUPPORT).length >= 1, 'support cannot act on a refund they were not told about');
  });

  it('and does NOT reach an administrator who cannot decide one', () => {
    /*
     * The negative, taken from whoever actually lacks the permission rather than
     * from my assumption about who that is. `resolveAccess` decides, so this
     * check cannot go stale against a role definition that changes.
     */
    assert.ok(!refundBlindPerms.includes('finance.refunds.manage' as any), 'the fixture is wrong');
    assert.equal(
      to(REFUND_BLIND).length,
      0,
      `${REFUND_BLIND} was told about a refund they have no power over`
    );
  });

  /* ---------------------------------------------------------------- *
   *  THE CHANNELS                                                    *
   * ---------------------------------------------------------------- */
  console.log('\n-- The channel the phone has actually created');

  const channelsSource = appSource(ADMIN_CHANNELS_FILE);

  it('The admin app creates both channels', () => {
    /*
     * It created NONE before this. The app has always registered a push token, so
     * everything looked wired — and on Android 8+ every message would have been
     * discarded for naming a channel that did not exist.
     */
    assert.ok(
      channelsSource.includes('setNotificationChannelAsync'),
      'the admin app creates no notification channel, so every push would be dropped'
    );
    const calls = channelsSource.match(/setNotificationChannelAsync/g) || [];
    assert.equal(calls.length, 2, `expected two channels, found ${calls.length}`);
  });

  it("THE SERVER'S IDS ARE THE ONES IN THE APP'S SOURCE", () => {
    /*
     * Read out of the app file, not compared with a copy of the string in this
     * test. A constant compared with itself is what let `new_orders`,
     * `new-orders` and `kitchen-orders` coexist.
     */
    assert.ok(
      channelsSource.includes(`'${ADMIN_CHANNEL.URGENT}'`),
      `the app does not create '${ADMIN_CHANNEL.URGENT}'`
    );
    assert.ok(
      channelsSource.includes(`'${ADMIN_CHANNEL.ATTENTION}'`),
      `the app does not create '${ADMIN_CHANNEL.ATTENTION}'`
    );
  });

  it('and the strings were read from CODE, not from a comment about it', () => {
    /*
     * Proving the stripper works, because the check above would pass on the
     * comments alone -- `adminChannels.ts` documents both ids in prose. If this
     * ever fails, the check above has stopped testing anything.
     */
    const raw = fs.readFileSync(path.join(REPO, ADMIN_CHANNELS_FILE), 'utf8');
    const needle = 'It looked like a delivery problem for weeks';
    assert.ok(raw.includes(needle), 'the explanation has been deleted from the app file');
    assert.ok(
      !channelsSource.includes(needle),
      'the comment stripper is not working, so these checks match prose as readily as code'
    );
  });

  it('The channels are created BEFORE the token is registered', () => {
    /*
     * Order matters and it is not cosmetic: a notification arriving before the
     * channel exists is dropped, not queued. So a first sign-in that registered
     * the token and created channels afterwards would lose anything sent in
     * between.
     */
    const app = appSource(ADMIN_APP);
    assert.ok(app.includes('prepareAdminChannels'), 'the app never creates its channels');
    const both = [...app.matchAll(/prepareAdminChannels\(\)\.then\(\(\) => registerForPush/g)];
    assert.equal(both.length, 2, `expected both sign-in paths to order these, found ${both.length}`);
  });

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await notifyAdminsSosRaised({ alertId: 'sos_channel_1', riderName: 'Vikram Singh' });
  const sosSend = to(SUPPORT)[0];

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await notifyAdminsSupportTicketOpened({
    ticketId: 'tkt_channel_1',
    subjectLine: 'My order was cold',
    raisedBy: 'Aditya'
  });
  const ticketSend = to(SUPPORT)[0];

  it('An emergency rings and a cold curry does not', () => {
    assert.equal(sosSend?.channel, ADMIN_CHANNEL.URGENT, `SOS went to ${sosSend?.channel}`);
    assert.equal(ticketSend?.channel, ADMIN_CHANNEL.ATTENTION, `a ticket went to ${ticketSend?.channel}`);
    assert.notEqual(
      sosSend?.channel,
      ticketSend?.channel,
      'both use one channel, so silencing the tickets silences the emergencies'
    );
  });

  /* ---------------------------------------------------------------- *
   *  WHAT A LOCK SCREEN MAY SAY                                      *
   * ---------------------------------------------------------------- */
  console.log('\n-- What is safe to print on a lock screen');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await notifyAdminsBankAccountFiled({
    accountId: 'pa_secrecy_1',
    ownerName: 'Biryani House',
    ownerKind: 'restaurant'
  });
  const bankBody = to(FINANCE)[0]?.body || '';

  it('A bank notification carries no account digits at all', () => {
    /*
     * Not even the last four. Everybody receiving this sees them on the screen it
     * opens; a lock screen is readable by whoever is standing near the phone, and
     * this is the one notification on the platform about somebody's banking.
     */
    assert.ok(!/\d{4}/.test(bankBody), `the body contains a four-digit run: ${bankBody}`);
    assert.ok(bankBody.includes('Biryani House'), bankBody);
  });

  /* ---------------------------------------------------------------- *
   *  NOT THREE TIMES FOR ONE THING                                   *
   * ---------------------------------------------------------------- */
  console.log('\n-- One thing waiting is one notification');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  for (let i = 0; i < 3; i++) {
    await notifyAdminsBankAccountFiled({
      accountId: 'pa_dedupe_1',
      ownerName: 'Biryani House',
      ownerKind: 'restaurant'
    });
  }

  it('THE SAME ACCOUNT FILED THREE TIMES SENDS ONE NOTIFICATION', () => {
    assert.equal(to(FINANCE).length, 1, `finance got ${to(FINANCE).length} for one account`);
  });

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await notifyAdminsBankAccountFiled({ accountId: 'pa_a', ownerName: 'A', ownerKind: 'rider' });
  await notifyAdminsBankAccountFiled({ accountId: 'pa_b', ownerName: 'B', ownerKind: 'rider' });

  it('but two DIFFERENT accounts send two', () => {
    /*
     * The other half. Deduplicating on the event alone rather than on its subject
     * would collapse these into one, and the second rider would wait forever for
     * a notification that was suppressed as a duplicate of somebody else's.
     */
    assert.equal(to(FINANCE).length, 2, `finance got ${to(FINANCE).length} for two accounts`);
  });

  /* ---------------------------------------------------------------- *
   *  IT MUST NEVER FAIL THE ACTION                                   *
   * ---------------------------------------------------------------- */
  console.log('\n-- An SOS must raise whether or not anybody can be told');

  const riderRow = Array.from(memoryStore.riders.values() as any).find((r: any) => r.userId) as any;
  const riderUser = memoryStore.users.get(riderRow.userId) as any;
  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: riderUser.email, password: 'pass123' }
  });
  const riderToken = login.json?.data?.token as string;

  it('A rider can sign in, so the route below is actually exercised', () => {
    assert.ok(riderToken, JSON.stringify(login.json).slice(0, 200));
  });

  // Push delivery made to throw, which is what a broken credential looks like.
  (fcmDispatcher as any).sendPushNotification = async () => {
    throw new Error('FCM is unreachable');
  };

  const sosWithPushBroken = await api(
    '/riders/sos',
    { method: 'POST', body: { category: 'ACCIDENT', note: 'Testing that the alert still records' } },
    riderToken
  );

  it('AN SOS STILL RAISES WHEN PUSH IS COMPLETELY BROKEN', () => {
    /*
     * The rule from §8.1's `tellTheKitchen`, applied to the one event where
     * failing it would matter most. A rider in trouble must not have their alert
     * refused because a Google credential expired.
     */
    assert.equal(
      sosWithPushBroken.status,
      201,
      `status ${sosWithPushBroken.status}: ${JSON.stringify(sosWithPushBroken.json).slice(0, 250)}`
    );
    assert.ok(sosWithPushBroken.json?.data?.alert?.id, 'no alert was recorded');
  });

  it('and the alert is in the store, not just in the response', () => {
    const id = sosWithPushBroken.json.data.alert.id;
    assert.ok(memoryStore.sosAlerts.get(id), 'the alert was returned but never stored');
  });

  (fcmDispatcher as any).sendPushNotification = realSend;

  /* ---------------------------------------------------------------- *
   *  AND THE ROUTES ACTUALLY CALL IT                                 *
   * ---------------------------------------------------------------- */
  console.log('\n-- The events are wired, and wired to the event not to a count');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  const realSos = await api(
    '/riders/sos',
    { method: 'POST', body: { category: 'UNSAFE_LOCATION', note: 'A real route call, end to end' } },
    riderToken
  );

  it('The SOS ROUTE notifies, not just the notifier in isolation', () => {
    assert.equal(realSos.status, 201, JSON.stringify(realSos.json).slice(0, 200));
    assert.ok(to(SUPPORT).length >= 1, 'raising an SOS through the route told no support administrator');
  });

  it('and it carries where to go, so tapping it lands somewhere', () => {
    const payload = to(SUPPORT)[0];
    assert.equal(payload.data?.open, 'support', `opens ${payload.data?.open}`);
    assert.equal(payload.data?.type, 'ADMIN_SOS_RAISED');
  });

  /*
   * EVERY EVENT, so the nav-key check below covers all of them rather than
   * whichever one happened to be sent last.
   */
  captureSends();
  resetAdminNotificationDedupeForTesting();
  const all = await import('../notifications/adminNotifier.ts');
  await all.notifyAdminsSosRaised({ alertId: 'n1', riderName: 'R' });
  await all.notifyAdminsPayoutFailed({
    payoutId: 'n2',
    payeeName: 'P',
    amountLabel: 'Rs 100',
    reason: 'Closed account.'
  });
  await all.notifyAdminsBankAccountFiled({ accountId: 'n3', ownerName: 'O', ownerKind: 'rider' });
  await all.notifyAdminsKycSubmitted({ documentId: 'n4', ownerName: 'O', documentLabel: 'driving licence' });
  await all.notifyAdminsRefundRaised({ requestId: 'n5', orderNumber: 'QB-1', amountLabel: 'Rs 10' });
  await all.notifyAdminsSupportTicketOpened({ ticketId: 'n6', subjectLine: 'S', raisedBy: 'B' });
  await all.notifyAdminsCashDeclared({ depositId: 'n7', riderName: 'R', amountLabel: 'Rs 500' });
  await all.notifyAdminsMenuRequestRaised({ requestId: 'n8', restaurantName: 'X', what: 'a new dish' });
  await all.notifyAdminsProfileEditRaised({ editId: 'n9', restaurantName: 'X' });

  it('EVERY NAV KEY A NOTIFICATION CAN CARRY IS A SECTION THE APP HAS', () => {
    /*
     * §11.2c in miniature, and it caught me. I wrote `cash` for the cash-deposit
     * notification and there is no such section — cash deposits live inside Pay.
     * A key the app does not know opens nothing, and nothing anywhere would have
     * reported it: the notification would arrive, the tap would do nothing, and
     * it would read as the notification being broken.
     */
    const app = appSource(ADMIN_APP);
    const keys = new Set(sent.map(s => s.data?.open).filter(Boolean));
    assert.ok(keys.size >= 6, `only ${keys.size} distinct destinations were exercised`);
    for (const key of keys) {
      assert.ok(app.includes(`key: '${key}'`), `the admin app has no section keyed '${key}'`);
    }
  });

  it('and the app READS that key, rather than it travelling to nothing', () => {
    /*
     * The half of §8C.4 I nearly shipped without. The key was in every payload
     * and nothing in the admin app looked at it: the notification would arrive,
     * the tap would open the dashboard, and the reader would go hunting for the
     * thing they had just been interrupted about. A payload field nobody reads
     * is indistinguishable from one that is not sent.
     */
    const app = appSource(ADMIN_APP);
    assert.ok(
      app.includes('addNotificationResponseReceivedListener'),
      'nothing handles a notification tap while the app is open'
    );
    assert.ok(
      app.includes('getLastNotificationResponseAsync'),
      'a tap that LAUNCHES the app is not handled, which is the SOS-at-3am case'
    );
    assert.ok(
      app.includes('data?.open'),
      'the tap handler does not read the destination the server sends'
    );
  });

  it('and it refuses a destination the account cannot open', () => {
    /*
     * Permissions can change between a notification being sent and being tapped.
     * Navigating anyway would show NoAccess with no explanation of why they were
     * sent there, so the key is checked against the sections this account can
     * actually see.
     */
    const app = appSource(ADMIN_APP);
    assert.ok(
      app.includes('visible.some(section => section.key === key)'),
      'the tap handler navigates to whatever the payload says, unchecked'
    );
  });

  it('and every event carries one, so none of them opens the dashboard', () => {
    /*
     * A notification that opens the dashboard makes the reader hunt for what it
     * was about, which is worse than not sending one — they now have to look
     * anyway, and they were interrupted to be told so.
     */
    const ownerGot = to(OWNER);
    assert.equal(ownerGot.length, 9, `the owner received ${ownerGot.length} of 9 events`);
    for (const s of ownerGot) {
      assert.ok(s.data?.open, `"${s.title}" carries no destination`);
      assert.ok(s.data?.type, `"${s.title}" carries no event type`);
    }
  });
  /* ---------------------------------------------------------------- *
   *  W2: THE PROBLEMS THE PLATFORM FINDS BY ITSELF                   *
   * ---------------------------------------------------------------- */
  console.log('\n-- W2: problems, targeted at whoever can act on them');

  const OPS = 'usr_admin_ops';
  const opsUser = memoryStore.users.get(OPS) as any;
  if (!opsUser) {
    throw new Error('PRECONDITION: no operations administrator, so the targeting below cannot fail.');
  }
  const opsPerms = resolveAccess(opsUser).permissions;

  if (!opsPerms.includes('orders.deliveries.manage' as any)) {
    throw new Error('PRECONDITION: the operations role cannot manage deliveries, so it is the wrong fixture.');
  }
  if (opsPerms.includes('finance.payouts.manage' as any)) {
    throw new Error(
      'PRECONDITION: the operations role holds finance.payouts.manage, so "the books did not reach operations" cannot fail.'
    );
  }
  if (financePerms.includes('orders.deliveries.manage' as any)) {
    throw new Error(
      'PRECONDITION: the finance role can manage deliveries, so "a stuck order did not reach finance" cannot fail.'
    );
  }

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await all.notifyAdminsNoRiderFound({
    orderId: 'ord_w2_stuck',
    orderNumber: 'QB-W2-1',
    restaurantName: 'Biryani House',
    waitingMinutes: 14
  });

  it('A STUCK ORDER REACHES OPERATIONS AND NOT FINANCE', () => {
    assert.equal(to(OPS).length, 1, `operations got ${to(OPS).length}`);
    assert.equal(to(FINANCE).length, 0, 'finance was told about a trip they cannot dispatch');
  });

  it('and it is URGENT, because the food is going cold', () => {
    /*
     * The only operational alert that earns the urgent channel. A rider no-show
     * is recoverable — the trip goes straight back on offer — but cooked food
     * with nobody to carry it needs somebody now.
     */
    assert.equal(to(OPS)[0].channel, ADMIN_CHANNEL.URGENT, `sent on ${to(OPS)[0].channel}`);
    assert.equal(to(OPS)[0].data?.open, 'deliveries');
  });

  // A no-show is NOT urgent: the trip goes straight back on offer, so the
  // platform has already recovered. Somebody should know; nobody needs waking.

  captureSends();
  resetAdminNotificationDedupeForTesting();
  await all.notifyAdminsRiderNoShow({
    orderId: 'ord_w2_noshow',
    orderNumber: 'QB-W2-2',
    riderName: 'Vikram',
    waitingMinutes: 11
  });

  it('and that is asserted', () => {
    assert.equal(to(OPS).length, 1);
    assert.equal(
      to(OPS)[0].channel,
      ADMIN_CHANNEL.ATTENTION,
      'a recovered no-show woke somebody at 3am'
    );
  });

  /* ---- B's check: three ticks, one push ---- */
  console.log('\n-- One stuck order across three sweeps is one push');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  for (let tick = 0; tick < 3; tick++) {
    await all.notifyAdminsNoRiderFound({
      orderId: 'ord_w2_repeat',
      orderNumber: 'QB-W2-3',
      restaurantName: 'Biryani House',
      waitingMinutes: 10 + tick
    });
  }

  it('THREE SWEEPER TICKS ON ONE ORDER PRODUCE ONE PUSH', () => {
    /*
     * The sweeper runs on a timer. Without dedup on the ORDER, a single stuck
     * order is a notification every thirty seconds until somebody fixes it —
     * which is how the reader learns to swipe, and the next thing they swipe is
     * the SOS.
     */
    assert.equal(to(OPS).length, 1, `operations got ${to(OPS).length} pushes for one order`);
  });

  /*
   * Two stuck orders are two problems with two different fixes — a different
   * restaurant, a different rider to phone. Collapsing them would hide the second.
   */
  await all.notifyAdminsNoRiderFound({
    orderId: 'ord_w2_other',
    orderNumber: 'QB-W2-4',
    restaurantName: 'Dosa Corner',
    waitingMinutes: 12
  });

  it('and that is asserted too', () => {
    assert.equal(to(OPS).length, 2, `a second stuck order did not reach anybody: ${to(OPS).length}`);
  });

  /* ---- The books, collapsed and change-driven ---- */
  console.log('\n-- The books: one message, and only when the set changes');

  captureSends();
  resetAdminNotificationDedupeForTesting();
  all.resetPaymentsHealthNotificationForTesting();

  const twoAlerts = [
    'THE LEDGER DOES NOT BALANCE. 2 transaction(s) are one-sided.',
    '3 duplicate idempotency key(s) in the ledger. Money may be double-counted.'
  ];
  await all.notifyAdminsPaymentsHealth({ alerts: twoAlerts, worst: twoAlerts[0] });

  it('SIX FINDINGS ARE ONE PUSH, NOT SIX', () => {
    /*
     * One bad state produces several alerts at once — an imbalance brings its
     * duplicate keys and the uncertain payouts behind both. Six notifications for
     * one morning is how a channel gets muted.
     */
    assert.equal(to(FINANCE).length, 1, `finance got ${to(FINANCE).length} pushes for one sweep`);
    assert.equal(to(OPS).length, 0, 'operations was told about the books');
  });

  it('and it names the worst one, with the count of the rest', () => {
    const push = to(FINANCE)[0];
    assert.ok(push.body.includes('DOES NOT BALANCE'), push.body);
    assert.ok(push.body.includes('1 more'), `the other finding is not mentioned: ${push.body}`);
    assert.ok(push.title.includes('2'), `the count is not in the title: ${push.title}`);
  });

  captureSends();
  await all.notifyAdminsPaymentsHealth({ alerts: twoAlerts, worst: twoAlerts[0] });

  it('THE SAME PROBLEMS NEXT SWEEP SEND NOTHING', () => {
    /*
     * The sweep runs every fifteen minutes and an unresolved problem is still
     * there next time. Re-notifying trains the reader to swipe, and a reader who
     * swipes these by reflex is worse off than one never notified — they are now
     * practised at it.
     */
    assert.equal(to(FINANCE).length, 0, 'the same unresolved problems notified again');
  });

  captureSends();
  await all.notifyAdminsPaymentsHealth({
    alerts: [...twoAlerts, '2 riders have held cash for more than 3 days.'],
    worst: twoAlerts[0]
  });

  it('but a NEW problem appearing does send one', () => {
    /*
     * Keyed on the SET, not a count and not a flag. Two alerts becoming two
     * DIFFERENT alerts is news, and a count would miss it entirely.
     */
    assert.equal(to(FINANCE).length, 1, 'a new finding was swallowed as a repeat');
  });

  captureSends();
  await all.notifyAdminsPaymentsHealth({ alerts: [], worst: '' });
  await all.notifyAdminsPaymentsHealth({ alerts: twoAlerts, worst: twoAlerts[0] });

  it('and a problem that CLEARS and comes back is announced again', () => {
    /*
     * Remembering the fingerprint forever would silence a recurrence, which is a
     * worse failure than a repeat: the first time it happened somebody was told,
     * so the second time looks like it never came back.
     */
    assert.equal(to(FINANCE).length, 1, 'a recurrence was swallowed as a duplicate');
  });

} catch (err: any) {
  failed++;
  console.log(`[FAIL] the suite itself threw: ${err?.stack || err}`);
} finally {
  (fcmDispatcher as any).sendPushNotification = realSend;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
