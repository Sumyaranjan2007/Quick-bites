/**
 * The choices on a dish, seen from the customer's side: quote and checkout agree.
 *
 * dishOptions.test.ts proves the rules in `resolveDishOptions`. This suite proves
 * the ROUTES apply them, and apply them identically: every basket goes to BOTH
 * /orders/quote and /orders, and each refusal must come back with the same code
 * from both, with no order created. A cart that promises a basket checkout then
 * refuses is its own defect.
 *
 * Three things it holds in particular:
 *
 *   - The free-large exploit. A large portion (+150) with a negative option named
 *     eight times used to net the add-ons below zero, which the customer's price
 *     reads as nothing while the kitchen's share subtracted the raw figure.
 *     Repeats are refused, and a single negative option counts as zero on BOTH
 *     sides, so the customer and the kitchen are priced from the same number.
 *
 *   - A required choice left empty takes the cheapest, because the customer app
 *     on phones from 23 Sep shows only one group. That is only honest if the
 *     choice is SHOWN: on the quote, before paying, and on the order item, where
 *     the kitchen ticket and the bill read it.
 *
 *   - Nothing the dish does not offer gets through.
 *
 * Run: node --experimental-strip-types src/test/optionGroups.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5271;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const BIRYANI = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';

console.log('====================================================');
console.log('  EVERY CHOICE ON A DISH IS ONE THE DISH OFFERS     ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 600)}`);
  }
}

async function api(pathname: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const code = (r: { json: any }) => r.json?.error?.code ?? r.json?.code;
const messageOf = (r: { json: any }) => String(r.json?.error?.message ?? r.json?.message ?? '');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (payload: any) => ({ ...payload, sentAt: new Date().toISOString() });

const PORTION = (optionId: string) => ({ groupId: 'grp_portion', optionId });
const EXTRA = (optionId: string) => ({ groupId: 'grp_extras', optionId });

try {
  const { json: loginJson } = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const token = loginJson?.data?.token as string;

  /*
   * A NEGATIVE option, the shape the exploit needs. The seed has none, so it is
   * added to the stored dish directly.
   */
  const menu = memoryStore.menus.get(RESTAURANT_ID) as any;
  const biryani = menu.categories.flatMap((c: any) => c.items).find((d: any) => d.id === BIRYANI);
  const DISH_PRICE = Number(biryani.price);
  const extras = biryani.optionGroups.find((g: any) => g.id === 'grp_extras');
  extras.options.push({ id: 'opt_no_onion', name: 'No fried onion', priceDelta: -20 });
  const plainDish = menu.categories
    .flatMap((c: any) => c.items)
    .find((d: any) => d.isAvailable !== false && !(d.optionGroups || []).length);

  async function bothRoutes(selectedOptions: any[] | undefined, dishId = BIRYANI) {
    const item: any = { dishId, quantity: 1 };
    if (selectedOptions) item.selectedOptions = selectedOptions;
    const quote = await api(
      '/orders/quote',
      { method: 'POST', body: { restaurantId: RESTAURANT_ID, deliveryAddressId: ADDRESS, items: [item], distanceKm: 3.2 } },
      token
    );
    const ordersBefore = memoryStore.orders.size;
    const order = await api(
      '/orders',
      {
        method: 'POST',
        body: {
          restaurantId: RESTAURANT_ID,
          deliveryAddressId: ADDRESS,
          items: [item],
          paymentMethod: 'CASH_ON_DELIVERY',
          idempotencyKey: crypto.randomUUID(),
          distanceKm: 3.2
        }
      },
      token
    );
    return { quote, order, created: memoryStore.orders.size - ordersBefore };
  }

  const placed = (r: any) => r.json?.data?.order ?? r.json?.data;
  const addons = (r: any) => Number(placed(r)?.items?.[0]?.addonsTotal);
  const kitchenItems = (r: any) => Number(placed(r)?.bill?.partnerItemsTotal);
  const quoteItem = (r: any) => (r.json?.data?.items ?? [])[0];

  /* ================================================================ */
  console.log('-- Controls: baskets the dish allows');

  const plain = await bothRoutes([PORTION('opt_regular')]);
  it('Control: a portion and nothing else is priced and ordered', () => {
    assert.equal(plain.quote.status, 200, `quote ${plain.quote.status}: ${JSON.stringify(plain.quote.json).slice(0, 300)}`);
    assert.ok([200, 201].includes(plain.order.status), `order ${plain.order.status}: ${JSON.stringify(plain.order.json).slice(0, 300)}`);
    assert.equal(plain.created, 1);
  });

  const full = await bothRoutes([PORTION('opt_large'), EXTRA('opt_extra_raita'), EXTRA('opt_mirchi_salan')]);
  it('Control: a large portion with the two add-ons the group allows is accepted, and charged for', () => {
    assert.equal(full.quote.status, 200, `quote ${full.quote.status}`);
    assert.ok([200, 201].includes(full.order.status), `order ${full.order.status}`);
    assert.equal(addons(full.order), 150 + 30 + 35);
    assert.equal(kitchenItems(full.order), DISH_PRICE + 150 + 30 + 35);
  });

  const once = await bothRoutes([PORTION('opt_large'), EXTRA('opt_no_onion')]);
  it('A negative option counts as zero for the CUSTOMER: the large portion is still charged in full', () => {
    assert.ok([200, 201].includes(once.order.status), `order ${once.order.status}: ${JSON.stringify(once.order.json).slice(0, 300)}`);
    assert.equal(addons(once.order), 150, `customer add-ons: ${addons(once.order)}`);
  });
  it('and as zero for the KITCHEN, so both are priced from the same figure', () => {
    assert.equal(kitchenItems(once.order), DISH_PRICE + 150, `kitchen's items total: ${kitchenItems(once.order)}`);
  });

  const noGroups = await bothRoutes(undefined, plainDish?.id);
  it('Control: a dish with no choices needs none', () => {
    assert.ok(plainDish?.id, 'the seed has no dish without options');
    assert.equal(noGroups.quote.status, 200, `quote ${noGroups.quote.status}`);
    assert.ok([200, 201].includes(noGroups.order.status), `order ${noGroups.order.status}`);
  });

  /* ================================================================ */
  console.log('\n-- Refused, by the quote and by checkout alike');

  const refusals: Array<[string, any[] | undefined, string, string?]> = [
    [
      // Rs 150 - 8 x Rs 20 would net below zero: a free large portion, paid for
      // out of the kitchen's share, before negatives counted as zero.
      'A negative option named eight times to make a large portion free',
      [PORTION('opt_large'), ...Array.from({ length: 8 }, () => EXTRA('opt_no_onion'))],
      'DUPLICATE_OPTION'
    ],
    ['The same add-on twice', [PORTION('opt_regular'), EXTRA('opt_extra_raita'), EXTRA('opt_extra_raita')], 'DUPLICATE_OPTION'],
    ['The same portion twice', [PORTION('opt_large'), PORTION('opt_large')], 'DUPLICATE_OPTION'],
    ['An option from another group (an add-on offered as the portion)', [PORTION('opt_extra_raita')], 'UNKNOWN_OPTION'],
    ['An option the dish does not have', [PORTION('opt_regular'), EXTRA('opt_gold_leaf')], 'UNKNOWN_OPTION'],
    ['A group the dish does not have', [PORTION('opt_regular'), { groupId: 'grp_sauces', optionId: 'opt_extra_raita' }], 'UNKNOWN_OPTION'],
    ['Two portions where the group allows one', [PORTION('opt_regular'), PORTION('opt_large')], 'TOO_MANY_OPTIONS'],
    [
      'Three add-ons where the group allows two',
      [PORTION('opt_regular'), EXTRA('opt_extra_raita'), EXTRA('opt_mirchi_salan'), EXTRA('opt_no_onion')],
      'TOO_MANY_OPTIONS'
    ],
    ['Any choice at all on a dish that offers none', [PORTION('opt_regular')], 'UNKNOWN_OPTION', 'plain']
  ];

  for (const [name, basket, expected, which] of refusals) {
    const r = await bothRoutes(basket, which === 'plain' ? plainDish?.id : BIRYANI);
    it(`${name}: refused as ${expected}`, () => {
      assert.equal(r.quote.status, 400, `quote answered ${r.quote.status}: ${JSON.stringify(r.quote.json).slice(0, 200)}`);
      assert.equal(code(r.quote), expected, `quote said ${code(r.quote)}`);
      assert.equal(r.order.status, 400, `checkout answered ${r.order.status}: ${JSON.stringify(r.order.json).slice(0, 200)}`);
      assert.equal(code(r.order), expected, `checkout said ${code(r.order)}`);
      assert.equal(r.created, 0, 'an order was created anyway');
    });
  }

  const unknown = await bothRoutes([PORTION('opt_regular'), EXTRA('opt_gold_leaf')]);
  it('A refusal names the dish, so the customer knows which line to fix', () => {
    assert.ok(messageOf(unknown.order).includes(biryani.name), `message: ${messageOf(unknown.order)}`);
  });

  /* ================================================================ */
  console.log('\n-- A required choice left empty takes the cheapest, and SAYS so');

  const cheapestName = 'Regular (Serves 1)';
  const defaults: Array<[string, any[] | undefined]> = [
    ['No choices at all', []],
    ['No selectedOptions field at all (the 23 Sep app, for a dish it shows no sheet for)', undefined],
    ['Only an add-on, no portion', [EXTRA('opt_extra_raita')]]
  ];

  for (const [name, basket] of defaults) {
    const r = await bothRoutes(basket);
    it(`${name}: accepted by the quote and by checkout`, () => {
      assert.equal(r.quote.status, 200, `quote ${r.quote.status}: ${JSON.stringify(r.quote.json).slice(0, 200)}`);
      assert.ok([200, 201].includes(r.order.status), `order ${r.order.status}: ${JSON.stringify(r.order.json).slice(0, 200)}`);
    });
    it(`${name}: the ORDER records the portion by name, for the kitchen ticket and the bill`, () => {
      const chosen = (placed(r.order)?.items?.[0]?.selectedOptions || []) as any[];
      const portion = chosen.find(o => o.groupId === 'grp_portion');
      assert.equal(portion?.optionName, cheapestName, `order item options: ${JSON.stringify(chosen)}`);
    });
    it(`${name}: the QUOTE shows the same portion, before the customer pays`, () => {
      const chosen = (quoteItem(r.quote)?.selectedOptions || []) as any[];
      const portion = chosen.find(o => o.groupId === 'grp_portion');
      assert.equal(portion?.optionName, cheapestName, `quote item: ${JSON.stringify(quoteItem(r.quote)).slice(0, 300)}`);
    });
  }

  // "Required" said only by the flag, with no minimum set: still required.
  const portionGroup = biryani.optionGroups.find((g: any) => g.id === 'grp_portion');
  portionGroup.minSelections = 0;
  const flagOnly = await bothRoutes([EXTRA('opt_extra_raita')]);
  portionGroup.minSelections = 1;
  it('A group marked required only by its flag still gets its portion', () => {
    const chosen = (placed(flagOnly.order)?.items?.[0]?.selectedOptions || []) as any[];
    assert.ok(chosen.some(o => o.groupId === 'grp_portion'), `order item options: ${JSON.stringify(chosen)}`);
  });

  /* ================================================================ */
  console.log('\n-- The current customer app never leans on that default');

  /*
   * The default exists for the 23 Sep app, which shows one group. The current
   * app shows every group, and its option sheet must refuse to add a dish until
   * every required group has a choice, by the SAME minimum the server applies.
   * Read from the source, comments stripped, so an explanation of the rule
   * cannot stand in for the rule.
   */
  const sheetPath = fileURLToPath(
    new URL('../../../customer-mobile/src/screens/RestaurantDetailScreen.tsx', import.meta.url)
  );
  const sheet = fs
    .readFileSync(sheetPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  const minForSource = sheet.match(/const minFor = \(g: OptionGroup\) => ([^;\n]+);/)?.[1];
  const appMin = minForSource ? (new Function('g', `return ${minForSource};`) as (g: any) => number) : null;
  const serverMin = (g: any) => Math.max(Number(g.minSelections) || 0, g.isRequired ? 1 : 0);
  const shapes = [
    { isRequired: true, minSelections: 1 },
    { isRequired: true, minSelections: 0 },
    { isRequired: true },
    { isRequired: false, minSelections: 0 },
    { isRequired: false, minSelections: 2 },
    { isRequired: true, minSelections: 3 }
  ];
  it("The app's minimum per group is the server's, for every shape of group", () => {
    assert.ok(appMin, 'minFor was not found in RestaurantDetailScreen.tsx');
    for (const g of shapes) assert.equal(appMin!(g), serverMin(g), `group ${JSON.stringify(g)}`);
  });

  it('and a group is "missing" when ANY group has fewer choices than that minimum', () => {
    assert.match(
      sheet,
      /const missingGroup = \(dish: Dish\) =>\s*\(dish\.optionGroups \|\| \[\]\)\.find\(g => \(picks\[g\.id\] \|\| \[\]\)\.length < minFor\(g\)\);/
    );
  });

  const confirmBody = sheet.slice(
    sheet.indexOf('const handleConfirmCustomization'),
    sheet.indexOf('setSelectedDish(null);', sheet.indexOf('const handleConfirmCustomization'))
  );
  it('The sheet adds nothing to the cart while a required group is missing', () => {
    const guard = confirmBody.indexOf('if (missingGroup(selectedDish)) return;');
    const add = confirmBody.indexOf('onAddToCart(');
    assert.ok(guard >= 0, 'the missing-group guard is gone from handleConfirmCustomization');
    assert.ok(add > guard, 'the dish is added to the cart before the guard runs');
  });
  it('and its Add button is disabled until then', () => {
    assert.match(sheet, /disabled=\{Boolean\(missingGroup\(selectedDish\)\)\}/);
  });
  it('and what it sends is every choice from every group', () => {
    assert.match(sheet, /const chosen = \(dish: Dish\) =>\s*\(dish\.optionGroups \|\| \[\]\)\.flatMap\(/);
    assert.match(confirmBody, /selectedOptions: list\.length \? list\.map\(c => \(\{ groupId: c\.group\.id, optionId: c\.option\.id \}\)\)/);
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] The suite could not complete: ${err?.stack || err}`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
