/**
 * A customer becomes a partner or rider with the SAME email (owner, 17 Oct 2026).
 *
 * A customer made in the Customer app (emailed code) has no password, so
 * Partner/Rider sign-up asked for "that account's password" and refused them
 * for ever. Now the account's own inbox is the proof: sign-up emails a link,
 * and only its Confirm button (a POST) adds the role.
 *
 * What must hold:
 *  - nothing changes until the link is confirmed; opening it (GET, as mail
 *    scanners do) changes nothing; it works once;
 *  - after it, the Partner app signs in with that email and the chosen
 *    password, and the Customer app still signs in as before;
 *  - a wrong password on a password account still refuses, with no email;
 *  - the link's address never comes from the request's Host header.
 */
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore, saveStoreToFile, clearStore, loadStoreFromFile } from '../db/client.ts';
import { config } from '../config/env.ts';
import { userRepository, rolesOf } from '../db/repositories/userRepository.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`[PASS] ${label}`);
  else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// Brevo is replaced by a recorder; every other request goes out as usual.
const emails: { to: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).includes('api.brevo.com')) {
    const body = JSON.parse(init.body);
    emails.push({ to: body.to[0].email, text: body.textContent });
    return new Response(JSON.stringify({ messageId: `m${emails.length}` }), { status: 201 });
  }
  return realFetch(url, init);
}) as any;
process.env.BREVO_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'noreply@example.com';
process.env.PUBLIC_BASE_URL = 'https://quickbites.test';

async function run() {
  (config as any).OTP_PROVIDER = 'fixed';
  const CODE = config.OTP_FIXED_CODE;
  await seedDatabase();
  const server = http.createServer(createApp());
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const API = `http://127.0.0.1:${port}/api`;
  const call = async (path: string, init: { method?: string; body?: any } = {}) => {
    resetAuthRateLimit();
    const res = await fetch(`${API}${path}`, {
      method: init.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  };
  const customerSignIn = async (phone: string, email: string) => {
    await call('/auth/otp/request', { method: 'POST', body: { phone, email } });
    return call('/auth/otp/verify', { method: 'POST', body: { phone, code: CODE } });
  };
  const kitchen = (phone: string, email: string, password: string) => ({
    fullName: 'Asha', email, phone, password, restaurantName: 'Asha Tiffins',
    addressLine: 'Main Road, Harohalli', city: 'Harohalli', pincode: '562112', latitude: 12.68, longitude: 77.47
  });
  const linkIn = (text: string) => (text.match(/https:\/\/quickbites\.test\/api\/auth\/confirm\/[0-9a-f]+/) || [''])[0];
  const pathOf = (link: string) => link.replace('https://quickbites.test/api', '');
  const restaurantsOf = (userId: string) => Array.from(memoryStore.restaurants.values()).filter((r: any) => r.ownerId === userId);

  try {
    console.log('\n--- A customer from the Customer app (no password) ---');
    const EMAIL = 'asha.customer@example.com';
    const signed = await customerSignIn('9000011111', EMAIL);
    check('PRECONDITION: customer signs up with phone and email', signed.status === 200, `status ${signed.status}`);
    const customer = (await userRepository.findByEmail(EMAIL))!;
    check('PRECONDITION: the customer has no password', Boolean(customer) && !customer.passwordHash);

    console.log('\n--- Registers a restaurant with the same email and another phone ---');
    const first = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000022222', EMAIL, 'Kitchen#2026') });
    check('Sign-up answers: confirm by email', first.status === 409 && first.json?.error?.code === 'CONFIRM_BY_EMAIL',
      `status ${first.status} ${first.json?.error?.code}`);
    check('...and the app message lists the next steps',
      /Open the email we just sent to asha\.customer@example\.com/.test(first.json?.error?.message) && /tap Sign in/.test(first.json?.error?.message),
      first.json?.error?.message);
    check('...one email, to the account itself', emails.length === 1 && emails[0].to === EMAIL, JSON.stringify(emails.map(e => e.to)));
    const link = linkIn(emails[0]?.text || '');
    check('...carrying a link on the configured address', Boolean(link), emails[0]?.text);
    check('Nothing changed yet: no role, no restaurant',
      !rolesOf(await userRepository.findById(customer.id)).includes('restaurant_owner') && restaurantsOf(customer.id).length === 0);
    const early = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'Kitchen#2026', role: 'restaurant_owner' } });
    check('...and the Partner app cannot sign in yet', early.status === 401, `status ${early.status}`);

    const again = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000022222', EMAIL, 'Kitchen#2027') });
    check('Resubmitting within a minute sends no second email',
      again.json?.error?.code === 'CONFIRM_BY_EMAIL' && emails.length === 1, `emails ${emails.length}`);

    const opened = await call(pathOf(link));
    check('Opening the link shows a Confirm button', opened.status === 200 && /<form method="post">/.test(opened.text));
    check('...and opening alone changes nothing (mail scanners open links)',
      !rolesOf(await userRepository.findById(customer.id)).includes('restaurant_owner'));

    // K3: the link must outlive a deploy. Save, wipe memory, load: what a restart does.
    const token = link.split('/').pop() || '';
    check('The link is stored by its hash, never the token itself',
      memoryStore.pendingRoleConfirmations.size === 1 && !memoryStore.pendingRoleConfirmations.has(token));
    saveStoreToFile();
    clearStore();
    loadStoreFromFile();
    check('...and survives a restart (K3)', memoryStore.pendingRoleConfirmations.size === 1,
      `size ${memoryStore.pendingRoleConfirmations.size}`);

    const confirmed = await call(pathOf(link), { method: 'POST' });
    check('Confirm adds the restaurant', confirmed.status === 200 && /Confirmed/.test(confirmed.text), `status ${confirmed.status}`);
    check('...and the page says what to do next', /Sign in/.test(confirmed.text) && /Quick Bites Partner/.test(confirmed.text));
    const after = (await userRepository.findById(customer.id))!;
    check('...the same account now holds both roles',
      rolesOf(after).includes('customer') && rolesOf(after).includes('restaurant_owner'), JSON.stringify(rolesOf(after)));
    const mine = restaurantsOf(customer.id);
    check('...one restaurant, pending approval, on the phone typed at sign-up',
      mine.length === 1 && (mine[0] as any).status === 'PENDING_APPROVAL' && (mine[0] as any).phone === '9000022222',
      JSON.stringify(mine.map((r: any) => [r.status, r.phone])));
    check("...the account keeps its own phone", after.phone === '9000011111', String(after.phone));
    check('...and takes the name typed at sign-up instead of the placeholder', after.fullName === 'Asha', after.fullName);

    const login = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'Kitchen#2027', role: 'restaurant_owner' } });
    check('Partner app signs in with the email and the latest password typed', login.status === 200 && Boolean(login.json?.data?.token),
      `status ${login.status}`);
    check('...the older password does not', (await call('/auth/login', {
      method: 'POST', body: { email: EMAIL, password: 'Kitchen#2026', role: 'restaurant_owner' }
    })).status === 401);
    const reused = await call(pathOf(link), { method: 'POST' });
    check('The link works once', reused.status === 404 && restaurantsOf(customer.id).length === 1, `status ${reused.status}`);
    const back = await customerSignIn('9000011111', EMAIL);
    check('The Customer app still signs in as a customer',
      back.status === 200 && back.json?.data?.user?.role === 'customer', `status ${back.status}`);
    check('A made-up link is refused', (await call('/auth/confirm/deadbeef')).status === 404);

    console.log('\n--- The same for a rider ---');
    const RIDER_EMAIL = 'ravi.customer@example.com';
    await customerSignIn('9000044444', RIDER_EMAIL);
    const riderAsk = await call('/auth/register/rider', {
      method: 'POST',
      body: { fullName: 'Ravi', email: RIDER_EMAIL, phone: '9000044444', password: 'RiderPass#1', vehicleType: 'BIKE', licenseNumber: 'KA0120260001' }
    });
    check('Rider sign-up on a customer email asks to confirm by email', riderAsk.json?.error?.code === 'CONFIRM_BY_EMAIL',
      `status ${riderAsk.status} ${riderAsk.json?.error?.code}`);
    const riderLink = linkIn(emails[emails.length - 1]?.text || '');
    const riderPage = await fetch(`${API}${pathOf(riderLink)}`);
    check("The confirm page shares its address with our own site only (not 'no-referrer')",
      riderPage.headers.get('referrer-policy') === 'same-origin', String(riderPage.headers.get('referrer-policy')));
    /*
     * What a phone did on live (17 Oct 2026): the Confirm button sent
     * `Origin: null`, and the live server's origin check answered 500. Run with
     * the live server's rules, and check an ordinary API call is still refused.
     */
    (config as any).IS_PRODUCTION = true;
    let nullOriginConfirm: Response, nullOriginApi: Response;
    try {
      resetAuthRateLimit();
      nullOriginConfirm = await fetch(`${API}${pathOf(riderLink)}`, { method: 'POST', headers: { Origin: 'null' } });
      nullOriginApi = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{}'
      });
    } finally {
      (config as any).IS_PRODUCTION = false;
    }
    check('Confirm works when the browser sends Origin: null (live server rules)', nullOriginConfirm.status === 200,
      `status ${nullOriginConfirm.status}`);
    check('...while the rest of the API refuses that origin with 403, not 500 (K2)', nullOriginApi.status === 403,
      `status ${nullOriginApi.status}`);
    const ravi = (await userRepository.findByEmail(RIDER_EMAIL))!;
    check('...after Confirm, a rider record exists',
      Array.from(memoryStore.riders.values()).some((r: any) => r.userId === ravi.id) && rolesOf(ravi).includes('rider'));
    check('...and the Rider app signs in', (await call('/auth/login', {
      method: 'POST', body: { email: RIDER_EMAIL, password: 'RiderPass#1', role: 'rider' }
    })).status === 200);

    console.log('\n--- Protection ---');
    const sent = emails.length;
    const weak = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000055555', 'new.weak@example.com', 'x') });
    check('PRECONDITION: a new email with a weak password is refused', weak.status === 400, `status ${weak.status}`);
    await customerSignIn('9000066666', 'weak.customer@example.com');
    const weakConfirm = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000066666', 'weak.customer@example.com', 'short') });
    check('A weak password is refused before any email is sent',
      weakConfirm.json?.error?.code === 'WEAK_PASSWORD' && emails.length === sent, `${weakConfirm.json?.error?.code} emails ${emails.length - sent}`);
    const wrong = await call('/auth/register/rider', {
      method: 'POST',
      body: { fullName: 'Pavan', email: 'partner@quickbite.app', phone: '9000077777', password: 'not-the-password', vehicleType: 'BIKE', licenseNumber: 'KA0120260002' }
    });
    check('A password account with a wrong password is still refused, with no email',
      wrong.status === 409 && wrong.json?.error?.code !== 'CONFIRM_BY_EMAIL' && emails.length === sent, `${wrong.status} ${wrong.json?.error?.code}`);
    const right = await call('/auth/register/rider', {
      method: 'POST',
      body: { fullName: 'Pavan', email: 'partner@quickbite.app', phone: '9000077777', password: 'pass123', vehicleType: 'BIKE', licenseNumber: 'KA0120260003' }
    });
    check("A partner's own password adds the rider role, even on a new phone", right.status === 201, `status ${right.status} ${right.json?.error?.code}`);
    const conflict = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000044444', EMAIL, 'Kitchen#2028') });
    check("Another account's phone with this email is still refused",
      conflict.json?.error?.code === 'IDENTITY_CONFLICT', `${conflict.status} ${conflict.json?.error?.code}`);

    await customerSignIn('9000088888', 'host.customer@example.com');
    const hostLink = await new Promise<string>((resolve, reject) => {
      const before = emails.length;
      const req = http.request({
        host: '127.0.0.1', port, path: '/api/auth/register/rider', method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'evil.example' }
      }, res => { res.resume(); res.on('end', () => resolve(emails.slice(before).map(e => e.text).join(' '))); });
      req.on('error', reject);
      resetAuthRateLimit();
      req.end(JSON.stringify({ fullName: 'Arun', email: 'host.customer@example.com', phone: '9000088888', password: 'Rider#20266', vehicleType: 'BIKE', licenseNumber: 'KA0120260004' }));
    });
    check('A forged Host header never reaches the link', Boolean(hostLink) && !hostLink.includes('evil.example') && hostLink.includes('quickbites.test'),
      hostLink.slice(0, 120));

    console.log('\n--- Customer app: a partner signs in with their OWN mobile (not the kitchen one) ---');
    // Real emailed codes from here: only then does knowing the code prove the inbox.
    (config as any).OTP_PROVIDER = 'email';
    const emailedSignIn = async (phone: string, email: string, code?: string) => {
      const before = emails.length;
      await call('/auth/otp/request', { method: 'POST', body: { phone, email } });
      const mail = emails.slice(before).find(e => e.to === email.toLowerCase());
      const sentCode = (mail?.text.match(/code is (\d{6})/) || [])[1];
      return { mail, res: await call('/auth/otp/verify', { method: 'POST', body: { phone, code: code ?? sentCode } }) };
    };
    const KITCHEN_EMAIL = 'kitchen.only@example.com';
    const made = await call('/auth/register/partner', { method: 'POST', body: kitchen('9000101010', KITCHEN_EMAIL, 'Kitchen#2029') });
    check('PRECONDITION: a partner registered in the Partner app', made.status === 201, `status ${made.status}`);
    const kitchenUser = (await userRepository.findByEmail(KITCHEN_EMAIL))!;

    const own = await emailedSignIn('9000202020', KITCHEN_EMAIL);
    check('The code goes to the partner account’s email', Boolean(own.mail));
    check('A partner signs in to the Customer app with a different mobile',
      own.res.status === 200 && own.res.json?.data?.user?.role === 'customer', `status ${own.res.status} ${own.res.json?.error?.code || ''}`);
    check('...into the same account, not a new one',
      own.res.json?.data?.user?.id === kitchenUser.id && own.res.json?.data?.isNewAccount === false);
    const kitchenAfter = (await userRepository.findById(kitchenUser.id))!;
    check('...which gains the customer side and keeps its restaurant and phone',
      rolesOf(kitchenAfter).includes('customer') && rolesOf(kitchenAfter).includes('restaurant_owner') && kitchenAfter.phone === '9000101010',
      JSON.stringify({ roles: rolesOf(kitchenAfter), phone: kitchenAfter.phone }));
    check('...and no account was made for the new mobile', !(await userRepository.findByPhone('9000202020')));
    const ownToken = own.res.json?.data?.token;
    const earnings = await fetch(`${API}/earnings/payout-requests`, { headers: { Authorization: `Bearer ${ownToken}` } });
    check('...the session is customer-only (kitchen money refused)', earnings.status === 403, `status ${earnings.status}`);
    const twice = await emailedSignIn('9000202020', KITCHEN_EMAIL);
    check('Signing in again the same way works', twice.res.status === 200 && twice.res.json?.data?.user?.id === kitchenUser.id);
    const viaKitchenPhone = await emailedSignIn('9000101010', KITCHEN_EMAIL);
    check('...and so does the phone on the account', viaKitchenPhone.res.json?.data?.user?.id === kitchenUser.id);

    const plain = (await userRepository.findByEmail('weak.customer@example.com'))!;
    const newPhone = await emailedSignIn('9000404040', 'weak.customer@example.com');
    check('A customer on a new mobile reaches their own account by email',
      newPhone.res.status === 200 && newPhone.res.json?.data?.user?.id === plain.id, `status ${newPhone.res.status}`);

    const wrongCode = await emailedSignIn('9000505050', KITCHEN_EMAIL, '000000');
    check('A wrong code gets nobody in', wrongCode.res.status === 400 && !(await userRepository.findByPhone('9000505050')),
      `status ${wrongCode.res.status}`);

    const admin = Array.from(memoryStore.users.values()).find((u: any) => rolesOf(u).includes('admin')) as any;
    const staff = await emailedSignIn('9000606060', admin.email);
    check('An Operations email on a new mobile is refused', staff.res.status === 403 && staff.res.json?.error?.code === 'STAFF_ACCOUNT',
      `status ${staff.res.status} ${staff.res.json?.error?.code}`);
    check('...and the Operations account gains nothing', !rolesOf(await userRepository.findById(admin.id)).includes('customer'));

    // With the shared test code, typing someone's email proves nothing.
    (config as any).OTP_PROVIDER = 'fixed';
    const shared = await customerSignIn('9000707070', KITCHEN_EMAIL);
    check('With the shared test code an email alone does not sign in to its account',
      shared.status === 409 && shared.json?.error?.code === 'EMAIL_IN_USE', `status ${shared.status} ${shared.json?.error?.code}`);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }

  if (failures === 0) {
    console.log('\nCUSTOMER ADDS ROLE: ALL CHECKS PASSED');
    process.exit(0);
  }
  console.log(`\nCUSTOMER ADDS ROLE: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] customer-adds-role suite aborted:', err);
  process.exit(1);
});
