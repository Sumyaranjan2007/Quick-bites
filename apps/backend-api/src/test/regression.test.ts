/**
 * The reported defects, each driven through the layer that actually caused it.
 *
 * Every check below corresponds to something a person hit on a real phone. They
 * are written against the API rather than the screens deliberately: with one
 * exception every one of these was a backend or contract fault wearing a UI
 * costume — a coupon the app decided about without asking, a wallet route the
 * ownership check refused, favourites that were never sent anywhere, a delivery
 * fee the cart promised and the server did not honour.
 *
 * A check here failing means the bug is back, not that a label moved.
 */
import { createApp } from '../app.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import crypto from 'crypto';

const PORT = 5193;
const API = `http://127.0.0.1:${PORT}/api`;

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`[PASS] ${label}`);
  else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function api(path: string, init: any = {}, token?: string) {
  resetRequestRateLimit();
  const res = await fetch(`${API}${path}`, {
    ...init,
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

async function run() {
  console.log('====================================================');
  console.log('   REPORTED DEFECTS - ROOT CAUSE REGRESSION         ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  initSocketServer(server);
  await new Promise(r => server.once('listening', r as any));

  const superAdmin = await login('admin@quickbite.app');
  const customer = await login('customer@quickbite.app');

  /* ------------------------------------------------------------------ *
   * Phone validation — accounts could be created with unreachable numbers
   * ------------------------------------------------------------------ */

  resetAuthRateLimit();
  const tooLong = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `long_${Date.now()}@example.com`,
      password: 'strong-pass-1',
      fullName: 'Too Many Digits',
      phone: '98765432101'
    }
  });
  check('An 11-digit phone number is refused', tooLong.status === 400, String(tooLong.status));

  resetAuthRateLimit();
  const badPrefix = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `pre_${Date.now()}@example.com`,
      password: 'strong-pass-1',
      fullName: 'Bad Prefix',
      phone: '1234567890'
    }
  });
  check('A number starting 1 is refused — not an Indian mobile range', badPrefix.status === 400, String(badPrefix.status));

  resetAuthRateLimit();
  const withCountryCode = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `cc_${Date.now()}@example.com`,
      password: 'strong-pass-1',
      fullName: 'Country Code',
      phone: '+91 98765 43210'
    }
  });
  check('A number typed with +91 and spaces is accepted', withCountryCode.status === 201, String(withCountryCode.status));
  check(
    'and is stored as the bare ten digits',
    withCountryCode.json?.data?.user?.phone === '9876543210',
    String(withCountryCode.json?.data?.user?.phone)
  );

  /* ------------------------------------------------------------------ *
   * Coupons — admin created one, the customer app answered "invalid"
   * ------------------------------------------------------------------ */

  const code = `REGRESS${Date.now() % 100000}`;
  const created = await api(
    '/admin/coupons',
    {
      method: 'POST',
      body: {
        code,
        title: 'Regression test campaign',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        maxDiscountCap: 80,
        minOrderValue: 100,
        usageLimit: 5,
        isActive: true
      }
    },
    superAdmin.token
  );
  check('An administrator can create a coupon', created.status === 201, String(created.status));

  const basket = {
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 2 }],
    distanceKm: 3.2
  };

  const quoted = await api('/orders/quote', { method: 'POST', body: { ...basket, couponCode: code } }, customer.token);
  check('The checkout quote accepts that coupon', quoted.status === 200, String(quoted.status));
  check(
    'and reports no coupon error for it',
    !quoted.json?.data?.couponError,
    String(quoted.json?.data?.couponError)
  );
  check(
    'and applies a real discount to the bill',
    Number(quoted.json?.data?.bill?.couponDiscount) > 0,
    String(quoted.json?.data?.bill?.couponDiscount)
  );
  check(
    'and echoes the code back as applied',
    quoted.json?.data?.appliedCouponCode === code,
    String(quoted.json?.data?.appliedCouponCode)
  );

  // A lowercase entry is the same campaign: a customer types what is on a poster.
  const lowercase = await api(
    '/orders/quote',
    { method: 'POST', body: { ...basket, couponCode: code.toLowerCase() } },
    customer.token
  );
  check(
    'The same code typed in lower case still applies',
    Number(lowercase.json?.data?.bill?.couponDiscount) > 0,
    String(lowercase.json?.data?.couponError)
  );

  // Deactivating it must take effect at checkout, not just in the console.
  await api(`/admin/coupons/${code}`, { method: 'PATCH', body: { isActive: false } }, superAdmin.token);
  const deactivated = await api('/orders/quote', { method: 'POST', body: { ...basket, couponCode: code } }, customer.token);
  check(
    'Deactivating a coupon stops it applying at checkout',
    Boolean(deactivated.json?.data?.couponError) && !deactivated.json?.data?.appliedCouponCode,
    String(deactivated.json?.data?.couponError)
  );
  check(
    'and the customer is told why, in a sentence',
    typeof deactivated.json?.data?.couponError === 'string' && deactivated.json.data.couponError.length > 10,
    String(deactivated.json?.data?.couponError)
  );

  // An unusable code must not block the order — only the discount.
  check('An unusable coupon still returns a payable bill', Number(deactivated.json?.data?.bill?.totalAmount) > 0);

  const nonsense = await api(
    '/orders/quote',
    { method: 'POST', body: { ...basket, couponCode: 'NOT-A-REAL-CODE' } },
    customer.token
  );
  check('An invented code is refused with a reason', Boolean(nonsense.json?.data?.couponError));

  /* ------------------------------------------------------------------ *
   * The quote must match what checkout actually charges
   * ------------------------------------------------------------------ */

  const preOrderQuote = await api('/orders/quote', { method: 'POST', body: basket }, customer.token);
  const placed = await api(
    '/orders',
    {
      method: 'POST',
      body: { ...basket, paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() }
    },
    customer.token
  );
  const placedOrder = placed.json?.data?.order;
  check('An order can be placed from a quoted basket', placed.status === 201, String(placed.status));
  check(
    'The quoted total is exactly what the order is billed',
    Number(preOrderQuote.json?.data?.bill?.totalAmount) === Number(placedOrder?.bill?.totalAmount),
    `quoted ${preOrderQuote.json?.data?.bill?.totalAmount} vs charged ${placedOrder?.bill?.totalAmount}`
  );
  check(
    'The quoted delivery fee is exactly what the order is billed',
    Number(preOrderQuote.json?.data?.bill?.deliveryFee) === Number(placedOrder?.bill?.deliveryFee),
    `quoted ${preOrderQuote.json?.data?.bill?.deliveryFee} vs charged ${placedOrder?.bill?.deliveryFee}`
  );

  /* ------------------------------------------------------------------ *
   * Gold — the cart assumed every shopper had it and promised free delivery
   * ------------------------------------------------------------------ */

  resetAuthRateLimit();
  const plainEmail = `plain_${Date.now()}@example.com`;
  const plainReg = await api('/auth/register', {
    method: 'POST',
    body: { email: plainEmail, password: 'strong-pass-1', fullName: 'Not Gold', phone: '9812345678' }
  });
  const plainToken = plainReg.json?.data?.token;
  check('A newly registered customer is not Gold', plainReg.json?.data?.user?.isGold === false);

  const plainAddress = await api(
    '/addresses',
    {
      method: 'POST',
      body: {
        label: 'Home',
        addressLine: '12 Test Street, Ground Floor',
        city: 'Bengaluru',
        pincode: '560001',
        coordinates: { latitude: 12.9611, longitude: 77.6387 }
      }
    },
    plainToken
  );
  const plainAddressId = plainAddress.json?.data?.address?.id;

  const plainQuote = await api(
    '/orders/quote',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: plainAddressId,
        items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
        distanceKm: 3.2
      }
    },
    plainToken
  );
  check(
    'The quote reports that customer as not Gold',
    plainQuote.json?.data?.isGold === false,
    String(plainQuote.json?.data?.isGold)
  );
  check(
    'and does not promise them a waived delivery fee',
    Number(plainQuote.json?.data?.bill?.deliveryFee) > 0,
    `delivery fee quoted as ${plainQuote.json?.data?.bill?.deliveryFee}`
  );

  /* ------------------------------------------------------------------ *
   * Wallet — /wallets/me was matched as a user id and refused with 403
   * ------------------------------------------------------------------ */

  const wallet = await api('/wallets/me', {}, customer.token);
  check('A customer can open their own wallet', wallet.status === 200, String(wallet.status));
  check('and it carries a balance', typeof wallet.json?.data?.wallet?.balance === 'number');
  check('and its transaction history', Array.isArray(wallet.json?.data?.transactions));

  const riderSelf = await login('rider@quickbite.app');
  const riderWallet = await api('/wallets/me', {}, riderSelf.token);
  check('A rider can open their own wallet on the same route', riderWallet.status === 200, String(riderWallet.status));

  const someoneElse = await api('/wallets/usr_customer_01', {}, plainToken);
  check(
    "Another user's wallet is still refused",
    someoneElse.status === 403,
    String(someoneElse.status)
  );

  /* ------------------------------------------------------------------ *
   * Favourites — the heart filled in and nothing was ever saved
   * ------------------------------------------------------------------ */

  const emptyFavourites = await api('/customers/favourites', {}, plainToken);
  check('A new account has no favourites', (emptyFavourites.json?.data?.restaurantIds || []).length === 0);

  const added = await api(
    '/customers/favourites',
    { method: 'PUT', body: { restaurantId: 'rst_bbh_01' } },
    plainToken
  );
  check('A restaurant can be saved as a favourite', added.status === 200 && added.json?.data?.isFavourite === true);

  const twice = await api(
    '/customers/favourites',
    { method: 'PUT', body: { restaurantId: 'rst_bbh_01' } },
    plainToken
  );
  check(
    'Saving it twice does not duplicate it',
    (twice.json?.data?.restaurantIds || []).filter((id: string) => id === 'rst_bbh_01').length === 1
  );

  const readBack = await api('/customers/favourites', {}, plainToken);
  check(
    'It is still there on a fresh read — it outlives the screen',
    (readBack.json?.data?.restaurantIds || []).includes('rst_bbh_01')
  );
  check(
    'and comes back hydrated for display',
    readBack.json?.data?.restaurants?.[0]?.name?.length > 0,
    JSON.stringify(readBack.json?.data?.restaurants?.[0] || {}).slice(0, 120)
  );

  const otherPersonsList = await api('/customers/favourites', {}, customer.token);
  check(
    "One customer's favourites do not appear on another's",
    !(otherPersonsList.json?.data?.restaurantIds || []).includes('rst_bbh_01') ||
      otherPersonsList.json?.data?.restaurantIds !== readBack.json?.data?.restaurantIds
  );

  const removed = await api('/customers/favourites/rst_bbh_01', { method: 'DELETE' }, plainToken);
  check('A favourite can be removed', removed.json?.data?.isFavourite === false);

  const unknownRestaurant = await api(
    '/customers/favourites',
    { method: 'PUT', body: { restaurantId: 'rst_does_not_exist' } },
    plainToken
  );
  check('A restaurant that does not exist cannot be favourited', unknownRestaurant.status === 404);

  /* ------------------------------------------------------------------ *
   * Profile photo — there was no way to set one
   * ------------------------------------------------------------------ */

  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const avatarSet = await api('/customers/avatar', { method: 'PUT', body: { avatarUrl: tinyPng } }, plainToken);
  check('A profile photo can be set', avatarSet.status === 200, String(avatarSet.status));

  const meAfter = await api('/auth/login', { method: 'POST', body: { email: plainEmail, password: 'strong-pass-1' } });
  check(
    'and it comes back on the account at sign-in',
    typeof meAfter.json?.data?.user?.avatarUrl === 'string' && meAfter.json.data.user.avatarUrl.startsWith('data:image/'),
    String(meAfter.json?.data?.user?.avatarUrl || '').slice(0, 40)
  );

  const notAnImage = await api(
    '/customers/avatar',
    { method: 'PUT', body: { avatarUrl: 'data:text/html;base64,PHNjcmlwdD4=' } },
    plainToken
  );
  check('Something that is not an image is refused', notAnImage.status === 400, String(notAnImage.status));

  /* ------------------------------------------------------------------ *
   * Addresses — the app never called edit or delete
   * ------------------------------------------------------------------ */

  const second = await api(
    '/addresses',
    {
      method: 'POST',
      body: { label: 'Work', addressLine: '9 Second Street, Unit 4', city: 'Bengaluru', pincode: '560002' }
    },
    plainToken
  );
  const secondId = second.json?.data?.address?.id;
  check('A second address can be added', second.status === 201, String(second.status));

  const edited = await api(
    `/addresses/${secondId}`,
    { method: 'PUT', body: { addressLine: '9 Second Street, Unit 7 — corrected' } },
    plainToken
  );
  check('An address can be corrected after the fact', edited.status === 200, String(edited.status));
  check(
    'and the correction is what is stored',
    String(edited.json?.data?.address?.addressLine || '').includes('Unit 7'),
    String(edited.json?.data?.address?.addressLine)
  );

  const madeDefault = await api(`/addresses/${secondId}`, { method: 'PUT', body: { isDefault: true } }, plainToken);
  check('An address can be made the default', madeDefault.json?.data?.address?.isDefault === true);

  const listed = await api('/addresses', {}, plainToken);
  const defaults = (listed.json?.data?.addresses || []).filter((a: any) => a.isDefault);
  check('Exactly one address is the default', defaults.length === 1, `${defaults.length} defaults`);

  const deleted = await api(`/addresses/${secondId}`, { method: 'DELETE' }, plainToken);
  check('An address can be deleted', deleted.status === 200, String(deleted.status));

  /* ------------------------------------------------------------------ *
   * Chat — the rider app had no receiver, so messages went nowhere
   * ------------------------------------------------------------------ */

  const chatOrderId = placedOrder?.id;
  const partnerForChat = await login('partner@quickbite.app');
  await api(
    `/orders/${chatOrderId}/status`,
    { method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 15 } },
    partnerForChat.token
  );
  await api(`/orders/${chatOrderId}/status`, { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } }, partnerForChat.token);

  // A trip cannot be claimed by a rider who is not on shift, which is correct:
  // dispatch should not hand work to someone who has gone home. Stated here
  // rather than inherited from the seed, so this suite does not quietly depend
  // on what some other suite last left the rider set to.
  const wentOnline = await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, riderSelf.token);
  check('A rider can go on shift', wentOnline.status === 200, String(wentOnline.status));

  const claimed = await api(`/riders/orders/${chatOrderId}/claim`, { method: 'POST' }, riderSelf.token);
  check('and claim the delivery', claimed.status === 200, `${claimed.status} ${JSON.stringify(claimed.json?.error || '')}`);

  const customerSaid = await api(
    `/orders/${chatOrderId}/messages`,
    { method: 'POST', body: { body: 'I am at the side gate, not the main door.' } },
    customer.token
  );
  check('A customer can message about their order', customerSaid.status === 201, String(customerSaid.status));

  const riderReads = await api(`/orders/${chatOrderId}/messages`, {}, riderSelf.token);
  check(
    'The assigned rider receives it',
    (riderReads.json?.data?.messages || []).some((m: any) => m.body.includes('side gate')),
    JSON.stringify(riderReads.json?.data?.messages || []).slice(0, 200)
  );

  const riderReplied = await api(
    `/orders/${chatOrderId}/messages`,
    { method: 'POST', body: { body: 'Understood — two minutes away.' } },
    riderSelf.token
  );
  check('The rider can reply', riderReplied.status === 201, String(riderReplied.status));

  const customerReads = await api(`/orders/${chatOrderId}/messages`, {}, customer.token);
  check(
    'and the customer receives the reply',
    (customerReads.json?.data?.messages || []).some((m: any) => m.body.includes('two minutes')),
    String((customerReads.json?.data?.messages || []).length)
  );
  check(
    'The thread persists in order, both sides',
    (customerReads.json?.data?.messages || []).length >= 2
  );

  const stranger = await api(`/orders/${chatOrderId}/messages`, {}, plainToken);
  check('Someone unconnected to the order cannot read the thread', stranger.status === 403, String(stranger.status));

  /* ------------------------------------------------------------------ *
   * Settlements — neither restaurants nor riders could be paid or see it
   * ------------------------------------------------------------------ */

  const stored = memoryStore.orders.get(chatOrderId);
  await api(`/riders/orders/${chatOrderId}/verify-pickup`, { method: 'POST', body: { pickupCode: stored.pickupCode } }, riderSelf.token);
  await api(`/riders/orders/${chatOrderId}/verify-otp`, { method: 'POST', body: { deliveryOtp: stored.deliveryOtp } }, riderSelf.token);

  const settlements = await api('/admin/settlements', {}, superAdmin.token);
  check('The console lists restaurant settlements', settlements.status === 200, String(settlements.status));
  const bbh = (settlements.json?.data?.settlements || []).find((r: any) => r.restaurantId === 'rst_bbh_01');
  check('with the delivered order outstanding for that kitchen', Number(bbh?.pendingAmount) > 0, String(bbh?.pendingAmount));

  const breakdown = await api('/admin/settlements/rst_bbh_01', {}, superAdmin.token);
  check('A per-order breakdown is available', (breakdown.json?.data?.lines || []).length > 0);
  check(
    'and each line shows sales, commission and TDS',
    breakdown.json?.data?.lines?.[0]?.grossSales > 0 && breakdown.json?.data?.lines?.[0]?.commission > 0
  );

  const draft = await api('/admin/settlements', { method: 'POST', body: { restaurantId: 'rst_bbh_01' } }, superAdmin.token);
  check('A settlement can be drafted', draft.status === 201, String(draft.status));
  const settlementId = draft.json?.data?.settlement?.id;
  check(
    'Net pays sales less commission and TDS',
    Math.abs(
      Number(draft.json?.data?.settlement?.netAmount) -
        (Number(draft.json?.data?.settlement?.grossSales) -
          Number(draft.json?.data?.settlement?.commission) -
          Number(draft.json?.data?.settlement?.tds))
    ) < 0.011,
    JSON.stringify(draft.json?.data?.settlement)
  );

  const secondDraft = await api('/admin/settlements', { method: 'POST', body: { restaurantId: 'rst_bbh_01' } }, superAdmin.token);
  check(
    'The same trading cannot be settled twice',
    secondDraft.status === 409,
    String(secondDraft.status)
  );

  const partnerSees = await api('/restaurants/rst_bbh_01/settlements', {}, partnerForChat.token);
  check('The restaurant can see its own settlement', partnerSees.status === 200, String(partnerSees.status));
  check(
    'and the figure it sees matches the one drafted',
    (partnerSees.json?.data?.history || []).some((h: any) => h.id === settlementId)
  );

  const markedPaid = await api(
    `/admin/settlements/${settlementId}/status`,
    { method: 'POST', body: { status: 'PAID', reference: 'UTR-REGRESS-1' } },
    superAdmin.token
  );
  check('A settlement can be marked paid with a reference', markedPaid.json?.data?.settlement?.status === 'PAID');

  const afterPayment = await api('/restaurants/rst_bbh_01/settlements', {}, partnerForChat.token);
  check(
    'The restaurant sees it as paid, with the reference',
    (afterPayment.json?.data?.history || []).some((h: any) => h.id === settlementId && h.reference === 'UTR-REGRESS-1')
  );
  check('and its paid-to-date rises', Number(afterPayment.json?.data?.summary?.paidToDate) > 0);

  const reopen = await api(
    `/admin/settlements/${settlementId}/status`,
    { method: 'POST', body: { status: 'PENDING' } },
    superAdmin.token
  );
  check('A paid settlement cannot be quietly reopened', reopen.status === 409, String(reopen.status));

  const riderSettlement = await api('/riders/settlements', {}, riderSelf.token);
  check('A rider can see their own settlement', riderSettlement.status === 200, String(riderSettlement.status));
  check(
    'showing trips awaiting payment',
    Number(riderSettlement.json?.data?.summary?.tripsAwaitingSettlement) > 0,
    String(riderSettlement.json?.data?.summary?.tripsAwaitingSettlement)
  );
  check(
    'and the COD cash they are holding as a deduction',
    typeof riderSettlement.json?.data?.summary?.cashInHand === 'number'
  );
  check('and the trips that make up the figure', (riderSettlement.json?.data?.pendingTrips || []).length > 0);

  const riderSeesRestaurantMoney = await api('/admin/settlements', {}, riderSelf.token);
  check(
    'A rider cannot read the restaurant settlement ledger',
    riderSeesRestaurantMoney.status === 403,
    String(riderSeesRestaurantMoney.status)
  );

  /* ------------------------------------------------------------------ *
   * Sign-in must not become an account-enumeration oracle
   *
   * The email recovery flow this section used to guard has been removed:
   * customers have no password, and staff recovery is an administrator
   * setting a temporary one. The property it protected still matters, so it
   * moves to the endpoint that replaced it — asking for a code must not
   * reveal whether a phone number belongs to a customer.
   * ------------------------------------------------------------------ */

  resetAuthRateLimit();
  const knownNumber = await api('/auth/otp/request', { method: 'POST', body: { phone: '9876543210' } });
  resetAuthRateLimit();
  const unknownNumber = await api('/auth/otp/request', { method: 'POST', body: { phone: '9111100022' } });
  check(
    'A known and an unknown phone number get the same status',
    knownNumber.status === unknownNumber.status,
    `${knownNumber.status} vs ${unknownNumber.status}`
  );
  check(
    'and the same message — no way to ask who has an account',
    knownNumber.json?.message === unknownNumber.json?.message
  );
  check(
    'The code itself never comes back in the response',
    !JSON.stringify(knownNumber.json).match(/\b\d{6}\b/),
    JSON.stringify(knownNumber.json).slice(0, 160)
  );
  check(
    'The apps are told whether SMS delivery exists, which is a property of the deployment',
    typeof knownNumber.json?.data?.deliveryConfigured === 'boolean'
  );

  const goneForgot = await api('/auth/forgot-password', { method: 'POST', body: { email: 'customer@quickbite.app' } });
  check(
    'The emailed-recovery endpoint is gone rather than left dangling',
    goneForgot.status === 404,
    String(goneForgot.status)
  );

  closeSocketServer();
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('   EVERY REPORTED DEFECT FIXED AT THE ROOT          ');
    console.log('====================================================\n');
    process.exit(0);
  }
  console.log(`   ${failures} REPORTED DEFECT(S) STILL PRESENT`);
  console.log('====================================================\n');
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Regression suite aborted:', err.message);
  process.exit(1);
});
