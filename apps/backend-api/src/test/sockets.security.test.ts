/**
 * WebSocket authorization.
 *
 * One check per hole that existed before Phase 1 of MASTER_FIX_PLAN.md, and for
 * each one the matching positive case, because a server that refuses everything
 * passes a suite of refusals and delivers nothing.
 *
 * What was wrong: the connection was authenticated and every subsequent room
 * name was trusted. `join:order` with any id returned a stranger's order and
 * their rider's live position; `join:restaurant` with any id returned whole
 * order objects for a kitchen — names, addresses, phone numbers, bills;
 * `join:admin` had no role check whatsoever; `join:riders` handed out delivery
 * offers; `rider:location` accepted coordinates for any order from any socket.
 * Identity itself came from `auth.userId` and `auth.role` in the handshake,
 * which are strings the client chooses.
 *
 * Each test below asks as the wrong person and asserts the room stays silent,
 * then asks as the right person and asserts it does not.
 */
import http from 'http';
import jwt from 'jsonwebtoken';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import {
  initSocketServer,
  closeSocketServer,
  emitOrderCreated,
  emitOrderStatusUpdate,
  emitOrderAvailableForPickup
} from '../sockets/socketServer.ts';
import { seedDatabase } from '../db/seed.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { config } from '../config/env.ts';

console.log('====================================================');
console.log('   RUNNING WEBSOCKET AUTHORIZATION SECURITY TESTS   ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean): void {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}`);
    failed++;
  }
}

function tokenFor(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, config.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
}

function connect(url: string, auth: Record<string, unknown>): ClientSocket {
  return ioClient(url, { auth, transports: ['websocket'], reconnection: false });
}

/** Resolves true if the socket connects, false if the server refuses it. */
function connectionOutcome(socket: ClientSocket): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (result: boolean) => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => settle(false), 3000);
    socket.on('connect', () => settle(true));
    socket.on('connect_error', () => settle(false));
  });
}

/** Waits briefly for an event, resolving false if it never arrives. */
function received(socket: ClientSocket, event: string, ms = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(false);
    }, ms);
    const handler = () => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(true);
    };
    socket.on(event, handler);
  });
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await seedDatabase();

  const server = http.createServer();
  initSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;

  // An ordinary customer with no relationship to anything below. Registered
  // rather than seeded, so the account is real but uninvolved — this is the
  // attacker in every test that follows.
  const outsider = await userRepository.create({
    id: 'usr_outsider_sec_' + Date.now(),
    email: `outsider${Date.now()}@example.com`,
    fullName: 'Uninvolved Person',
    phone: '+91-90000-00001',
    role: 'customer',
    passwordHash: 'not-used-in-this-test'
  } as any);

  // A real order belonging to the seeded customer at the seeded restaurant.
  const { order } = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod: 'CASH_ON_DELIVERY',
    idempotencyKey: 'idemp_sec_' + Date.now()
  });

  // ---------------------------------------------------------------------
  console.log('\n--- Identity comes from the token, never the handshake ---');

  const noToken = connect(url, { userId: 'usr_admin_01', role: 'ADMIN' });
  check(
    'A socket claiming to be an admin, with no token, is refused',
    (await connectionOutcome(noToken)) === false
  );
  noToken.close();

  const forged = connect(url, { token: jwt.sign({ sub: 'usr_admin_01', role: 'admin' }, 'wrong-signing-key') });
  check(
    'A token signed with the wrong key is refused',
    (await connectionOutcome(forged)) === false
  );
  forged.close();

  const valid = connect(url, { token: tokenFor('usr_customer_01', 'customer') });
  check('A correctly signed token connects', (await connectionOutcome(valid)) === true);

  // ---------------------------------------------------------------------
  console.log('\n--- join:admin ---');

  // The outsider announces ADMIN in the handshake as well, to prove the claim
  // is ignored rather than merely unused.
  const outsiderSocket = connect(url, {
    token: tokenFor(outsider.id, 'customer'),
    userId: 'usr_admin_01',
    role: 'ADMIN'
  });
  await connectionOutcome(outsiderSocket);

  const deniedAdmin = received(outsiderSocket, 'subscription:denied');
  outsiderSocket.emit('join:admin');
  check('A customer asking to join the control tower is refused', await deniedAdmin);

  const adminSocket = connect(url, { token: tokenFor('usr_admin_01', 'admin') });
  await connectionOutcome(adminSocket);
  adminSocket.emit('join:admin');
  await settle();

  const towerSawOrder = received(adminSocket, 'order:created');
  const outsiderSawOrder = received(outsiderSocket, 'order:created');
  emitOrderCreated('rst_bbh_01', order as any);
  check('An administrator does receive control tower traffic', await towerSawOrder);
  check('The refused customer receives none of it', (await outsiderSawOrder) === false);

  // ---------------------------------------------------------------------
  console.log('\n--- join:order ---');

  const deniedOrder = received(outsiderSocket, 'subscription:denied');
  outsiderSocket.emit('join:order', { orderId: order.id });
  check("A stranger asking to watch someone else's order is refused", await deniedOrder);

  const customerSocket = connect(url, { token: tokenFor('usr_customer_01', 'customer') });
  await connectionOutcome(customerSocket);
  customerSocket.emit('join:order', { orderId: order.id });
  await settle();

  const ownerSawStatus = received(customerSocket, 'order:status_update');
  const strangerSawStatus = received(outsiderSocket, 'order:status_update');
  emitOrderStatusUpdate(order.id, { orderId: order.id, status: 'ACCEPTED' });
  check('The order\'s own customer receives its status updates', await ownerSawStatus);
  check('The stranger receives nothing about that order', (await strangerSawStatus) === false);

  const deniedMissing = received(outsiderSocket, 'subscription:denied');
  outsiderSocket.emit('join:order', { orderId: 'ord_does_not_exist' });
  check('A subscription to an order that does not exist is refused', await deniedMissing);

  // ---------------------------------------------------------------------
  console.log('\n--- join:restaurant (carries whole orders) ---');

  const deniedKitchen = received(outsiderSocket, 'subscription:denied');
  outsiderSocket.emit('join:restaurant', { restaurantId: 'rst_bbh_01' });
  check('A customer asking for a kitchen\'s live order feed is refused', await deniedKitchen);

  const riderAtKitchen = connect(url, { token: tokenFor('usr_rider_01', 'rider') });
  await connectionOutcome(riderAtKitchen);
  const deniedRiderKitchen = received(riderAtKitchen, 'subscription:denied');
  riderAtKitchen.emit('join:restaurant', { restaurantId: 'rst_bbh_01' });
  check('A rider asking for the same feed is refused', await deniedRiderKitchen);

  const partnerSocket = connect(url, { token: tokenFor('usr_partner_01', 'restaurant_owner') });
  await connectionOutcome(partnerSocket);
  partnerSocket.emit('join:restaurant', { restaurantId: 'rst_bbh_01' });
  await settle();

  const kitchenSawOrder = received(partnerSocket, 'order:created');
  const outsiderSawKitchen = received(outsiderSocket, 'order:created');
  emitOrderCreated('rst_bbh_01', order as any);
  check('The owning partner does receive their kitchen\'s orders', await kitchenSawOrder);
  check('Nobody else does', (await outsiderSawKitchen) === false);

  // ---------------------------------------------------------------------
  console.log('\n--- join:riders (delivery offers carry addresses and payouts) ---');

  const deniedPool = received(outsiderSocket, 'subscription:denied');
  outsiderSocket.emit('join:riders');
  check('A customer asking to sit in the rider offer pool is refused', await deniedPool);

  await riderRepository.updateOnlineStatus('rdr_vikram_01', false);
  const offShift = connect(url, { token: tokenFor('usr_rider_01', 'rider') });
  await connectionOutcome(offShift);
  const deniedOffShift = received(offShift, 'subscription:denied');
  offShift.emit('join:riders');
  check('A rider who is off shift is refused — they have gone home', await deniedOffShift);
  offShift.close();

  await riderRepository.updateOnlineStatus('rdr_vikram_01', true);
  const onShift = connect(url, { token: tokenFor('usr_rider_01', 'rider') });
  await connectionOutcome(onShift);
  onShift.emit('join:riders');
  await settle();

  const riderSawOffer = received(onShift, 'order:available');
  const outsiderSawOffer = received(outsiderSocket, 'order:available');
  emitOrderAvailableForPickup({ id: order.id, orderNumber: order.orderNumber, restaurantId: 'rst_bbh_01' });
  check('A rider on shift does receive delivery offers', await riderSawOffer);
  check('The customer receives none', (await outsiderSawOffer) === false);

  // ---------------------------------------------------------------------
  console.log('\n--- rider:location (Zomato behaviour: visible only after pickup) ---');

  // Nobody is carrying this order yet.
  const strangerLocation = received(customerSocket, 'rider:location_update');
  outsiderSocket.emit('rider:location', { orderId: order.id, lat: 12.97, lng: 77.59 });
  check(
    'Fabricated coordinates from an uninvolved account never reach the customer',
    (await strangerLocation) === false
  );

  await orderRepository.assignRider(order.id, 'rdr_vikram_01', 'Vikram Singh', '+91-98765-43211', 45);
  await orderRepository.updateStatus(order.id, 'PREPARING');

  const assignedRider = connect(url, { token: tokenFor('usr_rider_01', 'rider') });
  await connectionOutcome(assignedRider);

  const beforePickup = received(customerSocket, 'rider:location_update');
  assignedRider.emit('rider:location', { orderId: order.id, lat: 12.97, lng: 77.59 });
  check(
    'Even the assigned rider is not tracked before pickup — the map stays dark',
    (await beforePickup) === false
  );

  await orderRepository.updateStatus(order.id, 'OUT_FOR_DELIVERY');

  const afterPickup = received(customerSocket, 'rider:location_update');
  assignedRider.emit('rider:location', { orderId: order.id, lat: 12.9716, lng: 77.5946, bearing: 90 });
  check('Once out for delivery, the customer sees the rider move', await afterPickup);

  const badCoordinate = received(customerSocket, 'rider:location_update');
  assignedRider.emit('rider:location', { orderId: order.id, lat: Number.NaN, lng: 77.5946 });
  check(
    'A NaN coordinate is refused rather than relayed as a broken marker',
    (await badCoordinate) === false
  );

  // ---------------------------------------------------------------------
  for (const s of [valid, outsiderSocket, adminSocket, customerSocket, partnerSocket, riderAtKitchen, onShift, assignedRider]) {
    s.close();
  }
  await closeSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`   ALL ${passed} WEBSOCKET AUTHORIZATION CHECKS PASSED   `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`   ${failed} AUTHORIZATION CHECK(S) FAILED               `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch((err) => {
  console.error('[FAIL] WebSocket authorization test crashed:', err);
  process.exit(1);
});
