/**
 * One phone number is one PERSON, and a person can be more than one thing.
 *
 * Reported from the apps: an account created in the customer app could not
 * then apply to deliver, because the rider registration answered "An account
 * with this mobile number already exists" and stopped there. There was nothing
 * to do about it but find a second SIM.
 *
 * Fixing that by letting the registration through would have been worse than
 * the bug. Two things had to hold at once:
 *
 *   1. An existing person gains a ROLE rather than being refused — and keeps
 *      the one they had, so a rider can still order their own dinner.
 *   2. "This number is already registered" must never become a way to attach
 *      yourself to somebody else's account by claiming to be them.
 *
 * So most of this suite is the second point. Every check below that asserts a
 * refusal is asserting that an existing account was NOT quietly handed to
 * whoever typed its number into a registration form.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';
import { userRepository, rolesOf } from '../db/repositories/userRepository.ts';
import crypto from 'crypto';

const PORT = 5201;
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

/** Ten digits starting 6-9, unique per run so reruns do not collide. */
function freshPhone(): string {
  const n = String(Math.floor(Math.random() * 900000000) + 100000000).slice(0, 9);
  return `9${n}`;
}

async function registerCustomer(phone: string, password: string, email: string) {
  resetAuthRateLimit();
  return api('/auth/register', {
    method: 'POST',
    body: { fullName: 'Asha Kumar', email, phone, password }
  });
}

async function registerRider(phone: string, password: string, email: string) {
  resetAuthRateLimit();
  return api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Asha Kumar',
      email,
      phone,
      password,
      vehicleType: 'BIKE',
      licenseNumber: 'KA05AB1234'
    }
  });
}

async function run() {
  console.log('====================================================');
  console.log('   ONE NUMBER, ONE PERSON, MORE THAN ONE ROLE       ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 300));

  // -------------------------------------------------------------------
  console.log('\n-- The reported bug: a customer applies to deliver');

  const phone = freshPhone();
  const password = 'asha-strong-pass-1';
  const email = `asha_${Date.now()}@rider.test`;

  const customer = await registerCustomer(phone, password, email);
  check('A customer account is created', customer.status === 201, `status ${customer.status}`);
  const customerToken = customer.json?.data?.token;
  const userId = customer.json?.data?.user?.id;

  const asRider = await registerRider(phone, password, email);
  check(
    'The SAME person can then register as a delivery partner',
    asRider.status === 201,
    `status ${asRider.status} ${JSON.stringify(asRider.json?.error || {})}`
  );
  check(
    'and it is the same account, not a second one',
    asRider.json?.data?.user?.id === userId,
    `${asRider.json?.data?.user?.id} vs ${userId}`
  );

  const stored = await userRepository.findById(userId);
  check(
    'The account now holds both roles',
    rolesOf(stored).includes('customer') && rolesOf(stored).includes('rider'),
    JSON.stringify(rolesOf(stored))
  );
  check(
    'and the primary role is unchanged, so their customer app still opens as before',
    stored?.role === 'customer',
    stored?.role
  );

  /*
   * THE POINT OF THE WHOLE CHANGE.
   *
   * Overwriting `role` with 'rider' would have "fixed" the registration and
   * broken something quieter and worse: placing an order requires the customer
   * role, so the moment somebody signed up to deliver they would have lost the
   * ability to order food, with nothing to tell them why.
   */
  const dashboard = await api('/riders/dashboard', {}, asRider.json?.data?.token);
  check(
    'They can reach the rider app',
    dashboard.status === 200,
    `status ${dashboard.status}`
  );

  const quoteAsCustomer = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'missing-on-purpose',
        items: [],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID()
      }
    },
    asRider.json?.data?.token
  );
  check(
    'and they can still order food — refused on the order body, never on their role',
    quoteAsCustomer.status !== 403,
    `status ${quoteAsCustomer.status} ${quoteAsCustomer.json?.error?.code}`
  );

  /*
   * The role has to work on a token issued BEFORE it was granted, or every
   * rider who signs up has to work out for themselves that signing out and
   * back in is what makes the app start working.
   */
  const oldTokenDashboard = await api('/riders/dashboard', {}, customerToken);
  check(
    'The new role works on the token they already had — no sign-out needed',
    oldTokenDashboard.status === 200,
    `status ${oldTokenDashboard.status}`
  );

  // -------------------------------------------------------------------
  console.log('\n-- Proving the account is yours');

  const victimPhone = freshPhone();
  const victimEmail = `victim_${Date.now()}@rider.test`;
  const victim = await registerCustomer(victimPhone, 'victim-real-password-9', victimEmail);
  check('A second customer exists to try this against', victim.status === 201);
  const victimId = victim.json?.data?.user?.id;

  const guess = await registerRider(victimPhone, 'not-their-password', victimEmail);
  check(
    'Registering over somebody else’s number with the wrong password is refused',
    guess.status === 409,
    `status ${guess.status}`
  );
  check(
    'and the refusal tells them what to do rather than dead-ending',
    /password|sign in/i.test(String(guess.json?.error?.message || '')),
    guess.json?.error?.message
  );
  check(
    'and NO role was granted',
    !rolesOf(await userRepository.findById(victimId)).includes('rider'),
    JSON.stringify(rolesOf(await userRepository.findById(victimId)))
  );
  check(
    'and no rider record was created for them',
    !Array.from(memoryStore.riders.values()).some((r: any) => r.userId === victimId)
  );

  // -------------------------------------------------------------------
  console.log('\n-- A blocked account cannot collect a new role');

  const blockedPhone = freshPhone();
  const blockedEmail = `blocked_${Date.now()}@rider.test`;
  const blockedPass = 'blocked-user-pass-1';
  const blocked = await registerCustomer(blockedPhone, blockedPass, blockedEmail);
  const blockedId = blocked.json?.data?.user?.id;

  const blockedUser = memoryStore.users.get(blockedId) as any;
  blockedUser.isBlocked = true;
  blockedUser.blockReason = 'Fraudulent refund claims';
  memoryStore.users.set(blockedId, blockedUser);

  const blockedApply = await registerRider(blockedPhone, blockedPass, blockedEmail);
  check(
    'A blocked customer cannot sign up to deliver, even with the right password',
    blockedApply.status === 403,
    `status ${blockedApply.status}`
  );
  check(
    'and is told it is a block, not a wrong password',
    String(blockedApply.json?.error?.code) === 'ACCOUNT_BLOCKED',
    blockedApply.json?.error?.code
  );
  check(
    'and gains no rider role',
    !rolesOf(await userRepository.findById(blockedId)).includes('rider')
  );

  // -------------------------------------------------------------------
  console.log('\n-- Two different accounts, one form');

  const conflict = await registerRider(phone, password, victimEmail);
  check(
    'A number from one account and an email from another is refused',
    conflict.status === 409,
    `status ${conflict.status}`
  );
  check(
    'and says so, rather than guessing which person is signing up',
    String(conflict.json?.error?.code) === 'IDENTITY_CONFLICT',
    conflict.json?.error?.code
  );

  // -------------------------------------------------------------------
  console.log('\n-- Applying twice');

  const again = await registerRider(phone, password, email);
  check(
    'Registering as a rider a second time is refused',
    again.status === 409,
    `status ${again.status}`
  );
  check(
    'and points them at the app they already have',
    String(again.json?.error?.code) === 'ROLE_ALREADY_HELD',
    again.json?.error?.code
  );
  check(
    'and there is still exactly ONE rider record for them',
    Array.from(memoryStore.riders.values()).filter((r: any) => r.userId === userId).length === 1,
    String(Array.from(memoryStore.riders.values()).filter((r: any) => r.userId === userId).length)
  );

  // -------------------------------------------------------------------
  console.log('\n-- A short existing password still proves the account');

  /*
   * The password field carries two different things: one being CHOSEN, and an
   * existing one being PROVED. Only the first has a minimum length.
   *
   * Enforcing eight characters in the schema looked right and locked out every
   * account created before that rule existed - including the seeded ones,
   * whose password is seven characters. They could never add a role, and were
   * told to "choose a password of at least 8 characters" about a password they
   * were not choosing.
   */
  const seeded = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const seededPhone = (await userRepository.findById(seeded.json?.data?.user?.id))?.phone;

  resetAuthRateLimit();
  const shortPass = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Seeded Customer',
      email: 'customer@quickbite.app',
      phone: seededPhone,
      password: 'pass123',
      vehicleType: 'BIKE',
      licenseNumber: 'KA05ZZ9999'
    }
  });
  check(
    'An account whose password is seven characters can still add a role',
    shortPass.status === 201,
    `status ${shortPass.status} ${JSON.stringify(shortPass.json?.error || {})}`
  );

  resetAuthRateLimit();
  const weakNew = await api('/auth/register/rider', {
    method: 'POST',
    body: {
      fullName: 'Weak New Rider',
      email: `weak_${Date.now()}@r.test`,
      phone: freshPhone(),
      password: 'short1',
      vehicleType: 'BIKE',
      licenseNumber: 'KA05YY8888'
    }
  });
  check(
    'but a BRAND NEW account still cannot choose a short one',
    weakNew.status === 400,
    `status ${weakNew.status}`
  );

  // -------------------------------------------------------------------
  console.log('\n-- A partner on the same number');

  const partnerApply = await api('/auth/register/partner', {
    method: 'POST',
    body: {
      fullName: 'Asha Kumar',
      email,
      phone,
      password,
      restaurantName: 'Asha Home Kitchen',
      addressLine: '14 Residency Road',
      city: 'Bengaluru',
      pincode: '560025'
    }
  });
  check(
    'The same person can also open a restaurant',
    partnerApply.status === 201,
    `status ${partnerApply.status} ${JSON.stringify(partnerApply.json?.error || {})}`
  );
  const threeRoles = rolesOf(await userRepository.findById(userId));
  check(
    'and now holds all three roles on one account',
    threeRoles.includes('customer') && threeRoles.includes('rider') && threeRoles.includes('restaurant_owner'),
    JSON.stringify(threeRoles)
  );

  // -------------------------------------------------------------------
  console.log('\n-- The other direction: a rider wants to order dinner');

  /*
   * THE MIRROR OF THE REPORTED BUG, and the worse of the two.
   *
   * Customer registration checked the EMAIL and not the phone number. So a
   * rider who had signed up with a number could register again here with the
   * same number and a different address, and get a SECOND account on it.
   *
   * Phone is the sign-in identity - there is an OTP route keyed on it - so two
   * accounts sharing one number makes the lookup return whichever was created
   * first, and the person signs in to an account that is theirs but is not the
   * one holding their orders. The reported bug refused a real person; this one
   * silently gave them a duplicate.
   */
  const soloPhone = freshPhone();
  const soloEmail = `solo_${Date.now()}@r.test`;
  const soloPass = 'solo-rider-password-1';

  const soloRider = await registerRider(soloPhone, soloPass, soloEmail);
  check('A rider signs up first', soloRider.status === 201, `status ${soloRider.status}`);
  const soloId = soloRider.json?.data?.user?.id;

  const sameNumberDifferentEmail = await registerCustomer(
    soloPhone,
    soloPass,
    `different_${Date.now()}@r.test`
  );
  check(
    'Registering as a customer on that number with ANOTHER email is refused',
    sameNumberDifferentEmail.status === 409,
    `status ${sameNumberDifferentEmail.status}`
  );
  check(
    'so the number never ends up on two accounts',
    Array.from(memoryStore.users.values()).filter(
      (u: any) => String(u.phone || '').replace(/\D/g, '').endsWith(soloPhone.slice(-10))
    ).length === 1,
    String(
      Array.from(memoryStore.users.values()).filter(
        (u: any) => String(u.phone || '').replace(/\D/g, '').endsWith(soloPhone.slice(-10))
      ).length
    )
  );

  const soloAsCustomer = await registerCustomer(soloPhone, soloPass, soloEmail);
  check(
    'but the rider CAN add the customer role to the account they have',
    soloAsCustomer.status === 201,
    `status ${soloAsCustomer.status} ${JSON.stringify(soloAsCustomer.json?.error || {})}`
  );
  check(
    'and it is still one account',
    soloAsCustomer.json?.data?.user?.id === soloId,
    `${soloAsCustomer.json?.data?.user?.id} vs ${soloId}`
  );
  const soloRoles = rolesOf(await userRepository.findById(soloId));
  check(
    'holding both roles',
    soloRoles.includes('rider') && soloRoles.includes('customer'),
    JSON.stringify(soloRoles)
  );

  // -------------------------------------------------------------------
  console.log('\n-- An email that is already somebody else\u2019s');

  /*
   * The mirror of the phone half-match, and it had no check until a mutant
   * pointed that out: deleting the guard left every test green. Without it, an
   * existing email plus a NEW phone number attaches that number to an account
   * whose real owner never supplied it.
   */
  const emailOwnerPhone = freshPhone();
  const emailOwnerEmail = `owner_${Date.now()}@r.test`;
  await registerCustomer(emailOwnerPhone, 'email-owner-pass-1', emailOwnerEmail);

  const newNumberSameEmail = await registerRider(freshPhone(), 'email-owner-pass-1', emailOwnerEmail);
  check(
    'An existing email with a DIFFERENT number is refused',
    newNumberSameEmail.status === 409,
    `status ${newNumberSameEmail.status}`
  );
  check(
    'and it is the email that is named as the problem',
    String(newNumberSameEmail.json?.error?.code) === 'EMAIL_IN_USE',
    newNumberSameEmail.json?.error?.code
  );

  // -------------------------------------------------------------------
  console.log('\n-- An account from before roles existed can still use its role');

  /*
   * The POSITIVE half of the legacy case, and the one that was missing.
   *
   * Every account created from now on is written with an explicit `roles`
   * array, so `rolesOf`'s fallback to `role` is exercised only by accounts
   * that predate it - the seeded ones, and every real account already on the
   * platform. Deleting that fallback left the whole suite green, because the
   * only legacy check here asserted a REFUSAL, and an account with no roles at
   * all is refused too. It would have passed a build that locked out every
   * existing rider, partner and customer on the platform.
   */
  resetAuthRateLimit();
  const seededRiderLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'rider@quickbite.app', password: 'pass123' }
  });
  check('The seeded rider can sign in', seededRiderLogin.status === 200, `status ${seededRiderLogin.status}`);
  const legacyStored = await userRepository.findById(seededRiderLogin.json?.data?.user?.id);
  check(
    'and that account genuinely has no `roles` array — it predates them',
    !Array.isArray((legacyStored as any)?.roles) || (legacyStored as any).roles.length === 0,
    JSON.stringify((legacyStored as any)?.roles)
  );
  const legacyRiderAccess = await api('/riders/dashboard', {}, seededRiderLogin.json?.data?.token);
  check(
    'and can still reach the rider app on its `role` alone',
    legacyRiderAccess.status === 200,
    `status ${legacyRiderAccess.status}`
  );

  // -------------------------------------------------------------------
  console.log('\n-- Nothing else got easier to reach');

  const plainPhone = freshPhone();
  const plainEmail = `plain_${Date.now()}@cust.test`;
  const plain = await registerCustomer(plainPhone, 'plain-user-password-1', plainEmail);
  const plainToken = plain.json?.data?.token;

  const trespass = await api('/riders/dashboard', {}, plainToken);
  check(
    'A customer who never applied still cannot reach the rider app',
    trespass.status === 403,
    `status ${trespass.status}`
  );

  const partnerTrespass = await api('/restaurants/rst_bbh_01/documents', {}, plainToken);
  check(
    'and cannot reach a partner’s documents',
    partnerTrespass.status === 403 || partnerTrespass.status === 401,
    `status ${partnerTrespass.status}`
  );

  /*
   * The seeded PARTNER, not the seeded customer.
   *
   * The customer account gains the rider role earlier in this run, in the
   * short-password case. Asserting against it here passed only until that case
   * was written, and then reported a failure that was this test's own doing
   * rather than the platform's - which is exactly how a suite starts being
   * edited to agree with whatever it happens to observe.
   */
  resetAuthRateLimit();
  const seededPartner = await api('/auth/login', {
    method: 'POST',
    body: { email: 'partner@quickbite.app', password: 'pass123' }
  });
  const seededPartnerAsRider = await api('/riders/dashboard', {}, seededPartner.json?.data?.token);
  check(
    'An account created before roles existed is judged exactly as it was',
    seededPartnerAsRider.status === 403,
    `status ${seededPartnerAsRider.status}`
  );

  // A brand new number must still take the ordinary path.
  const newbie = await registerRider(freshPhone(), 'brand-new-rider-1', `new_${Date.now()}@r.test`);
  check('A rider with a new number registers as before', newbie.status === 201, `status ${newbie.status}`);

  /*
   * The server is closed and the process is given a moment to finish doing it.
   * `server.close()` is asynchronous, and on Windows calling `process.exit()`
   * while a libuv handle is still mid-close aborts the process outright.
   */
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  ONE PERSON, MANY ROLES - AND NOBODY ELSE’S       ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
    return;
  }
  console.log(`  IDENTITY BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  setTimeout(() => process.exit(1), 100);
}

run().catch(err => {
  console.error('[FAIL] Identity suite aborted:', err.message);
  process.exit(1);
});
