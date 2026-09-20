/**
 * Blocking an account, and stopping an unverified kitchen going online.
 *
 * Two separate faults, both of which made a control on the admin screen lie:
 *
 *   1. BLOCKING ONLY APPLIED AT THE NEXT SIGN-IN. Tokens last seven days and
 *      there was no way to withdraw one, so blocking an account did nothing to
 *      the session that account already had open — and a blocked account is
 *      precisely the one that will not sign in again. The admin screen said
 *      "Blocked" and meant it about a login that was never going to happen.
 *
 *   2. AN UNAPPROVED RESTAURANT COULD SWITCH ITSELF ONLINE. The delivery app
 *      has refused this since it was written; the partner app had no
 *      equivalent, so a kitchen registered thirty seconds earlier could press
 *      Online and be told that it was.
 *
 * Most of what follows asserts a REFUSAL, because that is the whole of the
 * feature. A block that permits is not a block, and the only way to know one
 * holds is to try the thing it is supposed to stop — with the token that was
 * issued before it was applied, which is the case that was broken.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';

const PORT = 5197;
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  resetAuthRateLimit();
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

async function run() {
  console.log('====================================================');
  console.log('  ACCOUNT BLOCKING AND THE VERIFICATION GATE        ');
  console.log('====================================================\n');

  await seedDatabase();
  const server = createApp().listen(PORT);
  await new Promise(r => setTimeout(r, 250));

  const RESTAURANT = 'rst_bbh_01';
  const RIDER = 'rdr_vikram_01';

  try {
    resetRequestRateLimit();

    /* ================================================================== *
     *  1. A customer, blocked mid-session                                *
     * ================================================================== */
    console.log('\n-- A customer blocked while signed in');

    const customer = await login('customer@quickbite.app');
    const admin = await login('admin@quickbite.app');

    const before = await api('/auth/me', {}, customer.token);
    check('The customer can use their token', before.status === 200, `status ${before.status}`);

    const block = await api(
      `/admin/customers/${customer.user.id}`,
      { method: 'PATCH', body: { isBlocked: true, blockReason: 'Repeated fraudulent refund claims' } },
      admin.token
    );
    check('An administrator can block the account', block.status === 200, `status ${block.status}`);

    // THE CHECK THIS SUITE EXISTS FOR. The same token, issued before the block.
    const after = await api('/auth/me', {}, customer.token);
    check(
      'The token issued before the block stops working',
      after.status === 403 && after.json?.error?.code === 'ACCOUNT_BLOCKED',
      `${after.status} ${after.json?.error?.code}`
    );
    check(
      'and the reason is given rather than a bare refusal',
      String(after.json?.error?.message || '').includes('fraudulent refund claims'),
      after.json?.error?.message
    );

    // Not one endpoint: the block lives in the middleware every authenticated
    // route passes through, so checking only /auth/me would prove very little.
    const addresses = await api('/addresses', {}, customer.token);
    check('A blocked customer cannot read their addresses', addresses.status === 403, `status ${addresses.status}`);

    const quote = await api(
      '/orders/quote',
      { method: 'POST', body: { restaurantId: RESTAURANT, items: [{ dishId: 'dsh_bbh_01', quantity: 1 }] } },
      customer.token
    );
    check('A blocked customer cannot price a basket', quote.status === 403, `status ${quote.status}`);

    resetAuthRateLimit();
    const reLogin = await api('/auth/login', {
      method: 'POST',
      body: { email: 'customer@quickbite.app', password: 'pass123' }
    });
    check('and cannot sign in again either', reLogin.status === 403, `status ${reLogin.status}`);

    const unblock = await api(
      `/admin/customers/${customer.user.id}`,
      { method: 'PATCH', body: { isBlocked: false, blockReason: '' } },
      admin.token
    );
    check('The block can be lifted', unblock.status === 200, `status ${unblock.status}`);

    // The SAME token, not a fresh one: unblocking must restore the session
    // rather than force somebody to sign in again to undo a mistake.
    const restored = await api('/auth/me', {}, customer.token);
    check('and the original token works again', restored.status === 200, `status ${restored.status}`);

    /* ================================================================== *
     *  2. A delivery partner                                             *
     * ================================================================== */
    console.log('\n-- A delivery partner');

    const rider = await login('rider@quickbite.app');
    const riderOk = await api('/riders/me', {}, rider.token);
    check('A rider can read their own profile', riderOk.status === 200, `status ${riderOk.status}`);

    // Suspending is not blocking. A suspended rider has a problem to fix and
    // must still be able to sign in and read what it is.
    const suspend = await api(
      `/admin/drivers/${RIDER}`,
      { method: 'PATCH', body: { kycStatus: 'SUSPENDED', reason: 'Three no-shows this week' } },
      admin.token
    );
    check('An administrator can suspend a rider', suspend.status === 200, `status ${suspend.status}`);

    const suspendedProfile = await api('/riders/me', {}, rider.token);
    check(
      'A SUSPENDED rider can still sign in and see why',
      suspendedProfile.status === 200,
      `status ${suspendedProfile.status}`
    );

    const suspendedShift = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);
    check(
      'but cannot go online',
      suspendedShift.status === 409,
      `${suspendedShift.status} ${suspendedShift.json?.error?.code}`
    );

    await api(`/admin/drivers/${RIDER}`, { method: 'PATCH', body: { kycStatus: 'ACTIVE' } }, admin.token);

    /*
     * ON SHIFT before the block, or the next check proves nothing.
     *
     * The first version of this suite asserted that a blocked rider is offline
     * without first putting them online — and the rider starts offline, so the
     * assertion passed against a build that had no such side effect at all.
     * Mutation testing caught it: deleting the line that takes a blocked rider
     * off shift changed no result. A check that has never failed is not
     * evidence.
     */
    const onShift = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);
    check('An approved rider can go on shift', onShift.status === 200, `status ${onShift.status}`);
    check(
      'and is really on shift before the block is applied',
      memoryStore.riders.get(RIDER)?.isOnline === true,
      `isOnline ${memoryStore.riders.get(RIDER)?.isOnline}`
    );

    // Blocking IS blocking, and had no equivalent for riders at all before
    // this: only customers could be blocked, so a rider running a cash scam
    // could be stopped from delivering and went on using everything else.
    const blockRider = await api(
      `/admin/drivers/${RIDER}`,
      { method: 'PATCH', body: { isBlocked: true, blockReason: 'Collecting cash and cancelling' } },
      admin.token
    );
    check('An administrator can block a rider account', blockRider.status === 200, `status ${blockRider.status}`);

    const blockedRider = await api('/riders/me', {}, rider.token);
    check(
      'A BLOCKED rider is refused on the token they already held',
      blockedRider.status === 403 && blockedRider.json?.error?.code === 'ACCOUNT_BLOCKED',
      `${blockedRider.status} ${blockedRider.json?.error?.code}`
    );

    check(
      'and is taken off shift rather than left in the dispatch pool',
      memoryStore.riders.get(RIDER)?.isOnline === false,
      `isOnline ${memoryStore.riders.get(RIDER)?.isOnline}`
    );

    const riderRow = await api('/admin/drivers?status=BLOCKED', {}, admin.token);
    check(
      'The block is visible on the fleet screen that applied it',
      (riderRow.json?.data?.drivers || []).some((d: any) => d.id === RIDER && d.isBlocked),
      'an administrator who blocks somebody must be able to see that they did'
    );

    await api(`/admin/drivers/${RIDER}`, { method: 'PATCH', body: { isBlocked: false } }, admin.token);
    const riderBack = await api('/riders/me', {}, rider.token);
    check('Unblocking restores the rider', riderBack.status === 200, `status ${riderBack.status}`);

    /* ================================================================== *
     *  3. A restaurant partner, and the online gate                      *
     * ================================================================== */
    console.log('\n-- A restaurant partner');

    const partner = await login('partner@quickbite.app');

    const online = await api(
      `/restaurants/${RESTAURANT}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      partner.token
    );
    check('An approved kitchen can go online', online.status === 200, `status ${online.status}`);

    // Back to where a brand new partner starts.
    const pending = await api(
      `/admin/restaurants/${RESTAURANT}`,
      { method: 'PATCH', body: { status: 'PENDING_APPROVAL', reason: 'Re-verification' } },
      admin.token
    );
    check('An administrator can put a partner back into review', pending.status === 200, `status ${pending.status}`);
    check('which closes the kitchen immediately', memoryStore.restaurants.get(RESTAURANT)?.isOpen === false);

    const tryOnline = await api(
      `/restaurants/${RESTAURANT}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      partner.token
    );
    check(
      'An unverified kitchen is REFUSED when it tries to go online',
      tryOnline.status === 409 && tryOnline.json?.error?.code === 'RESTAURANT_NOT_APPROVED',
      `${tryOnline.status} ${tryOnline.json?.error?.code}`
    );
    check(
      'and is told it is waiting on verification rather than given a generic error',
      String(tryOnline.json?.error?.message || '').toLowerCase().includes('verified'),
      tryOnline.json?.error?.message
    );
    check(
      'The kitchen really did not open',
      memoryStore.restaurants.get(RESTAURANT)?.isOpen === false,
      'the refusal must not be cosmetic'
    );

    // Going OFFLINE is never gated: a partner who has been put back into review
    // must still be able to close a kitchen they had left open.
    const goOffline = await api(
      `/restaurants/${RESTAURANT}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: false } },
      partner.token
    );
    check('Closing the kitchen is never refused', goOffline.status === 200, `status ${goOffline.status}`);

    const unverifiedFeed = await api('/restaurants');
    check(
      'An unverified kitchen is not offered to customers',
      !(unverifiedFeed.json?.data?.restaurants || []).some((r: any) => r.id === RESTAURANT),
      'the feed reads listActive()'
    );

    const suspendR = await api(
      `/admin/restaurants/${RESTAURANT}`,
      { method: 'PATCH', body: { status: 'SUSPENDED', reason: 'Hygiene complaint' } },
      admin.token
    );
    check('A partner can be suspended', suspendR.status === 200, `status ${suspendR.status}`);

    const suspendedOnline = await api(
      `/restaurants/${RESTAURANT}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      partner.token
    );
    check(
      'A suspended kitchen cannot go online, and is told that it is suspended',
      suspendedOnline.status === 409 &&
        String(suspendedOnline.json?.error?.message || '').toLowerCase().includes('suspended'),
      `${suspendedOnline.status} ${suspendedOnline.json?.error?.message}`
    );

    // The owner's ACCOUNT is a separate lever from the restaurant's status.
    const suspendedDocs = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
    check(
      'A suspended partner can still reach their documents',
      suspendedDocs.status === 200,
      `status ${suspendedDocs.status}`
    );

    const blockOwner = await api(
      `/admin/restaurants/${RESTAURANT}`,
      { method: 'PATCH', body: { isBlocked: true, blockReason: 'Selling from an unlicensed kitchen' } },
      admin.token
    );
    check('An administrator can block the owner account', blockOwner.status === 200, `status ${blockOwner.status}`);

    const blockedPartner = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
    check(
      'A BLOCKED owner is refused on the token they already held',
      blockedPartner.status === 403 && blockedPartner.json?.error?.code === 'ACCOUNT_BLOCKED',
      `${blockedPartner.status} ${blockedPartner.json?.error?.code}`
    );

    const partnerRow = await api('/admin/restaurants?status=BLOCKED', {}, admin.token);
    check(
      'The block is visible on the partner screen that applied it',
      (partnerRow.json?.data?.restaurants || []).some((r: any) => r.id === RESTAURANT && r.isBlocked)
    );

    await api(`/admin/restaurants/${RESTAURANT}`, { method: 'PATCH', body: { isBlocked: false } }, admin.token);
    await api(
      `/admin/restaurants/${RESTAURANT}`,
      { method: 'PATCH', body: { status: 'ACTIVE', reason: 'Restored' } },
      admin.token
    );
    const partnerBack = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
    check('Unblocking restores the partner', partnerBack.status === 200, `status ${partnerBack.status}`);

    /* ================================================================== *
     *  3b. A partner who registered a moment ago                         *
     * ================================================================== */
    console.log('\n-- A brand new partner, from registration to their first order');

    /*
     * The whole journey, on a restaurant created by this test rather than by
     * the seed. The seeded partner is ACTIVE, so every check above ran against
     * a kitchen that had already been approved once — which is not the case
     * anybody complained about. This one has never been looked at.
     */
    resetAuthRateLimit();
    const newEmail = `fresh_${Date.now()}@kitchen.test`;
    const registered = await api('/auth/register/partner', {
      method: 'POST',
      body: {
        fullName: 'Fresh Kitchen Owner',
        email: newEmail,
        phone: '9876500099',
        password: 'kitchen-pass-1',
        restaurantName: 'Fresh Kitchen',
        addressLine: '14 Residency Road',
        city: 'Bengaluru',
        pincode: '560025'
      }
    });
    check('A new partner can register', registered.status === 201, `status ${registered.status}`);

    const freshToken = registered.json?.data?.token as string;
    const freshId = registered.json?.data?.restaurant?.id as string;
    check(
      'and starts unapproved rather than trading',
      registered.json?.data?.restaurant?.status === 'PENDING_APPROVAL',
      registered.json?.data?.restaurant?.status
    );

    const freshOnline = await api(
      `/restaurants/${freshId}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      freshToken
    );
    check(
      'A kitchen registered seconds ago CANNOT go online',
      freshOnline.status === 409 && freshOnline.json?.error?.code === 'RESTAURANT_NOT_APPROVED',
      `${freshOnline.status} ${freshOnline.json?.error?.code}`
    );

    const freshFeed = await api('/restaurants');
    check(
      'and is invisible to customers',
      !(freshFeed.json?.data?.restaurants || []).some((r: any) => r.id === freshId)
    );

    // Ordering from it directly, in case the feed is not the only way in.
    const freshOrder = await api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: freshId,
          items: [{ dishId: 'dsh_bbh_01', quantity: 1 }],
          addressId: 'adr_customer_01',
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: `fresh-${Date.now()}`
        }
      },
      customer.token
    );
    check(
      'and cannot be ordered from even by naming its id directly',
      freshOrder.status >= 400,
      `status ${freshOrder.status}`
    );

    // Now the documents, which is the step that was impossible from the app.
    const freshDocs = await api(`/restaurants/${freshId}/documents`, {}, freshToken);
    check('A new partner is told what is required', (freshDocs.json?.data?.slots || []).length >= 3);
    check(
      'and is not verified yet',
      freshDocs.json?.data?.verified === false,
      `verified ${freshDocs.json?.data?.verified}`
    );

    const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=';

    /*
     * An OPTIONAL document first, and approved.
     *
     * This is the case that was wrong. Approving any single document used to
     * activate the restaurant, so a partner who sent nothing but a bank account
     * proof became visible to customers and took orders with no FSSAI food
     * licence on file — the one document a kitchen may not legally trade
     * without was the one nothing checked for.
     */
    const bank = await api(
      `/restaurants/${freshId}/documents`,
      { method: 'POST', body: { documentType: 'BANK_PROOF', documentNumber: 'HDFC0009999', fileUrl: PHOTO } },
      freshToken
    );
    check('An optional document can be sent', bank.status === 201, `status ${bank.status}`);
    const bankReview = await api(
      '/admin/documents/review',
      { method: 'POST', body: { documentId: bank.json?.data?.document?.id, action: 'APPROVE' } },
      admin.token
    );
    check('and approved', bankReview.status === 200, `status ${bankReview.status}`);

    check(
      'Approving an OPTIONAL document does not approve the restaurant',
      memoryStore.restaurants.get(freshId)?.status === 'PENDING_APPROVAL',
      `status ${memoryStore.restaurants.get(freshId)?.status}`
    );
    const afterOptional = await api(
      `/restaurants/${freshId}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      freshToken
    );
    check('and the kitchen still cannot go online', afterOptional.status === 409, `status ${afterOptional.status}`);

    for (const [type, number] of [['FSSAI', '12345678901234'], ['PAN', 'ABCDE1234F']]) {
      const sent = await api(
        `/restaurants/${freshId}/documents`,
        { method: 'POST', body: { documentType: type, documentNumber: number, fileUrl: PHOTO } },
        freshToken
      );
      check(`${type} can be photographed and sent`, sent.status === 201, `status ${sent.status}`);

      const reviewed = await api(
        '/admin/documents/review',
        { method: 'POST', body: { documentId: sent.json?.data?.document?.id, action: 'APPROVE' } },
        admin.token
      );
      check(`and an administrator can approve the ${type}`, reviewed.status === 200, `status ${reviewed.status}`);

      // Halfway: one of the two required documents is in. Still not enough.
      if (type === 'FSSAI') {
        check(
          'One required document of two is still not verified',
          memoryStore.restaurants.get(freshId)?.status === 'PENDING_APPROVAL',
          `status ${memoryStore.restaurants.get(freshId)?.status}`
        );
        /*
         * The reviewer is told what is still missing.
         *
         * Without this they approve a licence, watch nothing happen, and go
         * looking for an approval button that does not exist — because the
         * approval IS the review, once the whole required set is in.
         */
        check(
          'and the reviewer is told what is still outstanding',
          (reviewed.json?.data?.outcome?.outstanding || []).some((l: string) => /PAN/i.test(l)) &&
            reviewed.json?.data?.outcome?.verified === false,
          JSON.stringify(reviewed.json?.data?.outcome)
        );
      } else {
        check(
          'and told plainly when the last one completes verification',
          reviewed.json?.data?.outcome?.verified === true &&
            reviewed.json?.data?.outcome?.entityStatus === 'ACTIVE',
          JSON.stringify(reviewed.json?.data?.outcome)
        );
      }
    }

    const verified = await api(`/restaurants/${freshId}/documents`, {}, freshToken);
    check(
      'Every required document is now approved',
      verified.json?.data?.verified === true,
      `outstanding ${JSON.stringify(verified.json?.data?.outstanding)}`
    );

    /*
     * With every REQUIRED document approved by an administrator, the partner is
     * verified and the restaurant is activated. That approval IS the human
     * decision — it is made one document at a time in the review queue rather
     * than as a separate button afterwards.
     */
    check(
      'Approving the last required document activates the restaurant',
      memoryStore.restaurants.get(freshId)?.status === 'ACTIVE',
      `status ${memoryStore.restaurants.get(freshId)?.status}`
    );

    const finallyOnline = await api(
      `/restaurants/${freshId}/kitchen-status`,
      { method: 'POST', body: { isKitchenActive: true } },
      freshToken
    );
    check(
      'and only THEN can the kitchen go online',
      finallyOnline.status === 200 && finallyOnline.json?.data?.isOpen === true,
      `${finallyOnline.status} ${JSON.stringify(finallyOnline.json?.data)}`
    );

    const visibleFeed = await api('/restaurants');
    check(
      'and only then does it appear to customers',
      (visibleFeed.json?.data?.restaurants || []).some((r: any) => r.id === freshId)
    );

    const reFssai = await api(
      `/restaurants/${freshId}/documents`,
      { method: 'POST', body: { documentType: 'FSSAI', documentNumber: '12345678901234', fileUrl: PHOTO } },
      freshToken
    );
    check('An approved document cannot quietly be replaced', reFssai.status === 409, `status ${reFssai.status}`);

    // Rejecting an optional document must not close a trading kitchen.
    const gst = await api(
      `/restaurants/${freshId}/documents`,
      { method: 'POST', body: { documentType: 'GSTIN', documentNumber: '29AAAAA0000A1Z5', fileUrl: PHOTO } },
      freshToken
    );
    await api(
      '/admin/documents/review',
      {
        method: 'POST',
        body: {
          documentId: gst.json?.data?.document?.id,
          action: 'REJECT',
          rejectionReason: 'The GSTIN is unreadable.'
        }
      },
      admin.token
    );
    check(
      'Rejecting an OPTIONAL document leaves a trading kitchen trading',
      memoryStore.restaurants.get(freshId)?.status === 'ACTIVE',
      `status ${memoryStore.restaurants.get(freshId)?.status}`
    );

    /*
     * A REQUIRED document withdrawn from a kitchen that is already trading.
     *
     * The unpleasant case, and the right one. An administrator who discovers
     * that an approved FSSAI licence has expired — or was never real — and
     * rejects it is saying the kitchen may not sell food today. Leaving it
     * open because it was open an hour ago is the platform knowingly listing
     * an unlicensed kitchen.
     */
    const approvedFssai = [...memoryStore.kycDocuments.values()].find(
      (d: any) => d.entityId === freshId && d.documentType === 'FSSAI' && d.status === 'APPROVED'
    ) as any;
    check('The approved licence is on file', Boolean(approvedFssai));

    const withdraw = await api(
      '/admin/documents/review',
      {
        method: 'POST',
        body: {
          documentId: approvedFssai?.id,
          action: 'REJECT',
          rejectionReason: 'This licence expired in March.'
        }
      },
      admin.token
    );
    check('An administrator can withdraw it', withdraw.status === 200, `status ${withdraw.status}`);

    check(
      'Withdrawing a REQUIRED document stops the kitchen trading',
      memoryStore.restaurants.get(freshId)?.status !== 'ACTIVE',
      `status ${memoryStore.restaurants.get(freshId)?.status}`
    );
    check(
      'and closes it rather than leaving it open with nobody allowed to cook',
      memoryStore.restaurants.get(freshId)?.isOpen === false,
      `isOpen ${memoryStore.restaurants.get(freshId)?.isOpen}`
    );

    const afterWithdraw = await api('/restaurants');
    check(
      'and takes it off the customer feed',
      !(afterWithdraw.json?.data?.restaurants || []).some((r: any) => r.id === freshId)
    );

    // Back to PENDING_APPROVAL rather than SUSPENDED, so the partner can
    // photograph a valid licence and send it again from the same screen.
    const resend = await api(
      `/restaurants/${freshId}/documents`,
      { method: 'POST', body: { documentType: 'FSSAI', documentNumber: '99999999999999', fileUrl: PHOTO } },
      freshToken
    );
    check('The partner can send a valid one', resend.status === 201, `status ${resend.status}`);

    await api(
      '/admin/documents/review',
      { method: 'POST', body: { documentId: resend.json?.data?.document?.id, action: 'APPROVE' } },
      admin.token
    );
    check(
      'and approving it puts them back in business',
      memoryStore.restaurants.get(freshId)?.status === 'ACTIVE',
      `status ${memoryStore.restaurants.get(freshId)?.status}`
    );

    /* ================================================================== *
     *  4. An account that no longer exists                               *
     * ================================================================== */
    console.log('\n-- A deleted account');

    const doomed = await login('rahul.sharma@quickbite.app');
    const doomedOk = await api('/auth/me', {}, doomed.token);
    check('The account works before it is removed', doomedOk.status === 200, `status ${doomedOk.status}`);

    // What a platform reset leaves behind: a valid signature belonging to
    // somebody who is no longer there.
    memoryStore.users.delete(doomed.user.id);

    const ghost = await api('/auth/me', {}, doomed.token);
    check(
      'A token for a deleted account is refused',
      ghost.status === 401 && ghost.json?.error?.code === 'ACCOUNT_NOT_FOUND',
      `${ghost.status} ${ghost.json?.error?.code}`
    );

    /* ================================================================== *
     *  5. A document is a photograph                                     *
     * ================================================================== */
    console.log('\n-- What counts as a document');

    const docs = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
    check(
      'Only formats the app can actually produce are advertised',
      !(docs.json?.data?.acceptedFormats || []).includes('PDF'),
      `advertised ${JSON.stringify(docs.json?.data?.acceptedFormats)}`
    );

    const prose = await api(
      `/restaurants/${RESTAURANT}/documents`,
      {
        method: 'POST',
        body: { documentType: 'GSTIN', documentNumber: '29ABCDE1234F1Z5', fileUrl: 'emailed on 14 Sep' }
      },
      partner.token
    );
    check('A note describing a file is not a document', prose.status === 400, `status ${prose.status}`);

    const photo = await api(
      `/restaurants/${RESTAURANT}/documents`,
      {
        method: 'POST',
        body: {
          documentType: 'GSTIN',
          documentNumber: '29ABCDE1234F1Z5',
          fileUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg='
        }
      },
      partner.token
    );
    check('A photograph is accepted', photo.status === 201, `status ${photo.status}`);
    check(
      'and reaches the reviewer as an image rather than as prose',
      String(photo.json?.data?.document?.fileUrl || '').startsWith('data:image/')
    );
  } finally {
    server.close();
  }

  console.log(`\n  ${passed} passed, ${failures} failed`);
  if (failures > 0) {
    console.log('\n  ACCOUNT BLOCKING IS NOT ENFORCED');
    process.exit(1);
  }
  console.log('\n====================================================');
  console.log('  BLOCKED MEANS BLOCKED, ON THE TOKEN THEY HOLD     ');
  console.log('====================================================');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
