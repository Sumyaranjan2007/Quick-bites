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
function check(label: string, fn: () => void) {
  try {
    fn();
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

check('A dish typed at exactly its percentage behaves like the percentage', () => {
  // The continuity argument, asserted rather than claimed: this is what makes
  // the ratio the right shape instead of merely a workable one.
  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: 240, actorUserId: ADMIN });
  const typedAddons = customerAddonsPrice(restaurantId, dish.id, 200, 50);

  setItemPrice({ restaurantId, itemId: dish.id, restaurantPrice: 200, customerPrice: null, actorUserId: ADMIN });
  const percentAddons = customerAddonsPrice(restaurantId, dish.id, 200, 50);

  assert.equal(typedAddons, percentAddons, 'typed-at-20% and 20% must produce the same extras');
  assert.equal(typedAddons, 60);
});

check('A free dish with a typed price cannot produce NaN', () => {
  /*
   * The guarded division. A zero-priced dish gives Infinity or NaN, and NaN
   * travels through a bill in silence until it reaches a screen as a blank.
   */
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
} finally {
  server.close();
}

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
