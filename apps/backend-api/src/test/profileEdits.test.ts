/**
 * The restaurant profile: two versions of one restaurant, and the review that
 * decides which one customers see.
 *
 * Driven over HTTP the way the partner app and the admin console drive it. The
 * claims that matter are negatives, so most of these checks assert a refusal:
 *
 *  - an unreviewed change is NOT live, not even for a moment
 *  - a partner cannot edit the fields that are their own verification
 *  - a second submission retires the first rather than queueing behind it
 *  - a review that leaves a field undecided is refused
 *  - a partner cannot review their own submission
 *
 * A check that only ever asserts the happy path proves the route exists. It
 * does not prove the gate holds, which is the entire point of the gate.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';

const PORT = 5199;  // 5197 is accountBlocking's. Two suites on one port is a flake waiting for a slow close.
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

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
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

/** A real 1x1 PNG. Short, but structurally a picture, which is what is checked. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function run() {
  console.log('====================================================');
  console.log('   RESTAURANT PROFILE - DRAFT, REVIEW, PUBLISH      ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 300));

  const RESTAURANT = 'rst_bbh_01';
  const partner = await login('partner@quickbite.app');
  const admin = await login('admin@quickbite.app');

  // ---------------------------------------------------------------------
  console.log('\n-- What the partner app is told');

  const profile = await api(`/restaurants/${RESTAURANT}/profile`, {}, partner.token);
  check('A partner can read their own profile', profile.status === 200, `status ${profile.status}`);

  const rules = profile.json?.data?.rules;
  check('The editable field list comes from the server', Array.isArray(rules?.editableFields));
  check(
    'and the limits come with it, so no APK hardcodes them',
    Number(rules?.maxDescriptionChars) > 0 &&
      Number(rules?.maxGalleryImages) > 0 &&
      Number(rules?.maxImageChars) > 0,
    JSON.stringify(rules).slice(0, 120)
  );
  check(
    'The seven day names come from the server too',
    Array.isArray(rules?.daysOfWeek) && rules.daysOfWeek.length === 7
  );

  // The fields that ARE the verification. A partner who could edit these could
  // undo their own KYC behind an already-approved document.
  for (const forbidden of [
    'packagingFee',
    'commissionPercent',
    'status',
    'kycStatus',
    'serviceRadiusKm',
    'isPureVeg',
    'fssaiLicenseNumber',
    'gstin'
  ]) {
    check(
      `"${forbidden}" is not offered to a partner as editable`,
      !rules?.editableFields?.includes(forbidden)
    );
  }

  check('Nothing is pending on a fresh restaurant', profile.json?.data?.pending === null);

  // ---------------------------------------------------------------------
  console.log('\n-- Submitting a change');

  const originalName = memoryStore.restaurants.get(RESTAURANT)?.name;

  const submitted = await api(
    `/restaurants/${RESTAURANT}/profile`,
    {
      method: 'PUT',
      body: {
        name: 'Bengaluru Biryani House & Grill',
        description: 'Slow-cooked dum biryani, made to order since 2014.',
        cuisineTags: ['Biryani', 'Mughlai', 'biryani'],
        bannerUrl: TINY_PNG
      }
    },
    partner.token
  );
  check('A partner can submit a profile change', submitted.status === 201, `status ${submitted.status}`);
  check('and it is recorded as submitted', submitted.json?.data?.submitted === true);

  const editId = submitted.json?.data?.edit?.id;
  check('The submission has an id to review', typeof editId === 'string' && editId.length > 0);

  check(
    'Duplicate cuisine tags are de-duplicated, not refused',
    JSON.stringify(submitted.json?.data?.edit?.changes?.cuisineTags) ===
      JSON.stringify(['Biryani', 'Mughlai']),
    JSON.stringify(submitted.json?.data?.edit?.changes?.cuisineTags)
  );

  /*
   * THE CLAIM THIS WHOLE FEATURE RESTS ON.
   *
   * If the live record has moved, everything else here is decoration: an
   * unreviewed name is on the customer's home screen and the review queue is a
   * formality that runs after the fact.
   */
  check(
    'The LIVE restaurant has not changed',
    memoryStore.restaurants.get(RESTAURANT)?.name === originalName,
    `live name is now ${memoryStore.restaurants.get(RESTAURANT)?.name}`
  );
  check(
    'and no unreviewed photograph reached it either',
    !memoryStore.restaurants.get(RESTAURANT)?.bannerUrl?.startsWith('data:image/png')
  );

  const customerView = await api(`/restaurants/${RESTAURANT}`);
  check(
    'A customer still sees the approved name',
    customerView.json?.data?.restaurant?.name === originalName,
    customerView.json?.data?.restaurant?.name
  );

  // ---------------------------------------------------------------------
  console.log('\n-- What a partner may not change');

  const forbidden = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { commissionPercent: 1, isPureVeg: true } },
    partner.token
  );
  check(
    'Editing commission or the veg flag is refused outright',
    forbidden.status === 400,
    `status ${forbidden.status}`
  );
  check(
    'and the refusal names the field',
    String(forbidden.json?.error?.message || '').includes('commissionPercent'),
    forbidden.json?.error?.message
  );

  const prose = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { bannerUrl: 'I will email the photo tomorrow' } },
    partner.token
  );
  check('Prose is not a photograph', prose.status === 400, `status ${prose.status}`);

  const fakeImage = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { bannerUrl: 'data:image/png;base64,this is not base64!!' } },
    partner.token
  );
  check(
    'A data URI with the right prefix and a prose body is refused',
    fakeImage.status === 400,
    `status ${fakeImage.status}`
  );

  const tooMany = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { galleryUrls: [TINY_PNG, TINY_PNG, TINY_PNG, TINY_PNG, TINY_PNG] } },
    partner.token
  );
  check('A fifth gallery photograph is refused', tooMany.status === 400, `status ${tooMany.status}`);

  const farAway = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { coordinates: { latitude: 28.61, longitude: 77.2 } } },
    partner.token
  );
  check(
    'A map pin outside the served area is refused',
    farAway.status === 400,
    `status ${farAway.status}`
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Opening hours');

  const overlapping = await api(
    `/restaurants/${RESTAURANT}/profile`,
    {
      method: 'PUT',
      body: {
        openingHours: {
          timezone: 'Asia/Kolkata',
          week: {
            MONDAY: [
              { opensAt: '11:00', closesAt: '15:00' },
              { opensAt: '14:00', closesAt: '23:00' }
            ]
          }
        }
      }
    },
    partner.token
  );
  check('Overlapping serving windows are refused', overlapping.status === 400, `status ${overlapping.status}`);

  const badTime = await api(
    `/restaurants/${RESTAURANT}/profile`,
    {
      method: 'PUT',
      body: { openingHours: { timezone: 'Asia/Kolkata', week: { MONDAY: [{ opensAt: '9pm', closesAt: '11pm' }] } } }
    },
    partner.token
  );
  check('"9pm" is not a time on a 24-hour clock', badTime.status === 400, `status ${badTime.status}`);

  const notADay = await api(
    `/restaurants/${RESTAURANT}/profile`,
    {
      method: 'PUT',
      body: { openingHours: { timezone: 'Asia/Kolkata', week: { FUNDAY: [{ opensAt: '11:00', closesAt: '23:00' }] } } }
    },
    partner.token
  );
  check('An invented day of the week is refused', notADay.status === 400, `status ${notADay.status}`);

  // ---------------------------------------------------------------------
  console.log('\n-- A second submission retires the first');

  const second = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { name: 'Bengaluru Biryani House and Grill' } },
    partner.token
  );
  check('A partner can submit again', second.status === 201, `status ${second.status}`);
  const secondId = second.json?.data?.edit?.id;

  const history = await api(`/restaurants/${RESTAURANT}/profile/edits`, {}, partner.token);
  const firstRow = (history.json?.data?.edits || []).find((e: any) => e.id === editId);
  check(
    'The earlier submission is SUPERSEDED, not queued',
    firstRow?.status === 'SUPERSEDED',
    `status ${firstRow?.status}`
  );

  const stale = await api(
    `/admin/profile-edits/${editId}/review`,
    { method: 'POST', body: { approve: ['name', 'description', 'cuisineTags', 'bannerUrl'] } },
    admin.token
  );
  check(
    'A superseded submission cannot be approved',
    stale.status === 409,
    `status ${stale.status}`
  );
  check(
    'and the refusal points the reviewer at the newer one',
    String(stale.json?.error?.message || '').toLowerCase().includes('newer'),
    stale.json?.error?.message
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Nothing to review is not a submission');

  const liveName = memoryStore.restaurants.get(RESTAURANT)?.name;
  const unchanged = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { name: liveName } },
    partner.token
  );
  check('Re-saving an unchanged field is not an error', unchanged.status === 200, `status ${unchanged.status}`);
  check('and is explicitly not a submission', unchanged.json?.data?.submitted === false);

  const afterNoop = await api(`/restaurants/${RESTAURANT}/profile/edits`, {}, partner.token);
  check(
    'so it did not retire the change actually waiting for review',
    (afterNoop.json?.data?.edits || []).find((e: any) => e.id === secondId)?.status === 'PENDING'
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Who may review');

  const selfReview = await api(
    `/admin/profile-edits/${secondId}/review`,
    { method: 'POST', body: { approve: ['name'] } },
    partner.token
  );
  check(
    'A partner cannot approve their own change',
    selfReview.status === 401 || selfReview.status === 403,
    `status ${selfReview.status}`
  );

  const queue = await api('/admin/profile-edits?status=PENDING', {}, admin.token);
  check('An administrator sees the review queue', queue.status === 200, `status ${queue.status}`);
  const queued = (queue.json?.data?.edits || []).find((e: any) => e.id === secondId);
  check('and the pending submission is in it', Boolean(queued));
  check(
    'with the before and after a reviewer needs',
    queued?.previous?.name === liveName && queued?.changes?.name === 'Bengaluru Biryani House and Grill',
    `${queued?.previous?.name} -> ${queued?.changes?.name}`
  );
  check('and the restaurant it belongs to', queued?.restaurantName === liveName || Boolean(queued?.restaurantName));

  // ---------------------------------------------------------------------
  console.log('\n-- A review must decide every field');

  const third = await api(
    `/restaurants/${RESTAURANT}/profile`,
    {
      method: 'PUT',
      body: {
        name: 'Bengaluru Biryani House & Co',
        description: 'Dum biryani, kebabs and rolls.',
        bannerUrl: TINY_PNG
      }
    },
    partner.token
  );
  const thirdId = third.json?.data?.edit?.id;

  const partial = await api(
    `/admin/profile-edits/${thirdId}/review`,
    { method: 'POST', body: { approve: ['name'] } },
    admin.token
  );
  check(
    'A review that leaves fields undecided is refused',
    partial.status === 400,
    `status ${partial.status}`
  );
  check(
    'and names what is still undecided',
    String(partial.json?.error?.message || '').includes('description'),
    partial.json?.error?.message
  );

  const noReason = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description'],
        reject: [{ field: 'bannerUrl', reason: '' }]
      }
    },
    admin.token
  );
  check(
    'Refusing a field without a reason is refused',
    noReason.status === 400,
    `status ${noReason.status}`
  );

  /*
   * The three gaps below were found by deleting each clause of the review rule
   * separately and seeing which deletions no check noticed. Two of these
   * clauses had two mirrored halves, and the suite was exercising only one
   * half of each - the other could be deleted with everything still green.
   */

  const phantomApprove = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description', 'bannerUrl', 'phone'],
        reject: []
      }
    },
    admin.token
  );
  check(
    'Approving a field the partner never submitted is refused',
    phantomApprove.status === 400,
    `status ${phantomApprove.status}`
  );
  check(
    'and the refusal names the field that was not in the submission',
    String(phantomApprove.json?.error?.message || '').includes('phone'),
    phantomApprove.json?.error?.message
  );

  const phantomReject = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description', 'bannerUrl'],
        reject: [{ field: 'galleryUrls', reason: 'Not needed.' }]
      }
    },
    admin.token
  );
  check(
    'Refusing a field the partner never submitted is refused',
    phantomReject.status === 400,
    `status ${phantomReject.status}`
  );

  /*
   * A reason of "   " passes the schema, which only requires one character.
   * Without the trim in the review rule it would reach the partner as a
   * refusal with a blank explanation - which is the same as no explanation,
   * and leaves them with nothing to fix.
   */
  const blankReason = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description'],
        reject: [{ field: 'bannerUrl', reason: '   ' }]
      }
    },
    admin.token
  );
  check(
    'A reason of only whitespace is not a reason',
    blankReason.status === 400,
    `status ${blankReason.status}`
  );

  const contradiction = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description', 'bannerUrl'],
        reject: [{ field: 'bannerUrl', reason: 'Too dark to see the food.' }]
      }
    },
    admin.token
  );
  check(
    'A field cannot be both approved and refused',
    contradiction.status === 400,
    `status ${contradiction.status}`
  );

  check(
    'None of those refused reviews changed the restaurant',
    memoryStore.restaurants.get(RESTAURANT)?.name === liveName,
    memoryStore.restaurants.get(RESTAURANT)?.name
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Approving part and refusing part');

  const reviewed = await api(
    `/admin/profile-edits/${thirdId}/review`,
    {
      method: 'POST',
      body: {
        approve: ['name', 'description'],
        reject: [{ field: 'bannerUrl', reason: 'Too dark to see the food. Shoot it in daylight.' }]
      }
    },
    admin.token
  );
  check('A mixed review is accepted', reviewed.status === 200, `status ${reviewed.status}`);
  check(
    'and is recorded as PARTIALLY_APPROVED, which is what it was',
    reviewed.json?.data?.outcome?.status === 'PARTIALLY_APPROVED',
    reviewed.json?.data?.outcome?.status
  );

  const live = memoryStore.restaurants.get(RESTAURANT);
  check(
    'The approved name is now live',
    live?.name === 'Bengaluru Biryani House & Co',
    live?.name
  );
  check(
    'The approved description is now live',
    live?.description === 'Dum biryani, kebabs and rolls.',
    live?.description
  );
  check(
    'The REFUSED photograph is not live',
    !String(live?.bannerUrl || '').startsWith('data:image/png'),
    String(live?.bannerUrl).slice(0, 40)
  );

  const customerAfter = await api(`/restaurants/${RESTAURANT}`);
  check(
    'and a customer sees the approved name',
    customerAfter.json?.data?.restaurant?.name === 'Bengaluru Biryani House & Co',
    customerAfter.json?.data?.restaurant?.name
  );

  const partnerHistory = await api(`/restaurants/${RESTAURANT}/profile/edits`, {}, partner.token);
  const row = (partnerHistory.json?.data?.edits || []).find((e: any) => e.id === thirdId);
  check(
    'The partner is told WHICH field was refused and why',
    row?.rejections?.[0]?.field === 'bannerUrl' &&
      String(row?.rejections?.[0]?.reason).includes('daylight'),
    JSON.stringify(row?.rejections)
  );
  check(
    'and which fields went live',
    Array.isArray(row?.approvedFields) &&
      row.approvedFields.includes('name') &&
      row.approvedFields.includes('description'),
    JSON.stringify(row?.approvedFields)
  );

  const twice = await api(
    `/admin/profile-edits/${thirdId}/review`,
    { method: 'POST', body: { approve: ['name', 'description', 'bannerUrl'] } },
    admin.token
  );
  check('A settled submission cannot be reviewed again', twice.status === 409, `status ${twice.status}`);

  // ---------------------------------------------------------------------
  console.log('\n-- The hours override expires by itself');

  const override = await api(
    `/restaurants/${RESTAURANT}/hours-override`,
    { method: 'POST', body: { minutes: 90 } },
    partner.token
  );
  check('A partner can stay open past their declared hours', override.status === 200, `status ${override.status}`);

  const until = new Date(override.json?.data?.forceOpenUntil || 0).getTime();
  check(
    'and the override carries an expiry, not a flag',
    until > Date.now() && until <= Date.now() + 91 * 60_000,
    override.json?.data?.forceOpenUntil
  );

  const forever = await api(
    `/restaurants/${RESTAURANT}/hours-override`,
    { method: 'POST', body: { minutes: 60 * 24 } },
    partner.token
  );
  check(
    'An override longer than twelve hours is refused',
    forever.status === 400,
    `status ${forever.status}`
  );

  const cancelled = await api(
    `/restaurants/${RESTAURANT}/hours-override`,
    { method: 'POST', body: { minutes: 0 } },
    partner.token
  );
  check('and it can be cancelled', cancelled.json?.data?.forceOpenUntil === null);

  // ---------------------------------------------------------------------
  console.log('\n-- An unapproved kitchen');

  const pendingRestaurant = Array.from(memoryStore.restaurants.values()).find(
    (r: any) => r.id !== RESTAURANT
  ) as any;

  if (pendingRestaurant) {
    const before = pendingRestaurant.status;
    pendingRestaurant.status = 'PENDING_APPROVAL';
    memoryStore.restaurants.set(pendingRestaurant.id, pendingRestaurant);

    const staff = await api(
      `/restaurants/${pendingRestaurant.id}/hours-override`,
      { method: 'POST', body: { minutes: 60 } },
      admin.token
    );
    check(
      'A kitchen still being verified cannot force itself open',
      staff.status === 409,
      `status ${staff.status}`
    );

    pendingRestaurant.status = before;
    memoryStore.restaurants.set(pendingRestaurant.id, pendingRestaurant);
  }

  // ---------------------------------------------------------------------
  console.log('\n-- Another partner\'s restaurant');

  const trespass = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { name: 'Not mine' } },
    (await login('customer@quickbite.app')).token
  );
  check(
    'A customer cannot edit a restaurant profile',
    trespass.status === 401 || trespass.status === 403,
    `status ${trespass.status}`
  );

  /*
   * The server is closed and the process is given a moment to finish doing it.
   *
   * `server.close()` is asynchronous, and on Windows calling `process.exit()`
   * while a libuv handle is still mid-close aborts the process outright:
   * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Every check in
   * this suite passes and the runner still reports it as failed, because the
   * exit code is 127 rather than 0 - a suite that fails for a reason that has
   * nothing to do with what it tests. Same fix as contract.test.ts.
   */
  // ---------------------------------------------------------------------
  console.log('\n-- Declared hours close the kitchen');

  /*
   * THE REASON OPENING HOURS EXIST.
   *
   * The most common complaint a food platform gets is not a bad dish. It is an
   * order accepted by a restaurant that was shut, because somebody forgot to
   * press Offline — the customer pays, waits, and is refunded a meal they
   * wanted.
   *
   * These checks place REAL orders over HTTP rather than asking the helper
   * function what it thinks, because the helper being right is worth nothing
   * if the order path never calls it. That was the actual state of this
   * feature an hour ago: the model, the validation and the evaluation all
   * existed and nothing anywhere used them.
   */
  const buyer = await login('customer@quickbite.app');
  const addresses = await api('/addresses', {}, buyer.token);
  const address = (addresses.json?.data?.addresses || [])[0];
  check('The customer has an address to order to', Boolean(address?.id));

  const menu = await api(`/restaurants/${RESTAURANT}/menu`);
  const dish = (menu.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.isAvailable !== false);
  check('and the kitchen has something to sell', Boolean(dish?.id));

  const placeOrder = async () =>
    api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: RESTAURANT,
          deliveryAddressId: address?.id,
          items: [{ dishId: dish?.id, quantity: 1 }],
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: `hours_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        }
      },
      buyer.token
    );

  const kitchen = memoryStore.restaurants.get(RESTAURANT) as any;
  kitchen.isOpen = true;
  delete kitchen.forceOpenUntil;

  // A week that is switchOff right now, whenever "now" happens to be, so this does
  // not pass or fail depending on the hour the suite is run.
  const now = new Date();
  const today = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][
    (now.getDay() + 6) % 7
  ]!;
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  kitchen.openingHours = {
    timezone: 'Asia/Kolkata',
    week: { [today]: [{ opensAt: Math.max(0, minutesNow - 60), closesAt: Math.min(1439, minutesNow + 60) }] }
  };
  memoryStore.restaurants.set(RESTAURANT, kitchen);

  const inHours = await placeOrder();
  check('A kitchen inside its declared hours takes the order', inHours.status === 201, `status ${inHours.status}`);

  // Now a window that has already finished today.
  kitchen.openingHours = {
    timezone: 'Asia/Kolkata',
    week: { [today]: [{ opensAt: 0, closesAt: 1 }] }
  };
  memoryStore.restaurants.set(RESTAURANT, kitchen);

  const outOfHours = await placeOrder();
  check(
    'and outside them it is refused, even with the switch still on',
    outOfHours.status === 409 && outOfHours.json?.error?.code === 'RESTAURANT_CLOSED',
    `status ${outOfHours.status} ${outOfHours.json?.error?.code}`
  );
  check(
    'and the customer is told when it opens again, not just "closed"',
    /opens? again at \d{2}:\d{2}/i.test(String(outOfHours.json?.error?.message || '')),
    outOfHours.json?.error?.message
  );

  // The partner's override: "I know we are past our hours, we are serving."
  const stayOpen = await api(
    `/restaurants/${RESTAURANT}/hours-override`,
    { method: 'POST', body: { minutes: 60 } },
    partner.token
  );
  check('The partner can override their own hours', stayOpen.status === 200, `status ${stayOpen.status}`);

  const duringOverride = await placeOrder();
  check(
    'and the kitchen takes orders again while it lasts',
    duringOverride.status === 201,
    `status ${duringOverride.status}`
  );

  /*
   * An EXPIRED override must be ignored. This is the whole reason the override
   * is stored as a time rather than a flag: a flag quietly becomes permanent,
   * which is the exact failure declared hours were introduced to fix.
   */
  const expiredOverride = memoryStore.restaurants.get(RESTAURANT) as any;
  expiredOverride.forceOpenUntil = new Date(Date.now() - 60_000).toISOString();
  memoryStore.restaurants.set(RESTAURANT, expiredOverride);

  const afterOverride = await placeOrder();
  check(
    'An expired override is ignored, not honoured forever',
    afterOverride.status === 409,
    `status ${afterOverride.status}`
  );

  // The manual switch still beats everything: the fryer broke, the chef left.
  const switchOff = memoryStore.restaurants.get(RESTAURANT) as any;
  switchOff.openingHours = {
    timezone: 'Asia/Kolkata',
    week: { [today]: [{ opensAt: 0, closesAt: 1439 }] }
  };
  switchOff.isOpen = false;
  delete switchOff.forceOpenUntil;
  memoryStore.restaurants.set(RESTAURANT, switchOff);

  const switchedOff = await placeOrder();
  check(
    'A partner who switches off is closed, whatever their hours say',
    switchedOff.status === 409,
    `status ${switchedOff.status}`
  );

  /*
   * And a restaurant that has never declared hours behaves exactly as it
   * always did. Reading "no hours" as "closed" would shut every restaurant
   * onboarded before today, which is all of them.
   */
  const noSchedule = memoryStore.restaurants.get(RESTAURANT) as any;
  delete noSchedule.openingHours;
  noSchedule.isOpen = true;
  memoryStore.restaurants.set(RESTAURANT, noSchedule);

  const noHours = await placeOrder();
  check(
    'A kitchen that never declared hours is unaffected',
    noHours.status === 201,
    `status ${noHours.status}`
  );

  // ---------------------------------------------------------------------
  console.log('\n-- Which administrator can actually do this');

  /*
   * ASKED OF THE RUNNING SERVER, NOT OF THE ROLE TABLE.
   *
   * Every check above signs in as the super admin, and a super admin holds
   * every permission by virtue of the role itself. That cannot distinguish
   * "allowed because this role is right" from "allowed because this account is
   * always allowed" — so it cannot tell whether the permission gate works at
   * all.
   *
   * The payments session found exactly this in their own work: the Finance
   * Admin role did not hold the two permissions that are its entire job, and
   * eight chunks of screens were unreachable by the only person they were
   * built for. It survived because everything was demonstrated as super admin.
   *
   * So this signs in as the scoped accounts the seed creates for the purpose,
   * and asserts both directions. A permission granted to everybody is not a
   * permission.
   */
  const ops = await login('ops@quickbite.app');
  const support = await login('support@quickbite.app');
  const finance = await login('finance@quickbite.app');

  const opsQueue = await api('/admin/profile-edits?status=PENDING', {}, ops.token);
  check(
    'An Operations Admin — whose job this is — can open the review queue',
    opsQueue.status === 200,
    `status ${opsQueue.status}`
  );

  for (const [who, session] of [
    ['A Support Admin', support],
    ['A Finance Admin', finance]
  ] as const) {
    const refused = await api('/admin/profile-edits?status=PENDING', {}, session.token);
    check(
      `${who} cannot`,
      refused.status === 403,
      `status ${refused.status}`
    );
  }

  /*
   * And reaching the queue is not the same as being able to settle one.
   * Read and write are separate questions, and a role that can see the work
   * but not do it is its own kind of broken.
   */
  const opsSubmission = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { description: 'Reviewed by operations.' } },
    partner.token
  );
  const opsEditId = opsSubmission.json?.data?.edit?.id;
  check('A partner submits something for them to settle', Boolean(opsEditId));

  const supportAttempt = await api(
    `/admin/profile-edits/${opsEditId}/review`,
    { method: 'POST', body: { approve: ['description'], reject: [] } },
    support.token
  );
  check(
    'A Support Admin cannot settle it either',
    supportAttempt.status === 403,
    `status ${supportAttempt.status}`
  );

  const opsSettles = await api(
    `/admin/profile-edits/${opsEditId}/review`,
    { method: 'POST', body: { approve: ['description'], reject: [] } },
    ops.token
  );
  check(
    'and an Operations Admin can',
    opsSettles.status === 200,
    `status ${opsSettles.status}`
  );
  check(
    'and it actually reached the live restaurant',
    (memoryStore.restaurants.get(RESTAURANT) as any)?.description === 'Reviewed by operations.',
    (memoryStore.restaurants.get(RESTAURANT) as any)?.description
  );

  // -------------------------------------------------------------------
  console.log('\n-- Who this platform legally is');

  /*
   * Every official surface needs the same answer, and before this there was no
   * answer anywhere: the Terms and the Privacy Policy described obligations
   * without naming the entity that holds them, which is the one thing a legal
   * document cannot leave out.
   */
  const business = await api('/policies/business');
  check('The operator record is readable without signing in', business.status === 200,
    `status ${business.status}`);
  check(
    'and carries the Udyam registration',
    business.json?.data?.identity?.udyamNumber === 'UDYAM-KR-29-0052148',
    business.json?.data?.identity?.udyamNumber
  );
  check(
    'and a single formatted address, so four apps cannot format it four ways',
    /Harohalli.*Karnataka 562112/.test(String(business.json?.data?.formattedAddress || '')),
    business.json?.data?.formattedAddress
  );

  /*
   * The footer must NOT imply a tax registration. Udyam is an MSME
   * registration and confers no right to charge or reclaim tax, and the tax
   * section was removed from this platform at the owner's instruction - so
   * anything on a receipt that reads like a GSTIN would be a misleading
   * document rather than an incomplete one.
   */
  const footer = (business.json?.data?.footer || []).join(' | ');
  check(
    'The receipt footer names it as an MSME registration',
    /MSME Udyam Registration/i.test(footer),
    footer.slice(0, 140)
  );
  check(
    'and never calls it GST or a tax registration',
    !/GST|GSTIN|tax invoice/i.test(footer),
    footer.slice(0, 140)
  );

  // -------------------------------------------------------------------
  console.log('\n-- Correcting the registration');

  const opsEdit = await api(
    '/admin/platform/business',
    { method: 'PUT', body: { contactPhone: '9876500099' } },
    ops.token
  );
  check(
    'An Operations Admin cannot rewrite the platform registration',
    opsEdit.status === 403,
    `status ${opsEdit.status}`
  );

  /*
   * A Udyam number that does not look like one is a typo, and a typo on a
   * receipt is a registration nobody can verify. Refused rather than stored.
   */
  const typo = await api(
    '/admin/platform/business',
    { method: 'PUT', body: { udyamNumber: 'UDYAM-KR-290052148' } },
    admin.token
  );
  check('A malformed Udyam number is refused', typo.status === 400, `status ${typo.status}`);
  check(
    'and the original is untouched',
    (await api('/policies/business')).json?.data?.identity?.udyamNumber === 'UDYAM-KR-29-0052148'
  );

  const corrected = await api(
    '/admin/platform/business',
    { method: 'PUT', body: { contactPhone: '9876500099' } },
    admin.token
  );
  check('A super administrator can correct a detail', corrected.status === 200,
    `status ${corrected.status}`);
  check(
    'and correcting ONE field does not blank the others',
    corrected.json?.data?.identity?.udyamNumber === 'UDYAM-KR-29-0052148' &&
      corrected.json?.data?.identity?.legalName === 'QUICK BITES',
    JSON.stringify(corrected.json?.data?.identity || {}).slice(0, 160)
  );

  // ---------------------------------------------------------------------
  console.log('\n-- The packaging charge a partner declares');

  /*
   * The partner declares what packaging costs THEM. An administrator approves
   * it and may add a markup; the customer pays the sum. This half is the
   * declaration, and the payments session reads exactly two fields from it.
   */
  /*
   * Derived from what the restaurant already charges, not a literal.
   *
   * An earlier version submitted 25, which happens to be the seeded figure —
   * so the server correctly answered "nothing changed" and the check failed
   * for a reason that had nothing to do with packaging. A fixture that
   * collides with the value under test proves nothing either way.
   */
  const currentPack = Number(
    (memoryStore.restaurants.get(RESTAURANT) as any)?.partnerPackagingFee ??
      (memoryStore.restaurants.get(RESTAURANT) as any)?.packagingFee ??
      0
  );
  const declaredPack = currentPack + 7;

  const packSubmit = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { partnerPackagingFee: declaredPack } },
    partner.token
  );
  check('A partner can declare a packaging charge', packSubmit.status === 201,
    `status ${packSubmit.status}`);

  const packEditId = packSubmit.json?.data?.edit?.id;
  await api(
    `/admin/profile-edits/${packEditId}/review`,
    { method: 'POST', body: { approve: ['partnerPackagingFee'], reject: [] } },
    ops.token
  );

  const afterFirst = memoryStore.restaurants.get(RESTAURANT) as any;
  check('and once approved it reaches the restaurant', afterFirst?.partnerPackagingFee === declaredPack,
    String(afterFirst?.partnerPackagingFee));
  check(
    'stamped with when they submitted it',
    typeof afterFirst?.partnerPackagingSubmittedAt === 'string',
    afterFirst?.partnerPackagingSubmittedAt
  );

  /*
   * THE STAMP MUST MOVE ON EVERY CHANGE, not just the first.
   *
   * The payments session compares it against its own approval timestamp to
   * tell a figure it has already approved from one that has moved since. If
   * this only stamped once, a partner could raise their packaging fee after
   * approval and the admin queue would still show it as settled.
   */
  const firstStamp = afterFirst.partnerPackagingSubmittedAt;
  await new Promise(r => setTimeout(r, 15));

  const raised = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { partnerPackagingFee: declaredPack + 9 } },
    partner.token
  );
  await api(
    `/admin/profile-edits/${raised.json?.data?.edit?.id}/review`,
    { method: 'POST', body: { approve: ['partnerPackagingFee'], reject: [] } },
    ops.token
  );

  const afterSecond = memoryStore.restaurants.get(RESTAURANT) as any;
  check('A raised charge replaces the old one', afterSecond?.partnerPackagingFee === declaredPack + 9,
    String(afterSecond?.partnerPackagingFee));
  check(
    'and the submission stamp MOVES, so a reviewed figure cannot look settled after it changes',
    afterSecond?.partnerPackagingSubmittedAt !== firstStamp,
    `${firstStamp} -> ${afterSecond?.partnerPackagingSubmittedAt}`
  );

  // A typo is refused rather than put on every bill until somebody complains.
  const typoFee = await api(
    `/restaurants/${RESTAURANT}/profile`,
    { method: 'PUT', body: { partnerPackagingFee: 2500 } },
    partner.token
  );
  check('An implausible packaging charge is refused', typoFee.status === 400,
    `status ${typoFee.status}`);

  // ---------------------------------------------------------------------
  console.log('\n-- The markup reaches customers and never the kitchen');

  /*
   * `inflateMenuForCustomer` existed and NOTHING CALLED IT. It appeared only
   * in its own unit tests, so every customer was still being shown and charged
   * the restaurant's raw price and the platform earned nothing on food.
   *
   * That is the shape of defect this project keeps producing: a function that
   * is correct, tested, and unreachable. So these checks go through the HTTP
   * routes the apps actually call, not the function.
   */
  const charges = await api(
    `/admin/rates/restaurants/${RESTAURANT}`,
    { method: 'PUT', body: { foodMarkupPercent: 20 } },
    admin.token
  );
  check('An admin can set a food markup', charges.status === 200 || charges.status === 201,
    `status ${charges.status} ${JSON.stringify(charges.json?.error || {}).slice(0, 120)}`);

  const partnerMenu = await api(`/restaurants/${RESTAURANT}/menu/manage`, {}, partner.token);
  const customerMenu = await api(`/restaurants/${RESTAURANT}/menu`);

  const firstOf = (m: any) => (m?.data?.menu?.categories || [])[0]?.items?.[0];
  const partnerDish = firstOf(partnerMenu.json);
  const customerDish = firstOf(customerMenu.json);

  check('The partner can read their own menu', Boolean(partnerDish), JSON.stringify(partnerMenu.status));
  check('and a customer can read the public one', Boolean(customerDish), JSON.stringify(customerMenu.status));

  check(
    'The customer price is MARKED UP',
    Number(customerDish?.price) > Number(partnerDish?.price),
    `customer ${customerDish?.price} vs partner ${partnerDish?.price}`
  );
  check(
    'and the partner still sees their OWN price, not ours',
    Number(partnerDish?.price) === Math.round(Number(partnerDish?.price)) &&
      Number(partnerDish?.price) < Number(customerDish?.price),
    `partner sees ${partnerDish?.price}`
  );

  /*
   * The markup is a VIEW. If it ever wrote back, the kitchen's own menu would
   * become the marked-up one and the next read would mark up the markup.
   */
  const secondRead = await api(`/restaurants/${RESTAURANT}/menu`);
  check(
    'Reading twice does not compound the markup',
    Number(firstOf(secondRead.json)?.price) === Number(customerDish?.price),
    `${customerDish?.price} then ${firstOf(secondRead.json)?.price}`
  );

  const partnerAfter = await api(`/restaurants/${RESTAURANT}/menu/manage`, {}, partner.token);
  check(
    'and the stored menu is untouched',
    Number(firstOf(partnerAfter.json)?.price) === Number(partnerDish?.price),
    `${partnerDish?.price} then ${firstOf(partnerAfter.json)?.price}`
  );

  // A customer must not be able to reach the kitchen's own prices.
  const trespassMenu = await api(`/restaurants/${RESTAURANT}/menu/manage`, {}, buyer.token);
  check(
    'A customer cannot read the uninflated menu',
    trespassMenu.status === 403 || trespassMenu.status === 401,
    `status ${trespassMenu.status}`
  );

  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  PROFILE REVIEW HOLDS - NOTHING UNREVIEWED IS LIVE  ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  }
  console.log(`  PROFILE REVIEW BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  setTimeout(() => process.exit(1), 100);
}

run().catch(err => {
  console.error('[FAIL] Profile review suite aborted:', err.message);
  process.exit(1);
});
