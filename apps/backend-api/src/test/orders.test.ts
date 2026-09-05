import { seedDatabase } from '../db/seed.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import crypto from 'crypto';

console.log('====================================================');
console.log('    RUNNING CHUNK 04 ORDER & PAYMENT ADAPTER TESTS  ');
console.log('====================================================\n');

async function runOrderTests() {
  // 1. Seed Database
  console.log('Step 1: Seeding database...');
  await seedDatabase();

  // 2. Place Order with Idempotency Key
  console.log('Step 2: Placing new order with idempotency key and WELCOME50 coupon...');
  const testIdempotencyKey = crypto.randomUUID();

  const createResult = await orderService.createOrder({
    customerId: 'usr_customer_01', // Gold customer
    restaurantId: 'rst_bbh_01',    // Bangalore Biryani House
    deliveryAddressId: 'addr_sample_01',
    items: [
      {
        dishId: 'dish_ck_biryani',
        quantity: 1,
        selectedOptions: [
          { groupId: 'grp_portion', optionId: 'opt_large' }, // +150
          { groupId: 'grp_extras', optionId: 'opt_extra_raita' } // +30
        ]
      }
    ],
    paymentMethod: 'RAZORPAY_SANDBOX',
    couponCode: 'WELCOME50',
    idempotencyKey: testIdempotencyKey,
    distanceKm: 4.5
  });

  const order = createResult.order;
  if (!order || createResult.isDuplicate) {
    throw new Error('Order creation failed or marked duplicate on first attempt.');
  }
  console.log(`[PASS] Order created: ${order.orderNumber} (ID: ${order.id})`);

  // 3. Verify Bill Breakdown & Pricing Engine
  console.log('Step 3: Verifying pricing engine bill calculations...');
  // Base: 320 + 150 + 30 = 500.00
  if (order.bill.itemsTotal !== 500.00) {
    throw new Error(`Items total mismatch: expected 500.00, got ${order.bill.itemsTotal}`);
  }
  if (order.bill.gstAmount !== 25.00) {
    throw new Error(`GST mismatch: expected 25.00 (5%), got ${order.bill.gstAmount}`);
  }
  if (order.bill.deliveryFee !== 0.00) {
    throw new Error(`Delivery fee mismatch: expected 0.00 for Gold member, got ${order.bill.deliveryFee}`);
  }
  if (order.bill.couponDiscount !== 100.00) {
    throw new Error(`Coupon discount mismatch: expected 100.00 cap, got ${order.bill.couponDiscount}`);
  }
  // Total: 500 + 25 (GST) + 25 (packaging) + 0 (delivery) + 5.90 (platform fee) - 100 = 455.90
  if (order.bill.totalAmount !== 455.90) {
    throw new Error(`Total amount mismatch: expected 455.90, got ${order.bill.totalAmount}`);
  }
  console.log('[PASS] Step 3: Bill breakdown verified (Items: Rs 500, GST: Rs 25, Gold Free Del, Coupon: -Rs 100, Total: Rs 455.90)');

  // 4. Test Idempotency Double-Click Protection (Rule 45)
  console.log('Step 4: Testing idempotency key duplicate rejection...');
  const duplicateResult = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_pbm', quantity: 2 }],
    paymentMethod: 'RAZORPAY_SANDBOX',
    idempotencyKey: testIdempotencyKey
  });

  if (!duplicateResult.isDuplicate || duplicateResult.order.id !== order.id) {
    throw new Error('Idempotency check failed: duplicate key did not return existing order.');
  }
  console.log('[PASS] Step 4: Duplicate submission with same idempotency key returned original order without double-charging');

  // 5. Razorpay Sandbox Signature Verification
  console.log('Step 5: Simulating Razorpay payment and verifying HMAC SHA256 signature...');
  const testPaymentId = 'pay_test_' + crypto.randomUUID().substring(0, 10);
  const signature = razorpayAdapter.generateSimulatedSignature(order.orderNumber, testPaymentId);

  const confirmedOrder = await orderService.confirmPayment(order.id, testPaymentId, signature);
  if (confirmedOrder.paymentStatus !== 'PAID' || confirmedOrder.status !== 'ORDER_PLACED') {
    throw new Error('Payment confirmation failed.');
  }
  console.log('[PASS] Step 5: Payment verified via HMAC SHA256; order advanced to ORDER_PLACED');

  // 6. Order State Machine: ACCEPTED -> PREPARING with 20 min prep time
  console.log('Step 6: Advancing order through kitchen state machine...');
  await orderService.transitionStatus(order.id, 'ACCEPTED');
  const preparingOrder = await orderService.transitionStatus(order.id, 'PREPARING', 20);
  if (preparingOrder?.preparationMinutes !== 20 || preparingOrder.status !== 'PREPARING') {
    throw new Error('Failed to set prep time on PREPARING status.');
  }
  console.log('[PASS] Step 6: Kitchen terminal accepted order with 20 minutes prep time');

  // 7. Invalid Transition Prevention
  console.log('Step 7: Testing invalid state transition prevention...');
  let invalidTransitionBlocked = false;
  try {
    // Cannot skip directly from PREPARING to DELIVERED
    await orderService.transitionStatus(order.id, 'DELIVERED');
  } catch (err: any) {
    invalidTransitionBlocked = true;
  }
  if (!invalidTransitionBlocked) {
    throw new Error('State machine failed to block invalid transition from PREPARING to DELIVERED.');
  }
  console.log('[PASS] Step 7: State machine successfully blocked illegal state skip');

  // 8. Progress to OUT_FOR_DELIVERY
  await orderService.transitionStatus(order.id, 'READY_FOR_PICKUP');
  await orderService.transitionStatus(order.id, 'OUT_FOR_DELIVERY');
  console.log('[PASS] Step 8: Order transitioned to READY_FOR_PICKUP -> OUT_FOR_DELIVERY');

  // 9. OTP Delivery Verification (Rule 40)
  console.log('Step 9: Testing secure OTP-based delivery verification...');
  let wrongOtpBlocked = false;
  try {
    await orderService.transitionStatus(order.id, 'DELIVERED', undefined, '0000');
  } catch (err: any) {
    wrongOtpBlocked = true;
  }
  if (!wrongOtpBlocked) {
    throw new Error('Handover should have failed with incorrect OTP.');
  }

  const deliveredOrder = await orderService.transitionStatus(order.id, 'DELIVERED', undefined, order.deliveryOtp);
  if (deliveredOrder?.status !== 'DELIVERED') {
    throw new Error('Failed to complete delivery with valid OTP.');
  }
  console.log(`[PASS] Step 9: Delivery completed and confirmed using customer OTP (${order.deliveryOtp})`);

  console.log('\n====================================================');
  console.log('    ALL CHUNK 04 ORDER & PAYMENT TESTS PASSED!      ');
  console.log('====================================================\n');
}

runOrderTests().catch(err => {
  console.error('[FAIL] Order test failed:', err);
  process.exit(1);
});
