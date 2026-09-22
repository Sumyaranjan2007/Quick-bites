/**
 * CAN AN ORDER GET STUCK?
 *
 * Every other suite asks whether a particular journey works. This one asks
 * whether any journey can DEAD-END - an order that cannot be finished, cannot
 * be cancelled, and sits on a kitchen screen and a customer's phone forever
 * with nobody able to do anything about it.
 *
 * That is not a hypothetical failure here. It is what the owner reported: a
 * rider accepting an order made the kitchen's remaining steps unreachable, and
 * the order stopped. Nothing crashed, nothing was logged, and the only symptom
 * was buttons that did nothing.
 *
 * Two kinds of check, and they catch different things.
 *
 * Part 1 is structural, over the transition table itself. It asks the question
 * for EVERY status rather than for the ones somebody thought to write a
 * journey for, and it keeps asking as statuses are added. A journey test can
 * only ever cover the paths its author imagined; this covers the graph.
 *
 * Part 2 drives the real thing over HTTP, with separate logins per portal,
 * because a transition table that is perfect proves nothing about whether the
 * routes, the guards and the data each portal receives agree with it.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { VALID_TRANSITIONS } from '../modules/orders/orderStateMachine.ts';
import type { OrderStatus } from '@quick-bites/shared-types';
import { memoryStore as memoryStoreRef } from '../db/client.ts';

const PORT = 5191;
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
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email: string, password = 'pass123') {
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { token: json.data.token as string, user: json.data.user };
}

/** Where an order can never move again, and that is correct. */
const TERMINAL: OrderStatus[] = ['REFUNDED'];
/** Where an order has legitimately finished, from a customer's point of view. */
const SETTLED: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

function reachableFrom(start: OrderStatus): Set<OrderStatus> {
  const seen = new Set<OrderStatus>([start]);
  const queue: OrderStatus[] = [start];
  while (queue.length) {
    for (const next of VALID_TRANSITIONS[queue.shift()!] || []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

async function run() {
  console.log('====================================================');
  console.log('   ORDER FLOW - CAN ANYTHING GET STUCK?             ');
  console.log('====================================================\n');

  // ==================================================================
  console.log('-- Part 1: the transition graph itself');

  const all = Object.keys(VALID_TRANSITIONS) as OrderStatus[];

  /*
   * EVERY STATUS MUST BE ABLE TO FINISH.
   *
   * This is the check that would have caught the reported bug at the table
   * rather than on a phone. It asks it of every status, including ones added
   * later by somebody who has never read this file.
   */
  for (const status of all) {
    if (TERMINAL.includes(status)) continue;
    const reach = reachableFrom(status);
    const canSettle = SETTLED.some(s => s !== status && reach.has(s));
    check(
      `An order at ${status} can still reach a finished state`,
      canSettle,
      `only reaches ${[...reach].join(', ')}`
    );
  }

  /*
   * And every status must be reachable from the beginning, or it is a status
   * that exists in the type, is handled in the apps, and can never occur -
   * which is how dead branches accumulate, and how a real branch eventually
   * gets deleted by somebody who believes it is one.
   */
  const fromStart = reachableFrom('PAYMENT_PENDING');
  for (const status of all) {
    check(
      `${status} is reachable from a new order`,
      fromStart.has(status),
      'unreachable: nothing can ever put an order in this state'
    );
  }

  /*
   * Cancellation has to stay available right up to the doorstep. An order that
   * cannot be cancelled is one a support agent cannot rescue, and every one of
   * those becomes a refund argument instead.
   */
  for (const status of all) {
    if (SETTLED.includes(status)) continue;
    check(
      `An order at ${status} can be cancelled`,
      (VALID_TRANSITIONS[status] || []).includes('CANCELLED')
    );
  }

  /*
   * The rider's track is deliberately NOT in this table, and that is the fix.
   * If a rider stage ever appears here, the two tracks have been merged again
   * and the reported bug is back.
   */
  const RIDER_ONLY_STAGES = [
    'UNASSIGNED',
    'OFFERED',
    'HEADING_TO_RESTAURANT',
    'AT_RESTAURANT',
    'PICKED_UP',
    'AT_DOORSTEP'
  ];
  const merged = all.filter(s => RIDER_ONLY_STAGES.includes(s as string));
  check('No rider stage has crept back into the food transitions', merged.length === 0,
    `found ${merged.join(', ')}`);

  // ==================================================================
  console.log('\n-- Part 2: the real flow, over HTTP, every portal');

  await seedDatabase();
  const server = createApp().listen(PORT, '127.0.0.1');
  await new Promise(r => setTimeout(r, 400));

  try {
    const customer = await login('customer@quickbite.app');
    const partner = await login('partner@quickbite.app');
    const rider = await login('rider@quickbite.app');
    const admin = await login('admin@quickbite.app');

    const feed = await api('/restaurants?latitude=12.6802&longitude=77.4734', {}, customer.token);
    const restaurant = feed.json?.data?.restaurants?.[0];
    check('A customer can see a restaurant to order from', !!restaurant,
      JSON.stringify(feed.json).slice(0, 160));
    if (!restaurant) throw new Error('no restaurant in the feed');

    const menu = await api(`/restaurants/${restaurant.id}/menu`, {}, customer.token);
    const dish = (menu.json?.data?.menu?.categories || [])
      .flatMap((c: any) => c.items || [])
      .find((i: any) => i.isAvailable !== false);
    check('and a dish on it that is in stock', !!dish);

    const addresses = await api('/addresses', {}, customer.token);
    const address = addresses.json?.data?.addresses?.[0];
    check('and an address to send it to', !!address);
    if (!dish || !address) throw new Error('missing dish or address');

    let lastPlaceResponse: any = null;
    async function place(key: string) {
      const r = await api('/orders', {
        method: 'POST',
        body: {
          restaurantId: restaurant.id,
          deliveryAddressId: address.id,
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: key,
          items: [{ dishId: dish.id, quantity: 1 }]
        }
      }, customer.token);
      lastPlaceResponse = r;
      return r.json?.data?.order;
    }

    const first = await place(`flow-happy-${Date.now()}`);
    check('The order is placed', !!first?.id,
      `status ${lastPlaceResponse?.status} ${JSON.stringify(lastPlaceResponse?.json).slice(0, 300)}`);
    if (!first?.id) throw new Error('order was not created');
    const orderId = first.id;
    const doorstepOtp = first.deliveryOtp;

    const statusOf = async (id = orderId) =>
      (await api(`/orders/${id}`, {}, customer.token)).json?.data?.order?.status;

    const partnerView = async (id: string) => {
      const r = await api(`/restaurants/${restaurant.id}/orders`, {}, partner.token);
      return (r.json?.data?.orders || []).find((o: any) => o.id === id);
    };

    /*
     * THE KITCHEN'S FOUR TAPS, each checked for having actually happened.
     *
     * Asserting the response status alone is not enough: a route that accepts
     * the request and changes nothing returns 200 just as happily.
     */
    for (const [label, next] of [
      ['Accept', 'ACCEPTED'],
      ['Start preparing', 'PREPARING'],
      ['Ready', 'READY_FOR_PICKUP']
    ] as const) {
      const r = await api(`/orders/${orderId}/status`, {
        method: 'PUT',
        body: { status: next, preparationMinutes: 20 }
      }, partner.token);
      check(`Kitchen tap "${label}" is accepted`, r.status === 200,
        `status ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
      const now = await statusOf();
      check(`...and the order really moved to ${next}`, now === next, `got ${now}`);
    }

    /*
     * THE RIDER CLAIMS WHILE THE FOOD IS READY, AND THE FOOD MUST NOT MOVE.
     *
     * The reported bug, asked of the running system rather than of the table.
     * The status is captured as a string first: comparing a later fetch to a
     * repository handle compares an object with itself and passes against any
     * mutation at all.
     */
    // A rider has to be online to be offered anything. Without this the claim
    // is refused with RIDER_OFFLINE and every check after it fails for a
    // reason that has nothing to do with what is being tested.
    await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);

    const beforeClaim = String(await statusOf());
    const claim = await api(`/riders/orders/${orderId}/claim`, { method: 'POST', body: {} }, rider.token);
    check('A rider can claim the trip', claim.status === 200,
      `status ${claim.status} ${JSON.stringify(claim.json).slice(0, 200)}`);
    const afterClaim = await statusOf();
    check('and claiming does NOT move the food', afterClaim === beforeClaim,
      `was ${beforeClaim}, now ${afterClaim}`);

    /*
     * The kitchen's fourth tap is rendered from `riderName`, so if that field
     * did not reach the partner the button would be invisible and the
     * transition unreachable from the real app even though the route works.
     */
    const claimed = await partnerView(orderId);
    check('and the kitchen can see which rider is coming', !!claimed?.riderName,
      `riderName ${JSON.stringify(claimed?.riderName)}`);

    /*
     * THE SECOND TRACK HAS TO REACH THE CUSTOMER'S PHONE.
     *
     * The tracking screen renders the rider's line from `order.riderStage`.
     * Separating the tracks in the database achieves nothing if the customer's
     * own view of the order does not carry the rider's half - the ticks would
     * correctly stop claiming the food had left, and the customer would simply
     * be told nothing at all, which is a different bad screen rather than a
     * fix.
     */
    const customerView = async () =>
      (await api(`/orders/${orderId}`, {}, customer.token)).json?.data?.order;
    const claimedForCustomer = await customerView();
    check('and the customer is told where the RIDER is, separately from the food',
      claimedForCustomer?.riderStage === 'HEADING_TO_RESTAURANT',
      `riderStage ${JSON.stringify(claimedForCustomer?.riderStage)}`);
    check('...while their food ticks stay where the kitchen left them',
      claimedForCustomer?.status === beforeClaim,
      `status ${claimedForCustomer?.status}`);
    check('...and the doorstep code is still not in what the rider can read',
      !JSON.stringify(claimed || {}).includes(String(doorstepOtp)));

    const handed = await api(`/orders/${orderId}/status`, {
      method: 'PUT',
      body: { status: 'HANDED_TO_RIDER' }
    }, partner.token);
    check('Kitchen tap "Handed to rider" is accepted', handed.status === 200,
      `status ${handed.status} ${JSON.stringify(handed.json).slice(0, 160)}`);
    const afterHanded = await statusOf();
    check('...and the order really moved to HANDED_TO_RIDER', afterHanded === 'HANDED_TO_RIDER',
      `got ${afterHanded}`);

    const withCode = await partnerView(orderId);
    check('The kitchen has a pickup code to quote', typeof withCode?.pickupCode === 'string');

    const pickup = await api(`/riders/orders/${orderId}/verify-pickup`, {
      method: 'POST',
      body: { pickupCode: withCode?.pickupCode }
    }, rider.token);
    check('The rider confirms collection', pickup.status === 200,
      `status ${pickup.status} ${JSON.stringify(pickup.json).slice(0, 200)}`);
    const afterPickup = await statusOf();
    check('...and the food is now out for delivery', afterPickup === 'OUT_FOR_DELIVERY',
      `got ${afterPickup}`);
    const carrying = await customerView();
    check('...and the customer sees the rider carrying it', carrying?.riderStage === 'PICKED_UP',
      `riderStage ${JSON.stringify(carrying?.riderStage)}`);

    const witnessOf = async (id: string) => {
      const r = await api(`/admin/orders/${id}`, {}, admin.token);
      return r.json?.data?.order?.handoverWitnessedBy ?? r.json?.data?.handoverWitnessedBy;
    };
    check('The handover is recorded as witnessed by both sides',
      (await witnessOf(orderId)) === 'BOTH', `got ${JSON.stringify(await witnessOf(orderId))}`);

    const delivered = await api(`/riders/orders/${orderId}/verify-otp`, {
      method: 'POST',
      body: { deliveryOtp: doorstepOtp }
    }, rider.token);
    check('The doorstep code completes the delivery', delivered.status === 200,
      `status ${delivered.status} ${JSON.stringify(delivered.json).slice(0, 200)}`);
    const finished = await statusOf();
    check('...and the order is finished', finished === 'DELIVERED', `got ${finished}`);

    /*
     * THE ESCAPE HATCH: the kitchen forgets the handover tap.
     *
     * The rider must still be able to collect - blocking would strand somebody
     * holding the food because a busy kitchen skipped a button that costs them
     * nothing to skip - and the record must say it was the rider's word alone.
     */
    console.log('\n-- When the kitchen forgets to tap "handed over"');

    const second = await place(`flow-forgot-${Date.now()}`);
    const forgotId = second?.id;
    if (!forgotId) throw new Error('second order was not created');

    for (const next of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) {
      await api(`/orders/${forgotId}/status`, {
        method: 'PUT',
        body: { status: next, preparationMinutes: 20 }
      }, partner.token);
    }
    await api(`/riders/orders/${forgotId}/claim`, { method: 'POST', body: {} }, rider.token);

    const forgotView = await partnerView(forgotId);
    const forgotPickup = await api(`/riders/orders/${forgotId}/verify-pickup`, {
      method: 'POST',
      body: { pickupCode: forgotView?.pickupCode }
    }, rider.token);
    check('A rider can still collect when the kitchen forgets the handover tap',
      forgotPickup.status === 200,
      `status ${forgotPickup.status} ${JSON.stringify(forgotPickup.json).slice(0, 200)}`);

    const forgotWitness = await witnessOf(forgotId);
    check('...and it is recorded as the rider word alone, not a mutual handover',
      forgotWitness === 'RIDER_ONLY', `got ${JSON.stringify(forgotWitness)}`);
    /*
     * ======================================================================
     * SUPPORT, END TO END.
     * ======================================================================
     *
     * A customer raising a complaint is a flow with four separate parties'
     * code in it - the customer's app, an authenticated route, a permissioned
     * admin route and the admin's screen - and every one of them can be
     * perfect while the flow is useless. The failure that matters is the
     * silent one: the ticket is stored, the customer is thanked, and nothing
     * ever reaches anybody who can act on it. Nothing errors, and the customer
     * waits for a reply that was never possible.
     *
     * So the checks follow the ticket rather than testing the endpoints: does
     * it appear where a human would look, does a reply come back to the person
     * who raised it, and does closing it close it on their side too.
     */
    console.log('\n-- Support: a complaint reaching a human and getting answered');

    /*
     * ======================================================================
     * ADMIN ATTENTION BADGES.
     * ======================================================================
     *
     * The navigation shows a count on each section so an administrator can see
     * where work is waiting WITHOUT opening every section to look. That only
     * works if the counts are real. A badge wired to a field the server never
     * sends reads as zero, which is indistinguishable from "nothing to do" -
     * the exact failure the badge exists to prevent, wearing a reassuring face.
     *
     * So every field the navigation reads is asserted present and numeric, and
     * one of them is then proved to MOVE when the underlying thing changes.
     * Presence alone would pass against a hardcoded zero.
     */
    console.log('\n-- Admin badges: counts that are real');

    const liveCounts = async () => (await api('/admin/live', {}, admin.token)).json?.data || {};
    const before = await liveCounts();

    const BADGE_FIELDS = [
      'liveOrders',
      'pendingKyc',
      'openRefunds',
      'openTickets',
      'openSos',
      'pendingProfileEdits',
      'pendingMenuRequests',
      'payeeAccountsAwaitingReview',
      'openPayoutRequests',
      'cashDepositsAwaitingConfirmation'
    ];
    const absent = BADGE_FIELDS.filter(f => typeof before[f] !== 'number');
    check('Every section the navigation badges has a real count', absent.length === 0,
      `missing or not numeric: ${absent.join(', ')}`);

    /*
     * NUMERIC IS NOT EVIDENCE, and this check exists because I learned that
     * the hard way on this very endpoint.
     *
     * Two of the three money counts were written against status values that
     * do not exist on their types - PENDING and REQUESTED on a payout request
     * whose states are OPEN | SEEN | SETTLED | DECLINED | WITHDRAWN. The
     * filter matched nothing, the count was structurally zero however many
     * people were waiting to be paid, and the assertion above passed happily,
     * because zero is a number.
     *
     * The only assertion that catches that is one where the count MOVES. So
     * each count now has to be proved against something that changes it,
     * rather than inspected once and pronounced present. Placing an order is
     * the cheapest of those, and it is checked here on an order this suite is
     * placing anyway.
     */
    const movedByAnOrder = await place(`flow-badge-${Date.now()}`);
    const afterOrder = await liveCounts();
    check('...and placing an order moves the live-orders badge',
      afterOrder.liveOrders === before.liveOrders + 1,
      `was ${before.liveOrders}, now ${afterOrder.liveOrders}`);
    check('...on an order that really exists', !!movedByAnOrder?.id);

    const raised = await api('/support/tickets', {
      method: 'POST',
      body: {
        subject: 'Order arrived cold',
        category: 'ORDER',
        message: 'The food was cold when it arrived and the seal was broken.',
        orderId
      }
    }, customer.token);
    check('A customer can raise a support ticket', raised.status === 201 || raised.status === 200,
      `status ${raised.status} ${JSON.stringify(raised.json).slice(0, 200)}`);
    const ticketId = raised.json?.data?.ticket?.id ?? raised.json?.data?.id;
    check('...and it comes back with an id they can be told', !!ticketId,
      JSON.stringify(raised.json).slice(0, 200));

    /*
     * The badge moved. This is the half that presence cannot prove: a count
     * hardcoded to zero, or read from the wrong collection, passes the check
     * above and never changes here.
     */
    const after = await liveCounts();
    check('...and raising a ticket moves the support badge',
      after.openTickets === afterOrder.openTickets + 1,
      `was ${afterOrder.openTickets}, now ${after.openTickets}`);

    // The check that matters: it reaches somebody who can act on it.
    const queue = await api('/admin/support/tickets', {}, admin.token);
    const inQueue = (queue.json?.data?.tickets || queue.json?.data || [])
      .find((t: any) => t.id === ticketId);
    check('...and it appears in the admin support queue', !!inQueue,
      `status ${queue.status} ${JSON.stringify(queue.json).slice(0, 200)}`);

    const replied = await api(`/admin/support/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: { body: 'We are sorry about that. A refund is on its way.' }
    }, admin.token);
    check('Support can reply to it', replied.status === 200 || replied.status === 201,
      `status ${replied.status} ${JSON.stringify(replied.json).slice(0, 200)}`);

    /*
     * A reply that the customer cannot read is the same as no reply. This is
     * the step most likely to be quietly missing, because the admin side looks
     * complete from the admin side.
     */
    const mine = await api('/support/tickets', {}, customer.token);
    const back = (mine.json?.data?.tickets || mine.json?.data || [])
      .find((t: any) => t.id === ticketId);
    const replyReachedCustomer = JSON.stringify(back || {}).includes('refund is on its way');
    check('...and the customer can read the reply', replyReachedCustomer,
      JSON.stringify(back || {}).slice(0, 300));

    /*
     * ======================================================================
     * DISPATCH: WHEN A RESTAURANT'S TRIPS ARE OFFERED.
     * ======================================================================
     *
     * The filter used to be hardcoded to offer everything from ACCEPTED
     * onwards, for every kitchen. Both halves are checked here, and the second
     * is the one that matters: a setting that is read but ignored, and a
     * setting that is not read at all, look identical from the default case.
     */
    console.log('\n-- Dispatch: riders are offered trips at the restaurant point');

    /*
     * THE RIDER MUST BE FREE FIRST, and this is not housekeeping.
     *
     * The rider is still carrying the previous order. A rider on a trip is
     * shown NO broadcasts at all - correctly - so every check below would have
     * passed against an empty list, including the one asserting an order is
     * not offered. Verified: written without this, "not offered by default"
     * passed and "offered once the restaurant asks" failed, which is the
     * signature of a list that is empty for an unrelated reason.
     */
    await api(`/riders/orders/${forgotId}/verify-otp`, {
      method: 'POST',
      body: { deliveryOtp: second?.deliveryOtp }
    }, rider.token);

    const riderSees = async (id: string) => {
      const r = await api('/riders/orders/broadcast', {}, rider.token);
      const body = r.json?.data || {};
      // Asserted rather than assumed. If the rider is busy or offline the list
      // is empty and every check reading it is meaningless.
      if (body.busy || body.offline) {
        throw new Error(`rider is not free: ${JSON.stringify(body)}`);
      }
      return (body.broadcasts || []).some((o: any) => o.id === id);
    };

    const cooking = await place(`flow-dispatch-${Date.now()}`);
    await api(`/orders/${cooking.id}/status`, {
      method: 'PUT', body: { status: 'ACCEPTED', preparationMinutes: 20 }
    }, partner.token);

    check('An order still being cooked is NOT offered by default',
      !(await riderSees(cooking.id)),
      'default is READY_FOR_PICKUP; offering earlier sends a rider to a kitchen that has not started');

    /*
     * The same order, the same rider, one setting changed. If this does not
     * flip, the setting is decoration.
     */
    const thisRestaurant: any = memoryStoreRef.restaurants.get(restaurant.id);
    thisRestaurant.riderOfferAtStatus = 'ACCEPTED';
    memoryStoreRef.restaurants.set(restaurant.id, thisRestaurant);

    check('...and IS offered once that restaurant asks for riders at ACCEPTED',
      await riderSees(cooking.id),
      'the per-restaurant setting is not being read');

    thisRestaurant.riderOfferAtStatus = 'READY_FOR_PICKUP';
    memoryStoreRef.restaurants.set(restaurant.id, thisRestaurant);
    check('...and stops being offered again when it is set back',
      !(await riderSees(cooking.id)));

    const closed = await api(`/admin/support/tickets/${ticketId}/status`, {
      method: 'POST',
      body: { status: 'RESOLVED' }
    }, admin.token);
    check('Support can resolve it', closed.status === 200,
      `status ${closed.status} ${JSON.stringify(closed.json).slice(0, 200)}`);

    const afterClose = await api('/support/tickets', {}, customer.token);
    const resolved = (afterClose.json?.data?.tickets || afterClose.json?.data || [])
      .find((t: any) => t.id === ticketId);
    check('...and the customer sees it resolved rather than still open',
      resolved?.status === 'RESOLVED', `got ${JSON.stringify(resolved?.status)}`);
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(failures === 0 ? '   NOTHING CAN GET STUCK' : `   ${failures} FLOW CHECK(S) FAILED`);
  console.log('====================================================\n');
  process.exit(failures > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[FAIL] Flow tests crashed:', err);
  process.exit(1);
});
