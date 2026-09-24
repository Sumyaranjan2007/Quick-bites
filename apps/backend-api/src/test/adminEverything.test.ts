/**
 * "Everything", and the switch that lets somebody take some of it back.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS IS ABOUT
 * -------------------------------------------------------------------------
 * The owner asked to receive every notification, in those words, because they are
 * the one solving the problems. So every category starts ON and a missing
 * preference means ON.
 *
 * That makes the interesting failures the opposite way round from most
 * notification work. The dangerous bug here is not noise: it is a switch that
 * silences more than it says it does, or one that silences something that must
 * never be silenced.
 *
 * TWO THINGS CANNOT BE MUTED. A rider pressing SOS, and an order no rider has
 * taken. The first is the only notification on this platform where the phone
 * should ring at 3am. The second is the one that costs a customer their dinner,
 * and nothing else notices it — the food sits on the pass and the map never moves.
 *
 * -------------------------------------------------------------------------
 * AND THREE ALERTS THAT COULD NEVER FIRE
 * -------------------------------------------------------------------------
 * Every check on a notification source below drives THE ROUTE THE APP ACTUALLY
 * CALLS. That is not a stylistic preference. The document alert was built,
 * correct, and wired to `POST /kyc/submit` — a route no app calls. A check against
 * that route would have passed for as long as the feature was broken, which is the
 * precise shape of a check that makes things worse.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import * as notifier from '../notifications/adminNotifier.ts';
import {
  NOTIFICATION_CATEGORIES,
  ALWAYS_ON_EVENTS,
  isCategoryEnabled,
  setCategoryEnabled,
  allCategoryPreferences,
  resetNotificationPrefsForTesting
} from '../notifications/adminNotificationPrefs.ts';
import {
  slotDueAt,
  digestCounts,
  digestBody,
  sendDigestIfDue,
  resetDigestForTesting
} from '../notifications/adminDigest.ts';
import { ledger, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { bookCapture } from '../modules/payments/capture.ts';
import { recordGatewaySettlement } from '../modules/payments/gatewaySettlements.ts';
import { runPaymentsHealthCheck } from '../modules/payments/paymentsHealth.ts';
import { toPaise } from '../modules/payments/money.ts';
import { sendRefund } from '../modules/payments/refunds.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { istDayStart } from '../modules/admin/analytics.ts';
import { ownOrder } from './helpers/ownFixture.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The notifier's source, with comments stripped.
 *
 * Stripped because the prose in that file names the categories it discusses, and a
 * grep that reads comments finds its own explanation and reports success.
 */
function notifierSource(): string {
  const raw = fs.readFileSync(path.join(SRC, 'notifications/adminNotifier.ts'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PORT = 5233;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  EVERYTHING TO ADMIN, AND THE SWITCH FOR IT        ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

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

const ofType = (type: string) => sent.filter(s => s.data?.type === type);

/**
 * How many distinct NOTIFICATIONS of a type went out, not how many pushes.
 *
 * One notification fans out to every staff account holding the permission, so
 * counting pushes counts recipients. Two admins hold `orders.deliveries.manage` on
 * the seeded data, so `ofType(...).length === 1` is a check that fails on a
 * perfectly correct system — and would start passing if somebody narrowed the
 * audience, which is the wrong signal entirely.
 */
const notificationsOfType = (type: string) =>
  new Set(ofType(type).map(s => s.data?.subject)).size;

async function api(path: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');
  resetNotificationPrefsForTesting();

  /* ================================================================ *
   *  DEFAULT ON                                                       *
   * ================================================================ */
  console.log('-- Nothing is muted until somebody mutes it');

  it('EVERY CATEGORY IS ON BEFORE ANYBODY TOUCHES A SWITCH', () => {
    /*
     * The opposite of the usual default, and right here because nobody else is
     * watching. A muted category on a platform with one operator is a problem that
     * reaches a customer before it reaches a person.
     *
     * Asserted through `isCategoryEnabled` on a store with nothing in it, which is
     * exactly the state a fresh deployment is in.
     */
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.equal(isCategoryEnabled(category.key), true, `${category.key} was muted by default`);
    }
  });

  captureSends();
  await notifier.notifyAdminsCashDeclared({
    depositId: 'dep_sw_1',
    riderName: 'Rahul',
    amountLabel: 'Rs 2,000.00'
  });

  it('and a money notification arrives with nothing configured', () => {
    assert.ok(ofType('ADMIN_CASH_DECLARED').length >= 1, 'a default-on category sent nothing');
  });

  /* ================================================================ *
   *  A SWITCH THAT SILENCES EXACTLY ONE THING                         *
   * ================================================================ */
  console.log('\n-- Muting one category leaves the others alone');

  setCategoryEnabled('MONEY', false, 'usr_admin_01');
  captureSends();
  await notifier.notifyAdminsCashDeclared({
    depositId: 'dep_sw_2',
    riderName: 'Rahul',
    amountLabel: 'Rs 3,000.00'
  });
  await notifier.notifyAdminsSupportTicketOpened({
    ticketId: 'tkt_sw_1',
    subjectLine: 'Cold food',
    raisedBy: 'Priya'
  });
  await notifier.notifyAdminsKycSubmitted({
    documentId: 'doc_sw_1',
    ownerName: 'Nandini Kitchen',
    documentLabel: 'fssai licence'
  });

  it('MUTING MONEY STOPS MONEY AND NOTHING ELSE', () => {
    assert.equal(ofType('ADMIN_CASH_DECLARED').length, 0, 'a muted category still sent');
    assert.ok(ofType('ADMIN_SUPPORT_TICKET').length >= 1, 'muting money silenced customer care');
    assert.ok(ofType('ADMIN_KYC_SUBMITTED').length >= 1, 'muting money silenced approvals');
  });

  /* ================================================================ *
   *  WHAT CANNOT BE MUTED                                             *
   * ================================================================ */
  console.log('\n-- With every switch off, two things still come through');

  for (const category of NOTIFICATION_CATEGORIES) {
    setCategoryEnabled(category.key, false, 'usr_admin_01');
  }

  captureSends();
  await notifier.notifyAdminsSosRaised({
    alertId: 'sos_sw_1',
    riderName: 'Rahul Sharma',
    riderPhone: '9800000000'
  });
  await notifier.notifyAdminsNoRiderFound({
    orderId: 'ord_sw_1',
    orderNumber: 'QB-950001',
    restaurantName: 'Nandini Kitchen',
    waitingMinutes: 12
  });
  await notifier.notifyAdminsDeliveryOverdue({ orderId: 'ord_sw_2', orderNumber: 'QB-950002', carryingMinutes: 40 });
  await notifier.notifyAdminsCashDeclared({ depositId: 'dep_sw_3', riderName: 'R', amountLabel: 'Rs 1.00' });

  it('AN SOS ARRIVES WITH EVERY CATEGORY SWITCHED OFF', () => {
    /*
     * The one notification where the phone should ring at 3am. A screen that can
     * silence it is a screen somebody silences on a quiet Tuesday and does not
     * think about again.
     */
    assert.ok(ofType('ADMIN_SOS_RAISED').length >= 1, 'an SOS was muted by a settings switch');
  });

  it('and so does an order no rider has taken', () => {
    /*
     * The one that costs a customer their dinner. Nothing else on the platform
     * notices it: the food sits on the pass and the customer watches a map that
     * never moves.
     */
    assert.ok(ofType('ADMIN_NO_RIDER_FOUND').length >= 1, 'a stranded order was muted');
  });

  it('while everything genuinely mutable IS muted', () => {
    // Otherwise the two checks above would pass on a switch that does nothing at
    // all, which is the same evidence and a completely different system.
    assert.equal(ofType('ADMIN_DELIVERY_OVERDUE').length, 0, 'dispatch was not muted');
    assert.equal(ofType('ADMIN_CASH_DECLARED').length, 0, 'money was not muted');
  });

  it('and the always-on list names events the notifier really sends', () => {
    /*
     * A typo here would silently make something switchable again — the set would
     * simply never match, every check above would still pass, and an SOS would be
     * mutable. So the names are checked against the events actually seen.
     */
    const everySeen = new Set(sent.map(s => s.data?.type));
    for (const eventType of ALWAYS_ON_EVENTS) {
      assert.ok(
        everySeen.has(eventType),
        `${eventType} is on the always-on list but no notification of that type was sent`
      );
    }
  });

  /* ================================================================ *
   *  THE SWITCH IS CHECKED BEFORE THE DEDUPE                          *
   * ================================================================ */
  console.log('\n-- Switching a category back on speaks immediately');

  captureSends();
  // Muted, so these two reach nobody — and must not consume the subject's window.
  await notifier.notifyAdminsDeliveryOverdue({ orderId: 'ord_sw_3', orderNumber: 'QB-950003', carryingMinutes: 40 });
  await notifier.notifyAdminsDeliveryOverdue({ orderId: 'ord_sw_3', orderNumber: 'QB-950003', carryingMinutes: 41 });
  setCategoryEnabled('DISPATCH', true, 'usr_admin_01');
  await notifier.notifyAdminsDeliveryOverdue({ orderId: 'ord_sw_3', orderNumber: 'QB-950003', carryingMinutes: 42 });

  it('A MUTED EVENT DOES NOT BURN ITS SUBJECT’S TEN-MINUTE WINDOW', () => {
    /*
     * If the switch were checked after the dedupe, the two suppressed attempts
     * would have registered as "already announced" — so switching the category back
     * on would buy ten minutes of silence about a problem that is still happening,
     * caused by messages nobody ever received.
     */
    assert.equal(
      notificationsOfType('ADMIN_DELIVERY_OVERDUE'),
      1,
      'switching a category on did not produce a notification for a live problem'
    );
  });

  // Back to all-on for the source checks below, which are about whether an alert
  // exists at all rather than about the switch.
  resetNotificationPrefsForTesting();

  /* ================================================================ *
   *  THREE ALERTS THAT COULD NEVER FIRE                               *
   * ================================================================ */
  console.log('\n-- Uploading a document, through the route the app really calls');

  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');

  const restaurantId = (Array.from(memoryStore.restaurants.values()) as any[]).find(
    r => r.ownerId === partner.user?.id
  )?.id;

  captureSends();
  const upload = await api(
    `/restaurants/${restaurantId}/documents`,
    { method: 'POST', body: { documentType: 'GSTIN', documentNumber: '29ABCDE1234F1Z5', fileUrl: 'https://example.test/gst.pdf' } },
    partner.token
  );

  it('A PARTNER UPLOADING A DOCUMENT ALERTS SOMEBODY', () => {
    /*
     * THE ROUTE THE APP CALLS, which is the whole point. This notification existed
     * and was wired to POST /kyc/submit, which no app calls — so a check written
     * against that route would have passed while a restaurant sat waiting for an
     * approval nobody had been told about.
     */
    assert.equal(upload.status, 201, `the upload failed: ${JSON.stringify(upload.json).slice(0, 200)}`);
    const told = ofType('ADMIN_KYC_SUBMITTED');
    assert.ok(told.length >= 1, 'a document upload told nobody');
    assert.ok(/gstin/i.test(told[0].body), `the alert does not say which document: ${told[0].body}`);
  });

  captureSends();
  const riderUpload = await api(
    '/riders/documents',
    { method: 'POST', body: { documentType: 'AADHAAR', documentNumber: '999988887777', fileUrl: 'https://example.test/aadhaar.pdf' } },
    rider.token
  );

  it('and so does a RIDER uploading one', () => {
    assert.equal(riderUpload.status, 201, `the upload failed: ${JSON.stringify(riderUpload.json).slice(0, 200)}`);
    assert.ok(ofType('ADMIN_KYC_SUBMITTED').length >= 1, 'a rider document upload told nobody');
  });

  console.log('\n-- Somebody new signing up');

  captureSends();
  const partnerSignup = await api('/auth/register/partner', {
    method: 'POST',
    body: {
      fullName: 'New Owner',
      email: `newkitchen${Date.now()}@example.test`,
      password: 'pass1234',
      phone: '9812345670',
      restaurantName: 'Brand New Kitchen',
      addressLine: '12 MG Road',
      city: 'Bengaluru',
      pincode: '560001',
      cuisine: 'North Indian',
      fssaiLicenseNumber: '12345678901234'
    }
  });

  it('A NEW RESTAURANT SIGNING UP ALERTS SOMEBODY', () => {
    /*
     * This announced nothing at all. A restaurant registered, landed in
     * PENDING_APPROVAL and waited for somebody to happen to open the People
     * screen — so the platform's own growth was the one thing it never mentioned.
     */
    assert.ok(
      partnerSignup.status === 201 || partnerSignup.status === 200,
      `registration failed: ${JSON.stringify(partnerSignup.json).slice(0, 250)}`
    );
    const told = ofType('ADMIN_NEW_SIGNUP');
    assert.ok(told.length >= 1, 'a new restaurant told nobody');
    assert.ok(/Brand New Kitchen/.test(told[0].body), told[0].body);
    assert.equal(told[0].data?.open, 'people', `it opens ${told[0].data?.open}`);
  });

  captureSends();
  const riderSignup = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'New Rider',
      email: `newrider${Date.now()}@example.test`,
      password: 'pass1234',
      phone: '9812345671',
      vehicleType: 'BIKE',
      licenseNumber: 'KA0120220001234'
    }
  });

  it('and so does a new rider', () => {
    assert.ok(
      riderSignup.status === 201 || riderSignup.status === 200,
      `registration failed: ${JSON.stringify(riderSignup.json).slice(0, 250)}`
    );
    const told = ofType('ADMIN_NEW_SIGNUP');
    assert.ok(told.length >= 1, 'a new rider told nobody');
    assert.ok(/New Rider/.test(told[0].body), told[0].body);
  });

  console.log('\n-- A refund that could not be sent');

  resetLedgerForTesting();
  resetConfigsForTesting();

  const stuckOrder = ownOrder('stuckrefund', {
    restaurantId: 'rst_stuck_1',
    status: 'CANCELLED',
    paymentMethod: 'CASH_ON_DELIVERY',
    totalAmount: 300,
    extra: { paymentStatus: 'PAID', customerId: 'usr_cust_stuck' }
  });

  captureSends();
  const stuckOutcome = await sendRefund({
    order: stuckOrder,
    amountPaise: toPaise(300),
    reason: 'Cancelled after payment',
    actorUserId: 'usr_admin_01',
    caseId: 'case_stuck_1'
  });
  // The alert is fired with `void` so a refund cannot fail on a slow push.
  await new Promise(r => setTimeout(r, 40));

  it('A REFUND THAT DID NOT SETTLE TELLS AN ADMINISTRATOR', () => {
    /*
     * Leaving the case OPEN rather than reporting it refunded was already right. But
     * nothing told anybody, so it sat in a queue somebody has to think to open,
     * holding a customer's money. The silence was the whole defect: an open case
     * only helps if a person looks at it.
     */
    assert.equal(stuckOutcome.settled, false, 'this fixture is meant to leave the refund unsettled');
    const told = ofType('ADMIN_REFUND_STUCK');
    assert.ok(told.length >= 1, 'a stuck refund told nobody');
    assert.ok(/NOT reached/i.test(told[0].body), told[0].body);
    assert.equal(told[0].data?.open, 'refunds');
  });

  it('and the customer is NOT told their money is on its way', () => {
    // The two halves of the same rule. A customer told money was sent stops
    // chasing it; the administrator is told precisely because the customer is not.
    assert.equal(ofType('REFUND_SENT').length, 0, 'a customer was told about a refund that failed');
  });

  /* ================================================================ *
   *  MONEY THE GATEWAY HAS BEEN SITTING ON                            *
   * ================================================================ */
  console.log('\n-- Money at the gateway for longer than it settles in');

  resetLedgerForTesting();

  const held = ownOrder('gwheld', {
    restaurantId: 'rst_gw_held',
    status: 'DELIVERED',
    paymentMethod: 'RAZORPAY_SANDBOX',
    totalAmount: 1000,
    extra: { paymentStatus: 'PAID', razorpayPaymentId: 'pay_gw_held' }
  });
  bookCapture(held, toPaise(1000));

  // Backdate the capture by four days, past the three-day default.
  for (const entry of memoryStore.ledgerEntries.values() as any) {
    if ((entry as any).event === 'PAYMENT_CAPTURED') {
      (entry as any).occurredAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    }
  }

  captureSends();
  const overdueReport = await runPaymentsHealthCheck();

  it('MONEY HELD FOUR DAYS IS REPORTED AS A PROBLEM', () => {
    /*
     * A positive balance is normal — Razorpay settles in about two working days, so
     * the amount says nothing on its own. The AGE says everything, and it is one of
     * two problems: a settlement arrived and nobody recorded it, so the books
     * understate the bank; or it never arrived. Nothing else would surface either.
     *
     * Asserted on the report's own figures rather than by matching the sentence, so
     * rewording the alert cannot quietly disable the check.
     */
    assert.equal(overdueReport.gateway.overdue, true,
      `four-day-old money was not flagged: ${JSON.stringify(overdueReport.gateway)}`);
    assert.equal(overdueReport.gateway.heldDays >= 4, true, `heldDays was ${overdueReport.gateway.heldDays}`);
    assert.ok(
      overdueReport.alerts.some(a => /payment gateway for/i.test(a)),
      `no alert mentioned it: ${JSON.stringify(overdueReport.alerts)}`
    );
  });

  /*
   * Computed BEFORE the check, because `it` is synchronous and does not await. A
   * promise returned from inside it would resolve after the check had already
   * reported PASS, so the assertion would never run and the check would pass
   * whatever the code did.
   */
  createVersion({ gatewaySettlementOverdueDays: 10 }, { userId: 'usr_admin_01' }, 'Wider window');
  const relaxedReport = await runPaymentsHealthCheck();
  createVersion({ gatewaySettlementOverdueDays: 3 }, { userId: 'usr_admin_01' }, 'Back');

  it('and the threshold is a setting, not a constant', () => {
    /*
     * Raised past the age of the money, so it stops being overdue. A hardcoded
     * three days would leave this flagged, and the owner would have no way to widen
     * it for a gateway that settles more slowly.
     */
    assert.equal(relaxedReport.gateway.overdue, false,
      'the setting was ignored, so the alert cannot be tuned');
  });

  recordGatewaySettlement({
    netPaise: toPaise(976.4),
    feesPaise: toPaise(20),
    taxPaise: toPaise(3.6),
    reference: 'setl_clears_it',
    actorUserId: 'usr_admin_01'
  });
  const settled = await runPaymentsHealthCheck();

  it('AND RECORDING THE SETTLEMENT CLEARS IT', () => {
    assert.equal(settled.gateway.outstandingPaise, 0, 'the receivable did not clear');
    assert.equal(settled.gateway.overdue, false, 'it is still reported as overdue after settling');
    assert.equal(settled.gateway.oldestHeldAt, null, 'it still names money the gateway is holding');
    assert.equal(
      settled.alerts.some(a => /payment gateway for/i.test(a)),
      false,
      'the alert survived the settlement that resolved it'
    );
  });

  /* ================================================================ *
   *  THE TWICE-DAILY SUMMARY                                          *
   * ================================================================ */
  console.log('\n-- How the day is going, twice');

  it('NO SUMMARY IS DUE BEFORE THE FIRST SLOT', () => {
    // 09:00 IST is 03:30 UTC.
    assert.equal(slotDueAt(new Date('2026-09-24T03:30:00Z')), null, 'a summary was due at 9am');
  });

  it('and the LAST slot that has passed is the one due, so a late job still sends', () => {
    /*
     * The reason this is a slot and not an interval. A process that was down at
     * 15:00 and wakes at 16:00 must send the midday summary late rather than skip
     * it — and `setInterval(twelve hours)` would instead have moved both summaries
     * to whenever the process last started.
     */
    assert.equal(slotDueAt(new Date('2026-09-24T10:45:00Z'))?.key, 'MIDDAY'); // 16:15 IST
    assert.equal(slotDueAt(new Date('2026-09-24T18:00:00Z'))?.key, 'EVENING'); // 23:30 IST
  });

  it('A day with nothing on it is not worth a notification', () => {
    /*
     * Zeros twice a day every day is how somebody learns to ignore this. Asserted
     * through `digestBody` returning null rather than through a count, because the
     * decision is "is there anything to say", not "is the number zero".
     */
    assert.equal(
      digestBody({ placed: 0, delivered: 0, cancelled: 0, newRestaurants: 0, newRiders: 0 }, 'today'),
      null,
      'an empty day produced a message'
    );
    assert.ok(
      digestBody({ placed: 0, delivered: 0, cancelled: 0, newRestaurants: 1, newRiders: 0 }, 'today'),
      'a sign-up on an otherwise quiet day was not worth saying'
    );
  });

  memoryStore.orders.clear();
  const nowIso = new Date().toISOString();
  memoryStore.orders.set('ord_d1', { id: 'ord_d1', createdAt: nowIso } as any);
  memoryStore.orders.set('ord_d2', { id: 'ord_d2', createdAt: nowIso, deliveredAt: nowIso } as any);
  memoryStore.orders.set('ord_d3', { id: 'ord_d3', createdAt: nowIso, cancelledAt: nowIso } as any);

  it('The summary counts what happened today', () => {
    const counts = digestCounts();
    assert.equal(counts.placed, 3, `placed was ${counts.placed}`);
    assert.equal(counts.delivered, 1, `delivered was ${counts.delivered}`);
    assert.equal(counts.cancelled, 1, `cancelled was ${counts.cancelled}`);
  });

  /*
   * THE EVENING SLOT ON THE SAME IST DAY AS THE ORDERS ABOVE.
   *
   * Derived, not written down. This said `2026-09-24T18:00:00Z` while the orders
   * were created with the real clock — so it passed on the day it was written and
   * failed the next morning, when `istDayKey(now)` had moved on and the summary
   * counted a day with nothing in it. A check that only holds on one date is a check
   * that reports a defect nobody introduced.
   */
  const eveningToday = new Date(istDayStart(new Date()).getTime() + 23.5 * 3_600_000);

  resetDigestForTesting();
  captureSends();
  const firstSend = await sendDigestIfDue(eveningToday);
  const secondSend = await sendDigestIfDue(new Date(eveningToday.getTime() + 5 * 60_000));

  it('IT IS SENT ONCE PER SLOT, NOT ONCE PER WAKE-UP', () => {
    /*
     * The job wakes every ten minutes. Without the record of which slot was sent,
     * the evening summary would arrive six times an hour until midnight.
     */
    assert.equal(firstSend.sent, true, `nothing was sent: ${firstSend.reason}`);
    assert.equal(secondSend.sent, false, 'the same slot was sent twice');
    assert.equal(secondSend.reason, 'already sent for this slot');
    assert.equal(notificationsOfType('ADMIN_DAILY_DIGEST'), 1, 'more than one summary went out');
  });

  it('and it is a summary rather than an alarm', () => {
    const digest = ofType('ADMIN_DAILY_DIGEST')[0];
    assert.equal(digest.channel, 'admin-attention',
      `the daily summary was sent on ${digest.channel}`);
    assert.ok(/3 orders placed/.test(digest.body), digest.body);
  });

  resetDigestForTesting();
  setCategoryEnabled('DIGEST', false, 'usr_admin_01');
  captureSends();
  await sendDigestIfDue(eveningToday);

  it('and muting the summary silences it without silencing problems', () => {
    assert.equal(ofType('ADMIN_DAILY_DIGEST').length, 0, 'a muted summary still arrived');
  });
  resetNotificationPrefsForTesting();

  /* ================================================================ *
   *  THE SETTINGS SCREEN CAN DRIVE IT                                 *
   * ================================================================ */
  console.log('\n-- Over the wire, as the admin app does it');

  const settingsRes = await api('/admin/settings', {}, admin.token);

  it('THE SETTINGS PAYLOAD CARRIES EVERY CATEGORY WITH ITS STATE', () => {
    assert.equal(settingsRes.status, 200, `status ${settingsRes.status}`);
    const list = settingsRes.json?.data?.notifications;
    assert.ok(Array.isArray(list), `notifications is ${typeof list}`);
    assert.equal(list.length, NOTIFICATION_CATEGORIES.length,
      `${list.length} categories in the payload, ${NOTIFICATION_CATEGORIES.length} defined`);
    for (const row of list) {
      for (const field of ['key', 'label', 'description', 'enabled', 'hasAlwaysOn']) {
        assert.ok(field in row, `a category is missing ${field}: ${JSON.stringify(row)}`);
      }
    }
  });

  it('and a category that cannot be fully muted SAYS SO on the screen', () => {
    /*
     * A switch that appears to work and does not is worse than one that admits what
     * it cannot do. Somebody who mutes Deliveries and then receives a stranded
     * order concludes the switch is broken.
     */
    const list = settingsRes.json?.data?.notifications || [];
    const dispatch = list.find((r: any) => r.key === 'DISPATCH');
    assert.ok(dispatch?.hasAlwaysOn, 'the dispatch category does not admit it has an always-on event');
    assert.ok(dispatch?.alwaysOnNote, 'and it does not say which');
  });

  const muted = await api(
    '/admin/settings/notifications/MONEY',
    { method: 'PUT', body: { enabled: false } },
    admin.token
  );

  it('Muting over the wire takes effect', () => {
    assert.equal(muted.status, 200, `status ${muted.status}`);
    assert.equal(isCategoryEnabled('MONEY'), false, 'the switch did not take');
    const row = (muted.json?.data?.notifications || []).find((r: any) => r.key === 'MONEY');
    assert.equal(row?.enabled, false, 'the response still says it is on');
  });

  const unknown = await api(
    '/admin/settings/notifications/NOT_A_CATEGORY',
    { method: 'PUT', body: { enabled: false } },
    admin.token
  );

  it('and an unknown category is refused rather than silently stored', () => {
    /*
     * A stored preference for a category nothing reads is invisible: the person
     * believes they muted something and every notification keeps arriving.
     */
    assert.equal(unknown.status, 400, `status ${unknown.status}`);
    assert.match(JSON.stringify(unknown.json), /NOT_A_CATEGORY|category/i);
  });

  const notAdmin = await login('support@quickbite.app');
  const refused = await api(
    '/admin/settings/notifications/MONEY',
    { method: 'PUT', body: { enabled: true } },
    notAdmin.token
  );

  it('and somebody without settings permission cannot mute the owner’s alerts', () => {
    assert.equal(refused.status, 403, `status ${refused.status}`);
    assert.equal(isCategoryEnabled('MONEY'), false, 'a refused request changed the setting anyway');
  });

  resetNotificationPrefsForTesting();

  it('EVERY CATEGORY THE NOTIFIER USES IS ONE THE SCREEN OFFERS', () => {
    /*
     * A source check, because this is the failure the behaviour checks cannot see.
     * An event carrying a category the screen does not list is one nobody can ever
     * mute — and every check above would still pass, because they each name their
     * own category.
     */
    const declared = new Set(allCategoryPreferences().map(c => c.key));
    const used = new Set(
      (notifierSource().match(/category: '([A-Z_]+)'/g) || []).map(m => m.split("'")[1])
    );
    assert.ok(used.size >= 5, `only ${used.size} categories were found in the notifier`);
    for (const category of used) {
      assert.ok(declared.has(category as any), `the notifier sends "${category}", which no switch covers`);
    }
  });
} finally {
  (fcmDispatcher as any).sendPushNotification = realSend;
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
