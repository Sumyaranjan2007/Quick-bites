/**
 * One person, several apps (owner, 17 Oct 2026): a restaurant owner or rider
 * may also order food from the Customer app with the same account.
 *
 * What must hold:
 *  - the partner signs in to the Customer app with their own phone, and the
 *    session is CUSTOMER-only: the kitchen's money and menu still need the
 *    Partner app password;
 *  - a different phone with the partner's email is refused; Operations
 *    accounts never get in this way;
 *  - an owner cannot order from their own kitchen; a rider is never offered
 *    their own order;
 *  - pushes go to the app the channel belongs to, and never get lost;
 *  - deleting from the Customer app removes only the customer side.
 */
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { userRepository, rolesOf } from '../db/repositories/userRepository.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { eligibleRidersFor } from '../modules/orders/tripOffers.ts';
import { forApp } from '../notifications/fcmDispatcher.ts';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`[PASS] ${label}`);
  else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function run() {
  (config as any).OTP_PROVIDER = 'fixed';
  const CODE = config.OTP_FIXED_CODE;
  await seedDatabase();
  const server = http.createServer(createApp());
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const API = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const call = async (path: string, init: { method?: string; body?: any; token?: string } = {}) => {
    const res = await fetch(`${API}${path}`, {
      method: init.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {})
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json };
  };
  const signIn = async (phone: string, email: string) => {
    resetAuthRateLimit();
    await call('/auth/otp/request', { method: 'POST', body: { phone, email } });
    return call('/auth/otp/verify', { method: 'POST', body: { phone, code: CODE } });
  };

  try {
    const partner = (await userRepository.findByEmail('partner@quickbite.app'))!;
    check('PRECONDITION: seeded partner has a phone and is not yet a customer',
      Boolean(partner?.phone) && !rolesOf(partner).includes('customer'), JSON.stringify(rolesOf(partner)));

    console.log('\n--- A partner signs in to the Customer app ---');
    // They type some other email: the code still goes to (and only proves) the account's own.
    const signed = await signIn(partner.phone!, 'someone.else@example.com');
    const token = signed.json?.data?.token;
    check('Partner signs in to the Customer app with their own phone', signed.status === 200 && Boolean(token),
      `status ${signed.status} ${signed.json?.error?.code || ''}`);
    check('...and the app sees a customer', signed.json?.data?.user?.role === 'customer');
    const after = (await userRepository.findById(partner.id))!;
    check('...the same account gained the customer role and kept the restaurant',
      rolesOf(after).includes('customer') && rolesOf(after).includes('restaurant_owner') && after.role === 'restaurant_owner',
      JSON.stringify({ role: after.role, roles: rolesOf(after) }));

    console.log('\n--- The customer session cannot touch the kitchen ---');
    check('Customer orders list works', (await call('/orders', { token })).status === 200);
    check('Earnings (ownership-checked) refused', (await call('/earnings/payout-requests', { token })).status === 403);
    check('Bank / payee accounts refused', (await call('/payee-accounts/me', { token })).status === 403);
    check('Kitchen dashboard (role-checked) refused', (await call('/restaurants/rst_bbh_01/dashboard', { token })).status === 403);
    const partnerLogin = await call('/auth/login', {
      method: 'POST', body: { email: 'partner@quickbite.app', password: 'pass123', role: 'restaurant_owner' }
    });
    const kitchenToken = partnerLogin.json?.data?.token;
    check('The Partner app password sign-in still works', partnerLogin.status === 200 && Boolean(kitchenToken));
    check('...and its session still reaches the earnings', (await call('/earnings/payout-requests', { token: kitchenToken })).status === 200);
    check('...and the bank accounts page', (await call('/payee-accounts/me', { token: kitchenToken })).status === 200);

    console.log('\n--- Who may not get in ---');
    const otherPhone = await signIn('9000012345', 'partner@quickbite.app');
    check("A different phone with the partner's email is refused",
      otherPhone.status === 409 && otherPhone.json?.error?.code === 'EMAIL_IN_USE', `status ${otherPhone.status}`);
    // A rider account with no real email: a code to the phone alone proves nothing.
    memoryStore.users.set('usr_noemail_rider', {
      id: 'usr_noemail_rider', email: '9000055555@phone.quickbite.app', fullName: 'No Email Rider',
      phone: '9000055555', role: 'rider', roles: ['rider']
    } as any);
    const noEmail = await signIn('9000055555', 'typed.by.anyone@example.com');
    check('A rider without an email on the account cannot get in by phone alone',
      noEmail.status === 403 && noEmail.json?.error?.code === 'STAFF_ACCOUNT', `status ${noEmail.status}`);
    const admin = Array.from(memoryStore.users.values()).find((u: any) => rolesOf(u).includes('admin') && u.phone) as any;
    if (admin) {
      const adminTry = await signIn(admin.phone, admin.email);
      check('An Operations account never signs in through the Customer app', adminTry.status === 403, `status ${adminTry.status}`);
    } else {
      // Give one a phone so the rule is tested rather than skipped.
      const anyAdmin = Array.from(memoryStore.users.values()).find((u: any) => rolesOf(u).includes('admin')) as any;
      anyAdmin.phone = '9000099999';
      const adminTry = await signIn('9000099999', anyAdmin.email);
      check('An Operations account never signs in through the Customer app', adminTry.status === 403, `status ${adminTry.status}`);
    }

    console.log('\n--- No ordering from your own kitchen, no riding your own order ---');
    let ownCode = '';
    try {
      await orderService.createOrder({
        customerId: partner.id, restaurantId: 'rst_bbh_01', items: [], paymentMethod: 'RAZORPAY_SANDBOX',
        idempotencyKey: `own-${Date.now()}`
      } as any);
    } catch (err: any) {
      ownCode = err?.code || err?.errorCode || '';
    }
    check('An owner cannot order from their own restaurant', ownCode === 'OWN_RESTAURANT', ownCode || 'no error');

    const rider = memoryStore.riders.get('rdr_vikram_01') as any;
    rider.isOnline = true;
    const kitchen = { latitude: 12.68, longitude: 77.47 };
    const order = (customerId: string): any => ({
      id: `o_${customerId}`, customerId, declinedByRiderIds: [], offeredToRiderIds: [], restaurantCoordinates: kitchen,
      bill: { totalAmount: 100 }, paymentMethod: 'RAZORPAY_SANDBOX'
    });
    const forStranger = (await eligibleRidersFor(order('usr_someone_else'))).map(r => r.id);
    const forThemselves = (await eligibleRidersFor(order(rider.userId))).map(r => r.id);
    check('PRECONDITION: the rider is offered a stranger\'s order', forStranger.includes(rider.id), JSON.stringify(forStranger));
    check('A rider is never offered their own order', !forThemselves.includes(rider.id), JSON.stringify(forThemselves));

    console.log('\n--- Pushes go to the right app ---');
    const phones = [{ id: 'c', role: 'customer' }, { id: 'k', role: 'restaurant_owner' }, { id: 'r', role: 'rider' }];
    check('Kitchen alarm rings only the Partner app', forApp(phones, 'kitchen-orders').map(d => d.id).join() === 'k');
    check('Rider offer rings only the Rider app', forApp(phones, 'new-orders').map(d => d.id).join() === 'r');
    check('Order update reaches only the Customer app', forApp(phones, 'order-updates').map(d => d.id).join() === 'c');
    check('With no matching app, every device still gets it',
      forApp([{ id: 'c', role: 'customer' }], 'kitchen-orders').length === 1);
    check('Payments and default channels are unchanged', forApp(phones, 'payments').length === 3);

    console.log('\n--- Deleting from the Customer app removes only the customer side ---');
    const del = await call('/auth/me', { method: 'DELETE', token, body: { password: 'pass123' } });
    check('Customer-app delete succeeds', del.status === 200 && del.json?.data?.deleted === true, `status ${del.status}`);
    const kept = await userRepository.findById(partner.id);
    check('...the account and restaurant are still there',
      Boolean(kept) && rolesOf(kept).includes('restaurant_owner') && !rolesOf(kept).includes('customer'),
      JSON.stringify(kept && rolesOf(kept)));
    check('...the customer session is ended', (await call('/orders', { token })).status === 401);
    check('...the Partner app still works',
      (await call('/earnings/payout-requests', { token: kitchenToken })).status === 200);
    check('...and the kitchen was not put up for deletion', !(kept as any)?.isBlocked && !(kept as any)?.deletionRequestedAt);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }

  if (failures === 0) {
    console.log('\nMULTI-ROLE CUSTOMER: ALL CHECKS PASSED');
    process.exit(0);
  }
  console.log(`\nMULTI-ROLE CUSTOMER: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] multi-role suite aborted:', err);
  process.exit(1);
});
