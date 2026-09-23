/**
 * Typing a customer's price on one dish, and the three totals that must never
 * converge.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS THE RISKIEST CHANGE IN THE SET
 * -------------------------------------------------------------------------
 * Before this there was one price per dish. Now there are three numbers:
 *
 *   1. what the customer is charged      -- the typed price
 *   2. what the restaurant is paid       -- partnerItemsTotal, their own price
 *   3. what the platform keeps           -- the difference
 *
 * Confusing any two of them is INVISIBLE, because the bill still adds up
 * whichever way round they go. A restaurant paid the customer's price loses the
 * platform its margin; a customer charged the restaurant's price does the same;
 * commission taken on the customer's total quietly overcharges the restaurant.
 * None of those produce an arithmetic error anywhere. They produce a partner
 * dispute weeks later.
 *
 * So every check here asserts a PAIR from the same order: what the customer
 * pays and what the restaurant is owed, together. Asserting either alone passes
 * in the exact cases worth catching.
 *
 * -------------------------------------------------------------------------
 * THE ADD-ON TRAP
 * -------------------------------------------------------------------------
 * Add-ons have no id of their own to look a price up by. Passing an add-ons
 * total through the dish's price resolution would find the dish's typed price
 * and return it -- so a Rs 50 slice of cheese on a dish typed at Rs 240 would be
 * charged Rs 240. The bill would add up. A customer would find it.
 *
 * A typed price is therefore converted to the ratio it implies and the ratio is
 * applied to the extras, which reproduces exactly what the percentage model
 * does. The check for it orders a dish WITH an add-on, because a check on the
 * dish line alone passes while the add-on is wrong -- they are separate terms in
 * the same expression.
 */
import assert from 'node:assert';
import { seedDatabase } from '../db/seed.ts';
import { createApp } from '../app.ts';
import { memoryStore } from '../db/client.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import {
  setCharges,
  setItemPrice,
  typedPriceFor,
  customerDishPrice,
  customerAddonsPrice,
  inflateMenuForCustomer
} from '../modules/payments/restaurantCharges.ts';

console.log('====================================================');
console.log('  PER-ITEM CUSTOMER PRICING                         ');
console.log('====================================================\n');

let failed = 0;
/**
 * Runs one check, and REFUSES an async body.
 *
 * This runner is synchronous. An `async` function handed to it returns a promise
 * that nothing awaits, so the check prints PASS immediately and any assertion
 * inside it can never fail. That happened here: the partner-leak check was
 * written async, passed, and went on passing when the leak was deliberately
 * introduced.
 *
 * Detected rather than documented, because a note saying "do not write these
 * async" is advisory and this is enforceable. Anything returning a thenable is a
 * FAILURE with a message saying why, not a silent pass.
 */
function check(label: string, fn: () => void) {
  try {
    const result: any = fn();
    if (result && typeof result.then === 'function') {
      failed++;
      console.error(
        `[FAIL] ${label}: this check is async, and this runner does not await. ` +
          'Its assertions could never fail. Do the awaiting outside and assert synchronously.'
      );
      return;
    }
    console.log(`[PASS] ${label}`);
  } catch (err: any) {
    failed++;
    console.error(`[FAIL] ${label}: ${err?.message || err}`);
  }
}

await seedDatabase();

const ADMIN = 'usr_admin_01';
const restaurantId = Array.from(memoryStore.restaurants.keys())[0] as string;
const menu = memoryStore.menus.get(restaurantId) as any;
const dish = menu.categories.flatMap((c: any) => c.items)[0];

// A known starting point: the kitchen's own price, and no markup of any kind.
dish.price = 200;
memoryStore.menus.set(restaurantId, menu);
setCharges(restaurantId, { foodMarkupPercent: 0, itemPrices: {} }, ADMIN, 'itemPricing suite baseline');

check('With nothing set, the customer pays the kitchen price', () => {
  assert.equal(typedPriceFor(restaurantId, dish.id), null);
  assert.equal(customerDishPrice(restaurantId, dish.id, 200), 200);
});

check('A restaurant percentage applies to a dish with no typed price', () => {
  setCharges(restaurantId, { foodMarkupPercent: 20 }, ADMIN, 'percentage only');
  assert.equal(customerDishPrice(restaurantId, dish.id, 200), 240, '20% on Rs 200');
  assert.equal(customerAddonsPrice(restaurantId, dish.id, 200, 50), 60, 'and on a Rs 50 extra');
});

check('A TYPED price beats the percentage', () => {
  setItemPrice({
    restaurantId,
    itemId: dish.id,
    restaurantPrice: 200,
    customerPrice: 260,
    actorUserId: ADMIN
  });
  assert.equal(customerDishPrice(restaurantId, dish.id, 200), 260, 'not the 240 the percentage gives');
  assert.equal(typedPriceFor(restaurantId, dish.id), 260);
});

/*
 * The trap. Rs 260 typed against a Rs 200 dish implies a ratio of 1.3, so a
 * Rs 50 extra costs Rs 65 -- NOT Rs 260, which is what returning the dish's
 * typed price for the add-ons would give.
 */
check('AN ADD-ON IS SCALED BY THE RATIO, NOT CHARGED THE DISH PRICE', () => {
  const addons = customerAddonsPrice(restaurantId, dish.id, 200, 50);
  assert.notEqual(addons, 260, 'the add-on was charged the whole dish price');
  assert.equal(addons, 65, 'Rs 50 at the 1.3 ratio Rs 200 -> Rs 260 implies');
});

check('A dish typed at its percentage matches the percentage where the numbers permit', () => {
  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: 240, actorUserId: ADMIN });
  const typedAddons = customerAddonsPrice(restaurantId, dish.id, 200, 50);

  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: null, actorUserId: ADMIN });
  const percentAddons = customerAddonsPrice(restaurantId, dish.id, 200, 50);

  assert.equal(typedAddons, percentAddons, 'Rs 200 at 20% is one of the cases that coincide exactly');
  assert.equal(typedAddons, 60);
});

/*
 * THE AWKWARD NUMBERS, chosen because the fixture above cannot reach this case.
 *
 * Rs 200 at 20% divides cleanly, so typed-at-the-percentage and the percentage
 * agree exactly -- and a suite built only on that number would assert continuity
 * while never testing it. That is the "fixture that cannot reach the case" shape.
 *
 * Rs 149 at 15% types as Rs 171, a ratio of 1.1477 rather than 1.15, so a Rs 37
 * extra is Rs 42 by the ratio and Rs 43 by the percentage. They DIFFER, and that
 * is correct: the typed price is the more specific instruction, and an
 * administrator who typed Rs 171 marked the dish up by 14.77%. The extras
 * following what was typed rather than a percentage that was overridden is the
 * intended behaviour.
 *
 * What is asserted instead is the thing that must hold: one rounding convention.
 */
check('Both paths return whole rupees, whatever the numbers', () => {
  const AWKWARD = 'dish_awkward_for_rounding';
  setCharges(restaurantId, { foodMarkupPercent: 15, itemPrices: {} }, ADMIN, 'awkward rounding case');

  const byPercentage = customerAddonsPrice(restaurantId, AWKWARD, 149, 37);
  assert.ok(Number.isInteger(byPercentage), `percentage path gave ${byPercentage}`);
  assert.equal(byPercentage, 43, '37 at 15% rounds to a whole rupee');

  setItemPrice({ restaurantId, itemId: AWKWARD, restaurantPrice: 149, customerPrice: 171, actorUserId: ADMIN });
  const byRatio = customerAddonsPrice(restaurantId, AWKWARD, 149, 37);

  // The assertion that failed before the rounding was unified: this returned
  // 42.46, so one dish produced a paise figure and the other whole rupees.
  assert.ok(Number.isInteger(byRatio), `ratio path gave ${byRatio}, which is not a whole rupee`);
  assert.equal(byRatio, 42, 'Rs 37 at the 1.1477 ratio Rs 149 -> Rs 171 actually implies');
});

check('The extras follow the markup that was TYPED, not the one configured', () => {
  /*
   * The property that makes the ratio right rather than merely workable, stated
   * as something checkable. A Rs 10 dish typed at Rs 11 has been marked up a
   * tenth whatever the restaurant percentage says, and its extras follow that.
   */
  const CHEAP = 'dish_cheap_for_ratio';
  setCharges(restaurantId, { foodMarkupPercent: 5, itemPrices: {} }, ADMIN, 'cheap dish ratio case');
  setItemPrice({ restaurantId, itemId: CHEAP, restaurantPrice: 10, customerPrice: 11, actorUserId: ADMIN });

  const extras = customerAddonsPrice(restaurantId, CHEAP, 10, 100);
  assert.equal(extras, 110, 'Rs 100 of extras at the tenth the typed price implies');
  assert.notEqual(extras, 105, 'the extras followed the 5% the typed price overrode');
});

check('A free dish with a typed price cannot produce NaN', () => {
  /*
   * The guarded division. A zero-priced dish gives Infinity or NaN, and NaN
   * travels through a bill in silence until it reaches a screen as a blank.
   */
  // Owns its own percentage, because the checks above it change theirs.
  setCharges(restaurantId, { foodMarkupPercent: 20 }, ADMIN, 'NaN guard case');
  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 0, customerPrice: 30, actorUserId: ADMIN });
  const addons = customerAddonsPrice(restaurantId, dish.id, 0, 50);
  assert.ok(Number.isFinite(addons), `add-ons came back as ${addons}`);
  assert.equal(addons, 60, 'it falls back to the 20% percentage, which is defined for it');
});

check('A customer price below the kitchen price is refused, naming both', () => {
  let message = '';
  try {
    setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: 150, actorUserId: ADMIN });
  } catch (err: any) {
    message = err?.message || '';
  }
  assert.ok(message.includes('200'), `the refusal did not name the kitchen price: ${message}`);
  assert.ok(message.includes('150'), `the refusal did not name the typed price: ${message}`);
  assert.ok(message.includes('50'), 'the refusal did not say what it would cost per order');
});

check('Clearing a typed price falls back to the percentage', () => {
  setCharges(restaurantId, { foodMarkupPercent: 20 }, ADMIN, 'clearing case');
  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: 300, actorUserId: ADMIN });
  assert.equal(customerDishPrice(restaurantId, dish.id, 200), 300);

  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: null, actorUserId: ADMIN });
  assert.equal(typedPriceFor(restaurantId, dish.id), null, 'the price was not cleared');
  assert.equal(customerDishPrice(restaurantId, dish.id, 200), 240, 'and 20% applies again');
});

check('The customer MENU shows the typed price, not the percentage one', () => {
  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: 260, actorUserId: ADMIN });
  const shown: any = inflateMenuForCustomer(memoryStore.menus.get(restaurantId), restaurantId);
  const shownDish = shown.categories.flatMap((c: any) => c.items).find((i: any) => i.id === dish.id);

  assert.equal(shownDish.price, 260, 'the menu and the checkout would have disagreed');
  assert.equal(shownDish.partnerPrice, 200, 'and the kitchen price is still recorded beside it');
});

check('and it still does when the restaurant percentage is ZERO', () => {
  /*
   * The short-circuit that used to sit at the top of inflateMenuForCustomer
   * returned the menu untouched on a 0% markup. Correct while a percentage was
   * the only markup; with typed prices it would show the kitchen's raw price on
   * the menu and charge the typed one at the till -- one total on the cart
   * screen and another at the end, which is the complaint this feature is most
   * likely to produce.
   */
  setCharges(restaurantId, { foodMarkupPercent: 0 }, ADMIN, 'percentage off, typed price still set');
  const shown: any = inflateMenuForCustomer(memoryStore.menus.get(restaurantId), restaurantId);
  const shownDish = shown.categories.flatMap((c: any) => c.items).find((i: any) => i.id === dish.id);
  assert.equal(shownDish.price, 260, 'a zero percentage hid the typed price from the menu');
});

/* ------------------------------------------------------------------ *
 *  THE THREE TOTALS, THROUGH A REAL ORDER                              *
 * ------------------------------------------------------------------ */

/*
 * Everything above tests the resolution functions. None of it proves that
 * COMMISSION is taken on the restaurant's total rather than the customer's --
 * and that is the one that quietly overcharges a partner on every order, with a
 * bill that adds up perfectly at both ends.
 *
 * So this places a real order through the assembled app and asserts all three
 * numbers from it, worked out by hand:
 *
 *   dish        Rs 320 at the kitchen, typed to Rs 400   -> ratio 1.25
 *   add-ons     Rs 150 + Rs 30 = Rs 180, at 1.25         -> Rs 225
 *   customer    400 + 225                                -> Rs 625
 *   restaurant  320 + 180                                -> Rs 500
 *   ours        625 - 500                                -> Rs 125
 *   commission  18% of 500 = Rs 90, NOT 18% of 625 = Rs 112.50
 *
 * That last line is the assertion worth the whole file. The wrong version
 * overcharges the restaurant Rs 22.50 on this one order and nothing anywhere
 * reports an error.
 */
const PORT = 5221;
const API = `http://127.0.0.1:${PORT}/api`;

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

const BIRYANI_RESTAURANT = 'rst_bbh_01';
const BIRYANI = 'dish_ck_biryani';

const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));

try {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const token = login.json?.data?.token;

  /*
   * This section sets up its own world from scratch, including the dish price.
   *
   * The unit checks above take the FIRST restaurant and its FIRST dish and
   * rewrite that dish to Rs 200 -- and on the seeded data that dish is this
   * biryani. So the order below priced a Rs 200 dish against Rs 320
   * expectations and four checks failed while the code was entirely correct.
   *
   * The lesson is not "reset state"; it is that a check asserting exact rupees
   * must OWN every number it depends on. Anything inherited from a fixture is a
   * number somebody else can change.
   */
  const biryaniMenu = memoryStore.menus.get(BIRYANI_RESTAURANT) as any;
  const biryani = biryaniMenu.categories
    .flatMap((c: any) => c.items)
    .find((i: any) => i.id === BIRYANI);
  biryani.price = 320;
  memoryStore.menus.set(BIRYANI_RESTAURANT, biryaniMenu);

  check('The dish this section prices costs Rs 320 at the kitchen', () => {
    assert.equal(biryani.price, 320, 'every figure below is derived from this one');
  });

  setCharges(
    BIRYANI_RESTAURANT,
    { foodMarkupPercent: 0, commissionPercent: 18, itemPrices: {} },
    ADMIN,
    'three-totals check'
  );
  setItemPrice({
    restaurantId: BIRYANI_RESTAURANT,
    itemId: BIRYANI,
    restaurantPrice: 320,
    customerPrice: 400,
    actorUserId: ADMIN
  });

  const addresses = await api('/addresses', {}, token);
  const addressId = addresses.json?.data?.addresses?.[0]?.id;

  const placed = await api('/orders', {
    method: 'POST',
    body: {
      restaurantId: BIRYANI_RESTAURANT,
      deliveryAddressId: addressId,
      paymentMethod: 'CASH_ON_DELIVERY',
      idempotencyKey: `item-pricing-${Date.now()}`,
      items: [
        {
          dishId: BIRYANI,
          quantity: 1,
          selectedOptions: [
            { groupId: 'grp_portion', optionId: 'opt_large' },
            { groupId: 'grp_extras', optionId: 'opt_extra_raita' }
          ]
        }
      ]
    }
  }, token);

  const bill = placed.json?.data?.order?.bill;

  check('The order is placed', () => {
    assert.ok(bill, `status ${placed.status}: ${JSON.stringify(placed.json).slice(0, 250)}`);
  });

  check('THE CUSTOMER IS CHARGED THE TYPED PRICES', () => {
    assert.equal(bill.itemsTotal, 625, 'Rs 400 typed plus Rs 225 of extras at the implied ratio');
  });

  check('THE RESTAURANT IS OWED ITS OWN PRICES', () => {
    assert.equal(bill.partnerItemsTotal, 500, 'Rs 320 plus Rs 180 of extras, unmarked');
  });

  check('and the two are NOT the same number', () => {
    // The check that fails if anything collapses the customer total into the
    // partner total, in either direction.
    assert.notEqual(bill.itemsTotal, bill.partnerItemsTotal);
    assert.equal(bill.itemsTotal - bill.partnerItemsTotal, 125, 'what the platform keeps');
  });

  check('COMMISSION IS TAKEN ON THE RESTAURANT TOTAL, NOT THE CUSTOMER TOTAL', () => {
    assert.equal(bill.commissionPercent, 18);
    assert.equal(bill.commissionAmount, 90, '18% of Rs 500 -- 18% of Rs 625 would be Rs 112.50');
  });

  check('and the settlement is computed from the restaurant total', () => {
    // net = partnerItemsTotal - commission - TDS + partnerPackagingFee. Whatever
    // the other terms are, it must never be derived from the customer's total.
    assert.ok(
      bill.restaurantNetPayout < bill.partnerItemsTotal,
      `net ${bill.restaurantNetPayout} should be below the Rs 500 owed before deductions`
    );
    assert.ok(
      bill.restaurantNetPayout < bill.itemsTotal - 100,
      `net ${bill.restaurantNetPayout} looks derived from the customer total`
    );
  });
/* ------------------------------------------------------------------ *
 *  A PRICE CHANGE AND ITS MARKUP ARE ONE DECISION                      *
 * ------------------------------------------------------------------ */

/*
 * A partner cannot reprice a dish on their own -- the app posts a request into
 * the approval queue. So the kitchen's new price and the customer's price on top
 * of it are decided together, once, by the person already being asked to approve
 * the change.
 *
 * The failure this prevents: the new price goes live and the typed customer
 * price is cleared, so the platform's markup on that dish silently becomes
 * whatever the restaurant percentage happens to be -- or nothing. The dish keeps
 * selling. Nothing reports an error.
 *
 * BULK APPROVAL IS THE DANGEROUS ONE. One tap can approve twelve price changes,
 * and twelve silent margin losses look exactly like twelve successful
 * approvals. So the default is applied automatically AND reported.
 */

async function adminToken() {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email: 'admin@quickbite.app', password: 'pass123' }
  });
  return res.json?.data?.token as string;
}

async function partnerToken() {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email: 'partner@quickbite.app', password: 'pass123' }
  });
  return res.json?.data?.token as string;
}

{
  const admin = await adminToken();
  const partner = await partnerToken();

  const partnerRestaurant = Array.from(memoryStore.restaurants.values() as any).find(
    (r: any) => r.ownerId === 'usr_partner_01'
  ) as any;

  check('There is a partner-owned restaurant to reprice', () => {
    assert.ok(partnerRestaurant, 'no restaurant belongs to the seeded partner');
  });

  const rid = partnerRestaurant.id;
  const theirMenu = memoryStore.menus.get(rid) as any;
  const theirDish = theirMenu.categories.flatMap((c: any) => c.items)[0];

  // This section owns every number it asserts.
  theirDish.price = 200;
  memoryStore.menus.set(rid, theirMenu);
  setCharges(rid, { foodMarkupPercent: 0, itemPrices: {} }, ADMIN, 'approval section baseline');
  setItemPrice({
    restaurantId: rid,
    itemId: theirDish.id,
    restaurantPrice: 200,
    customerPrice: 240,
    actorUserId: ADMIN
  });

  check('The dish starts at Rs 200 with a Rs 240 customer price', () => {
    assert.equal(theirDish.price, 200);
    assert.equal(typedPriceFor(rid, theirDish.id), 240, 'Rs 40 of margin stands on it');
  });

  /* ---------------- the partner asks for Rs 260 ---------------- */

  const requested = await api(`/restaurants/${rid}/menu/requests`, {
    method: 'POST',
    // Flat, not wrapped: the route destructures kind and dishId and treats the
    // REST of the body as the payload. Read from the route rather than guessed,
    // after the first version guessed a `payload` wrapper and got a 400.
    body: {
      kind: 'EDIT_ITEM',
      dishId: theirDish.id,
      name: theirDish.name,
      price: 260,
      isVeg: Boolean(theirDish.isVeg),
      categoryName: theirMenu.categories[0].name
    }
  }, partner);

  const requestId = requested.json?.data?.request?.id;
  check('A partner can ask to change a price', () => {
    assert.ok(requestId, `status ${requested.status}: ${JSON.stringify(requested.json).slice(0, 250)}`);
  });

  check('and asking alone changes NOTHING the customer pays', () => {
    assert.equal(
      (memoryStore.menus.get(rid) as any).categories.flatMap((c: any) => c.items)
        .find((i: any) => i.id === theirDish.id).price,
      200,
      'a request wrote straight to the live menu'
    );
    assert.equal(typedPriceFor(rid, theirDish.id), 240);
  });

  /* ---------------- approval, with no price named ---------------- */

  const approved = await api(`/admin/menu-requests/${requestId}/review`, {
    method: 'POST',
    body: { action: 'APPROVE' }
  }, admin);

  check('An administrator approves it', () => {
    assert.equal(approved.status, 200, JSON.stringify(approved.json).slice(0, 250));
  });

  check('THE MARGIN IS HELD WITHOUT BEING ASKED FOR', () => {
    // Rs 40 stood on the old price, so Rs 260 becomes Rs 300 -- not Rs 260 with
    // the markup lost, and not Rs 240 which is now below what we pay out.
    assert.equal(typedPriceFor(rid, theirDish.id), 300, 'the Rs 40 margin did not survive approval');
  });

  check('and the response SAYS it did, rather than doing it silently', () => {
    const held = approved.json?.data?.markupHeld;
    assert.ok(held, 'nothing in the response mentions the customer price');
    assert.equal(held.chosenBy, 'MARGIN_DEFAULT');
    assert.equal(held.customerPrice, 300);
    assert.equal(held.marginRupees, 40, 'the margin kept is stated in rupees');
    assert.equal(held.alternatives.percent, 312, '20% of Rs 260 offered as the other reading');
  });

  check('The erosion is stated, so a margin cannot drift away unseen', () => {
    /*
     * Holding Rs 40 is the right default and it erodes: 20% of Rs 200 is 15.38%
     * of Rs 260, and 11.76% by the time the dish reaches Rs 340. It erodes
     * fastest exactly when costs rise fastest. Nothing reports that unless the
     * approval says it, so the approval says it.
     */
    const held = approved.json?.data?.markupHeld;
    assert.equal(held.alternatives.keptPercent, 20, 'what was kept before, as a percentage');
    assert.equal(held.alternatives.rupeeKeepsPercent, 15.38, 'and what holding the rupees leaves');
    assert.ok(
      held.alternatives.rupeeKeepsPercent < held.alternatives.keptPercent,
      'the screen has nothing to warn with'
    );
  });

  /*
   * THE BOUNDARY, not a value. Raised in review, and it is the one place §11.3
   * would stop holding.
   *
   * The partner's own request history returns the raw records with no
   * projection. Today they carry nothing about our markup. The day anybody
   * widens the record to remember what an administrator set at approval -- a
   * natural thing to want for an audit trail -- our markup reaches the partner
   * immediately and nothing fails.
   *
   * A comment would not hold that. This does: it serialises what the partner is
   * actually sent and fails on the day a customer-price field appears in it.
   * Checking the JSON rather than the screen, because a field the screen does
   * not render is still a field the partner can read.
   */
  // Fetched OUT HERE. The runner above is synchronous, so an async check body
  // would print PASS without ever evaluating what is below it.
  const partnerHistory = await api(`/restaurants/${rid}/menu/requests`, {}, partner);

  check('THE PARTNER IS NEVER SENT OUR MARKUP', () => {
    assert.equal(partnerHistory.status, 200, `status ${partnerHistory.status}`);

    const serialised = JSON.stringify(partnerHistory.json);
    for (const leak of ['customerPrice', 'itemPrices', 'typedPrice', 'markup', 'margin', 'keptRupees']) {
      assert.ok(
        !serialised.includes(leak),
        `the partner's request history now carries "${leak}" -- our markup is derivable from it`
      );
    }

    // And the figure itself, in case a field is ever named something else.
    assert.ok(!serialised.includes('300'), 'the customer price Rs 300 appears in a partner response');
  });

  check('The customer never pays less than the kitchen is paid', () => {
    const typed = typedPriceFor(rid, theirDish.id)!;
    const live = (memoryStore.menus.get(rid) as any).categories.flatMap((c: any) => c.items)
      .find((i: any) => i.id === theirDish.id);
    assert.equal(live.price, 260, 'the approval did not write the new kitchen price');
    assert.ok(typed >= live.price, `customer ${typed} is below kitchen ${live.price}`);
  });

  /* ---------------- a direct write, with no approval ---------------- */

  check('A price written around the approval queue CLEARS the stale markup', () => {
    /*
     * The backstop. A typed price is absolute, so a kitchen going to Rs 400
     * against a typed Rs 300 would have the platform paying out more than it
     * collects on every order. Losing the markup is recoverable by typing it
     * again; paying more than you charge is not.
     */
    assert.equal(typedPriceFor(rid, theirDish.id), 300);
    menuRepository.updateItem(rid, theirDish.id, { price: 400 } as any);
    assert.equal(typedPriceFor(rid, theirDish.id), null, 'a Rs 300 customer price survived a Rs 400 cost');
  });

  check('but a rename does not touch the markup', () => {
    /*
     * Updates are partial, so a rename carries no price at all. Reacting to the
     * field being absent rather than comparing values would have cost the
     * platform its margin every time somebody fixed a typo.
     */
    setItemPrice({ restaurantId: rid, itemId: theirDish.id, restaurantPrice: 400, customerPrice: 460, actorUserId: ADMIN });
    menuRepository.updateItem(rid, theirDish.id, { description: 'Now with a longer description' } as any);
    assert.equal(typedPriceFor(rid, theirDish.id), 460, 'editing the description cleared the markup');
  });

  check('and neither does re-writing the SAME price', () => {
    menuRepository.updateItem(rid, theirDish.id, { price: 400 } as any);
    assert.equal(typedPriceFor(rid, theirDish.id), 460, 'an unchanged price was treated as a change');
  });
}

} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
