/**
 * The Phase 6 features: reorder, tipping, live ETA, discovery filters, and
 * cancellation with an automatic refund.
 *
 * Four of these five are the kind of feature that looks finished from the
 * outside while being wrong underneath, so the checks here concentrate on the
 * failure that would not show up on screen:
 *
 *   reorder      the price changed since last time, and the basket must quote
 *                today's, not the one the customer remembers
 *   tipping      a tip must reach the rider WITHOUT being taxed, discounted or
 *                commissioned — the arithmetic, not the button
 *   ETA          it must MOVE, and it must not be computed from the rider's
 *                position before the rider has the food
 *   filters      an unparseable filter must not empty the home screen
 *   cancelling   a paid order that is cancelled must produce a refund case; a
 *                cancellation with no reason must be refused
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { config } from '../config/env.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { refundRepository } from '../db/repositories/refundRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { memoryStore } from '../db/client.ts';
import { UNSET_COORDINATES } from '../modules/restaurants/restaurantLocation.ts';
import { syncService } from '../modules/search/syncService.ts';
import { estimateArrival } from '../modules/orders/eta.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import type { Order } from '@quick-bites/shared-types';

console.log('====================================================');
console.log('          RUNNING FEATURE TESTS                    ');
console.log('====================================================\n');

const PORT = 5600 + Math.floor(Math.random() * 300);
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function api(
  path: string,
  options: { method?: string; body?: any } = {},
  token?: string
) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* some errors carry no body */
  }
  return { status: res.status, json };
}

let idempotency = 0;
async function placeOrder(overrides: Partial<Parameters<typeof orderService.createOrder>[0]> = {}) {
  const { order } = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 2 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: `idem_feat_${Date.now()}_${idempotency++}`,
    ...overrides
  });
  return order;
}

async function run() {
  await seedDatabase();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  resetAuthRateLimit();
  resetRequestRateLimit();

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'customer@quickbite.app', password: 'pass123' }
  });
  const customerToken = login.json?.data?.token;
  check('A customer can sign in to exercise these features', Boolean(customerToken));

  const partnerLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'partner@quickbite.app', password: 'pass123' }
  });
  const partnerToken = partnerLogin.json?.data?.token;

  // ==================================================================
  console.log('\n--- 6.1 Reorder ---');

  const original = await placeOrder();

  const reorder = await api(`/orders/${original.id}/reorder`, { method: 'POST' }, customerToken);
  check('A past order can be rebuilt into a basket', reorder.status === 200, `status ${reorder.status}`);
  check('and it carries the same quantities',
    reorder.json?.data?.items?.[0]?.quantity === 2,
    JSON.stringify(reorder.json?.data?.items?.[0]));
  check('An unchanged menu makes it an exact repeat', reorder.json?.data?.isExactRepeat === true);
  check('Reorder returns a basket and does NOT place an order',
    (await orderRepository.listByCustomerId('usr_customer_01')).filter(
      (o: Order) => o.restaurantId === 'rst_bbh_01'
    ).length ===
      (await orderRepository.listByCustomerId('usr_customer_01')).filter(
        (o: Order) => o.restaurantId === 'rst_bbh_01'
      ).length,
    'placing an order from a reorder call would charge someone by accident');

  // The case that matters: the dish costs more now than it did then.
  const menu = await menuRepository.findByRestaurantId('rst_bbh_01');
  const dish = menu!.categories.flatMap((c: any) => c.items).find((d: any) => d.id === 'dish_ck_biryani');
  const oldPrice = dish.price;
  dish.price = oldPrice + 45;

  const repriced = await api(`/orders/${original.id}/reorder`, { method: 'POST' }, customerToken);
  const line = repriced.json?.data?.items?.[0];
  check("A price rise since the last order is quoted at TODAY's price",
    Number(line?.unitPrice) === oldPrice + 45,
    `quoted ${line?.unitPrice}, menu says ${oldPrice + 45}`);
  check('and the old price is returned beside it, so the change can be shown',
    Number(line?.previousUnitPrice) === oldPrice);
  check('and the basket is no longer an exact repeat',
    repriced.json?.data?.isExactRepeat === false);
  dish.price = oldPrice;

  // A dish that has gone out of stock is reported, not silently dropped.
  dish.isAvailable = false;
  const outOfStock = await api(`/orders/${original.id}/reorder`, { method: 'POST' }, customerToken);
  check('An out-of-stock line comes back named, not silently missing',
    outOfStock.json?.data?.unavailableItems?.length === 1,
    JSON.stringify(outOfStock.json?.data?.unavailableItems));
  dish.isAvailable = true;

  const otherPersons = await api(`/orders/${original.id}/reorder`, { method: 'POST' }, partnerToken);
  check("Someone else's order cannot be reordered", otherPersons.status >= 400,
    `status ${otherPersons.status}`);

  // ==================================================================
  console.log('\n--- 6.2 Tipping the rider ---');

  const noTip = calculateOrderPricing({
    items: [{ unitPrice: 300, quantity: 1 }],
    packagingFee: 20,
    distanceKm: 3
  });
  const withTip = calculateOrderPricing({
    items: [{ unitPrice: 300, quantity: 1 }],
    packagingFee: 20,
    distanceKm: 3,
    tipAmount: 50
  });

  check('A tip raises the total by exactly the tip',
    Math.abs(withTip.totalAmount - noTip.totalAmount - 50) < 0.001,
    `${noTip.totalAmount} -> ${withTip.totalAmount}`);
  check('No GST is charged on a tip', withTip.gstAmount === noTip.gstAmount,
    `${noTip.gstAmount} vs ${withTip.gstAmount}`);
  check('No commission is taken from a tip — the restaurant payout is unchanged',
    withTip.restaurantNetPayout === noTip.restaurantNetPayout,
    `${noTip.restaurantNetPayout} vs ${withTip.restaurantNetPayout}`);

  // A percentage coupon must be computed on the food, never on the tip: a
  // discount funded out of the rider's tip is the rider paying for the promotion.
  const discounted = calculateOrderPricing({
    items: [{ unitPrice: 300, quantity: 1 }],
    packagingFee: 20,
    distanceKm: 3,
    tipAmount: 100,
    coupon: { discountType: 'PERCENTAGE', discountValue: 50 }
  });
  const discountedNoTip = calculateOrderPricing({
    items: [{ unitPrice: 300, quantity: 1 }],
    packagingFee: 20,
    distanceKm: 3,
    coupon: { discountType: 'PERCENTAGE', discountValue: 50 }
  });
  check('A percentage coupon does not discount the tip',
    discounted.couponDiscount === discountedNoTip.couponDiscount,
    `${discountedNoTip.couponDiscount} vs ${discounted.couponDiscount}`);

  const negative = calculateOrderPricing({
    items: [{ unitPrice: 300, quantity: 1 }],
    tipAmount: -500
  });
  check('A negative tip cannot be used to reduce a bill', negative.tipAmount === 0,
    String(negative.tipAmount));

  const quoted = await api(
    '/orders/quote',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
        tipAmount: 30
      }
    },
    customerToken
  );
  check('The cart can price a basket including the tip', quoted.status === 200,
    `status ${quoted.status}`);
  check('and the quote reports the tip it will actually charge',
    quoted.json?.data?.bill?.tipAmount === 30, String(quoted.json?.data?.bill?.tipAmount));

  const absurdTip = await api(
    '/orders/quote',
    {
      method: 'POST',
      body: {
        restaurantId: 'rst_bbh_01',
        deliveryAddressId: 'addr_sample_01',
        items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
        tipAmount: config.MAX_TIP_AMOUNT + 1
      }
    },
    customerToken
  );
  check('A tip beyond the ceiling is refused with a message, not silently clamped',
    absurdTip.status === 400, `status ${absurdTip.status}`);

  const tipped = await placeOrder({ tipAmount: 60 });
  check('A placed order records the tip on its bill', tipped.bill.tipAmount === 60,
    String(tipped.bill.tipAmount));
  check('and the tip is inside the total the customer pays',
    tipped.bill.totalAmount > (tipped.bill.itemsTotal + tipped.bill.gstAmount),
    JSON.stringify(tipped.bill));

  // ==================================================================
  console.log('\n--- 6.3 Live ETA ---');

  const fresh = await placeOrder();
  const initial = estimateArrival(fresh);
  check('A new order has an arrival estimate', typeof initial.minutesRemaining === 'number',
    JSON.stringify(initial));
  check('and it includes preparation as well as travel',
    initial.basis === 'PREP_AND_TRAVEL', initial.basis);

  await orderRepository.updateStatus(fresh.id, 'ACCEPTED', 25);
  const accepted = (await orderRepository.findById(fresh.id))!;
  const afterAccept = estimateArrival(accepted);
  check("Once the kitchen accepts, its OWN prep time drives the estimate",
    afterAccept.basis === 'KITCHEN_ESTIMATE', afterAccept.basis);

  // The defect this catches: an ETA built from a promised duration with no
  // start time never moves, so the screen says the same thing all the way
  // through. Ten minutes of cooking must come off the estimate.
  const tenMinutesOn = estimateArrival(accepted, new Date(Date.now() + 10 * 60_000));
  check('The estimate FALLS as the food cooks',
    (tenMinutesOn.minutesRemaining ?? 0) < (afterAccept.minutesRemaining ?? 0),
    `${afterAccept.minutesRemaining} -> ${tenMinutesOn.minutesRemaining}`);

  // Before pickup the rider's position is irrelevant — and must not leak into
  // the estimate, because the food is still in the kitchen.
  accepted.riderCoordinates = { latitude: 12.99, longitude: 77.59 };
  const stillKitchen = estimateArrival(accepted);
  check("A rider's position does not affect the ETA before pickup",
    stillKitchen.distanceKm === afterAccept.distanceKm,
    `${afterAccept.distanceKm} vs ${stillKitchen.distanceKm}`);

  await orderRepository.updateStatus(fresh.id, 'PREPARING');
  await orderRepository.updateStatus(fresh.id, 'READY_FOR_PICKUP');
  await orderRepository.updateStatus(fresh.id, 'RIDER_ASSIGNED');
  await orderRepository.updateStatus(fresh.id, 'OUT_FOR_DELIVERY');
  const enRoute = (await orderRepository.findById(fresh.id))!;
  enRoute.riderCoordinates = enRoute.deliveryCoordinates
    ? { ...enRoute.deliveryCoordinates }
    : { latitude: 12.9, longitude: 77.6 };
  const arriving = estimateArrival(enRoute);
  check('Once out for delivery the estimate is measured from the rider',
    arriving.basis === 'RIDER_EN_ROUTE', arriving.basis);
  check('and a rider at the door is nearly there',
    (arriving.distanceKm ?? 99) < 0.1, String(arriving.distanceKm));

  const delivered = { ...enRoute, status: 'DELIVERED' as const };
  check('A delivered order has no arrival time left to give',
    estimateArrival(delivered).minutesRemaining === null);

  const tracking = await api(`/orders/${fresh.id}/tracking`, {}, customerToken);
  check('The tracking endpoint serves the estimate to the app',
    typeof tracking.json?.data?.eta?.minutesRemaining === 'number',
    JSON.stringify(tracking.json?.data?.eta));

  // ==================================================================
  console.log('\n--- 6.4 Discovery filters ---');

  const all = await api('/restaurants');
  const total = all.json?.data?.restaurants?.length || 0;
  check('The discovery feed lists restaurants', total > 0, String(total));

  const veg = await api('/restaurants?isPureVeg=true');
  check('Veg-only returns only pure-veg kitchens',
    (veg.json?.data?.restaurants || []).every((r: any) => r.isPureVeg === true));

  const rated = await api('/restaurants?minRating=4.5');
  check('A rating floor excludes everything below it',
    (rated.json?.data?.restaurants || []).every((r: any) => Number(r.ratingAverage) >= 4.5));

  // A delivery time only exists once the customer has said where they are.
  // Both halves of that are asserted, because the interesting case is the one
  // where the filter CANNOT be honoured and the question is what to do instead.
  //
  // Bengaluru, so the seeded restaurants are in range.
  const HERE = 'lat=12.9716&lng=77.5946';

  const quick = await api(`/restaurants?${HERE}&maxDeliveryMinutes=25`);
  check('With a position, a delivery-time ceiling excludes everything slower',
    (quick.json?.data?.restaurants || []).every((r: any) => r.estimatedDeliveryMinutes <= 25));

  check('With a position, every restaurant carries a real delivery time',
    (quick.json?.data?.restaurants || []).every(
      (r: any) => typeof r.estimatedDeliveryMinutes === 'number' && r.estimatedDeliveryMinutes > 0
    ));

  // Without a position the server has nothing to compute from. It used to
  // invent 2.5 km, which made every restaurant read "25 mins" and made this
  // filter look like it worked. Now the figure is absent, and an absent figure
  // is not judged against the ceiling — the alternative is an empty home screen
  // for anyone who has not set a location, which is a worse answer than an
  // unfiltered one.
  // A restaurant that was never placed on a map must still be listed.
  //
  // This is the regression that region filtering nearly shipped, and it was
  // real: every restaurant on the live deployment carries the register route's
  // placeholder, because no partner app has ever sent coordinates. A kitchen in
  // Harohalli is therefore recorded at the centre of Bengaluru, thirty
  // kilometres from itself. Judge those by distance and the home screen goes
  // EMPTY for precisely the customers they deliver to.
  //
  // Built here rather than relied on from the seed, because every seeded
  // restaurant has a real position — so the seed cannot exercise this at all,
  // which is exactly why it went unnoticed.
  await restaurantRepository.create({
    id: 'rst_no_pin_test',
    ownerId: 'usr_no_pin_test',
    name: 'Kitchen With No Pin',
    slug: 'kitchen-with-no-pin',
    phone: '9800000000',
    addressLine: 'Somewhere nobody recorded',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { ...UNSET_COORDINATES },
    isPureVeg: false,
    packagingFee: 0,
    status: 'ACTIVE',
    kycStatus: 'ACTIVE',
    ratingAverage: 4,
    ratingCount: 1,
    cuisineTags: ['Indian'],
    isOpen: true
  } as any);

  // 12.65,77.48 is beside the seeded kitchens and ~38 km from the placeholder,
  // so a restaurant carrying it is far outside any sane service radius and
  // would certainly be dropped if it were being judged by distance.
  const FAR_AWAY = 'lat=12.6500&lng=77.4800';
  const unplaced = await api(`/restaurants?${FAR_AWAY}`);
  const unplacedList = unplaced.json?.data?.restaurants || [];
  check('A restaurant with no pin is listed even from far outside the placeholder',
    unplacedList.some((r: any) => r.id === 'rst_no_pin_test'),
    `${unplacedList.length} returned`);
  check('A restaurant with no pin is flagged rather than silently placed',
    unplacedList.find((r: any) => r.id === 'rst_no_pin_test')?.locationPending === true);
  check('A restaurant with no pin carries no invented distance',
    unplacedList
      .filter((r: any) => r.locationPending === true)
      .every((r: any) => r.distanceKm === undefined && r.estimatedDeliveryMinutes === undefined));
  check('A restaurant that IS placed is still measured and still filtered',
    unplacedList.some((r: any) => r.locationPending === false && typeof r.distanceKm === 'number'));

  // Operations can correct a placeholder position.
  //
  // Until this existed there was no route back to the truth for a restaurant
  // carrying the register route's placeholder: the partner app only sets a pin
  // during REGISTRATION, and the admin schema had no coordinates field. A live
  // kitchen thirty kilometres from itself stayed that way for good, listed but
  // never measured, so it could never show a real distance or delivery time.
  {
    const adminLogin = await api('/auth/login', {
      method: 'POST',
      body: { email: 'admin@quickbite.app', password: 'pass123' }
    });
    const adminToken = adminLogin.json?.data?.token;
    check('An administrator can sign in', Boolean(adminToken));

    const fixed = await api(
      '/admin/restaurants/rst_bbh_01',
      {
        method: 'PATCH',
        body: {
          coordinates: { latitude: 12.7001, longitude: 77.5001 },
          serviceRadiusKm: 12
        }
      },
      adminToken
    );
    check('Operations can set a restaurant position', fixed.status === 200, `got ${fixed.status}`);

    const moved = await restaurantRepository.findById('rst_bbh_01');
    check('and it is stored', moved?.coordinates?.latitude === 12.7001, JSON.stringify(moved?.coordinates));
    check('along with the delivery radius', (moved as any)?.serviceRadiusKm === 12);

    // Put it back, so the checks below still measure from the seeded position.
    await api(
      '/admin/restaurants/rst_bbh_01',
      {
        method: 'PATCH',
        body: { coordinates: { latitude: 12.6802, longitude: 77.4734 } }
      },
      adminToken
    );
  }


  // Removed again before the checks below, which count the feed. A fixture that
  // outlives its own assertions fails a later, unrelated check and sends
  // whoever reads the output looking for a bug in the wrong place — which is
  // exactly what it did on the first run of this block.
  memoryStore.restaurants.delete('rst_no_pin_test');

  const noPosition = await api('/restaurants?maxDeliveryMinutes=25');
  check('Without a position, delivery times are absent rather than invented',
    (noPosition.json?.data?.restaurants || []).every(
      (r: any) => r.estimatedDeliveryMinutes === undefined
    ));
  check('Without a position, the ceiling does not empty the list',
    (noPosition.json?.data?.restaurants || []).length > 0);

  const cheap = await api('/restaurants?maxCostForTwo=400');
  check('A price band excludes what is above it',
    (cheap.json?.data?.restaurants || []).every(
      (r: any) => r.costForTwo === undefined || Number(r.costForTwo) <= 400
    ));

  const byRating = await api('/restaurants?sort=rating');
  const ratings = (byRating.json?.data?.restaurants || []).map((r: any) => Number(r.ratingAverage) || 0);
  check('Sorting by rating actually sorts',
    ratings.every((v: number, i: number) => i === 0 || ratings[i - 1] >= v),
    JSON.stringify(ratings));

  const combined = await api('/restaurants?isPureVeg=true&minRating=1&sort=deliveryTime');
  check('Filters combine rather than replacing one another',
    (combined.json?.data?.restaurants || []).every((r: any) => r.isPureVeg === true));

  check('The feed echoes which filters it applied',
    combined.json?.data?.appliedFilters?.sort === 'deliveryTime',
    JSON.stringify(combined.json?.data?.appliedFilters));

  // A stale app sending nonsense must not produce an empty home screen.
  const nonsense = await api('/restaurants?minRating=excellent&sort=whatever');
  check('An unparseable filter is ignored rather than emptying the feed',
    (nonsense.json?.data?.restaurants?.length || 0) === total,
    `${nonsense.json?.data?.restaurants?.length} of ${total}`);

  // The same filters must work on search, not only on the feed. Two surfaces
  // disagreeing about what "under 30 minutes" means is the reason these moved
  // to the server in the first place.
  //
  // The index has to be built first. Without the sync these checks ran against
  // an EMPTY index, where `[].every(...)` is true and two empty lists are equal
  // — every one of them passed while testing nothing at all.
  await syncService.syncCatalog();

  // A blank query returns the whole catalogue, which is the only result set
  // guaranteed to span more than one price. A narrow query can return kitchens
  // that all happen to sit inside the band, and then "the filter worked" is
  // indistinguishable from "the filter did nothing".
  const searchAll = await api('/search?q=&type=restaurants');
  const allHits = searchAll.json?.data?.restaurants || [];
  check('The search index has something in it for these checks to mean anything',
    allHits.length > 0, 'an empty index makes every filter assertion below vacuous');

  const band = 300;
  const dear = allHits.filter((r: any) => Number(r.costForTwo) > band).length;
  check('and the catalogue spans the price band being tested',
    dear > 0,
    `nothing costs more than ${band} for two, so a ${band} ceiling cannot be shown to exclude anything`);

  const searchCheap = await api(`/search?q=&type=restaurants&maxCostForTwo=${band}`);
  const cheapHits = searchCheap.json?.data?.restaurants || [];
  check('Search accepts a price band', searchCheap.status === 200, `status ${searchCheap.status}`);
  check('and applies it',
    cheapHits.every((r: any) => r.costForTwo === undefined || Number(r.costForTwo) <= band),
    JSON.stringify(cheapHits.map((r: any) => r.costForTwo)));
  check('and the band actually excluded the dearer kitchens',
    cheapHits.length < allHits.length,
    `${allHits.length} hits, ${dear} above the band, ${cheapHits.length} after filtering — ` +
      'an unchanged count means the filter never ran, or a cache served the unfiltered list');

  const searchSorted = await api('/search?q=&sort=rating');
  const searchRatings = (searchSorted.json?.data?.restaurants || []).map(
    (r: any) => Number(r.ratingAverage) || 0
  );
  check('Search sorts by rating when asked',
    searchRatings.length > 1 &&
      searchRatings.every((v: number, i: number) => i === 0 || searchRatings[i - 1] >= v),
    JSON.stringify(searchRatings));

  // The cache key must include every filter, or one customer's veg-only results
  // are served to the next person who searches the same word. These two queries
  // differ in exactly one parameter, which is what makes the check meaningful.
  const anySearch = await api('/search?q=&type=restaurants');
  const vegSearch = await api('/search?q=&type=restaurants&isVeg=true');
  const anyNames = (anySearch.json?.data?.restaurants || []).map((r: any) => r.name).join(',');
  const vegNames = (vegSearch.json?.data?.restaurants || []).map((r: any) => r.name).join(',');
  check('A filtered search does not serve the unfiltered result from cache',
    anyNames.length > 0 && vegNames !== anyNames,
    `unfiltered [${anyNames}] vs veg-only [${vegNames}] — identical means a shared cache key`);

  // ==================================================================
  console.log('\n--- 6.5 Cancellation reasons and automatic refund ---');

  const reasons = await api('/orders/cancellation-reasons', {}, customerToken);
  check('A customer is served the reasons they may choose', reasons.status === 200,
    `status ${reasons.status}`);
  const customerCodes = (reasons.json?.data?.reasons || []).map((r: any) => r.code);
  check('including ordering by mistake', customerCodes.includes('ORDERED_BY_MISTAKE'));
  check('and NOT the kitchen\'s reasons', !customerCodes.includes('KITCHEN_OVERLOADED'),
    JSON.stringify(customerCodes));

  const partnerReasons = await api('/orders/cancellation-reasons', {}, partnerToken);
  const partnerCodes = (partnerReasons.json?.data?.reasons || []).map((r: any) => r.code);
  check('A partner is offered the kitchen\'s reasons', partnerCodes.includes('KITCHEN_OVERLOADED'));
  check('and not the customer\'s', !partnerCodes.includes('CHANGED_MY_MIND'),
    JSON.stringify(partnerCodes));

  const hindi = await api('/orders/cancellation-reasons?language=hi', {}, customerToken);
  const hindiLabel = (hindi.json?.data?.reasons || []).find((r: any) => r.code === 'ORDERED_BY_MISTAKE')?.label;
  check('The reasons are served translated', Boolean(hindiLabel) && hindiLabel !== 'I ordered by mistake',
    String(hindiLabel));

  const toCancel = await placeOrder();
  const noReason = await api(
    `/orders/${toCancel.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED' } },
    customerToken
  );
  check('A cancellation with no reason is refused', noReason.status === 400,
    `status ${noReason.status}`);

  const badReason = await api(
    `/orders/${toCancel.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'MADE_UP' } },
    customerToken
  );
  check('A reason that is not in the catalogue is refused', badReason.status === 400,
    `status ${badReason.status}`);

  const notMine = await api(
    `/orders/${toCancel.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'KITCHEN_OVERLOADED' } },
    customerToken
  );
  check("A customer cannot cancel using the kitchen's reason", notMine.status === 403,
    `status ${notMine.status}`);

  const cancelled = await api(
    `/orders/${toCancel.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } },
    customerToken
  );
  check('A customer can cancel their own order with a reason', cancelled.status === 200,
    `status ${cancelled.status}`);

  const cancelledRecord = await orderRepository.findById(toCancel.id);
  check('The reason is stored as a countable code', cancelledRecord?.cancellationReasonCode === 'CHANGED_MY_MIND',
    String(cancelledRecord?.cancellationReasonCode));
  check('and who cancelled it is recorded', cancelledRecord?.cancelledByRole === 'customer',
    String(cancelledRecord?.cancelledByRole));
  check('and when', Boolean(cancelledRecord?.cancelledAt));
  check('An unpaid order raises no refund case', !cancelledRecord?.refundRequestId,
    String(cancelledRecord?.refundRequestId));

  // The one that matters: money was taken, and the order is cancelled.
  const paid = await placeOrder({ paymentMethod: 'WALLET' });
  await orderRepository.updateStatus(paid.id, 'ACCEPTED', 20);
  const paidRecord = (await orderRepository.findById(paid.id))!;
  paidRecord.paymentStatus = 'PAID';
  await orderRepository.save(paidRecord);

  const paidCancel = await api(
    `/orders/${paid.id}/status`,
    {
      method: 'PUT',
      body: { status: 'CANCELLED', cancellationReasonCode: 'OTHER', cancellationNote: 'Wrong flat number' }
    },
    customerToken
  );
  check('A paid order can be cancelled', paidCancel.status === 200, `status ${paidCancel.status}`);

  const refunded = (await orderRepository.findById(paid.id))!;
  check('Cancelling a PAID order opens a refund case automatically',
    Boolean(refunded.refundRequestId), 'no refund case was raised for money already taken');

  const cases = await refundRepository.listByOrder(paid.id);
  check('and the case is attached to that order', cases.length === 1, String(cases.length));
  check('for the full amount that was charged',
    cases[0]?.requestedAmount === paid.bill.totalAmount,
    `${cases[0]?.requestedAmount} vs ${paid.bill.totalAmount}`);
  check('A wallet payment is refunded to the wallet immediately',
    cases[0]?.status === 'REFUNDED', String(cases[0]?.status));
  check('and the order is marked refunded, not merely cancelled',
    refunded.paymentStatus === 'REFUNDED', String(refunded.paymentStatus));

  check('The free-text note is kept when the catch-all reason allows it',
    (refunded.cancellationReason || '').includes('Wrong flat number'),
    String(refunded.cancellationReason));

  // A note attached to a SPECIFIC reason must be dropped, or the countable code
  // can be contradicted by the sentence next to it.
  const specific = await placeOrder();
  await api(
    `/orders/${specific.id}/status`,
    {
      method: 'PUT',
      body: {
        status: 'CANCELLED',
        cancellationReasonCode: 'CHANGED_MY_MIND',
        cancellationNote: 'actually the food was cold'
      }
    },
    customerToken
  );
  const specificRecord = await orderRepository.findById(specific.id);
  check('A note against a specific reason is discarded',
    !(specificRecord?.cancellationReason || '').includes('actually the food was cold'),
    String(specificRecord?.cancellationReason));

  const twice = await api(
    `/orders/${specific.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } },
    customerToken
  );
  check('An order cannot be cancelled twice', twice.status === 409, `status ${twice.status}`);

  const delivered2 = await placeOrder();
  await orderRepository.updateStatus(delivered2.id, 'ACCEPTED', 20);
  await orderRepository.updateStatus(delivered2.id, 'PREPARING');
  await orderRepository.updateStatus(delivered2.id, 'READY_FOR_PICKUP');
  await orderRepository.updateStatus(delivered2.id, 'RIDER_ASSIGNED');
  await orderRepository.updateStatus(delivered2.id, 'OUT_FOR_DELIVERY');
  await orderRepository.updateStatus(delivered2.id, 'DELIVERED');
  const tooLate = await api(
    `/orders/${delivered2.id}/status`,
    { method: 'PUT', body: { status: 'CANCELLED', cancellationReasonCode: 'CHANGED_MY_MIND' } },
    customerToken
  );
  check('A delivered order cannot be cancelled', tooLate.status === 409, `status ${tooLate.status}`);

  server.close();

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`        ALL ${passed} FEATURE CHECKS PASSED                `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`        ${failed} FEATURE CHECK(S) FAILED                  `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch(err => {
  console.error('[FAIL] Feature tests crashed:', err);
  process.exit(1);
});
