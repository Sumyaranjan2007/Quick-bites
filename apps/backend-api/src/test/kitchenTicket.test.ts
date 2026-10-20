/**
 * Kitchen ticket to print (master plan B10, #2).
 *
 * What must hold:
 *  - an 80 mm (default) or 58 mm wide PDF with the order number, each dish
 *    with its quantity and chosen options, the item count, the pickup code and
 *    the customer's first name;
 *  - never on it: a price or total, the payment method, the customer's phone,
 *    address or delivery code;
 *  - only the kitchen that owns the order (once it has accepted) and staff with
 *    order access may print it; a customer-app session of the partner may not;
 *  - a cancelled order still prints, marked CANCELLED.
 */
import assert from 'node:assert/strict';
import http from 'http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit } from '../middlewares/rateLimiter.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { wrapMono } from '../modules/orders/kitchenTicket.ts';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

(config as any).OTP_PROVIDER = 'fixed';
await seedDatabase();
const server = http.createServer(createApp());
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${(server.address() as any).port}/api`;

async function get(pathname: string, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* a PDF */ }
  return { status: res.status, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', pdf: buf.toString('latin1'), html: buf.toString('utf8'), cache: res.headers.get('cache-control') || '', json };
}
async function login(email: string) {
  resetAuthRateLimit();
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pass123' })
  });
  return ((await res.json()) as any)?.data?.token as string;
}
/** The text drawn on the page: every `(…) Tj` string in the content stream. */
const textOf = (pdf: string) => [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\(.)/g, '$1')).join('\n');
/** The text of the HTML ticket: one line a <div>, a rule a line of its own. */
const htmlText = (html: string) =>
  html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<hr>/g, '\n---\n').replace(/<\/div>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const pageSize = (html: string) => /@page \{ size: (\d+)mm (\d+)mm; margin: 0; \}/.exec(html);
const mediaWidth = (pdf: string) => Number(/\/MediaBox \[0 0 ([\d.]+) /.exec(pdf)?.[1]);

const PRICES = [349, 698, 40, 129, 867, 912.5, 25];
const order: any = {
  id: 'ord_ticket_1',
  orderNumber: 'QB-500001',
  customerId: 'usr_customer_01',
  customerName: 'Priya Sharma',
  customerPhone: '+91 90000 11111',
  deliveryAddress: { line1: '14 Temple Street', city: 'Harohalli' },
  restaurantId: 'rst_bbh_01',
  restaurantName: 'Bangalore Biryani House',
  status: 'ACCEPTED',
  acceptedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  paymentMethod: 'RAZORPAY_SANDBOX',
  paymentStatus: 'PAID',
  pickupCode: '5371',
  deliveryOtp: '8642',
  items: [
    {
      dishId: 'dish_ck_biryani', name: 'Chicken Dum Biryani', unitPrice: 349, quantity: 2, totalPrice: 698,
      selectedOptions: [
        { groupId: 'g_size', groupTitle: 'Size', optionId: 'o_large', optionName: 'Large', priceDelta: 40 },
        { groupId: 'g_extra', groupTitle: 'Extras', optionId: 'o_raita', optionName: 'Extra raita', priceDelta: 25 }
      ]
    },
    { dishId: 'dish_dosa', name: 'Masala Dosa', unitPrice: 129, quantity: 1, totalPrice: 129 }
  ],
  bill: { itemsTotal: 867, totalAmount: 912.5, deliveryFee: 40 }
};
memoryStore.orders.set(order.id, order);
const TICKET = `/orders/${order.id}/kitchen-ticket`;

try {
  const partner = await login('partner@quickbite.app');

  console.log('\n-- What is on the ticket');
  const t = await get(TICKET, partner);
  const text = textOf(t.pdf);
  it('The owning kitchen gets a PDF', () => {
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.match(t.type, /application\/pdf/);
    assert.match(t.pdf, /^%PDF-/);
  });
  it('...named after the order, inline so a browser opens its print dialog', () =>
    assert.match(t.disposition, /inline; filename="QuickBites-ticket-QB-500001\.pdf"/));
  it('80 mm wide by default', () => assert.equal(mediaWidth(t.pdf).toFixed(1), (80 * 72 / 25.4).toFixed(1)));
  it('Order number, kitchen name, quantity-first dishes and their options', () => {
    assert.match(text, /QB-500001/);
    assert.match(text, /BANGALORE BIRYANI\s+HOUSE/); // 15 pt bold: a long name wraps inside the roll
    assert.match(text, /2 x Chicken Dum Biryani/);
    assert.match(text, /Large/);
    assert.match(text, /Extra raita/);
    assert.match(text, /1 x Masala Dosa/);
  });
  it('Item count and pickup code', () => {
    assert.match(text, /Items: 3/);
    assert.match(text, /5 3 7 1/);
  });
  it('Customer by first name only', () => {
    assert.match(text, /Customer: Priya\n/);
    assert.doesNotMatch(text, /Sharma/);
  });
  it('No price, total or "Rs" anywhere', () => {
    assert.doesNotMatch(text, /Rs|₹/);
    for (const p of PRICES) assert.doesNotMatch(text, new RegExp(`(^|[^\\d.])${String(p).replace('.', '\\.')}([^\\d.]|$)`, 'm'), `price ${p} printed`);
  });
  it('No phone, address, payment method or delivery code', () => {
    for (const secret of ['90000', 'Temple', 'Harohalli', 'RAZORPAY', 'Online', 'Cash', '8642', '8 6 4 2']) {
      assert.ok(!text.includes(secret), `${secret} printed`);
    }
  });
  it('"Not a bill" footer', () => assert.match(text, /Not a bill/));

  const narrow = await get(`${TICKET}?width=58`, partner);
  it('58 mm on request', () => assert.equal(mediaWidth(narrow.pdf).toFixed(1), (58 * 72 / 25.4).toFixed(1)));
  const odd = await get(`${TICKET}?width=70`, partner);
  it('Any other width is refused', () => assert.equal(odd.status, 400));

  console.log('\n-- The website ticket (HTML, round 5 C): a page exactly the size of the ticket');
  const web = await get(`${TICKET}?format=html`, partner);
  const webText = htmlText(web.html);
  it('HTML on request, never cached', () => {
    assert.equal(web.status, 200);
    assert.match(web.type, /text\/html/);
    assert.match(web.cache, /no-store/);
  });
  it('The page is 80 mm wide and exactly as tall as the ticket, no margins (the printer stops and cuts there)', () => {
    const size = pageSize(web.html);
    assert.equal(size?.[1], '80');
    assert.ok(Number(size?.[2]) > 60 && Number(size?.[2]) < 250, size?.[2]);
  });
  it('Bold monospace like a POS bill, dishes at 14 pt and the order number at 26 pt', () => {
    assert.match(web.html, /font-family: 'Courier New', Courier, monospace/);
    assert.match(web.html, /font-size:14pt;[^"]*font-weight:700;[^"]*">2 x Chicken Dum Biryani/);
    assert.match(web.html, /font-size:26pt;[^"]*">QB-500001/);
  });
  it('The same lines as the PDF', () => {
    for (const line of ['QB-500001', 'BANGALORE BIRYANI HOUSE', '2 x Chicken Dum Biryani', 'Large', 'Extra raita', '1 x Masala Dosa', 'Items: 3', '5 3 7 1', 'Customer: Priya\n', 'Not a bill']) {
      assert.ok(webText.includes(line), line);
    }
    assert.doesNotMatch(webText, /Sharma/);
  });
  it('No price, phone, address, payment method or delivery code on it either', () => {
    assert.doesNotMatch(webText, /Rs|₹/);
    for (const p of PRICES) assert.doesNotMatch(webText, new RegExp(`(^|[^\\d.])${String(p).replace('.', '\\.')}([^\\d.]|$)`, 'm'), `price ${p} printed`);
    for (const secret of ['90000', 'Temple', 'Harohalli', 'RAZORPAY', 'Online', 'Cash', '8642', '8 6 4 2']) assert.ok(!webText.includes(secret), `${secret} printed`);
  });
  const webNarrow = await get(`${TICKET}?format=html&width=58`, partner);
  it('58 mm on request', () => assert.equal(pageSize(webNarrow.html)?.[1], '58'));
  it('A long dish name wraps inside the roll, never cut off at the edge', () => {
    const lines = wrapMono('2 x Hyderabadi Chicken Dum Biryani Family Pack Special', 20);
    assert.ok(lines.length > 1 && lines.every(l => l.length <= 20), JSON.stringify(lines));
    assert.equal(lines.join(' '), '2 x Hyderabadi Chicken Dum Biryani Family Pack Special');
    assert.ok(wrapMono('Supercalifragilisticexpialidocious', 10).every(l => l.length <= 10));
  });

  const long = { ...order, id: 'ord_ticket_long', items: Array.from({ length: 30 }, (_, i) => ({ dishId: `d${i}`, name: `Dish number ${i}`, quantity: 1, unitPrice: 1, totalPrice: 1 })) };
  memoryStore.orders.set(long.id, long);
  const tall = await get(`/orders/${long.id}/kitchen-ticket`, partner);
  it('One page that grows with the items (no page breaks)', () => {
    assert.equal((tall.pdf.match(/\/Type \/Page /g) || []).length, 1);
    assert.ok(Number(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(tall.pdf)?.[1]) > Number(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(t.pdf)?.[1]));
    assert.match(textOf(tall.pdf), /Dish number 29/);
  });
  const tallWeb = await get(`/orders/${long.id}/kitchen-ticket?format=html`, partner);
  it('The website page grows with the items too', () =>
    assert.ok(Number(pageSize(tallWeb.html)?.[2]) > Number(pageSize(web.html)?.[2]) + 100));

  console.log('\n-- Who may print it');
  order.status = 'ORDER_PLACED';
  delete order.acceptedAt;
  const early = await get(TICKET, partner);
  it('Not before the kitchen accepts', () => assert.equal(early.json?.error?.code, 'NOT_ACCEPTED', `status ${early.status}`));
  order.status = 'CANCELLED';
  order.acceptedAt = new Date().toISOString();
  const cancelled = await get(TICKET, partner);
  it('A cancelled order still prints, marked CANCELLED', () => {
    assert.equal(cancelled.status, 200);
    assert.match(textOf(cancelled.pdf), /CANCELLED/);
  });
  order.status = 'ACCEPTED';

  memoryStore.restaurants.set('rst_ticket_other', { id: 'rst_ticket_other', ownerId: 'usr_partner_legacy', name: 'Other Kitchen' });
  memoryStore.orders.set('ord_ticket_other', { ...order, id: 'ord_ticket_other', restaurantId: 'rst_ticket_other' });
  const foreign = await get('/orders/ord_ticket_other/kitchen-ticket', partner);
  it('Another kitchen\'s order is refused', () => assert.equal(foreign.status, 403));
  const customer = await get(TICKET, await login('customer@quickbite.app'));
  it('The customer cannot print it', () => assert.equal(customer.status, 403));
  const rider = await get(TICKET, await login('rider@quickbite.app'));
  it('A rider cannot print it', () => assert.equal(rider.status, 403));
  const anon = await get(TICKET);
  it('Signed out is 401', () => assert.equal(anon.status, 401));
  const missing = await get('/orders/ord_nope/kitchen-ticket', partner);
  it('Unknown order is 404', () => assert.equal(missing.status, 404));

  resetAuthRateLimit();
  const partnerUser = (await userRepository.findByEmail('partner@quickbite.app'))!;
  await fetch(`${API}/auth/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: partnerUser.phone, email: 'partner@quickbite.app' }) });
  const verify = await fetch(`${API}/auth/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: partnerUser.phone, code: config.OTP_FIXED_CODE }) });
  const scoped = ((await verify.json()) as any)?.data?.token;
  const viaCustomerApp = await get(TICKET, scoped);
  it('The partner signed in to the Customer app cannot print it', () => assert.equal(viaCustomerApp.status, 403));

  const staff = await get(TICKET, await login('support@quickbite.app'));
  it('Staff with order access can print it', () => assert.equal(staff.status, 200));
  const role = memoryStore.adminRoles.get('rol_support_admin');
  role.isActive = false;
  const disabled = await get(TICKET, await login('support@quickbite.app'));
  it('...not when their admin role is switched off', () => assert.equal(disabled.status, 403));
  role.isActive = true;
} finally {
  // Wait for the close: exiting while it is in flight crashes Node on Windows (UV_HANDLE_CLOSING).
  await new Promise(r => server.close(() => r(null)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
