import { seedDatabase } from '../db/seed.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';

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

  console.log('\n====================================================');
  console.log('    ALL 7 CHUNK 03 TESTS PASSED SUCCESSFULLY!       ');
  console.log('====================================================\n');
}

runDbTests().catch(err => {
  console.error('[FAIL] DB test failed:', err);
  process.exit(1);
});
