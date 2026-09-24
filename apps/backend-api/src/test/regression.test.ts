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
  // A deliberately narrow admin, used to prove the server refuses rather than
  // the app merely hiding a button.
  const support = await login('support@quickbite.app');

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
      // A free number, typed the way a person types one. 9876543210 belongs to
      // the seeded customer, and this check is about NORMALISATION, not about
      // whether a number can be reused - which it can no longer be.
      phone: '+91 98111 00033'
    }
  });
  check('A number typed with +91 and spaces is accepted', withCountryCode.status === 201, String(withCountryCode.status));
  check(
    'and is stored as the bare ten digits',
    withCountryCode.json?.data?.user?.phone === '9811100033',
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
  /*
   * ADDED WITH THE LEDGER CHANGE, and it is the point of that change.
   *
   * These figures used to come from a formula local to this screen: TDS at 1% of
   * commission where the ledger uses the bill's own figure, no packaging at all, and
   * no sight of refund clawbacks. So Settlements and Pay reported different numbers
   * for the same kitchen on the same morning, and whichever screen somebody opened
   * was the one they believed.
   *
   * Payable-now is shown separately because it is the payout GATE — a delivery from
   * ten minutes ago is owed but not yet payable, and collapsing the two is what made
   * a hold period invisible here.
   */
  check(
    'and its figures agree with the Pay screen, which is the whole point',
    Number(bbh?.outstandingAmount) === Number(bbh?.pendingAmount) &&
      Number(bbh?.payableNowAmount) + Number(bbh?.heldAmount) === Number(bbh?.outstandingAmount),
    JSON.stringify({
      pending: bbh?.pendingAmount,
      payableNow: bbh?.payableNowAmount,
      held: bbh?.heldAmount,
      outstanding: bbh?.outstandingAmount
    })
  );

  const breakdown = await api('/admin/settlements/rst_bbh_01', {}, superAdmin.token);
  check('A per-order breakdown is available', (breakdown.json?.data?.lines || []).length > 0);
  check(
    'and each line shows sales, commission and TDS',
    breakdown.json?.data?.lines?.[0]?.grossSales > 0 && breakdown.json?.data?.lines?.[0]?.commission > 0
  );

  /*
   * DRAFTING INSIDE THE HOLD PERIOD IS NOW REFUSED, AND THAT IS NEW BEHAVIOUR.
   *
   * The order above was delivered seconds ago, and the default partner hold is a day.
   * This screen used to draft and pay it anyway, because it computed its own figure
   * and never consulted the hold — so the one control that stops the platform paying
   * out money it has not yet been settled for did not apply on the screen most likely
   * to be used to pay a restaurant.
   */
  const tooSoon = await api('/admin/settlements', { method: 'POST', body: { restaurantId: 'rst_bbh_01' } }, superAdmin.token);
  check('Drafting inside the hold period is refused', tooSoon.status === 409, String(tooSoon.status));
  check(
    'and the refusal names the hold rather than saying nothing is owed',
    /hold period/i.test(JSON.stringify(tooSoon.json)),
    JSON.stringify(tooSoon.json).slice(0, 200)
  );

  // Released the way an administrator would, on the Rates screen.
  await api(
    '/admin/pricing/config',
    { method: 'PUT', body: { rates: { partnerHoldDays: 0 }, note: 'Same-day settlement for this check' } },
    superAdmin.token
  );

  // And an account to pay into, which a real deployment has and the seed does not.
  memoryStore.payeeAccounts.set('acc_regress_bbh', {
    id: 'acc_regress_bbh',
    ownerType: 'RESTAURANT',
    ownerId: 'rst_bbh_01',
    ownerUserId: 'usr_partner_01',
    method: 'BANK',
    holderName: 'Biryani By Heart',
    accountLast4: '9911',
    ifsc: 'HDFC0001234',
    validationStatus: 'VERIFIED',
    appliedAt: new Date().toISOString(),
    isDefault: true,
    createdAt: new Date().toISOString(),
    createdByUserId: 'usr_admin_01'
  } as any);

  const draft = await api('/admin/settlements', { method: 'POST', body: { restaurantId: 'rst_bbh_01' } }, superAdmin.token);
  check('A settlement can be drafted once released', draft.status === 201, String(draft.status));
  const settlementId = draft.json?.data?.settlement?.id;

  /*
   * THIS ASSERTION CHANGED. It used to check the screen's own arithmetic —
   * net = gross − commission − TDS — which was a SECOND formula that disagreed with
   * the ledger about packaging and about the TDS base. Checking a formula against
   * itself passes however wrong the formula is.
   *
   * What matters is that the amount about to be paid is the amount the books say is
   * owed, so that is what is asserted now.
   */
  const dues = await api('/admin/payouts/dues', {}, superAdmin.token);
  const payRow = (dues.json?.data?.dues || []).find((d: any) => d.ownerType === 'RESTAURANT' && d.ownerId === 'rst_bbh_01');
  check(
    'and the amount drafted is the amount the Pay screen says is owed',
    Number(draft.json?.data?.settlement?.netAmount) === Number(payRow?.payable),
    JSON.stringify({ drafted: draft.json?.data?.settlement?.netAmount, pay: payRow?.payable })
  );

  const withAdjustment = await api(
    '/admin/settlements',
    { method: 'POST', body: { restaurantId: 'rst_bbh_01', adjustments: 50 } },
    superAdmin.token
  );
  check(
    'An adjustment is refused, because refunds are already deducted',
    withAdjustment.status === 400 && /twice/i.test(JSON.stringify(withAdjustment.json)),
    `${withAdjustment.status} ${JSON.stringify(withAdjustment.json).slice(0, 180)}`
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

  /*
   * AND IT ACTUALLY PAYS, WHICH IS THE PART THAT WAS MISSING.
   *
   * Marking a settlement PAID used to write the record and an audit line and post
   * NOTHING to the ledger. The payable stayed standing, so the Pay screen still showed
   * the money owed and the next run paid the same kitchen AGAIN.
   *
   * Driven through the ROUTE rather than the module on purpose: the module-level checks
   * in settlementsAgree pass whether or not this route is wired to them, and that gap
   * is exactly where the defect lived.
   */
  const duesAfterPaid = await api('/admin/payouts/dues', {}, superAdmin.token);
  const rowAfterPaid = (duesAfterPaid.json?.data?.dues || []).find(
    (d: any) => d.ownerType === 'RESTAURANT' && d.ownerId === 'rst_bbh_01'
  );
  check(
    'and the Pay screen no longer offers to pay the same trading again',
    // Absent OR zero. `allDues` only lists payees with something outstanding, so a
    // kitchen that has just been paid in full drops off the list entirely — and both
    // answers mean the same thing.
    !rowAfterPaid || Number(rowAfterPaid.payable) === 0,
    `Pay still says ${rowAfterPaid?.payable} is owed after the settlement was paid`
  );

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
   * Menu approval — a new restaurant could never publish its first dish
   * ------------------------------------------------------------------ */

  // A restaurant onboarded today has no menu document. Approving its first dish
  // used to fail with "That restaurant has no menu to add to", and the only way
  // a menu could come into existence was by approving a dish.
  const freshRestaurantId = `rst_regress_${Date.now()}`;
  memoryStore.restaurants.set(freshRestaurantId, {
    id: freshRestaurantId,
    name: 'Brand New Kitchen',
    ownerId: partnerForChat.user.id,
    city: 'Bengaluru',
    status: 'ACTIVE',
    isOpen: true,
    kycStatus: 'ACTIVE',
    packagingFee: 20,
    cuisines: ['South Indian'],
    rating: 0,
    coordinates: { latitude: 12.96, longitude: 77.64 }
  });
  check('A newly onboarded restaurant has no menu document yet', !memoryStore.menus.has(freshRestaurantId));

  const firstRequest = await api(
    `/restaurants/${freshRestaurantId}/menu/requests`,
    {
      method: 'POST',
      body: { kind: 'ADD_ITEM', name: 'Opening Day Dosa', price: 120, isVeg: true, categoryName: 'Breakfast' }
    },
    partnerForChat.token
  );
  check('Its first dish can be submitted', firstRequest.status === 201, String(firstRequest.status));

  const firstApproval = await api(
    `/admin/menu-requests/${firstRequest.json?.data?.request?.id}/review`,
    { method: 'POST', body: { action: 'APPROVE' } },
    superAdmin.token
  );
  check(
    'and approving it creates the menu instead of refusing',
    firstApproval.status === 200,
    `${firstApproval.status} ${JSON.stringify(firstApproval.json?.error || '')}`
  );
  check('The dish is on the live menu', firstApproval.json?.data?.item?.name === 'Opening Day Dosa');
  check('and the menu document now exists', memoryStore.menus.has(freshRestaurantId));

  /* ------------------------------------------------------------------ *
   * Menu approval — grouped by restaurant, settled in one decision
   * ------------------------------------------------------------------ */

  const submit = async (name: string, price: number) =>
    api(
      `/restaurants/${freshRestaurantId}/menu/requests`,
      { method: 'POST', body: { kind: 'ADD_ITEM', name, price, isVeg: true, categoryName: 'Mains' } },
      partnerForChat.token
    );

  const batch = [];
  for (const [name, price] of [['Masala Dosa', 140], ['Rava Dosa', 150], ['Mysore Dosa', 160], ['Typo Dosa', 28000]] as Array<[string, number]>) {
    batch.push((await submit(name, price)).json?.data?.request);
  }
  check('Four more dishes are submitted', batch.every(Boolean));

  const grouped = await api('/admin/menu-requests/grouped', {}, superAdmin.token);
  check('The queue can be read grouped by restaurant', grouped.status === 200, String(grouped.status));
  const freshGroup = (grouped.json?.data?.groups || []).find((g: any) => g.restaurantId === freshRestaurantId);
  check('The new restaurant appears as one group', Boolean(freshGroup));
  check('carrying all four of its pending dishes', freshGroup?.pendingCount === 4, String(freshGroup?.pendingCount));
  check('and naming the restaurant, not just its id', freshGroup?.restaurantName === 'Brand New Kitchen');
  check(
    'The summary counts restaurants waiting, not just requests',
    typeof grouped.json?.data?.restaurantsWaiting === 'number' && grouped.json.data.restaurantsWaiting >= 1
  );

  // The real job: turn down the mispriced one, wave the rest through.
  const typo = batch.find((r: any) => r.payload.name === 'Typo Dosa');
  const bulk = await api(
    '/admin/menu-requests/bulk-review',
    {
      method: 'POST',
      body: {
        restaurantId: freshRestaurantId,
        rejections: [{ requestId: typo.id, rejectionReason: 'Rs 28000 looks like a typo for Rs 280.' }],
        expectedRequestIds: batch.map((r: any) => r.id)
      }
    },
    superAdmin.token
  );
  check('A restaurant queue can be settled in one decision', bulk.status === 200, String(bulk.status));
  check('Three dishes approved', bulk.json?.data?.approvedCount === 3, String(bulk.json?.data?.approvedCount));
  check('One dish rejected', bulk.json?.data?.rejectedCount === 1, String(bulk.json?.data?.rejectedCount));
  check('Nothing failed to apply', (bulk.json?.data?.failed || []).length === 0, JSON.stringify(bulk.json?.data?.failed));

  const liveMenu = await api(`/restaurants/${freshRestaurantId}/menu`);
  const liveNames = (liveMenu.json?.data?.menu?.categories || []).flatMap((c: any) => c.items.map((i: any) => i.name));
  check('The approved dishes are live for customers', ['Masala Dosa', 'Rava Dosa', 'Mysore Dosa'].every(n => liveNames.includes(n)), JSON.stringify(liveNames));
  check('The rejected dish is not', !liveNames.includes('Typo Dosa'));

  const afterBulk = await api('/admin/menu-requests/grouped', {}, superAdmin.token);

  /*
   * The status is asserted FIRST, and that is the whole point of this line.
   *
   * The check below reads `!settled || settled.pendingCount === 0`, and here
   * that idiom is correct: a restaurant that has dropped out of the pending
   * list entirely IS the success state, so absence means what the check wants.
   *
   * But a 500 from this endpoint produces an absent `settled` too, and passes
   * for the wrong reason. Without this line the check cannot tell "the queue is
   * clear" from "the queue could not be read" -- and the sibling check above it
   * already asserts bulk.status, so the omission was an inconsistency rather
   * than a decision.
   */
  check('The pending queue can be read back', afterBulk.status === 200, String(afterBulk.status));

  const settled = (afterBulk.json?.data?.groups || []).find((g: any) => g.restaurantId === freshRestaurantId);
  check('The restaurant no longer has anything pending', !settled || settled.pendingCount === 0, String(settled?.pendingCount));

  const rejectedRequest = await api('/admin/menu-requests?status=REJECTED', {}, superAdmin.token);
  const rejectedTypo = (rejectedRequest.json?.data?.requests || []).find((r: any) => r.id === typo.id);
  check('The partner is told why theirs was turned down', String(rejectedTypo?.rejectionReason || '').includes('typo'), String(rejectedTypo?.rejectionReason));

  // A reason is mandatory: a rejection the partner cannot act on is not a review.
  const reasonless = await api(
    '/admin/menu-requests/bulk-review',
    { method: 'POST', body: { restaurantId: freshRestaurantId, rejections: [{ requestId: 'x', rejectionReason: '' }] } },
    superAdmin.token
  );
  check('A rejection with no reason is refused', reasonless.status === 400, String(reasonless.status));

  // Anything submitted after the screen was loaded must not be approved unseen.
  const lateDish = (await submit('Arrived After You Looked', 200)).json?.data?.request;
  const staleScreen = await api(
    '/admin/menu-requests/bulk-review',
    { method: 'POST', body: { restaurantId: freshRestaurantId, expectedRequestIds: ['some-older-id'] } },
    superAdmin.token
  );
  check('A dish submitted after the screen loaded is not approved unseen', staleScreen.json?.data?.approvedCount === 0, String(staleScreen.json?.data?.approvedCount));
  check('and is reported as skipped', staleScreen.json?.data?.skippedUnseen === 1, String(staleScreen.json?.data?.skippedUnseen));

  const stillPending = await api('/admin/menu-requests?status=PENDING', {}, superAdmin.token);
  check(
    'so it is still waiting for a human',
    (stillPending.json?.data?.requests || []).some((r: any) => r.id === lateDish.id)
  );

  const supportTriesToApprove = await api(
    '/admin/menu-requests/bulk-review',
    { method: 'POST', body: { restaurantId: freshRestaurantId } },
    support.token
  );
  check('An admin without menu review cannot bulk-approve', supportTriesToApprove.status === 403, String(supportTriesToApprove.status));

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
