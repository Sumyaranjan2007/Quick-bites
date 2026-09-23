/**
 * Cash has four locations, and money must never appear between two of them.
 *
 * The owner described their real process: a rider collects cash at the door, it
 * travels to the office, somebody later walks it to the bank, and settlement
 * pays everyone. Four places. The ledger modelled three -- a confirmed handover
 * posted straight to PLATFORM_BANK -- so from the moment a rider reached the
 * desk the platform believed it held bank money that was physically in a
 * drawer, for however many days passed before the branch.
 *
 * That has teeth because nothing checks it. `rail.available()` asks whether a
 * payout gateway is configured; no code asks whether PLATFORM_BANK holds the
 * money. A payout run funded by cash still in the office is marked sent,
 * bounces at the gateway, and our own books say the funds were there.
 *
 * -------------------------------------------------------------------------
 * THE ASSERTION THAT MATTERS MOST
 * -------------------------------------------------------------------------
 * The owner also said the returned cash "will be added to our total earning".
 * That is the right outcome described in words that, implemented literally,
 * would corrupt every revenue figure on the platform -- because the profit on a
 * cash order is ALREADY recognised at delivery, when the gross is split and the
 * whole of it charged to the rider. Booking it again when the notes are counted
 * would count every cash order twice and show a profit near double the truth,
 * on a screen that adds up perfectly either way.
 *
 * So REVENUE_COMMISSION and REVENUE_FEES are captured once after delivery and
 * asserted byte-identical at every later step. Asserting only that the rider's
 * cash-in-hand fell passes just as well when revenue has been double-booked:
 * the cash DOES move, so the check that looks like it is about the money is the
 * one that cannot see the bug.
 *
 * The conservation check is the other half. At every step the total across all
 * accounts must be unchanged, because money changing LOCATION is not money
 * being created. A single-account assertion cannot catch a posting that debits
 * one place without crediting another; only the sum can.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { ledger } from '../modules/payments/ledger.ts';
import { memoryStore } from '../db/client.ts';
import { cashInHandPaise, officeCashPaise } from '../modules/payments/cashDeposits.ts';
import { formatPaise } from '../modules/payments/money.ts';
import { setCharges } from '../modules/payments/restaurantCharges.ts';
import { backfillEarnings } from '../modules/payments/earnings.ts';

const PORT = 5213;
const API = `http://127.0.0.1:${PORT}/api`;

console.log('====================================================');
console.log('  CASH HAS FOUR LOCATIONS                           ');
console.log('====================================================\n');

let failed = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`[PASS] ${label}`);
  } else {
    failed++;
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
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

/**
 * Every account's balance, summed.
 *
 * Read from the ledger's own entries rather than from a list of account names,
 * so an account nobody thought of is still counted. A conservation check that
 * only sums the accounts it knows about cannot see money appearing in one it
 * does not.
 */
function totalAcrossAllAccounts(): number {
  const seen = new Set<string>();
  for (const entry of memoryStore.ledgerEntries.values() as any) {
    for (const posting of (entry as any).postings || []) seen.add(posting.account);
  }
  let total = 0;
  for (const account of seen) total += ledger.balanceOf(account);
  return total;
}

function revenueSnapshot() {
  return {
    commission: ledger.balanceOf('REVENUE_COMMISSION'),
    fees: ledger.balanceOf('REVENUE_FEES')
  };
}

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const admin = await login('admin@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');

  // ----------------------------------------------------------------
  console.log('\n-- One cash order, delivered');

  const feed = await api('/restaurants?latitude=12.6802&longitude=77.4734', {}, customer.token);
  const restaurant = feed.json?.data?.restaurants?.[0];
  const menu = await api(`/restaurants/${restaurant.id}/menu`, {}, customer.token);
  const dish = (menu.json?.data?.menu?.categories || [])
    .flatMap((c: any) => c.items || [])
    .find((i: any) => i.isAvailable !== false);
  const addresses = await api('/addresses', {}, customer.token);
  const address = addresses.json?.data?.addresses?.[0];

  /*
   * Give the restaurant a commission and a markup BEFORE ordering.
   *
   * The seeded configuration takes neither, so the platform keeps nothing on a
   * seeded order and REVENUE_COMMISSION and REVENUE_FEES are both zero. Every
   * "revenue did not move" assertion below would then be comparing zero with
   * zero and would pass however badly the cash return was written -- which is
   * the precise failure this file exists to catch. There has to be a profit
   * before "the profit did not change" means anything.
   */
  setCharges(restaurant.id, { commissionPercent: 18, foodMarkupPercent: 10 }, 'usr_admin_01',
    'Set by the cash-locations suite so there is revenue to protect.');

  const placed = await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: restaurant.id,
      deliveryAddressId: address.id,
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: `cash-locations-${Date.now()}`,
      items: [{ dishId: dish.id, quantity: 1 }]
    }
  }, customer.token);
  const order = placed.json?.data?.order;
  check('A cash order is placed', !!order?.id,
    `status ${placed.status}: ${JSON.stringify(placed.json).slice(0, 200)}`);
  if (!order?.id) throw new Error('no order to follow');

  const riderId = (rider.user as any)?.riderId ||
    Array.from(memoryStore.riders.values()).find((r: any) => r.userId === rider.user?.id)?.id;
  check('There is a rider to carry it', !!riderId);

  /*
   * The kitchen's half through the status route, and then the RIDER'S OWN
   * route to finish it.
   *
   * That last step matters and is not interchangeable. Cash-in-hand is credited
   * at riderRouter.ts:1093, inside POST /riders/orders/:id/verify-otp, and
   * NOWHERE else -- a generic transition to DELIVERED moves the status and
   * records no cash. The first version of this file drove the whole thing
   * through the status route, and every cash assertion after it compared zero
   * with zero and passed.
   */
  for (const [status, token] of [
    ['CONFIRMED', partner.token],
    ['PREPARING', partner.token],
    ['READY_FOR_PICKUP', partner.token]
  ] as Array<[string, any]>) {
    const body: any = { status };
    if (status === 'PREPARING') body.preparationMinutes = 20;
    await api(`/orders/${order.id}/status`, { method: 'PUT', body }, token);
  }

  // Put the trip in this rider's hands the way the dispatch would.
  const live = memoryStore.orders.get(order.id) as any;
  live.riderId = riderId;
  live.pickedUpAt = live.pickedUpAt || new Date().toISOString();
  live.status = 'OUT_FOR_DELIVERY';
  memoryStore.orders.set(order.id, live);

  const otp = (memoryStore.orders.get(order.id) as any)?.deliveryOtp;
  const handover = await api(`/riders/orders/${order.id}/verify-otp`, {
    method: 'POST',
    body: { deliveryOtp: otp }
  }, rider.token);

  /*
   * The sweep that posts the money -- and NOTHING RUNS IT AUTOMATICALLY.
   *
   * verifyDeliveryOtp writes DELIVERED through the repository and does not post
   * earnings. The sweep that would catch it, backfillEarnings(), has exactly one
   * caller in the whole of src: an admin route at payoutRoutes.ts:543 that a
   * person has to press.
   *
   * This comment said "it runs at boot" when it was written, which was taken
   * from the comment at orderRepository.ts:368 rather than from the call sites.
   * It is not true, and both comments are wrong. The consequence is not a delay:
   * an ordinary cash delivery posts NOTHING to the ledger -- no revenue, no
   * partner payable -- until somebody opens the admin console and presses a
   * button.
   *
   * So this line is the test standing in for a human. It is doing what no code
   * currently does, which is why the suite can assert revenue at all, and that
   * makes this call the load-bearing part of the file rather than a detail.
   * When the two delivery paths are unified, this should come out and the
   * assertions below should pass without it.
   */
  const swept = backfillEarnings();
  check('The delivery is swept into the ledger', swept.posted > 0,
    JSON.stringify(swept));

  const delivered = memoryStore.orders.get(order.id) as any;
  check('It reaches DELIVERED through the handover the rider performs',
    delivered?.status === 'DELIVERED',
    `status ${handover.status}: ${JSON.stringify(handover.json).slice(0, 200)}`);

  // ----------------------------------------------------------------
  console.log('\n-- Location 1: the money is in the rider\'s pocket');

  const afterDelivery = {
    total: totalAcrossAllAccounts(),
    revenue: revenueSnapshot(),
    riderCash: cashInHandPaise(riderId),
    office: officeCashPaise(),
    bank: ledger.balanceOf('PLATFORM_BANK')
  };

  check('The rider is holding the cash', afterDelivery.riderCash > 0,
    `holding ${formatPaise(afterDelivery.riderCash)}`);

  /*
   * Stop here rather than continue on a zero.
   *
   * Every later assertion compares a balance against this one. With no cash in
   * play they all compare zero with zero and PASS -- which is exactly what the
   * first run of this file did: three checks failed and eleven passed
   * meaninglessly, including "THE OFFICE IS NOW HOLDING IT". A suite that keeps
   * going after its precondition fails reports mostly good news about nothing.
   */
  if (afterDelivery.riderCash <= 0) {
    throw new Error(
      'The rider is holding no cash, so nothing below this line would be testing anything.'
    );
  }
  check('The office is holding nothing yet', afterDelivery.office === 0,
    formatPaise(afterDelivery.office));

  /*
   * The profit is ALREADY recognised. This is the fact the rest of the file
   * depends on, so it is asserted rather than assumed -- if revenue were zero
   * here, every later "unchanged" check would be comparing zero with zero and
   * would pass no matter what the cash return did.
   */
  check('OUR PROFIT IS ALREADY RECOGNISED, BEFORE ANY CASH COMES BACK',
    afterDelivery.revenue.commission > 0,
    JSON.stringify(afterDelivery.revenue));

  if (afterDelivery.revenue.commission <= 0) {
    throw new Error(
      'No revenue was recognised at delivery, so every "revenue did not move" check below ' +
        'would compare zero with zero and pass regardless.'
    );
  }

  // ----------------------------------------------------------------
  console.log('\n-- Location 2: the rider hands it over at the office');

  const returned = await api('/admin/cash/returns', {
    method: 'POST',
    body: { riderId, amount: Math.round((afterDelivery.riderCash / 100) * 100) / 100 }
  }, admin.token);

  check('An administrator can record a cash return with nothing declared in the app',
    returned.status === 200,
    `status ${returned.status}: ${JSON.stringify(returned.json).slice(0, 250)}`);

  const afterReturn = {
    total: totalAcrossAllAccounts(),
    revenue: revenueSnapshot(),
    riderCash: cashInHandPaise(riderId),
    office: officeCashPaise(),
    bank: ledger.balanceOf('PLATFORM_BANK')
  };

  check('The rider is no longer carrying it', afterReturn.riderCash === 0,
    formatPaise(afterReturn.riderCash));
  check('THE OFFICE IS NOW HOLDING IT', afterReturn.office === afterDelivery.riderCash,
    `office ${formatPaise(afterReturn.office)}, expected ${formatPaise(afterDelivery.riderCash)}`);
  check('and it is NOT in the bank, because nobody has been to the bank',
    afterReturn.bank === afterDelivery.bank,
    `bank moved from ${formatPaise(afterDelivery.bank)} to ${formatPaise(afterReturn.bank)}`);

  /*
   * The double-count check. If anybody implements "added to our total earning"
   * literally, this is the line that fails.
   */
  check('REVENUE DID NOT MOVE WHEN THE CASH CAME IN — commission',
    afterReturn.revenue.commission === afterDelivery.revenue.commission,
    `${afterDelivery.revenue.commission} became ${afterReturn.revenue.commission}`);
  check('REVENUE DID NOT MOVE WHEN THE CASH CAME IN — fees',
    afterReturn.revenue.fees === afterDelivery.revenue.fees,
    `${afterDelivery.revenue.fees} became ${afterReturn.revenue.fees}`);
  check('and nothing was created or destroyed', afterReturn.total === afterDelivery.total,
    `total ${afterDelivery.total} became ${afterReturn.total}`);

  // ----------------------------------------------------------------
  console.log('\n-- The office cannot hand over what it does not have');

  const tooMuch = await api('/admin/cash/bank-deposits', {
    method: 'POST',
    body: { amount: (afterReturn.office / 100) + 5000, reference: 'SLIP-TOO-BIG' }
  }, admin.token);
  check('Banking more than the office holds is refused', tooMuch.status >= 400,
    `status ${tooMuch.status}`);
  check('and the refusal names what is actually there',
    JSON.stringify(tooMuch.json).includes(formatPaise(afterReturn.office)),
    JSON.stringify(tooMuch.json).slice(0, 220));

  const noSlip = await api('/admin/cash/bank-deposits', {
    method: 'POST',
    body: { amount: 1, reference: '   ' }
  }, admin.token);
  check('and a deposit with no slip reference is refused', noSlip.status >= 400,
    `status ${noSlip.status}`);

  // ----------------------------------------------------------------
  console.log('\n-- Location 3: somebody walks it to the bank');

  const banked = await api('/admin/cash/bank-deposits', {
    method: 'POST',
    body: { amount: afterReturn.office / 100, reference: 'SLIP-00417', depositedOn: '2026-09-23' }
  }, admin.token);
  check('The office cash is banked', banked.status === 200,
    `status ${banked.status}: ${JSON.stringify(banked.json).slice(0, 250)}`);

  const afterBank = {
    total: totalAcrossAllAccounts(),
    revenue: revenueSnapshot(),
    office: officeCashPaise(),
    bank: ledger.balanceOf('PLATFORM_BANK')
  };

  check('THE OFFICE IS EMPTY', afterBank.office === 0, formatPaise(afterBank.office));
  check('AND THE BANK HAS IT', afterBank.bank === afterDelivery.bank + afterDelivery.riderCash,
    `bank ${formatPaise(afterBank.bank)}, expected ${formatPaise(afterDelivery.bank + afterDelivery.riderCash)}`);
  check('Revenue STILL has not moved — commission',
    afterBank.revenue.commission === afterDelivery.revenue.commission,
    `${afterDelivery.revenue.commission} became ${afterBank.revenue.commission}`);
  check('Revenue STILL has not moved — fees',
    afterBank.revenue.fees === afterDelivery.revenue.fees,
    `${afterDelivery.revenue.fees} became ${afterBank.revenue.fees}`);
  check('and still nothing was created or destroyed', afterBank.total === afterDelivery.total,
    `total ${afterDelivery.total} became ${afterBank.total}`);

  // The same slip twice is the same deposit. Without this a double-tap banks
  // the money twice and the bank balance is wrong in our favour, which is the
  // direction nobody goes looking.
  const again = await api('/admin/cash/bank-deposits', {
    method: 'POST',
    body: { amount: 1, reference: 'SLIP-00417' }
  }, admin.token);
  check('The same slip number does not bank the money twice',
    ledger.balanceOf('PLATFORM_BANK') === afterBank.bank,
    `status ${again.status}, bank is now ${formatPaise(ledger.balanceOf('PLATFORM_BANK'))}`);

  // ----------------------------------------------------------------
  console.log('\n-- A rider cannot return more than they are carrying');

  const overReturn = await api('/admin/cash/returns', {
    method: 'POST',
    body: { riderId, amount: 6000 }
  }, admin.token);
  check('Returning more than they hold is refused', overReturn.status >= 400,
    `status ${overReturn.status}`);
  check('and the refusal says what they are actually carrying',
    JSON.stringify(overReturn.json).toLowerCase().includes('carrying'),
    JSON.stringify(overReturn.json).slice(0, 220));
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
