import http from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { initSocketServer, closeSocketServer, emitOrderCreated, emitOrderStatusUpdate } from '../sockets/socketServer.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { seedDatabase } from '../db/seed.ts';
import { orderService } from '../modules/orders/orderService.ts';
import type { Order } from '@quick-bites/shared-types';

console.log('====================================================');
console.log('    RUNNING CHUNK 08 WEBSOCKETS & REAL-TIME TESTS   ');
console.log('====================================================\n');

async function runSocketTests() {
  // 1. Start Ephemeral HTTP & Socket.IO Server
  console.log('Step 1: Starting test Socket.IO server...');
  const server = http.createServer();
  initSocketServer(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as any;
  const port = address.port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`[PASS] Test server listening on ${serverUrl}`);

  // 2. Connect Client Sockets (Customer, Kitchen Terminal, Admin Tower)
  console.log('Step 2: Connecting client sockets with role authentication...');

  const customerSocket: ClientSocket = ioClient(serverUrl, {
    auth: { userId: 'usr_customer_01', role: 'CUSTOMER' },
    transports: ['websocket']
  });

  const kitchenSocket: ClientSocket = ioClient(serverUrl, {
    auth: { userId: 'usr_partner_01', role: 'RESTAURANT_PARTNER' },
    transports: ['websocket']
  });

  const adminSocket: ClientSocket = ioClient(serverUrl, {
    auth: { userId: 'usr_admin_01', role: 'ADMIN' },
    transports: ['websocket']
  });

  await Promise.all([
    new Promise<void>((resolve) => customerSocket.on('connect', () => resolve())),
    new Promise<void>((resolve) => kitchenSocket.on('connect', () => resolve())),
    new Promise<void>((resolve) => adminSocket.on('connect', () => resolve()))
  ]);

  console.log('[PASS] Customer, Kitchen Terminal, and Admin Tower connected.');

  // 3. Join Partitioned Rooms
  console.log('Step 3: Subscribing sockets to partitioned real-time rooms...');
  const testOrderId = 'ord_rt_999';
  const testRestaurantId = 'rst_rt_888';

  customerSocket.emit('join:order', { orderId: testOrderId });
  kitchenSocket.emit('join:restaurant', { restaurantId: testRestaurantId });
  // admin joins control tower automatically via role, but also joins explicitly
  adminSocket.emit('join:admin');

  // Allow room join propagation
  await new Promise((r) => setTimeout(r, 100));
  console.log('[PASS] Rooms joined: order:ord_rt_999, restaurant:rst_rt_888, admin:control_tower');

  // 4. Test Event: emitOrderCreated (Kitchen Terminal + Admin)
  console.log('Step 4: Testing emitOrderCreated real-time event distribution...');
  let kitchenReceivedOrder = false;
  let adminReceivedOrder = false;
  let customerReceivedOrder = false;

  const sampleOrder: Order = {
    id: testOrderId,
    idempotencyKey: 'idemp_socket_test',
    orderNumber: 'QB-888999',
    customerId: 'usr_customer_01',
    restaurantId: testRestaurantId,
    deliveryAddressId: 'addr_sample_01',
    status: 'ORDER_PLACED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY_SANDBOX',
    items: [],
    bill: {
      itemsTotal: 300,
      packagingFee: 20,
      deliveryFee: 0,
      platformFee: 5.9,
      gstAmount: 15,
      couponDiscount: 0,
      totalAmount: 340.9,
      deliveryDistanceKm: 3
    },
    deliveryOtp: '4821',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  kitchenSocket.once('order:created', (data: any) => {
    if (data.order?.orderNumber === 'QB-888999') {
      kitchenReceivedOrder = true;
    }
  });

  adminSocket.once('order:created', (data: any) => {
    if (data.order?.orderNumber === 'QB-888999') {
      adminReceivedOrder = true;
    }
  });

  customerSocket.once('order:created', () => {
    customerReceivedOrder = true;
  });

  emitOrderCreated(testRestaurantId, sampleOrder);

  // Wait for delivery
  await new Promise((r) => setTimeout(r, 150));

  if (!kitchenReceivedOrder) throw new Error('Kitchen terminal did not receive order:created event.');
  if (!adminReceivedOrder) throw new Error('Admin control tower did not receive order:created event.');
  if (customerReceivedOrder) throw new Error('Room isolation violation: Customer received restaurant order:created event.');

  console.log('[PASS] emitOrderCreated: Delivered to Kitchen Terminal and Admin; isolated from Customer.');

  // 5. Test Event: emitOrderStatusUpdate (Customer + Admin)
  console.log('Step 5: Testing emitOrderStatusUpdate event distribution...');
  let customerReceivedStatus = false;
  let adminReceivedStatus = false;
  let kitchenReceivedStatus = false;

  customerSocket.once('order:status_update', (data: any) => {
    if (data.orderId === testOrderId && data.status === 'PREPARING' && data.prepMinutes === 25) {
      customerReceivedStatus = true;
    }
  });

  adminSocket.once('order:status_update', (data: any) => {
    if (data.orderId === testOrderId && data.status === 'PREPARING') {
      adminReceivedStatus = true;
    }
  });

  kitchenSocket.once('order:status_update', () => {
    kitchenReceivedStatus = true;
  });

  emitOrderStatusUpdate(testOrderId, {
    orderId: testOrderId,
    status: 'PREPARING',
    prepMinutes: 25
  });

  await new Promise((r) => setTimeout(r, 150));

  if (!customerReceivedStatus) throw new Error('Customer socket did not receive order:status_update.');
  if (!adminReceivedStatus) throw new Error('Admin socket did not receive order:status_update.');
  if (kitchenReceivedStatus) throw new Error('Room isolation violation: Kitchen terminal received customer status update.');

  console.log('[PASS] emitOrderStatusUpdate: Received by Customer & Admin with prepMinutes; isolated from kitchen.');

  // 6. Test Rider Live Telemetry Relay
  console.log('Step 6: Testing Rider real-time GPS telemetry broadcast...');
  let customerReceivedRiderLocation = false;
  let adminReceivedRiderLocation = false;

  customerSocket.once('rider:location_update', (data: any) => {
    if (data.orderId === testOrderId && data.lat === 12.9716 && data.lng === 77.5946) {
      customerReceivedRiderLocation = true;
    }
  });

  adminSocket.once('rider:location_update', (data: any) => {
    if (data.orderId === testOrderId && data.bearing === 90) {
      adminReceivedRiderLocation = true;
    }
  });

  // Connect a simulated rider socket
  const riderSocket: ClientSocket = ioClient(serverUrl, {
    auth: { userId: 'usr_rider_01', role: 'DELIVERY_PARTNER' },
    transports: ['websocket']
  });

  await new Promise<void>((resolve) => riderSocket.on('connect', () => resolve()));

  riderSocket.emit('rider:location', {
    orderId: testOrderId,
    lat: 12.9716,
    lng: 77.5946,
    bearing: 90
  });

  await new Promise((r) => setTimeout(r, 150));

  if (!customerReceivedRiderLocation) throw new Error('Customer did not receive rider location update.');
  if (!adminReceivedRiderLocation) throw new Error('Admin did not receive rider location update.');

  riderSocket.disconnect();
  console.log('[PASS] Rider GPS location relayed successfully to Customer live tracking and Admin tower.');

  // 7. Test FCM Push Notification Dispatcher
  console.log('Step 7: Testing FCM Push Notification Dispatcher...');
  fcmDispatcher.clearHistory();

  await fcmDispatcher.notifyOrderPlaced('usr_customer_01', 'ord_101', 'QB-101');
  await fcmDispatcher.notifyOrderPreparing('usr_customer_01', 'ord_101', 'QB-101', 15);
  await fcmDispatcher.notifyReadyForPickup('usr_customer_01', 'ord_101', 'QB-101', '5931');
  await fcmDispatcher.notifyOutForDelivery('usr_customer_01', 'ord_101', 'QB-101', 'Sunil Rider');
  await fcmDispatcher.notifyDelivered('usr_customer_01', 'ord_101', 'QB-101');

  const history = fcmDispatcher.getSentNotifications();
  if (history.length !== 5) {
    throw new Error(`Expected 5 FCM notifications, found ${history.length}`);
  }

  const pickupNotif = history.find(n => n.data?.type === 'READY_FOR_PICKUP');
  if (!pickupNotif || pickupNotif.data?.otp !== '5931' || !pickupNotif.body.includes('5931')) {
    throw new Error('FCM pickup notification missing 4-digit handover OTP.');
  }

  const outForDeliveryNotif = history.find(n => n.data?.type === 'OUT_FOR_DELIVERY');
  if (!outForDeliveryNotif || !outForDeliveryNotif.body.includes('Sunil Rider')) {
    throw new Error('FCM out for delivery notification missing rider name.');
  }

  console.log(`[PASS] FCM Dispatcher sent ${history.length}/5 lifecycle push alerts with OTP and dynamic metadata.`);

  // 8. Test End-to-End Order Service Real-Time Integration
  console.log('Step 8: Testing End-to-End OrderService live socket & push emissions...');
  await seedDatabase();

  // Subscribe kitchen socket to rst_bbh_01
  kitchenSocket.emit('join:restaurant', { restaurantId: 'rst_bbh_01' });
  await new Promise((r) => setTimeout(r, 100));

  let liveOrderReceived = false;
  kitchenSocket.once('order:created', (payload: any) => {
    if (payload.order?.restaurantId === 'rst_bbh_01') {
      liveOrderReceived = true;
    }
  });

  const created = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: 'idemp_e2e_socket_' + Date.now()
  });

  await new Promise((r) => setTimeout(r, 150));
  if (!liveOrderReceived) {
    throw new Error('Live order creation via orderService did not broadcast order:created to kitchen room.');
  }

  // Subscribe customer to live order
  customerSocket.emit('join:order', { orderId: created.order.id });
  await new Promise((r) => setTimeout(r, 100));

  const receivedStatuses: string[] = [];
  const statusListener = (payload: any) => {
    if (payload.orderId === created.order.id) {
      receivedStatuses.push(payload.status);
    }
  };
  customerSocket.on('order:status_update', statusListener);

  await orderService.transitionStatus(created.order.id, 'ACCEPTED');
  await orderService.transitionStatus(created.order.id, 'PREPARING', 18);

  await new Promise((r) => setTimeout(r, 200));
  customerSocket.off('order:status_update', statusListener);

  if (!receivedStatuses.includes('PREPARING')) {
    throw new Error('Live status transition via orderService did not broadcast order:status_update to customer.');
  }
  console.log(`[PASS] End-to-End orderService emitted status updates [${receivedStatuses.join(', ')}] to customer.`);


  // 9. Teardown
  console.log('Step 9: Cleaning up socket connections and server...');
  customerSocket.disconnect();
  kitchenSocket.disconnect();
  adminSocket.disconnect();

  await closeSocketServer();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  console.log('\n====================================================');
  console.log('    ALL CHUNK 08 WEBSOCKET & FCM TESTS PASSED!      ');
  console.log('====================================================\n');

  // Allow libuv handles on Windows to drain before process termination
  setTimeout(() => {
    process.exit(0);
  }, 100);
}

runSocketTests().catch((err) => {
  console.error('[FAIL] WebSocket test failed:', err);
  process.exit(1);
});
