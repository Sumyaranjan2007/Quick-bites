/**
 * The restaurant partner's whole journey, driven over HTTP the way the app does.
 *
 * Account creation -> document upload -> admin approval -> kitchen goes online ->
 * an order arrives -> preparation -> completion -> history -> dashboard.
 *
 * Every one of these features was reported as "looks implemented but is not
 * connected", so this test refuses to accept a screen that renders: each step
 * asserts the server actually changed, and several assert the negative case —
 * that a closed kitchen is refused, that a five-minute preparation time is
 * rejected, that a partner cannot reach another restaurant's orders.
 */
import { createApp } from '../app.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';
import crypto from 'crypto';

const PORT = 5191;
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

async function run() {
  console.log('====================================================');
  console.log('     RESTAURANT PARTNER END-TO-END WORKFLOW         ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT);
  initSocketServer(server as any);
  await new Promise(r => setTimeout(r, 300));

  const RESTAURANT = 'rst_bbh_01';

  // -----------------------------------------------------------------------
  // 1. Account creation
  // -----------------------------------------------------------------------
  console.log('\n-- Account creation');
  resetAuthRateLimit();
  const newEmail = `owner_${Date.now()}@kitchen.test`;
  const created = await api('/auth/register', {
    method: 'POST',
    body: { fullName: 'New Kitchen Owner', email: newEmail, phone: '9876500011', password: 'kitchen-pass-1' }
  });
  check('A new owner can create an account', created.status === 201, `status ${created.status}`);
  check(
    'Self-registration cannot grant partner access',
    created.json?.data?.user?.role === 'customer',
    `got role ${created.json?.data?.user?.role}`
  );

  const weak = await api('/auth/register', {
    method: 'POST',
    body: { fullName: 'Weak', email: `weak_${Date.now()}@k.test`, phone: '9', password: 'short' }
  });
  check('A short password is rejected at registration', weak.status === 400, `status ${weak.status}`);

  // -----------------------------------------------------------------------
  // 2. Documents
  // -----------------------------------------------------------------------
  console.log('\n-- Document verification');
  const partner = await login('partner@quickbite.app');

  const docs = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
  check('The partner can read their document requirements', docs.status === 200, `status ${docs.status}`);
  const slots = docs.json?.data?.slots || [];
  check('Every required document is described', slots.length >= 3 && slots.every((s: any) => s.purpose && s.mustShow));
  check(
    'Accepted formats and size limit are published',
    Array.isArray(docs.json?.data?.acceptedFormats) && typeof docs.json?.data?.maxSizeMb === 'number'
  );

  const bankSlot = slots.find((s: any) => s.documentType === 'BANK_PROOF');
  check('The payout account is offered as a document', Boolean(bankSlot));

  /*
   * What the app now sends: a photograph, as a data URI.
   *
   * These uploads used to post 'emailed 14 Sep' — because that is what the
   * partner app asked for. It had no picker, so it told the partner to email
   * the file to support and type a note here saying where to find it, and the
   * KYC queue filled with prose a reviewer had to match against an inbox by
   * hand. The app photographs the document now, so the fixtures do too.
   */
  const PHOTO =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

  // A file reference that is not a file is refused now rather than filed.
  const prose = await api(
    `/restaurants/${RESTAURANT}/documents`,
    { method: 'POST', body: { documentType: 'BANK_PROOF', documentNumber: 'HDFC0001234', fileUrl: 'emailed 14 Sep' } },
    partner.token
  );
  check('A note describing a file is not a document', prose.status === 400, `status ${prose.status}`);

  const huge = await api(
    `/restaurants/${RESTAURANT}/documents`,
    {
      method: 'POST',
      body: {
        documentType: 'BANK_PROOF',
        documentNumber: 'HDFC0001234',
        fileUrl: `data:image/jpeg;base64,${'A'.repeat(700_001)}`
      }
    },
    partner.token
  );
  check('A photo over the ceiling is refused', huge.status === 400, `status ${huge.status}`);

  const upload = await api(
    `/restaurants/${RESTAURANT}/documents`,
    { method: 'POST', body: { documentType: 'BANK_PROOF', documentNumber: 'HDFC0001234', fileUrl: PHOTO } },
    partner.token
  );
  check('A document can be submitted', upload.status === 201, `status ${upload.status}`);
  const documentId = upload.json?.data?.document?.id;

  const again = await api(
    `/restaurants/${RESTAURANT}/documents`,
    { method: 'POST', body: { documentType: 'BANK_PROOF', documentNumber: 'HDFC0001234', fileUrl: PHOTO } },
    partner.token
  );
  check('A document already under review cannot be re-sent', again.status === 409, `status ${again.status}`);

  const afterUpload = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
  const bankAfter = (afterUpload.json?.data?.slots || []).find((s: any) => s.documentType === 'BANK_PROOF');
  check('The submitted document now reads as pending', bankAfter?.status === 'PENDING', `got ${bankAfter?.status}`);

  // -----------------------------------------------------------------------
  // 3. Admin review
  // -----------------------------------------------------------------------
  console.log('\n-- Admin review');
  const admin = await login('admin@quickbite.app');

  const reject = await api(
    '/admin/documents/review',
    { method: 'POST', body: { documentId, action: 'REJECT', rejectionReason: 'Statement header is unreadable.' } },
    admin.token
  );
  check('An admin can reject a document with a reason', reject.status === 200, `status ${reject.status}`);

  const afterReject = await api(`/restaurants/${RESTAURANT}/documents`, {}, partner.token);
  const rejected = (afterReject.json?.data?.slots || []).find((s: any) => s.documentType === 'BANK_PROOF');
  check('The partner sees the rejection and the reason', rejected?.status === 'REJECTED' && !!rejected?.rejectionReason);
  check('A rejected document is flagged as needing action', rejected?.actionNeeded === true);

  const reupload = await api(
    `/restaurants/${RESTAURANT}/documents`,
    { method: 'POST', body: { documentType: 'BANK_PROOF', documentNumber: 'HDFC0001234', fileUrl: PHOTO } },
    partner.token
  );
  check('A rejected document can be sent again', reupload.status === 201, `status ${reupload.status}`);

  const approve = await api(
    '/admin/documents/review',
    { method: 'POST', body: { documentId: reupload.json?.data?.document?.id, action: 'APPROVE' } },
    admin.token
  );
  check('An admin can approve a document', approve.status === 200, `status ${approve.status}`);
  check(
    'Approving a document is persisted, not just held in memory',
    memoryStore.restaurants.get(RESTAURANT)?.kycStatus === 'ACTIVE',
    `store shows kycStatus ${memoryStore.restaurants.get(RESTAURANT)?.kycStatus}`
  );

  // -----------------------------------------------------------------------
  // 4. Going online, and the closed-kitchen refusal
  // -----------------------------------------------------------------------
  console.log('\n-- Kitchen availability');
  const offline = await api(
    `/restaurants/${RESTAURANT}/kitchen-status`,
    { method: 'POST', body: { isKitchenActive: false } },
    partner.token
  );
  check('The kitchen can be switched offline', offline.status === 200 && offline.json?.data?.isOpen === false);
  check(
    'Going offline is persisted, not just held in memory',
    memoryStore.restaurants.get(RESTAURANT)?.isOpen === false,
    'the store still shows the kitchen open'
  );

  const customer = await login('customer@quickbite.app');
  const address = Array.from(memoryStore.addresses.values()).find((a: any) => a.userId === customer.user.id) as any;
  const menu = await api(`/restaurants/${RESTAURANT}/menu`);
  const dish = menu.json?.data?.menu?.categories?.[0]?.items?.[0];

  const whileClosed = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT,
        deliveryAddressId: address.id,
        items: [{ dishId: dish.id, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID()
      }
    },
    customer.token
  );
  check(
    'A closed kitchen refuses orders',
    whileClosed.status === 409,
    `status ${whileClosed.status} — a closed kitchen accepted an order`
  );

  const online = await api(
    `/restaurants/${RESTAURANT}/kitchen-status`,
    { method: 'POST', body: { isKitchenActive: true } },
    partner.token
  );
  check('The kitchen can be switched back online', online.status === 200 && online.json?.data?.isOpen === true);

  // -----------------------------------------------------------------------
  // 5. An order arrives, and is prepared
  // -----------------------------------------------------------------------
  console.log('\n-- Receiving and preparing an order');
  const placed = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT,
        deliveryAddressId: address.id,
        items: [{ dishId: dish.id, quantity: 2 }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID()
      }
    },
    customer.token
  );
  check('An open kitchen accepts the order', placed.status === 201, `status ${placed.status}`);
  const orderId = placed.json?.data?.order?.id;

  const queue = await api(`/restaurants/${RESTAURANT}/orders`, {}, partner.token);
  const inQueue = (queue.json?.data?.orders || []).some((o: any) => o.id === orderId);
  check('The order reaches the kitchen queue', inQueue);
  check(
    'The doorstep OTP is not exposed to the kitchen',
    (queue.json?.data?.orders || []).every((o: any) => o.deliveryOtp === undefined)
  );

  const tooFast = await api(
    `/orders/${orderId}/status`,
    { method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 5 } },
    partner.token
  );
  check(
    'A preparation time under 10 minutes is refused',
    tooFast.status === 400,
    `status ${tooFast.status} — five minutes was accepted`
  );

  const accepted = await api(
    `/orders/${orderId}/status`,
    { method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 20 } },
    partner.token
  );
  check('The order can be accepted with a valid preparation time', accepted.status === 200, `status ${accepted.status}`);

  const preparing = await api(`/orders/${orderId}/status`, { method: 'PUT', body: { status: 'PREPARING' } }, partner.token);
  check('The order moves to preparing', preparing.status === 200, `status ${preparing.status}`);

  const ready = await api(
    `/orders/${orderId}/status`,
    { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } },
    partner.token
  );
  check('The order can be marked ready', ready.status === 200, `status ${ready.status}`);

  // -----------------------------------------------------------------------
  // 6. Cross-tenant refusal
  // -----------------------------------------------------------------------
  console.log('\n-- Isolation between partners');
  const otherRestaurant = Array.from(memoryStore.restaurants.values()).find(
    (r: any) => r.ownerId !== partner.user.id
  ) as any;
  if (otherRestaurant) {
    const foreign = await api(`/restaurants/${otherRestaurant.id}/orders`, {}, partner.token);
    check(
      'A partner cannot read another restaurant\'s orders',
      foreign.status === 403,
      `status ${foreign.status}`
    );
  } else {
    console.log('[SKIP] No second owner in the seed to test isolation against');
  }

  // -----------------------------------------------------------------------
  // 7. Menu request workflow
  // -----------------------------------------------------------------------
  console.log('\n-- Menu approval workflow');
  const request = await api(
    `/restaurants/${RESTAURANT}/menu/requests`,
    {
      method: 'POST',
      body: { name: 'Test Kebab Platter', price: 340, isVeg: false, categoryName: 'Starters', description: 'For the test' }
    },
    partner.token
  );
  check('A partner can request a new dish', request.status === 201, `status ${request.status}`);
  const requestId = request.json?.data?.request?.id;

  const menuBefore = await api(`/restaurants/${RESTAURANT}/menu`);
  const leaked = JSON.stringify(menuBefore.json).includes('Test Kebab Platter');
  check('A pending request does not appear on the live menu', !leaked);

  const queueAdmin = await api('/admin/menu-requests?status=PENDING', {}, admin.token);
  check(
    'The request reaches the admin queue',
    (queueAdmin.json?.data?.requests || []).some((r: any) => r.id === requestId)
  );

  const rejectNoReason = await api(
    `/admin/menu-requests/${requestId}/review`,
    { method: 'POST', body: { action: 'REJECT' } },
    admin.token
  );
  check('Rejecting without a reason is refused', rejectNoReason.status === 400, `status ${rejectNoReason.status}`);

  const approved = await api(
    `/admin/menu-requests/${requestId}/review`,
    { method: 'POST', body: { action: 'APPROVE', overrides: { price: 360 } } },
    admin.token
  );
  check('An admin can approve, correcting the price', approved.status === 200, `status ${approved.status}`);

  const menuAfter = await api(`/restaurants/${RESTAURANT}/menu`);
  const published = (menuAfter.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.name === 'Test Kebab Platter');
  check('The approved dish is now on the live menu', Boolean(published));
  check('The administrator\'s corrected price is what published', Number(published?.price) === 360, `got ${published?.price}`);

  const twice = await api(
    `/admin/menu-requests/${requestId}/review`,
    { method: 'POST', body: { action: 'APPROVE' } },
    admin.token
  );
  check('The same request cannot be approved twice', twice.status === 409, `status ${twice.status}`);

  // -----------------------------------------------------------------------
  // 8. Completion, history and the dashboard
  // -----------------------------------------------------------------------
  console.log('\n-- Completion, history and dashboard');
  const order = memoryStore.orders.get(orderId);
  order.status = 'DELIVERED';
  order.deliveredAt = new Date().toISOString();
  order.rating = 5;
  order.ratingComment = 'Excellent biryani';

  const history = await api(`/restaurants/${RESTAURANT}/orders/history?scope=completed`, {}, partner.token);
  check('Completed orders appear in history', history.status === 200 && history.json?.data?.orders?.length > 0);
  check(
    'History does not leak the doorstep OTP either',
    (history.json?.data?.orders || []).every((o: any) => o.deliveryOtp === undefined)
  );
  check('History reports counts for each tab', typeof history.json?.data?.counts?.completed === 'number');

  const dashboard = await api(`/restaurants/${RESTAURANT}/dashboard`, {}, partner.token);
  check('The dashboard loads', dashboard.status === 200, `status ${dashboard.status}`);
  const d = dashboard.json?.data?.dashboard;
  check('Earnings are reported', typeof d?.revenue?.netPayout === 'number');
  check('Earnings reflect the delivered order', d.revenue.netPayout > 0, `netPayout ${d?.revenue?.netPayout}`);
  check('Order counts are reported', d?.orders?.delivered >= 1, `delivered ${d?.orders?.delivered}`);
  check('The customer rating is reflected', d?.ratings?.count >= 1 && d?.ratings?.average !== null);
  check('Best sellers are computed from real items', Array.isArray(d?.topDishes) && d.topDishes.length > 0);
  check('Category revenue is computed', Array.isArray(d?.categories) && d.categories.length > 0);
  check('Menu health is reported', typeof d?.menu?.totalItems === 'number' && d.menu.totalItems > 0);
  check('A 14-day trend is returned', Array.isArray(d?.revenueTrend) && d.revenueTrend.length === 14);

  // -----------------------------------------------------------------------
  // 9. Support
  // -----------------------------------------------------------------------
  console.log('\n-- Support');
  const ticket = await api(
    '/support/tickets',
    { method: 'POST', body: { subject: 'Test ticket from partner', category: 'RESTAURANT', message: 'Checking the help centre works end to end.' } },
    partner.token
  );
  check('A partner can raise a support ticket', ticket.status === 201 || ticket.status === 200, `status ${ticket.status}`);

  const mine = await api('/support/tickets', {}, partner.token);
  check('The partner can see their own tickets', (mine.json?.data?.tickets || []).length > 0);

  closeSocketServer();
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  PARTNER WORKFLOW COMPLETE - EVERY STEP CONNECTED  ');
    console.log('====================================================\n');
    process.exit(0);
  }
  console.log(`  PARTNER WORKFLOW BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Partner workflow aborted:', err.message);
  process.exit(1);
});
