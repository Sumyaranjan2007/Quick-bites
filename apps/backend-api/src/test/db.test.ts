import { seedDatabase } from '../db/seed.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { memoryStore } from '../db/client.ts';
import { normaliseLoadedStore } from '../db/normaliseStore.ts';

console.log('====================================================');
console.log('    RUNNING CHUNK 03 DATA LAYER INTEGRATION TESTS   ');
console.log('====================================================\n');

async function runDbTests() {
  // 1. Run Seed
  console.log('Test 1: Executing seedDatabase() ...');
  await seedDatabase();
  console.log('[PASS] Test 1: Seed executed without errors');

  // 2. User Repository Verification
  console.log('Test 2: Verifying userRepository ...');
  const user = await userRepository.findByEmail('rahul.sharma@quickbite.app');
  if (!user || user.fullName !== 'Rahul Sharma' || !user.isGold) {
    throw new Error('Failed to find seeded customer user or incorrect Gold status.');
  }
  console.log('[PASS] Test 2: User repository fetched correct profile with Gold status');

  // 3. PostGIS / Spatial Distance Calculations
  console.log('Test 3: Testing spatial restaurant proximity (Near Harohalli) ...');
  // Harohalli, Kanakapura Road — the service area the seeded restaurants sit in.
  const nearby = await restaurantRepository.findNearby({
    latitude: 12.6802,
    longitude: 77.4734,
    radiusKm: 10.0
  });

  if (nearby.length < 2) {
    throw new Error('Expected at least 2 nearby restaurants in 10km radius.');
  }
  if (nearby[0].slug !== 'bangalore-biryani-house' || nearby[0].distanceKm !== 0.0) {
    throw new Error('Closest restaurant should be Bangalore Biryani House at 0.0km.');
  }
  console.log(`[PASS] Test 3: Spatial lookup returned ${nearby.length} restaurants ordered by distance (Closest: ${nearby[0].name} at ${nearby[0].distanceKm}km)`);

  // 4. Pure Veg Filter Verification
  console.log('Test 4: Testing Pure Veg filtering ...');
  const vegOnly = await restaurantRepository.findNearby({
    latitude: 12.6802,
    longitude: 77.4734,
    isVegOnly: true
  });

  if (vegOnly.length !== 1 || vegOnly[0].slug !== 'udupi-sri-krishna-bhavan') {
    throw new Error('Expected exactly 1 Pure Veg restaurant (Udupi Sri Krishna Bhavan).');
  }
  console.log('[PASS] Test 4: Pure Veg filter correctly isolated vegetarian restaurants');

  // 5. Menu Catalog & Option Groups
  console.log('Test 5: Verifying nested menu categories & option groups ...');
  const menu = await menuRepository.findByRestaurantId('rst_bbh_01');
  if (!menu || menu.categories.length === 0) {
    throw new Error('Menu for Bangalore Biryani House not found.');
  }
  const biryaniDish = menu.categories[0].items.find(i => i.id === 'dish_ck_biryani');
  if (!biryaniDish || !biryaniDish.optionGroups || biryaniDish.optionGroups.length === 0) {
    throw new Error('Special Chicken Dum Biryani option groups missing.');
  }
  console.log('[PASS] Test 5: Nested menu and variant option groups verified');

  // 6. Real-Time Stock Availability Toggle
  console.log('Test 6: Testing real-time stock toggle ...');
  const toggleResult = await menuRepository.updateItemStock('rst_bbh_01', 'dish_ck_biryani', false);
  if (!toggleResult) {
    throw new Error('Failed to update dish stock state.');
  }
  const updatedMenu = await menuRepository.findByRestaurantId('rst_bbh_01');
  const updatedDish = updatedMenu?.categories[0].items.find(i => i.id === 'dish_ck_biryani');
  if (updatedDish?.isAvailable !== false) {
    throw new Error('Dish availability was not toggled to false.');
  }
  console.log('[PASS] Test 6: Dish stock successfully marked out-of-stock');

  // 7. Order Idempotency Key Lookup
  console.log('Test 7: Testing Order repository and idempotency keys ...');
  const testIdempotencyKey = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  await orderRepository.create({
    id: 'ord_test_01',
    idempotencyKey: testIdempotencyKey,
    orderNumber: 'QB-TEST-1001',
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_test_01',
    status: 'PAYMENT_PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'RAZORPAY_SANDBOX',
    items: [
      {
        dishId: 'dish_pbm',
        name: 'Paneer Butter Masala',
        unitPrice: 260.00,
        quantity: 1,
        totalPrice: 260.00
      }
    ],
    bill: {
      itemsTotal: 260.00,
      gstAmount: 13.00,
      packagingFee: 25.00,
      deliveryFee: 0.00, // Gold customer
      platformFee: 5.90,
      couponDiscount: 0.00,
      totalAmount: 303.90,
      restaurantNetPayout: 232.00
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const retrievedOrder = await orderRepository.findByIdempotencyKey(testIdempotencyKey);
  if (!retrievedOrder || retrievedOrder.id !== 'ord_test_01') {
    throw new Error('Order lookup by idempotency key failed.');
  }
  console.log('[PASS] Test 7: Order repository and idempotency key match verified');
  /*
   * TEST 8: DELIVERY DOES NOT INVENT A PAYMENT.
   *
   * Both writers that mark an order DELIVERED used to set
   * `paymentStatus = 'PAID'` for every order regardless of method, so a
   * prepaid order whose payment never completed was recorded as paid the
   * moment the food arrived. `financeRoutes` selects payables and settlements
   * on DELIVERED without consulting `paymentStatus`, so that became a payout
   * of money the platform never collected.
   *
   * Driven through the repository rather than over HTTP on purpose: the value
   * under test is what gets WRITTEN, and the checkout flow cannot easily
   * produce a prepaid order that is delivered while still unpaid - which is
   * exactly why the case went unnoticed for so long.
   */
  console.log('Test 8: Verifying delivery does not invent a payment ...');

  const billStub = {
    itemsTotal: 100, gstAmount: 0, packagingFee: 0, deliveryFee: 0,
    platformFee: 0, couponDiscount: 0, totalAmount: 100, restaurantNetPayout: 100
  };

  const unpaidPrepaid: any = await orderRepository.create({
    id: 'ord_test_unpaid',
    idempotencyKey: 'idem_test_unpaid',
    orderNumber: 'QB-TEST-UNPAID',
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    addressId: 'adr_test_01',
    status: 'OUT_FOR_DELIVERY',
    paymentStatus: 'PENDING',
    paymentMethod: 'RAZORPAY_SANDBOX',
    deliveryOtp: '4321',
    items: [],
    bill: billStub,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  const afterDelivery = await orderRepository.verifyDeliveryOtp(unpaidPrepaid.id, '4321');
  if (!afterDelivery.success) {
    throw new Error('Expected the delivery to complete; it was refused: ' + afterDelivery.error);
  }
  if (afterDelivery.order!.paymentStatus === 'PAID') {
    throw new Error('A prepaid order that never paid was marked PAID by being delivered.');
  }
  if (!(afterDelivery.order as any).paymentUnresolvedAt) {
    throw new Error('Delivery with an unresolved payment was not recorded for anybody to see.');
  }
  console.log('[PASS] Test 8a: An unpaid prepaid order is not marked paid by being delivered');

  /*
   * The other half, and the one more likely to be got wrong: this must NOT
   * have broken cash on delivery, where handing the food over genuinely IS
   * the payment. A guard that refuses everything passes 8a and silently stops
   * every cash order being recorded as paid.
   */
  const cashOrder: any = await orderRepository.create({
    id: 'ord_test_cash',
    idempotencyKey: 'idem_test_cash',
    orderNumber: 'QB-TEST-CASH',
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    addressId: 'adr_test_01',
    status: 'OUT_FOR_DELIVERY',
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH_ON_DELIVERY',
    deliveryOtp: '8765',
    items: [],
    bill: billStub,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as any);

  const afterCash = await orderRepository.verifyDeliveryOtp(cashOrder.id, '8765');
  if (afterCash.order!.paymentStatus !== 'PAID') {
    throw new Error('A cash-on-delivery order was not marked paid on delivery.');
  }
  if ((afterCash.order as any).paymentUnresolvedAt) {
    throw new Error('A cash order was flagged unresolved; cash on delivery IS the payment.');
  }
  console.log('[PASS] Test 8b: A cash order is still marked paid, because delivery IS the payment');

  /*
   * TEST 9: AN ORDER PERSISTED BY THE PREVIOUS BUILD STILL WORKS.
   *
   * `RIDER_ASSIGNED` was removed from OrderStatus and `riderStage` renamed its
   * collection stage. Orders already written to the store carry the old values,
   * and they do not fail loudly: a status missing from VALID_TRANSITIONS makes
   * every action on that order return "invalid transition", so the order sticks
   * forever with food in a bag and a customer watching a screen that never
   * changes. Nothing throws. Nothing is logged.
   *
   * This is the check that the migration exists AND runs. Writing one and
   * never exercising it is the same as not writing it, except that it looks
   * handled.
   */
  console.log('Test 9: Verifying a store written by the previous build is migrated ...');

  memoryStore.orders.set('ord_test_legacy', {
    id: 'ord_test_legacy',
    orderNumber: 'QB-TEST-LEGACY',
    status: 'RIDER_ASSIGNED',
    riderStage: 'OUT_FOR_DELIVERY',
    riderId: 'rdr_legacy',
    riderName: 'Legacy Rider',
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH_ON_DELIVERY'
  } as any);

  normaliseLoadedStore();
  const migrated: any = memoryStore.orders.get('ord_test_legacy');

  if (migrated.status !== 'READY_FOR_PICKUP') {
    throw new Error(`Legacy RIDER_ASSIGNED was not migrated; status is ${migrated.status}.`);
  }
  if (migrated.riderStage !== 'PICKED_UP') {
    throw new Error(`Legacy rider stage was not migrated; stage is ${migrated.riderStage}.`);
  }
  // The rider is still on this trip. Only the FOOD's status was wrong, and a
  // migration that dropped the rider would hand a second one an order somebody
  // is already delivering.
  if (migrated.riderId !== 'rdr_legacy' || migrated.riderName !== 'Legacy Rider') {
    throw new Error('The migration lost the rider who was on the trip.');
  }
  console.log('[PASS] Test 9a: A legacy order is migrated and keeps its rider');

  /*
   * Idempotent: it runs at every boot, on a store that is usually already
   * current. A migration that changes something on the second pass would
   * rewrite live orders on every restart.
   */
  normaliseLoadedStore();
  const twice: any = memoryStore.orders.get('ord_test_legacy');
  if (twice.status !== 'READY_FOR_PICKUP' || twice.riderStage !== 'PICKED_UP') {
    throw new Error('Running the migration a second time changed the order again.');
  }
  console.log('[PASS] Test 9b: Running it again changes nothing');

  /*
   * And it must not touch orders that are already current. A rule matching too
   * broadly would rewrite live orders at every boot, and 9a and 9b both pass
   * with a migration that does.
   */
  memoryStore.orders.set('ord_test_current', {
    id: 'ord_test_current',
    status: 'PREPARING',
    riderStage: 'HEADING_TO_RESTAURANT',
    riderId: 'rdr_current'
  } as any);
  normaliseLoadedStore();
  const current: any = memoryStore.orders.get('ord_test_current');
  if (current.status !== 'PREPARING' || current.riderStage !== 'HEADING_TO_RESTAURANT') {
    throw new Error('The migration rewrote an order that was already current.');
  }
  console.log('[PASS] Test 9c: An order already on the current build is left alone');



  console.log('\n====================================================');
  console.log('    ALL 7 CHUNK 03 TESTS PASSED SUCCESSFULLY!       ');
  console.log('====================================================\n');
}

runDbTests().catch(err => {
  console.error('[FAIL] DB test failed:', err);
  process.exit(1);
});
