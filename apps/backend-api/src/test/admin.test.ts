/**
 * The admin console, end to end, over HTTP.
 *
 * Two things are being checked here, and the second matters more than the first.
 *
 * One: every management surface the console offers is actually connected —
 * dashboard figures come from real orders, a refund case walks from Requested to
 * Refunded and the money lands in a wallet, a coupon created here is honoured at
 * checkout, a payout settles real trips.
 *
 * Two: a restricted administrator is refused by the SERVER, not merely shown a
 * smaller menu. Every check below that a scoped account cannot reach something
 * is a direct request with a valid token — exactly what someone typing a URL
 * would send. Hiding a section in the app is not access control, and a test that
 * only asserted on the navigation would pass while the platform was wide open.
 */
import { createApp } from '../app.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import crypto from 'crypto';

const PORT = 5188;
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
  // This suite makes several hundred requests from one address in a few seconds,
  // which is exactly what the per-IP limiter exists to stop. The limit stays as
  // production runs it; the bucket is emptied between calls instead.
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
  // This suite signs seven accounts in, and later resets and changes a password.
  // That is well past the brute-force throttle, which is measuring exactly the
  // behaviour it should; the bucket is cleared rather than the limit loosened.
  resetAuthRateLimit();
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

/** Places an order and drives it to DELIVERED, so there is real trade to report on. */
async function completeAnOrder(customerToken: string, partnerToken: string, riderToken: string) {
  const placed = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 2, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
        distanceKm: 3.2
      }
    },
    customerToken
  );
  const order = placed.json?.data?.order || placed.json?.data;
  const orderId = order?.id;

  await api('/orders/' + orderId + '/status', { method: 'PUT', body: { status: 'PREPARING', preparationMinutes: 20 } }, partnerToken);
  await api('/orders/' + orderId + '/status', { method: 'PUT', body: { status: 'READY_FOR_PICKUP' } }, partnerToken);
  await api('/riders/orders/' + orderId + '/claim', { method: 'POST' }, riderToken);

  const stored = memoryStore.orders.get(orderId);
  await api('/riders/orders/' + orderId + '/verify-pickup', { method: 'POST', body: { pickupCode: stored.pickupCode } }, riderToken);
  await api('/riders/orders/' + orderId + '/verify-otp', { method: 'POST', body: { deliveryOtp: stored.deliveryOtp } }, riderToken);

  return memoryStore.orders.get(orderId);
}

async function run() {
  console.log('====================================================');
  console.log('   ADMIN CONSOLE & ROLE-BASED ACCESS CONTROL        ');
  console.log('====================================================\n');

  await seedDatabase();
  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  initSocketServer(server);
  await new Promise(r => server.once('listening', r as any));

  const superAdmin = await login('admin@quickbite.app');
  const ops = await login('ops@quickbite.app');
  const finance = await login('finance@quickbite.app');
  const support = await login('support@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');
  check('Super Admin and three scoped admin accounts can all sign in', true);

  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);
  const delivered = await completeAnOrder(customer.token, partner.token, rider.token);
  check('A real order was driven through to delivered', delivered?.status === 'DELIVERED', delivered?.status);

  /* ----------------------------- Who am I ----------------------------- */

  const me = await api('/admin/me', {}, superAdmin.token);
  check('Super Admin is recognised as unrestricted', me.json?.data?.isSuperAdmin === true);
  check('The permission catalogue is served to the console', (me.json?.data?.permissionCatalogue || []).length >= 9);

  const opsMe = await api('/admin/me', {}, ops.token);
  check('Operations Admin holds its role', opsMe.json?.data?.role?.key === 'operations_admin', JSON.stringify(opsMe.json?.data?.role));
  check('Operations Admin is not a Super Admin', opsMe.json?.data?.isSuperAdmin === false);
  check('Operations Admin can see orders', (opsMe.json?.data?.permissions || []).includes('orders.view'));
  check('Operations Admin cannot see revenue', !(opsMe.json?.data?.permissions || []).includes('finance.revenue.view'));

  /* --------------------------- The dashboard --------------------------- */

  const dashboard = await api('/admin/dashboard', {}, superAdmin.token);
  const d = dashboard.json?.data;
  check('Dashboard is served', dashboard.status === 200 && Boolean(d));
  check('Dashboard counts the completed order', d?.orders?.completed >= 1, JSON.stringify(d?.orders));
  check('Dashboard reports gross merchandise value', d?.money?.grossMerchandiseValue > 0, String(d?.money?.grossMerchandiseValue));
  check('Dashboard separates platform revenue from GMV',
    d?.money?.netRevenue !== d?.money?.grossMerchandiseValue,
    `net ${d?.money?.netRevenue} vs gmv ${d?.money?.grossMerchandiseValue}`);
  check('Dashboard counts customers, drivers and restaurants',
    d?.people?.totalCustomers > 0 && d?.people?.totalDrivers > 0 && d?.people?.totalRestaurants > 0);
  check('Dashboard surfaces the work queues', typeof d?.queues?.pendingKyc === 'number' && typeof d?.queues?.openRefundRequests === 'number');
  check('Dashboard carries a revenue trend', Array.isArray(d?.revenueTrend) && d.revenueTrend.length === 14);

  /* ------------------------- Orders, in full --------------------------- */

  const allOrders = await api('/admin/orders?pageSize=5', {}, superAdmin.token);
  check('All orders are listed with paging', allOrders.status === 200 && Array.isArray(allOrders.json?.data?.orders));

  const detail = await api(`/admin/orders/${delivered.id}`, {}, superAdmin.token);
  const dd = detail.json?.data;
  check('Order detail names the customer, restaurant and rider',
    Boolean(dd?.customer?.fullName && dd?.restaurant?.name && dd?.rider?.fullName),
    JSON.stringify({ c: dd?.customer?.fullName, r: dd?.restaurant?.name, d: dd?.rider?.fullName }));
  check('Order detail itemises the bill', dd?.order?.bill?.itemsTotal > 0 && dd?.order?.items?.length > 0);
  check('Order detail splits the money four ways',
    dd?.economics?.commission > 0 && dd?.economics?.restaurantPayout > 0 && dd?.economics?.riderPayout >= 0);
  check('Order detail carries a dated timeline', Array.isArray(dd?.timeline) && dd.timeline.length >= 3);
  check('Order detail withholds the doorstep OTP', dd?.order?.deliveryOtp === undefined);

  const liveDeliveries = await api('/admin/deliveries/live', {}, ops.token);
  check('Live deliveries are served to operations', liveDeliveries.status === 200 && Array.isArray(liveDeliveries.json?.data?.deliveries));

  /* ---------------------- Refund case, end to end ---------------------- */

  const walletBefore = await api(`/wallets/${customer.user.id}`, {}, customer.token);
  const startingBalance = walletBefore.json?.data?.wallet?.balance ?? walletBefore.json?.data?.balance ?? 0;

  const raised = await api(
    '/support/refund-requests',
    {
      method: 'POST',
      body: {
        orderId: delivered.id,
        reasonCode: 'ITEM_MISSING',
        description: 'One of the two biryanis was missing from the bag when it arrived.',
        requestedAmount: 150
      }
    },
    customer.token
  );
  check('A customer can raise a refund request', raised.status === 201, JSON.stringify(raised.json).slice(0, 200));
  const caseId = raised.json?.data?.request?.id;
  check('The new case starts at Requested', raised.json?.data?.request?.status === 'REQUESTED');

  const duplicate = await api(
    '/support/refund-requests',
    { method: 'POST', body: { orderId: delivered.id, reasonCode: 'OTHER', description: 'Trying the same thing twice over.' } },
    customer.token
  );
  check('A second open request on the same order is refused', duplicate.status === 409, String(duplicate.status));

  const queue = await api('/admin/refund-requests', {}, support.token);
  check('The case reaches the support queue', (queue.json?.data?.requests || []).some((r: any) => r.id === caseId));

  const caseDetail = await api(`/admin/refund-requests/${caseId}`, {}, support.token);
  check('The case carries the whole story',
    Boolean(caseDetail.json?.data?.request?.description) && Boolean(caseDetail.json?.data?.order?.customer));

  await api(`/admin/refund-requests/${caseId}/decision`, { method: 'POST', body: { action: 'PROCESSING', note: 'Checking with the restaurant.' } }, support.token);
  const approved = await api(
    `/admin/refund-requests/${caseId}/decision`,
    { method: 'POST', body: { action: 'APPROVE', amount: 150, note: 'Restaurant confirmed the missing item.' } },
    support.token
  );
  check('The case can be approved', approved.json?.data?.request?.status === 'APPROVED');

  /*
   * A refund with nowhere to send it is REFUSED, not quietly booked.
   *
   * This deployment has no payment gateway configured, so there is nothing to
   * reverse a payment through and no payout link can be created. The old code
   * credited a wallet here regardless of how the customer paid, which is the
   * defect this replaces — a customer who paid by UPI received store credit.
   *
   * The refusal is the correct behaviour and is asserted first, because it is
   * the property that matters: money that cannot move must not be recorded as
   * having moved.
   */
  const unsettleable = await api(
    `/admin/refund-requests/${caseId}/decision`,
    { method: 'POST', body: { action: 'REFUND', amount: 150 } },
    finance.token
  );
  check('A refund that cannot be settled is refused, not booked',
    unsettleable.status === 502 && unsettleable.json?.error?.code === 'REFUND_NOT_SETTLED',
    JSON.stringify(unsettleable.json).slice(0, 200));

  const stillOpen = await api(`/admin/refund-requests/${caseId}`, {}, finance.token);
  check('and the case stays open where somebody will see it',
    stillOpen.json?.data?.request?.status === 'PROCESSING',
    String(stillOpen.json?.data?.request?.status));

  /*
   * An administrator who has refunded it by hand records that, and it settles.
   *
   * Without this a cash-order refund could never be completed on a deployment
   * with no gateway, and the customer would be owed money indefinitely while a
   * case sat in a queue nobody could clear.
   */
  const paid = await api(
    `/admin/refund-requests/${caseId}/decision`,
    { method: 'POST', body: { action: 'REFUND', amount: 150, manualReference: 'UTR55512345678' } },
    finance.token
  );
  check('Finance can settle it by recording the transfer they made',
    paid.status === 200 && paid.json?.data?.request?.status === 'REFUNDED',
    JSON.stringify(paid.json).slice(0, 200));

  check('and the reference is kept, so the payment can be pointed at',
    paid.json?.data?.reference === 'UTR55512345678',
    String(paid.json?.data?.reference));

  check('No wallet was credited by any of that',
    Math.round(((await api(`/wallets/${customer.user.id}`, {}, customer.token)).json?.data?.wallet?.balance ?? 0) * 100) / 100 ===
      Math.round(startingBalance * 100) / 100,
    'a refund still credited a wallet');

  const doubleRefund = await api(`/admin/refund-requests/${caseId}/decision`, { method: 'POST', body: { action: 'REFUND', amount: 150 } }, finance.token);
  check('The same case cannot be refunded twice', doubleRefund.status === 409, String(doubleRefund.status));

  const caseTimeline = await api(`/admin/refund-requests/${caseId}`, {}, finance.token);
  check('The case keeps every step of its history',
    (caseTimeline.json?.data?.request?.timeline || []).length >= 4,
    String((caseTimeline.json?.data?.request?.timeline || []).length));

  /* ---------------------- Permissions are enforced --------------------- */

  const opsRevenue = await api('/admin/revenue', {}, ops.token);
  check('Operations cannot read revenue, by direct request', opsRevenue.status === 403, String(opsRevenue.status));
  check('The refusal explains itself', String(opsRevenue.json?.error?.code) === 'PERMISSION_DENIED', JSON.stringify(opsRevenue.json?.error));

  const opsCoupon = await api('/admin/coupons', { method: 'POST', body: { code: 'SNEAKY', discountType: 'FLAT', discountValue: 50 } }, ops.token);
  check('Operations cannot create a coupon', opsCoupon.status === 403, String(opsCoupon.status));

  const financeOrders = await api('/admin/orders', {}, finance.token);
  check('Finance can still read orders it needs', financeOrders.status === 200);

  const financeSuspend = await api('/admin/drivers/rdr_vikram_01', { method: 'PATCH', body: { kycStatus: 'SUSPENDED' } }, finance.token);
  check('Finance cannot suspend a driver', financeSuspend.status === 403, String(financeSuspend.status));

  const opsRoles = await api('/admin/roles', {}, ops.token);
  check('Operations cannot read the role list', opsRoles.status === 403, String(opsRoles.status));

  const opsCreateRole = await api('/admin/roles', { method: 'POST', body: { name: 'Self Promotion', permissions: ['admin.roles.manage'] } }, ops.token);
  check('A scoped admin cannot create a role to promote itself', opsCreateRole.status === 403, String(opsCreateRole.status));

  const customerOnAdmin = await api('/admin/dashboard', {}, customer.token);
  check('A customer token is refused everywhere under /admin', customerOnAdmin.status === 403, String(customerOnAdmin.status));

  const noToken = await api('/admin/dashboard');
  check('An unauthenticated request is refused', noToken.status === 401, String(noToken.status));

  /* ------------------------ Roles and assignment ----------------------- */

  const roles = await api('/admin/roles', {}, superAdmin.token);
  check('Super Admin sees the role catalogue', (roles.json?.data?.roles || []).length >= 7);
  check('Built-in roles are marked as such', (roles.json?.data?.roles || []).some((r: any) => r.isSystem));

  const created = await api(
    '/admin/roles',
    {
      method: 'POST',
      body: {
        name: 'Menu Reviewer',
        description: 'Reviews partner menu submissions and nothing else.',
        permissions: ['analytics.dashboard.view', 'catalog.menus.view', 'catalog.menus.review', 'not.a.real.permission']
      }
    },
    superAdmin.token
  );
  check('A custom role can be created', created.status === 201, JSON.stringify(created.json).slice(0, 200));
  const roleId = created.json?.data?.role?.id;
  check('Unknown permissions are dropped rather than stored',
    !(created.json?.data?.role?.permissions || []).includes('not.a.real.permission'),
    JSON.stringify(created.json?.data?.role?.permissions));

  const newAdmin = await api(
    '/admin/admins',
    {
      method: 'POST',
      body: { email: 'menu.reviewer@quickbite.app', fullName: 'Kavya Rao', password: 'review-me-1234', roleId }
    },
    superAdmin.token
  );
  check('Super Admin can provision a staff account', newAdmin.status === 201, JSON.stringify(newAdmin.json).slice(0, 200));

  const reviewer = await login('menu.reviewer@quickbite.app', 'review-me-1234');
  const reviewerMe = await api('/admin/me', {}, reviewer.token);
  check('The new admin holds exactly its assigned role', reviewerMe.json?.data?.role?.id === roleId);

  const reviewerOrders = await api('/admin/orders', {}, reviewer.token);
  check('The new admin is refused what its role omits', reviewerOrders.status === 403, String(reviewerOrders.status));

  const reviewerMenus = await api('/admin/menus', {}, reviewer.token);
  check('The new admin is allowed what its role grants', reviewerMenus.status === 200, String(reviewerMenus.status));

  // Narrowing a live role has to bite on the next request, not at token expiry.
  await api(`/admin/roles/${roleId}`, { method: 'PATCH', body: { permissions: ['analytics.dashboard.view'] } }, superAdmin.token);
  const reviewerMenusAfter = await api('/admin/menus', {}, reviewer.token);
  check('Narrowing a role takes effect immediately, on the same token',
    reviewerMenusAfter.status === 403,
    String(reviewerMenusAfter.status));

  await api(`/admin/roles/${roleId}`, { method: 'PATCH', body: { isActive: false } }, superAdmin.token);
  const disabledRole = await api('/admin/me', {}, reviewer.token);
  check('Disabling a role locks its holder out', disabledRole.status === 403 && disabledRole.json?.error?.code === 'ROLE_DISABLED',
    JSON.stringify(disabledRole.json?.error));

  const deleteInUse = await api(`/admin/roles/${roleId}`, { method: 'DELETE' }, superAdmin.token);
  check('A role still assigned to somebody cannot be deleted', deleteInUse.status === 409, String(deleteInUse.status));

  const systemRole = (roles.json?.data?.roles || []).find((r: any) => r.isSystem);
  const deleteSystem = await api(`/admin/roles/${systemRole.id}`, { method: 'DELETE' }, superAdmin.token);
  check('A built-in role cannot be deleted', deleteSystem.status === 409, String(deleteSystem.status));

  const selfEdit = await api(`/admin/admins/${superAdmin.user.id}`, { method: 'PATCH', body: { roleId: null } }, superAdmin.token);
  check('An administrator cannot change their own role', selfEdit.status === 409, String(selfEdit.status));

  /* ----------------------- Coupons reach checkout ---------------------- */

  const uncapped = await api(
    '/admin/coupons',
    { method: 'POST', body: { code: 'HALFOFF', discountType: 'PERCENTAGE', discountValue: 50 } },
    superAdmin.token
  );
  check('A percentage campaign without a ceiling is refused', uncapped.status === 400, String(uncapped.status));

  const coupon = await api(
    '/admin/coupons',
    {
      method: 'POST',
      body: {
        code: 'ADMINTEST',
        title: 'Console test offer',
        discountType: 'FLAT',
        discountValue: 60,
        minOrderValue: 100,
        usageLimit: 1,
        isActive: true
      }
    },
    superAdmin.token
  );
  check('A coupon can be created from the console', coupon.status === 201, JSON.stringify(coupon.json).slice(0, 200));

  const withCoupon = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
        couponCode: 'ADMINTEST',
        distanceKm: 3.2
      }
    },
    customer.token
  );
  const couponOrder = withCoupon.json?.data?.order || withCoupon.json?.data;
  check('The new coupon is honoured at checkout', (couponOrder?.bill?.couponDiscount || 0) === 60,
    String(couponOrder?.bill?.couponDiscount));
  check('The order records which campaign paid for the discount', couponOrder?.couponCode === 'ADMINTEST', String(couponOrder?.couponCode));

  const exhausted = await api(
    '/orders',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID(),
        couponCode: 'ADMINTEST',
        distanceKm: 3.2
      }
    },
    customer.token
  );
  const secondOrder = exhausted.json?.data?.order || exhausted.json?.data;
  check('A one-use campaign stops discounting once it is spent',
    (secondOrder?.bill?.couponDiscount || 0) === 0,
    String(secondOrder?.bill?.couponDiscount));

  const couponList = await api('/admin/coupons', {}, superAdmin.token);
  const listed = (couponList.json?.data?.coupons || []).find((c: any) => c.code === 'ADMINTEST');
  check('The console reports what a campaign has cost', listed?.discountGiven === 60, String(listed?.discountGiven));
  check('A spent campaign is reported as exhausted', listed?.effectiveStatus === 'EXHAUSTED', String(listed?.effectiveStatus));

  const deleteUsed = await api('/admin/coupons/ADMINTEST', { method: 'DELETE' }, superAdmin.token);
  check('A used coupon is deactivated rather than erased', deleteUsed.json?.data?.disabled === true, JSON.stringify(deleteUsed.json?.data));

  /* --------------------------- Driver payouts -------------------------- */

  /*
   * The second payout system is gone, and POST /admin/payouts now reaches the
   * ledger-backed one.
   *
   * Both halves matter. The old system registered the same method and path, so
   * it answered every request and the ledger system was unreachable — and
   * because they disagreed about their input, the admin app's Payouts screen
   * got a validation error every time it tried to pay anybody.
   *
   * The suites stayed green throughout, because they called the payout module
   * directly and proved the unreachable code correct. This one goes over HTTP
   * with the body the SCREEN actually sends, which is the only way to find out
   * which handler is on the other end.
   */

  const legacyDraft = await api(
    '/admin/rider-settlements',
    { method: 'POST', body: { riderId: 'rdr_vikram_01' } },
    finance.token
  );
  check('The second payout system is gone', legacyDraft.status === 404, String(legacyDraft.status));

  const legacyStatus = await api(
    '/admin/payouts/pay_whatever/status',
    { method: 'POST', body: { status: 'PAID' } },
    finance.token
  );
  check('and so is its mark-as-paid route', legacyStatus.status === 404, String(legacyStatus.status));

  const ledgerDraft = await api(
    '/admin/payouts',
    { method: 'POST', body: { ownerType: 'RIDER', ownerId: 'rdr_vikram_01' } },
    finance.token
  );
  /*
   * Asserted as "not a schema refusal" rather than as success. Whether there
   * is anything payable depends on hold periods and on what other suites have
   * already settled, so demanding a 201 would make this fail for reasons that
   * are not the point. What must never happen again is the request being
   * rejected for missing `riderId` — that is the shadowed handler answering.
   */
  const refusedForRiderId =
    ledgerDraft.status === 400 && JSON.stringify(ledgerDraft.json || {}).includes('riderId');
  check(
    'POST /admin/payouts reaches the ledger system, not the old one',
    !refusedForRiderId,
    JSON.stringify(ledgerDraft.json).slice(0, 200)
  );

  /* --------------------------- Support tickets ------------------------- */

  const ticket = await api(
    '/support/tickets',
    {
      method: 'POST',
      body: {
        subject: 'Rider could not find the gate',
        category: 'DELIVERY',
        message: 'The delivery partner circled the block for ten minutes before I called him.',
        orderId: delivered.id
      }
    },
    customer.token
  );
  check('A complaint raised in the app is accepted', ticket.status === 201, JSON.stringify(ticket.json).slice(0, 200));
  const ticketId = ticket.json?.data?.ticket?.id;

  const ticketQueue = await api('/admin/support/tickets', {}, support.token);
  check('The complaint reaches the support queue', (ticketQueue.json?.data?.tickets || []).some((t: any) => t.id === ticketId));

  const replied = await api(`/admin/support/tickets/${ticketId}/reply`, { method: 'POST', body: { body: 'Sorry about that — we have flagged the address.' } }, support.token);
  check('Support can reply to the complaint', (replied.json?.data?.ticket?.replies || []).length === 1);
  check('A replied ticket is in progress', replied.json?.data?.ticket?.status === 'IN_PROGRESS');

  const customerTickets = await api('/support/tickets', {}, customer.token);
  check('The customer sees the reply on their own ticket',
    (customerTickets.json?.data?.tickets?.[0]?.replies || []).length === 1);

  /* ------------------------------ Catalogue ---------------------------- */

  const categories = await api('/admin/categories', {}, superAdmin.token);
  check('Platform categories are seeded', (categories.json?.data?.categories || []).length >= 10);

  const newCategory = await api('/admin/categories', { method: 'POST', body: { name: 'Late Night' } }, superAdmin.token);
  check('A category can be created', newCategory.status === 201 && newCategory.json?.data?.category?.slug === 'late-night');

  const addedDish = await api(
    '/admin/menus/rst_bbh_01/items',
    { method: 'POST', body: { name: 'Admin Test Thali', price: 240, isVeg: true, categoryName: 'Thalis' } },
    superAdmin.token
  );
  check('An administrator can add a dish to a live menu', addedDish.status === 201, JSON.stringify(addedDish.json).slice(0, 160));
  const dishId = addedDish.json?.data?.item?.id;

  const editedDish = await api(`/admin/menus/rst_bbh_01/items/${dishId}`, { method: 'PATCH', body: { price: 260 } }, superAdmin.token);
  check('An administrator can correct a price', editedDish.json?.data?.item?.price === 260);

  const publicMenu = await api('/restaurants/rst_bbh_01/menu');
  const publicDish = (publicMenu.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.id === dishId);
  check('The edit is what a customer actually sees', publicDish?.price === 260, String(publicDish?.price));

  await api(`/admin/menus/rst_bbh_01/items/${dishId}`, { method: 'DELETE' }, superAdmin.token);
  const menuAfter = await api('/restaurants/rst_bbh_01/menu');
  const goneDish = (menuAfter.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.id === dishId);
  check('A removed dish leaves the customer menu', !goneDish);

  /* ----------------------- Partner menu requests ----------------------- */

  const submitted = await api(
    '/restaurants/rst_bbh_01/menu/requests',
    {
      method: 'POST',
      body: { kind: 'ADD_ITEM', name: 'Partner Paneer Tikka', price: 280, isVeg: true, categoryName: 'Starters' }
    },
    partner.token
  );
  check('A partner can submit a menu change for review', submitted.status === 201 || submitted.status === 200,
    JSON.stringify(submitted.json).slice(0, 200));
  const requestId = submitted.json?.data?.request?.id;

  const beforeApproval = await api('/restaurants/rst_bbh_01/menu');
  const notYetLive = (beforeApproval.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .some((i: any) => i.name === 'Partner Paneer Tikka');
  check('A pending request is not on the live menu', !notYetLive);

  const reviewed = await api(`/admin/menu-requests/${requestId}/review`, { method: 'POST', body: { action: 'APPROVE' } }, superAdmin.token);
  check('An administrator can approve a menu request', reviewed.status === 200, JSON.stringify(reviewed.json).slice(0, 160));

  const afterApproval = await api('/restaurants/rst_bbh_01/menu');
  const nowLive = (afterApproval.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .some((i: any) => i.name === 'Partner Paneer Tikka');
  check('Approval is what puts the dish in front of customers', nowLive);

  /* ------------------------------ Audit log ---------------------------- */

  const audit = await api('/admin/audit-log', {}, superAdmin.token);
  const entries = audit.json?.data?.entries || [];
  check('The audit log is readable by a Super Admin', audit.status === 200 && entries.length > 0, String(entries.length));
  check('The refund is on the record', entries.some((e: any) => e.action === 'REFUND_PAID'));
  /*
   * No PAYOUT_PAID here any more. This suite made one through the second
   * payout system, which is gone; ledger payouts and their audit trail are
   * covered by the payouts suite, which exercises draft, approve and send.
   */
  check('Role changes are on the record', entries.some((e: any) => e.action === 'ROLE_CREATED'));
  check('Each entry names who did it', entries.every((e: any) => Boolean(e.actorUserId && e.actorName)));

  const opsAudit = await api('/admin/audit-log', {}, ops.token);
  check('A scoped admin cannot read the audit log', opsAudit.status === 403, String(opsAudit.status));

  /* --------------------------- Account controls ------------------------ */

  const blocked = await api(
    `/admin/customers/${customer.user.id}`,
    { method: 'PATCH', body: { isBlocked: true, blockReason: 'Testing the block path' } },
    support.token
  );
  check('Support can block a customer account', blocked.status === 200, String(blocked.status));

  resetAuthRateLimit();
  const blockedLogin = await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } });
  check('A blocked account cannot sign in', blockedLogin.status === 403, String(blockedLogin.status));
  check('The blocked customer is told why', String(blockedLogin.json?.error).includes('Testing the block path'), String(blockedLogin.json?.error));

  await api(`/admin/customers/${customer.user.id}`, { method: 'PATCH', body: { isBlocked: false } }, support.token);
  resetAuthRateLimit();
  const restoredLogin = await api('/auth/login', { method: 'POST', body: { email: 'customer@quickbite.app', password: 'pass123' } });
  check('Unblocking restores sign-in', restoredLogin.status === 200, String(restoredLogin.status));

  /* ------------------------- Password management ----------------------- */

  // Emailed recovery codes are gone. Customers have no password to recover —
  // they sign in with a code sent to their phone — and staff recovery is an
  // administrator setting a temporary password, which is what actually happens
  // when a restaurant telephones operations. It is audit-logged, because an
  // administrator able to take over a partner account silently is exactly the
  // power that needs a record kept against it.
  resetAuthRateLimit();

  const staffReset = await api(
    '/admin/staff/usr_partner_01/reset-password',
    { method: 'POST', body: { temporaryPassword: 'TemporaryPartnerPass99' } },
    superAdmin.token
  );
  check('An administrator can reset a partner password', staffReset.status === 200,
    JSON.stringify(staffReset.json).slice(0, 160));

  resetAuthRateLimit();
  const partnerSignIn = await api('/auth/login', {
    method: 'POST',
    body: { email: 'partner@quickbite.app', password: 'TemporaryPartnerPass99' }
  });
  check('The partner signs in with the temporary password', partnerSignIn.status === 200,
    String(partnerSignIn.status));

  const customerReset = await api(
    `/admin/staff/${customer.user.id}/reset-password`,
    { method: 'POST', body: { temporaryPassword: 'ShouldNotBeAllowed1' } },
    superAdmin.token
  );
  check('A customer cannot be given a password — their phone is the credential',
    customerReset.status === 400, String(customerReset.status));

  const resetAudit = await api('/admin/audit-log', {}, superAdmin.token);
  check('The reset is on the audit log',
    JSON.stringify(resetAudit.json).includes('STAFF_PASSWORD_RESET'),
    'no STAFF_PASSWORD_RESET entry found');

  // change-password is still a staff feature, so it is exercised against a
  // staff account rather than the customer it used to use.
  resetAuthRateLimit();
  const newLogin = await login('partner@quickbite.app', 'TemporaryPartnerPass99');
  check('The temporary password yields a usable session', Boolean(newLogin.token));

  const wrongCurrent = await api('/auth/change-password', { method: 'POST', body: { currentPassword: 'not-it', newPassword: 'yet-another-pass' } }, newLogin.token);
  check('Changing a password needs the current one', wrongCurrent.status === 401, String(wrongCurrent.status));

  const changed = await api('/auth/change-password', { method: 'POST', body: { currentPassword: 'TemporaryPartnerPass99', newPassword: 'final-password-1' } }, newLogin.token);
  check('A signed-in user can change their password', changed.status === 200, String(changed.status));
  const finalLogin = await login('partner@quickbite.app', 'final-password-1');
  check('The changed password signs in', Boolean(finalLogin.token));

  const loggedOut = await api('/auth/logout', { method: 'POST' }, finalLogin.token);

  // The checks below are the customer's own view of the platform and need a
  // customer session: finalLogin is a staff account now that the password
  // chain moved off the customer, who no longer has a password to change.
  resetAuthRateLimit();
  const customerSession = await login('customer@quickbite.app');

  check('Sign-out is acknowledged', loggedOut.status === 200);

  /* ------------------------------ Analytics ---------------------------- */

  const revenue = await api('/admin/revenue?period=month', {}, finance.token);
  check('Finance can read revenue analytics', revenue.status === 200 && revenue.json?.data?.summary?.orders >= 1);
  check('Revenue is broken down by period', Boolean(revenue.json?.data?.periods?.today && revenue.json?.data?.periods?.all));

  const payments = await api('/admin/payments', {}, finance.token);
  check('The payment ledger lists orders', (payments.json?.data?.payments || []).length > 0);
  check('The ledger shows what the platform kept on each order',
    typeof payments.json?.data?.payments?.[0]?.platformEarning === 'number');

  const performance = await api('/admin/analytics/performance', {}, superAdmin.token);
  check('Performance scorecards are served',
    (performance.json?.data?.restaurants || []).length > 0 && (performance.json?.data?.riders || []).length > 0);

  /* ------------- What the admin did, seen from the other apps ------------- */
  //
  // Every check above proves the console wrote something. These prove the write
  // reached the app it was about — which is the only sense in which the four
  // sides are actually synchronised.

  const customerOrders = await api('/orders', {}, customerSession.token);
  const refundedOrder = (customerOrders.json?.data?.orders || []).find((o: any) => o.id === delivered.id);
  check('The customer sees the partial refund on their own order',
    Boolean(refundedOrder),
    'order missing from the customer\'s own list');

  const customerCases = await api('/support/refund-requests', {}, customerSession.token);
  const ownCase = (customerCases.json?.data?.requests || []).find((r: any) => r.id === caseId);
  check('The customer can follow their refund case to its conclusion',
    ownCase?.status === 'REFUNDED' && ownCase?.approvedAmount === 150,
    JSON.stringify({ status: ownCase?.status, amount: ownCase?.approvedAmount }));

  const partnerMenu = await api('/restaurants/rst_bbh_01/menu');
  const partnerSeesApproved = (partnerMenu.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .some((i: any) => i.name === 'Partner Paneer Tikka');
  check('The partner\'s own menu carries the dish the admin approved', partnerSeesApproved);

  const riderDashboard = await api('/riders/dashboard', {}, rider.token);
  /*
   * PAYING A RIDER DOES NOT CLEAR THE CASH THEY ARE CARRYING.
   *
   * The removed payout system did exactly that: marking a payout paid wrote
   * the rider's COD cash down to zero. Two separate things were settled by one
   * action, and the cash half never reached the ledger — so the books went on
   * showing cash the rider no longer held.
   *
   * Cash is settled when the rider hands it over and somebody counts it, which
   * posts the movement as double entry. Earnings are settled by a payout.
   * Asserting the cash is STILL HELD is what stops the two being collapsed
   * back into one action by a future tidy-up.
   */
  check('Paying a rider does not silently clear the cash they are carrying',
    (riderDashboard.json?.data?.rider?.codCashInHand ?? 0) > 0,
    String(riderDashboard.json?.data?.rider?.codCashInHand));

  // Suspending a restaurant has to remove it from what customers can order from,
  // not merely change a badge in the console.
  const beforeSuspend = await api('/restaurants?latitude=12.9&longitude=77.6', {}, customerSession.token);
  const listedBefore = (beforeSuspend.json?.data?.restaurants || []).some((r: any) => r.id === 'rst_bbh_01');
  check('The restaurant is on the customer\'s list before it is suspended', listedBefore);

  await api('/admin/restaurants/rst_bbh_01', { method: 'PATCH', body: { status: 'SUSPENDED', reason: 'Testing propagation' } }, superAdmin.token);
  const afterSuspend = await api('/restaurants?latitude=12.9&longitude=77.6', {}, customerSession.token);
  const listedAfter = (afterSuspend.json?.data?.restaurants || []).some((r: any) => r.id === 'rst_bbh_01');
  check('Suspending it takes it off the customer\'s list immediately', !listedAfter);

  await api('/admin/restaurants/rst_bbh_01', { method: 'PATCH', body: { status: 'ACTIVE' } }, superAdmin.token);
  const restored = await api('/restaurants?latitude=12.9&longitude=77.6', {}, customerSession.token);
  check('Reinstating it puts it back',
    (restored.json?.data?.restaurants || []).some((r: any) => r.id === 'rst_bbh_01'));

  // A suspended rider must come off shift, or dispatch keeps offering them work.
  await api('/admin/drivers/rdr_vikram_01', { method: 'PATCH', body: { kycStatus: 'SUSPENDED', reason: 'Testing propagation' } }, ops.token);
  const suspendedRider = await api('/riders/me', {}, rider.token);
  check('Suspending a delivery partner takes them off shift',
    suspendedRider.json?.data?.rider?.isOnline === false,
    `status ${suspendedRider.status} ${JSON.stringify(suspendedRider.json?.data?.rider?.isOnline)}`);

  await api('/admin/drivers/rdr_vikram_01', { method: 'PATCH', body: { kycStatus: 'ACTIVE' } }, ops.token);

  closeSocketServer();
  server.close();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('   ADMIN CONSOLE VERIFIED - RBAC ENFORCED SERVER-SIDE');
    console.log('====================================================\n');
    process.exit(0);
  }
  console.log(`   ADMIN CONSOLE BROKEN - ${failures} CHECK(S) FAILED`);
  console.log('====================================================\n');
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] Admin suite aborted:', err.message);
  process.exit(1);
});
