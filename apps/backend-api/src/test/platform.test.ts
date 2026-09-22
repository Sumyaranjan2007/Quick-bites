/**
 * The machinery that runs when nobody is pressing anything.
 *
 * Everything in the other suites is triggered by a request. This one covers the
 * parts that act on their own — the sweeper that cancels an order no kitchen
 * accepted, the reconciliation that goes looking for money the gateway took and
 * never told us about, the breaker that stops calling a dead dependency — plus
 * the switches an operator throws during an incident and the journal that
 * proves the wallet balances.
 *
 * Those are exactly the pieces that cannot be checked by clicking through the
 * apps: they fire on a timer, at a boundary measured in minutes, against a
 * third party that is not available in a test. Each one here is therefore
 * exercised at its boundary with an injected clock, and each check is
 * deliberately made to FAIL once during development before being kept — a check
 * that has never failed is not evidence that anything works.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { memoryStore } from '../db/client.ts';
import { orderService } from '../modules/orders/orderService.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { sweepStaleOrders } from '../modules/orders/orderSweeper.ts';
import { reconcilePayments } from '../modules/payments/reconciliation.ts';
import { CircuitBreaker } from '../modules/platform/circuitBreaker.ts';
import { isEnabled, setFlag, listFlags, assertEnabled, FEATURE_FLAGS } from '../modules/platform/featureFlags.ts';
import { visibleContact, maskPhoneNumber, isContactable, viewerFor, shapeOrderForViewer } from '../modules/orders/contactVisibility.ts';
import { suggestAddresses, isPlacesConfigured, clearPlacesCache } from '../modules/places/placesService.ts';
import { findCancellationReason } from '../modules/orders/cancellationReasons.ts';
import { config } from '../config/env.ts';
import type { Order } from '@quick-bites/shared-types';

console.log('====================================================');
console.log('    RUNNING BACKGROUND, SWITCH AND LEDGER TESTS    ');
console.log('====================================================\n');

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

/** A moment N minutes from now, for driving a timer-based rule at its edge. */
function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

let sequence = 0;
async function placeOrder(paymentMethod: 'CASH_ON_DELIVERY' | 'RAZORPAY_SANDBOX' = 'CASH_ON_DELIVERY') {
  const { order } = await orderService.createOrder({
    customerId: 'usr_customer_01',
    restaurantId: 'rst_bbh_01',
    deliveryAddressId: 'addr_sample_01',
    items: [{ dishId: 'dish_ck_biryani', quantity: 1 }],
    paymentMethod,
    idempotencyKey: `idem_plat_${Date.now()}_${sequence++}`
  });
  return order;
}

const PORT = 6400 + Math.floor(Math.random() * 150);

async function api(path: string, token?: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function signIn(email: string): Promise<string | undefined> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass123' })
  });
  return (await res.json().catch(() => null))?.data?.token;
}

async function run() {
  await seedDatabase();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  resetAuthRateLimit();
  resetRequestRateLimit();

  // ==================================================================
  console.log('--- An order no kitchen accepted does not sit there forever ---');

  {
    const order = await placeOrder();
    const fresh = await orderRepository.findById(order.id);
    check('A new order starts in ORDER_PLACED', fresh?.status === 'ORDER_PLACED', `got ${fresh?.status}`);

    // One minute short of the timeout. The boundary is the whole point: a
    // sweeper that cancels everything would pass a test that only ever looked
    // at old orders.
    const justBefore = await sweepStaleOrders(
      minutesFromNow(config.ORDER_ACCEPT_TIMEOUT_MINUTES - 1)
    );
    check(
      'It is left alone one minute before the timeout',
      !justBefore.cancelled.includes(order.id),
      `cancelled ${justBefore.cancelled.length}`
    );
    const stillPlaced = await orderRepository.findById(order.id);
    check('and its status is untouched', stillPlaced?.status === 'ORDER_PLACED');

    // One minute past.
    const justAfter = await sweepStaleOrders(minutesFromNow(config.ORDER_ACCEPT_TIMEOUT_MINUTES + 1));
    check(
      'It is cancelled one minute after the timeout',
      justAfter.cancelled.includes(order.id),
      `cancelled ${JSON.stringify(justAfter.cancelled)}`
    );

    const cancelled = await orderRepository.findById(order.id);
    check('and the order really is CANCELLED', cancelled?.status === 'CANCELLED', `got ${cancelled?.status}`);
    check(
      'with a reason a report can count, not free text',
      (cancelled as any)?.cancellationReasonCode === 'RESTAURANT_DID_NOT_RESPOND',
      `got ${(cancelled as any)?.cancellationReasonCode}`
    );
    check(
      'and that reason is one the platform may pick, not a customer',
      findCancellationReason('RESTAURANT_DID_NOT_RESPOND')?.actors.join(',') === 'admin'
    );

    // Run again. A sweeper that cancels the same order twice would issue two
    // refunds for one payment.
    const second = await sweepStaleOrders(minutesFromNow(config.ORDER_ACCEPT_TIMEOUT_MINUTES + 5));
    check(
      'A second sweep does not cancel it again',
      !second.cancelled.includes(order.id),
      `cancelled ${JSON.stringify(second.cancelled)}`
    );
  }

  // ==================================================================
  console.log('\n--- A rider who accepts and never turns up ---');

  {
    // The gap this closes is invisible from every screen: the order is not
    // stuck waiting for a rider, it HAS one, so the no-rider escalation below
    // never fires for it. The kitchen has the food on a counter and the
    // customer's app says "rider on the way to collect".
    const order = await placeOrder();
    memoryStore.riders.set('rdr_noshow_test', {
      id: 'rdr_noshow_test',
      fullName: 'Test Rider',
      isOnline: true
    } as any);
    /*
     * The kitchen accepts and finishes before the rider claims, which is the
     * ordinary sequence: riders are offered a trip at READY_FOR_PICKUP.
     *
     * It also keeps this scenario about the one thing it is testing. Left at
     * ORDER_PLACED, the sweep that releases the no-show ALSO cancels the order
     * for never having been accepted by the kitchen - correct behaviour, but
     * it buries the no-show assertions under an unrelated cancellation.
     */
    await orderRepository.updateStatus(order.id, 'ACCEPTED', 20);
    await orderRepository.updateStatus(order.id, 'PREPARING');
    await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');

    /*
     * Copied to a string BEFORE the claim, and that is the whole point.
     *
     * This read `order.status` at assertion time and compared it with the
     * order fetched afterwards. The repository hands back the SAME object it
     * holds in the store, so `order` and the fetched order are one object:
     * the check compared a value with itself and passed no matter what
     * assignment did to it. Verified by putting a status write back into
     * `assignRider` - the assertion still passed.
     */
    const statusBeforeClaim = String(order.status);

    await orderRepository.assignRider(order.id, 'rdr_noshow_test', 'Test Rider', '9800000001', 40);

    const assigned = await orderRepository.findById(order.id);
    /*
     * Claiming moves the RIDER and leaves the FOOD alone. Both halves are
     * asserted: a claim that advanced the food's status is the original bug,
     * and a claim that set no rider stage would leave the no-show sweep with
     * nothing to find.
     */
    check('A claimed trip does not move the food',
      assigned?.status === statusBeforeClaim, `was ${statusBeforeClaim}, now ${assigned?.status}`);
    check('...and the rider is recorded as heading to the restaurant',
      assigned?.riderStage === 'HEADING_TO_RESTAURANT', `got ${assigned?.riderStage}`);

    // A minute before the warning. The boundary is the point: a sweeper that
    // warns immediately passes a test that only looks at old assignments.
    const early = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_WARN_MINUTES - 1));
    check(
      'No nudge one minute before the warning window',
      !early.noShowWarned.includes(order.id),
      `warned ${JSON.stringify(early.noShowWarned)}`
    );
    check('and the trip is still theirs', !early.released.includes(order.id));

    const warned = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_WARN_MINUTES + 1));
    check(
      'The rider is nudged once the warning window passes',
      warned.noShowWarned.includes(order.id),
      `warned ${JSON.stringify(warned.noShowWarned)}`
    );
    check(
      'and the trip is NOT taken off them yet',
      !warned.released.includes(order.id),
      'releasing without warning strands a rider who is two minutes away'
    );

    // One reminder, not one every thirty seconds.
    const nagged = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_WARN_MINUTES + 2));
    check(
      'The nudge is sent once, not on every sweep',
      !nagged.noShowWarned.includes(order.id),
      `warned again: ${JSON.stringify(nagged.noShowWarned)}`
    );

    const released = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_RELEASE_MINUTES + 1));
    check(
      'The trip is released once the release window passes',
      released.released.includes(order.id),
      `released ${JSON.stringify(released.released)}`
    );

    const pooled = await orderRepository.findById(order.id);
    /*
     * The FOOD's status is untouched by the release.
     *
     * This asserted READY_FOR_PICKUP, which passed only because releasing a
     * rider forced that status and stamped `readyAt` - a workaround for
     * claiming having overwritten the status in the first place. It declared
     * food ready that the kitchen had never finished, purely because a rider
     * wandered off. A rider leaving tells us nothing about the food, so the
     * status stays exactly where the kitchen left it.
     */
    check('and the food is left exactly where the kitchen had it',
      pooled?.status === statusBeforeClaim, `was ${statusBeforeClaim}, now ${pooled?.status}`);
    check('with no rider on it', !pooled?.riderId, `riderId ${pooled?.riderId}`);
    check(
      'and it is not offered straight back to the rider who dropped it',
      (pooled?.declinedByRiderIds || []).includes('rdr_noshow_test')
    );

    const flagged = memoryStore.riders.get('rdr_noshow_test');
    check(
      'The rider is flagged so a pattern is visible to operations',
      (flagged?.noShowCount || 0) === 1,
      `count ${flagged?.noShowCount}`
    );

    const again = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_RELEASE_MINUTES + 5));
    check(
      'A second sweep does not release it again',
      !again.released.includes(order.id),
      `released ${JSON.stringify(again.released)}`
    );

    /*
     * A rider who DOES collect must not be punished by a sweep that races them.
     *
     * The food is advanced with `updateStatus` and the rider's stage is left
     * alone, which is deliberate. A real collection goes through
     * `verifyPickup` and moves both, so this is the DISAGREEMENT case: the
     * food says delivered-in-progress, the rider's track still says heading to
     * the restaurant. Two tracks that move independently will disagree
     * eventually, and the cost of getting it wrong here is a rider stripped of
     * a trip they are actively delivering and flagged for not turning up.
     * `isAwaitingPickup` believes `pickedUpAt` over the stage for exactly this.
     */
    const collected = await placeOrder();
    memoryStore.riders.set('rdr_ontime_test', { id: 'rdr_ontime_test', fullName: 'Punctual Rider', isOnline: true } as any);
    await orderRepository.assignRider(collected.id, 'rdr_ontime_test', 'Punctual Rider', '9800000002', 40);
    await orderRepository.updateStatus(collected.id, 'OUT_FOR_DELIVERY');
    const raced = await sweepStaleOrders(minutesFromNow(config.RIDER_NOSHOW_RELEASE_MINUTES + 1));
    check(
      'A rider who collected the order keeps it',
      !raced.released.includes(collected.id),
      `released ${JSON.stringify(raced.released)}`
    );
    check(
      'and is not flagged',
      !memoryStore.riders.get('rdr_ontime_test')?.noShowCount,
      `count ${memoryStore.riders.get('rdr_ontime_test')?.noShowCount}`
    );
  }

  // ==================================================================
  console.log('\n--- Cooked food with no rider is escalated, never thrown away ---');

  {
    const order = await placeOrder();
    await orderRepository.updateStatus(order.id, 'ACCEPTED', 20);
    await orderRepository.updateStatus(order.id, 'PREPARING');
    await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');

    const late = minutesFromNow(config.RIDER_ASSIGN_ALERT_MINUTES + 2);

    const before = await sweepStaleOrders(minutesFromNow(config.RIDER_ASSIGN_ALERT_MINUTES - 2));
    check(
      'No alert before the waiting window is up',
      !before.alerted.includes(order.id),
      `alerted ${JSON.stringify(before.alerted)}`
    );

    const first = await sweepStaleOrders(late);
    check('An alert is raised once the wait is too long', first.alerted.includes(order.id));

    const after = await orderRepository.findById(order.id);
    check(
      'The order is NOT cancelled — the food is already cooked',
      after?.status === 'READY_FOR_PICKUP',
      `got ${after?.status}`
    );
    check('and the alert is stamped so it is not raised twice', Boolean(after?.riderSearchAlertedAt));

    // The control room must not receive the same alert every thirty seconds.
    const repeat = await sweepStaleOrders(minutesFromNow(config.RIDER_ASSIGN_ALERT_MINUTES + 20));
    check(
      'A later sweep does not raise it again',
      !repeat.alerted.includes(order.id),
      `alerted ${JSON.stringify(repeat.alerted)}`
    );
  }

  // ==================================================================
  console.log('\n--- A handover marked from the wrong place is flagged, not blocked ---');

  {
    const order = await placeOrder();
    await orderRepository.updateStatus(order.id, 'ACCEPTED', 15);
    await orderRepository.updateStatus(order.id, 'PREPARING');
    await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');
    await orderRepository.assignRider(order.id, 'usr_rider_01', 'Test Rider', '9800000000');
    await orderRepository.updateStatus(order.id, 'OUT_FOR_DELIVERY');

    const live = (await orderRepository.findById(order.id))!;
    const destination = live.deliveryCoordinates;
    check('The order has a delivery position to compare against', Boolean(destination));

    if (destination) {
      // Roughly 1.1 km north — well past the 300 m default.
      await orderRepository.updateRiderLocation(order.id, {
        latitude: destination.latitude + 0.01,
        longitude: destination.longitude
      } as any);

      const delivered = await orderService.transitionStatus(
        order.id,
        'DELIVERED',
        undefined,
        live.deliveryOtp
      );

      check(
        'The delivery still completes — an honest rider is never stranded by GPS',
        delivered.status === 'DELIVERED',
        `got ${delivered.status}`
      );

      const flagged = await orderRepository.findById(order.id);
      check('but it carries a proximity flag for review', Boolean(flagged?.deliveryProximityFlag));
      check(
        'and the flag records how far away it was',
        (flagged?.deliveryProximityFlag?.distanceMetres ?? 0) > config.DELIVERY_PROXIMITY_METRES,
        `${flagged?.deliveryProximityFlag?.distanceMetres} m`
      );
    }
  }

  {
    // The other half, without which the check above proves only that the code
    // runs: a delivery AT the door must not be flagged.
    const order = await placeOrder();
    await orderRepository.updateStatus(order.id, 'ACCEPTED', 15);
    await orderRepository.updateStatus(order.id, 'PREPARING');
    await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');
    await orderRepository.assignRider(order.id, 'usr_rider_01', 'Test Rider', '9800000000');
    await orderRepository.updateStatus(order.id, 'OUT_FOR_DELIVERY');

    const live = (await orderRepository.findById(order.id))!;
    if (live.deliveryCoordinates) {
      await orderRepository.updateRiderLocation(order.id, {
        latitude: live.deliveryCoordinates.latitude,
        longitude: live.deliveryCoordinates.longitude
      } as any);
      await orderService.transitionStatus(order.id, 'DELIVERED', undefined, live.deliveryOtp);
      const clean = await orderRepository.findById(order.id);
      check('A handover at the door is not flagged', !clean?.deliveryProximityFlag);
    }
  }

  // ==================================================================
  console.log('\n--- Phone numbers stop being visible when the trip ends ---');

  {
    const live = visibleContact('9812345678', 'OUT_FOR_DELIVERY');
    check('A rider on the way can be called', live.phone === '9812345678' && live.callable);
    check('and the masked form is always available for support', live.maskedPhone === '••••• ••678');

    const done = visibleContact('9812345678', 'DELIVERED');
    check('Once delivered the number is gone', done.phone === null && !done.callable);
    check('and only the last three digits remain', done.maskedPhone === '••••• ••678');

    const cancelled = visibleContact('9812345678', 'CANCELLED');
    check('A cancelled order also stops exposing it', cancelled.phone === null);

    check('Nothing is invented for an order with no number', visibleContact(null, 'OUT_FOR_DELIVERY').phone === null);
    check('A too-short number masks to nothing rather than to itself', maskPhoneNumber('12') === null);
    check('PAYMENT_PENDING is not a contactable state', !isContactable('PAYMENT_PENDING'));
  }

  // ==================================================================
  console.log('\n--- The breaker stops calling something that has stopped answering ---');

  {
    const breaker = new CircuitBreaker('Test dependency', {
      threshold: 3,
      cooldownMs: 120,
      timeoutMs: 100
    });

    const boom = async () => {
      throw new Error('connection refused');
    };

    for (let i = 0; i < 2; i++) {
      await breaker.run(boom).catch(() => null);
    }
    check('Two failures are not enough to open it', breaker.snapshot().state === 'closed');

    await breaker.run(boom).catch(() => null);
    check('The third opens it', breaker.snapshot().state === 'open', breaker.snapshot().state);

    let refusedFast = false;
    let reached = false;
    await breaker
      .run(async () => {
        reached = true;
        return 'ok';
      })
      .catch(() => {
        refusedFast = true;
      });
    check('While open, calls are refused', refusedFast);
    check('and the dependency is not touched at all', !reached);

    // After the cooldown one trial call is allowed through, and a success
    // closes it. Anything else would leave a recovered dependency shut off.
    await new Promise(resolve => setTimeout(resolve, 150));
    const trial = await breaker.run(async () => 'recovered').catch(() => null);
    check('After the cooldown a trial call gets through', trial === 'recovered');
    check('and a success closes it again', breaker.snapshot().state === 'closed');
  }

  {
    // The distinction that matters most: a gateway answering "card declined" is
    // a working gateway. Counting that as a failure would take payments offline
    // every time a few customers in a row were short of funds.
    const breaker = new CircuitBreaker('Fussy dependency', { threshold: 2, cooldownMs: 100, timeoutMs: 100 });
    // Wrapped, because a breaker that wrongly counts 4xx as an outage starts
    // REFUSING these calls part-way through the loop. An unguarded throw there
    // would abort the whole suite instead of failing this one check, which is
    // the difference between a test that reports a defect and one that hides it
    // behind a stack trace.
    let refusedDuringLoop = false;
    for (let i = 0; i < 5; i++) {
      await breaker.run(async () => ({ status: 400 }), res => res.status >= 500).catch(() => {
        refusedDuringLoop = true;
      });
    }
    check(
      'A run of 4xx answers does not open the breaker',
      !refusedDuringLoop && breaker.snapshot().state === 'closed',
      refusedDuringLoop ? 'it started refusing declined-card responses' : breaker.snapshot().state
    );

    for (let i = 0; i < 2; i++) {
      // Caught for the same reason as above: the second 5xx opens the breaker,
      // and on some orderings the call itself is then refused.
      await breaker.run(async () => ({ status: 503 }), res => res.status >= 500).catch(() => null);
    }
    check('but 5xx answers do', breaker.snapshot().state === 'open');
  }

  {
    // A dependency that accepts the connection and never replies is the case
    // that hangs a server, so the deadline has to actually fire.
    const breaker = new CircuitBreaker('Silent dependency', { threshold: 1, cooldownMs: 100, timeoutMs: 80 });
    const started = Date.now();
    let code = '';
    await breaker
      .run(signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
      .catch((error: any) => {
        code = error?.code || '';
      });
    const elapsed = Date.now() - started;
    check('A call that never answers is abandoned at the deadline', elapsed < 1000, `${elapsed} ms`);
    check('and it is reported as a timeout, not as a generic abort', code === 'DEPENDENCY_TIMEOUT', code);
  }

  // ==================================================================
  console.log('\n--- An operator can switch things off without a deployment ---');

  {
    check('Every switch is on by default', FEATURE_FLAGS.every(f => isEnabled(f.key)));
    check('Every switch says what the blocked person is told', FEATURE_FLAGS.every(f => f.blockedMessage.length > 10));
    check('Every switch is safe by default', FEATURE_FLAGS.every(f => f.defaultEnabled === true));

    setFlag('ordering', false, 'test', 'checking the switch');
    check('Turning ordering off is visible immediately', !isEnabled('ordering'));

    let blockedStatus = 0;
    let blockedMessage = '';
    try {
      assertEnabled('ordering');
    } catch (error: any) {
      blockedStatus = error?.status;
      blockedMessage = error?.message || '';
    }
    check('and it refuses with 503, not 500', blockedStatus === 503, String(blockedStatus));
    check(
      'with the operator\'s own sentence, which a customer can act on',
      blockedMessage.includes('paused'),
      blockedMessage
    );

    let placedAnyway = true;
    try {
      await placeOrder();
    } catch {
      placedAnyway = false;
    }
    check('No order can be placed while it is off', !placedAnyway);

    setFlag('ordering', true, 'test');
    check('Turning it back on restores ordering', isEnabled('ordering'));
    const restored = await placeOrder();
    check('and an order goes through again', Boolean(restored?.id));

    // A typo must not take the platform down.
    check('An unknown switch reads as on rather than off', isEnabled('no_such_switch'));
    let rejected = false;
    try {
      setFlag('no_such_switch', false);
    } catch {
      rejected = true;
    }
    check('and cannot be created by writing to it', rejected);

    const listed = listFlags();
    check('The operations screen is generated from the catalogue', listed.length === FEATURE_FLAGS.length);
    check('and every entry carries a current state', listed.every(f => typeof f.enabled === 'boolean'));

    // The admin settings endpoint used to return the settings map wholesale.
    // Pending sign-in codes live in that same map, keyed by phone number, with
    // the SHA-256 of a six-digit code beside each one — a million hashes, which
    // is about a second of work. Any admin token was therefore a way to sign in
    // as an arbitrary customer. The response is now built from the catalogue,
    // so nothing else written to that store can appear in it.
    memoryStore.settings.set('otp:919876543210', {
      phone: '919876543210',
      codeHash: 'a'.repeat(64),
      expiresAt: Date.now() + 60000,
      attempts: 0,
      lastSentAt: Date.now()
    });
    const serialised = JSON.stringify(listFlags());
    check('A pending sign-in code cannot leak through the settings screen', !serialised.includes('919876543210'));
    check('and neither can its hash', !serialised.includes('a'.repeat(64)));
    check(
      'The store really does hold it — so the check above means something',
      memoryStore.settings.has('otp:919876543210')
    );
    memoryStore.settings.delete('otp:919876543210');
  }

  {
    // The payment switches are the reason this exists: a failing gateway should
    // become "pay cash", not "the app is broken".
    setFlag('online_payments', false, 'test', 'gateway wobbling');
    let onlineBlocked = false;
    try {
      await placeOrder('RAZORPAY_SANDBOX');
    } catch (error: any) {
      onlineBlocked = error?.status === 503;
    }
    check('Online payment can be switched off on its own', onlineBlocked);

    const cashStillWorks = await placeOrder('CASH_ON_DELIVERY');
    check('while cash on delivery keeps working', Boolean(cashStillWorks?.id));
    setFlag('online_payments', true, 'test');
  }

  // ==================================================================
  console.log('\n--- The wallet balance can be re-derived from its journal ---');

  {
    const userId = 'usr_customer_01';
    // The NUMBER, not the wallet. getByUserId hands back the live object out of
    // the store, so holding the wallet and reading `.balance` afterwards reads
    // the new balance and compares it against itself.
    const openingBalance = (await walletRepository.getByUserId(userId)).balance;

    await walletRepository.credit(userId, 100, 'Test credit');
    await walletRepository.debit(userId, 40.5, 'Test debit');
    const after = await walletRepository.getByUserId(userId);

    check(
      'Credits and debits move the balance by the amount asked for',
      Math.abs(after.balance - (openingBalance + 59.5)) < 0.005,
      `${openingBalance} -> ${after.balance}`
    );

    const audit = await walletRepository.auditBalance(userId);
    check('The journal replays to the stored balance', audit.balanced, JSON.stringify(audit));
    check('and every entry records the balance it produced', audit.entries > 0);

    // The defect this whole thing exists to catch.
    const wallet = memoryStore.wallets.get(userId);
    wallet.balance = Math.round((wallet.balance + 25) * 100) / 100;
    const tampered = await walletRepository.auditBalance(userId);
    check('A balance changed behind the journal is detected', !tampered.balanced);
    check(
      'and the audit says by exactly how much',
      Math.abs(tampered.discrepancy - 25) < 0.005,
      String(tampered.discrepancy)
    );
    const allProblems = await walletRepository.auditAllBalances();
    check('and the wallet appears in the platform-wide audit', allProblems.some(p => p.userId === userId));

    // Put it back so later checks are not run against a broken wallet.
    wallet.balance = Math.round((wallet.balance - 25) * 100) / 100;
    check('Restoring it clears the discrepancy', (await walletRepository.auditBalance(userId)).balanced);
  }

  {
    const userId = 'usr_customer_01';
    const before = (await walletRepository.getByUserId(userId)).balance;

    // `credit(-500)` used to subtract five hundred rupees while skipping the
    // insufficient-funds check, because that check lives in `debit`.
    let negativeRejected = false;
    try {
      await walletRepository.credit(userId, -500, 'Should not be possible');
    } catch {
      negativeRejected = true;
    }
    check('A negative credit is refused outright', negativeRejected);
    check(
      'and the balance did not move',
      (await walletRepository.getByUserId(userId)).balance === before
    );

    let zeroRejected = false;
    try {
      await walletRepository.debit(userId, 0, 'Nothing');
    } catch {
      zeroRejected = true;
    }
    check('A zero movement is refused rather than journalled', zeroRejected);

    let overdraftRejected = false;
    try {
      await walletRepository.debit(userId, before + 100000, 'Too much');
    } catch {
      overdraftRejected = true;
    }
    check('A wallet cannot be spent below zero', overdraftRejected);
    check(
      'and the journal still balances after every refusal',
      (await walletRepository.auditBalance(userId)).balanced
    );
  }

  {
    // Sub-paise amounts used to move the balance by a rounded figure while the
    // journal recorded the unrounded one, so the two drifted apart by
    // construction on every entry.
    const userId = 'usr_rider_01';
    for (const amount of [10.005, 0.014, 33.333, 0.006]) {
      await walletRepository.credit(userId, amount, `Rounding probe ${amount}`);
    }
    const audit = await walletRepository.auditBalance(userId);
    check('Sub-paise amounts do not make the journal drift', audit.balanced, JSON.stringify(audit));
    check(
      'and no single entry disagrees with the running total it recorded',
      audit.firstDivergentEntry === null,
      String(audit.firstDivergentEntry)
    );
    check(
      'and the balance is a whole number of paise',
      Number.isInteger(Math.round(audit.storedBalance * 100)) &&
        Math.abs(audit.storedBalance * 100 - Math.round(audit.storedBalance * 100)) < 1e-6,
      String(audit.storedBalance)
    );
  }

  // ==================================================================
  console.log('\n--- Money taken with a lost webhook is found ---');

  {
    // No Razorpay credentials in a test run, so the gateway lookup returns
    // nothing. That is the honest case to check: an unpaid order past the
    // abandonment window must be closed rather than left on a customer's screen
    // forever, and one inside the window must be left alone.
    const recent = await placeOrder('RAZORPAY_SANDBOX');
    const recentResult = await reconcilePayments(minutesFromNow(1));
    check(
      'A payment a minute old is left alone — somebody may be mid-OTP',
      !recentResult.abandoned.includes(recent.id),
      JSON.stringify(recentResult.abandoned)
    );

    const stale = (await orderRepository.findById(recent.id))!;
    check('and it is still awaiting payment', stale.status === 'PAYMENT_PENDING', stale.status);

    const late = await reconcilePayments(minutesFromNow(config.PAYMENT_ABANDON_AFTER_MINUTES + 1));
    check(
      'Past the abandonment window it is closed',
      late.abandoned.includes(recent.id),
      JSON.stringify(late.abandoned)
    );
    const closed = await orderRepository.findById(recent.id);
    check('and the order is CANCELLED rather than left pending', closed?.status === 'CANCELLED', String(closed?.status));
    check(
      'with a reason that says payment, not "other"',
      (closed as any)?.cancellationReasonCode === 'PAYMENT_FAILED',
      String((closed as any)?.cancellationReasonCode)
    );
  }

  {
    // A paid order must never be swept up by the same pass.
    const paid = await placeOrder('RAZORPAY_SANDBOX');
    await orderService.markPaidByGateway(paid.id, { razorpayPaymentId: 'pay_test_reconcile' });

    const result = await reconcilePayments(minutesFromNow(config.PAYMENT_ABANDON_AFTER_MINUTES + 10));
    check(
      'An order that was paid is never abandoned',
      !result.abandoned.includes(paid.id),
      JSON.stringify(result.abandoned)
    );
    const settled = await orderRepository.findById(paid.id);
    check('and it is with the kitchen', settled?.status === 'ORDER_PLACED', String(settled?.status));
    check('marked paid', settled?.paymentStatus === 'PAID');
  }

  // ==================================================================
  console.log('\n--- Address lookup degrades instead of breaking ---');

  {
    clearPlacesCache();
    check(
      'A deployment with no Places key says so rather than guessing',
      isPlacesConfigured() === Boolean(config.GOOGLE_MAPS_SERVER_KEY)
    );

    const short = await suggestAddresses('ko', 'usr_test');
    check('Two characters never reach a paid API', short.length === 0);

    const unconfigured = await suggestAddresses('koramangala', 'usr_test');
    check(
      'and with no key configured the result is empty, not an error',
      Array.isArray(unconfigured) && unconfigured.length === 0
    );
  }

  // ==================================================================
  console.log('\n--- A background job cannot take the server down ---');

  {
    // Both jobs must survive being run against a store in any state. This is
    // the check that would have caught a sweeper that threw on an order with a
    // malformed timestamp and killed the process from inside setInterval.
    const order = await placeOrder();
    const record = memoryStore.orders.get(order.id) as Order;
    record.createdAt = 'not a date at all';

    let threw = false;
    try {
      const result = await sweepStaleOrders(minutesFromNow(120));
      check(
        'An order with an unreadable timestamp is not cancelled on a guess',
        !result.cancelled.includes(order.id)
      );
    } catch {
      threw = true;
    }
    check('The sweeper survives corrupt data instead of crashing', !threw);

    let reconcileThrew = false;
    try {
      await reconcilePayments(minutesFromNow(120));
    } catch {
      reconcileThrew = true;
    }
    check('Reconciliation survives it too', !reconcileThrew);
  }

  // ==================================================================
  console.log('\n--- The order record itself, as each reader is allowed to see it ---');

  {
    const customerToken = await signIn('customer@quickbite.app');
    const riderToken = await signIn('rider@quickbite.app');
    check('A customer and a rider can both sign in for this check',
      Boolean(customerToken) && Boolean(riderToken));

    const order = await placeOrder();
    await orderRepository.updateStatus(order.id, 'ACCEPTED', 20);
    await orderRepository.updateStatus(order.id, 'PREPARING');
    await orderRepository.updateStatus(order.id, 'READY_FOR_PICKUP');
    await orderRepository.assignRider(order.id, 'usr_rider_01', 'Test Rider', '9800000123');
    await orderRepository.updateStatus(order.id, 'OUT_FOR_DELIVERY');

    const stored = (await orderRepository.findById(order.id))!;
    check('The stored record does carry a delivery OTP', Boolean(stored.deliveryOtp));

    const asRider = await api(`/orders/${order.id}`, riderToken);
    const riderView: any = asRider.json?.data?.order || {};
    check('The assigned rider can read the order', asRider.status === 200, String(asRider.status));
    // The defect this exists for: the delivery OTP is the only proof the food
    // reached the customer, and this route used to hand it to the one person
    // who could then mark an order delivered without meeting anybody.
    check(
      'but is NOT given the delivery OTP',
      riderView.deliveryOtp === undefined,
      `the rider received ${riderView.deliveryOtp}`
    );
    check('and still gets the pickup code they need at the counter', Boolean(riderView.pickupCode));

    const asCustomer = await api(`/orders/${order.id}`, customerToken);
    const customerView: any = asCustomer.json?.data?.order || {};
    check('The customer IS given the delivery OTP — they read it out at the door',
      customerView.deliveryOtp === stored.deliveryOtp,
      String(customerView.deliveryOtp));
    check('and can call the rider while the food is on its way',
      customerView.riderPhone === '9800000123', String(customerView.riderPhone));

    await orderService.transitionStatus(order.id, 'DELIVERED', undefined, stored.deliveryOtp);

    const afterCustomer: any = (await api(`/orders/${order.id}`, customerToken)).json?.data?.order || {};
    check('Once delivered the rider number is gone from the order record too',
      !afterCustomer.riderPhone, String(afterCustomer.riderPhone));
    check('and only the masked form remains', Boolean(afterCustomer.riderPhoneMasked));

    const afterRider: any = (await api(`/orders/${order.id}`, riderToken)).json?.data?.order || {};
    check('and the rider keeps no customer number either', !afterRider.customerPhone);

    // Checked directly, because the route above cannot reach it: an unassigned
    // rider is refused by the permission check before shaping happens. The rule
    // still has to hold, because a second caller added later would rely on it.
    const someoneElse = viewerFor(stored, { id: 'usr_rider_99', role: 'rider' });
    check(
      'A rider who is not the rider for THIS order is not treated as one',
      someoneElse !== 'rider' || stored.riderId === 'usr_rider_99',
      `viewerFor returned ${someoneElse}`
    );
    check(
      'The assigned rider still is',
      viewerFor(stored, { id: stored.riderId, role: 'rider' }) === 'rider'
    );
    check(
      'and an admin is staff whoever they are',
      viewerFor(stored, { id: 'usr_admin_01', role: 'admin' }) === 'staff'
    );

    // The kitchen's own lists go through the same shaping, so the rule is one
    // rule rather than three that can drift apart. It used to delete a single
    // field, which stopped the OTP and nothing else.
    // A phone is injected because `customerPhone` is declared on Order and never
    // populated by createOrder — so a shaping check against a real order would
    // be comparing null to null and would pass however the rule was written.
    const withPhone = { ...stored, customerPhone: '9812345678' } as any;
    const kitchenLive: any = shapeOrderForViewer({ ...withPhone, status: 'PREPARING' }, 'restaurant');
    check(
      'A kitchen can call the customer about a live order',
      kitchenLive.customerPhone === '9812345678',
      String(kitchenLive.customerPhone)
    );
    check('and never holds the delivery OTP', kitchenLive.deliveryOtp === undefined);
    check('but does hold the pickup code it checks at the counter', Boolean(kitchenLive.pickupCode));

    const kitchenDone: any = shapeOrderForViewer({ ...withPhone, status: 'DELIVERED' }, 'restaurant');
    check('Once delivered the number is gone from the kitchen tablet too', !kitchenDone.customerPhone);
  }

  // ==================================================================
  console.log('\n--- The operations screen can actually read and throw the switches ---');

  {
    // Through HTTP, not through the module. The screen talks to these two
    // routes, and a switch an operator cannot reach from the app is not a kill
    // switch — it is a curl command nobody will run at eight in the evening.
    const adminToken = await signIn('admin@quickbite.app');
    check('An administrator can sign in', Boolean(adminToken));

    const read = await api('/admin/settings', adminToken);
    check('GET /admin/settings answers', read.status === 200, String(read.status));
    const payload: any = read.json?.data || {};
    check('with the switch catalogue', Array.isArray(payload.flags) && payload.flags.length === FEATURE_FLAGS.length);
    check('and with what the breakers are doing', Array.isArray(payload.dependencies));
    check(
      'and nothing else from the settings store',
      !JSON.stringify(payload).includes('otp:'),
      'the settings map is leaking again'
    );

    const off = await fetch(`http://127.0.0.1:${PORT}/api/admin/settings/flags/coupons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: false, note: 'checked from the test suite' })
    });
    check('A switch can be thrown over HTTP', off.status === 200, String(off.status));
    check('and the platform agrees it is off', !isEnabled('coupons'));

    const bad = await fetch(`http://127.0.0.1:${PORT}/api/admin/settings/flags/coupons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: 'yes please' })
    });
    check('A non-boolean is refused rather than coerced', bad.status === 400, String(bad.status));

    const unknown = await fetch(`http://127.0.0.1:${PORT}/api/admin/settings/flags/not_a_switch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: false })
    });
    check('An invented switch is a 404, not a new setting', unknown.status === 404, String(unknown.status));

    const anonymous = await fetch(`http://127.0.0.1:${PORT}/api/admin/settings`);
    check('and none of it is reachable without a token', anonymous.status === 401, String(anonymous.status));

    await fetch(`http://127.0.0.1:${PORT}/api/admin/settings/flags/coupons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: true })
    });
    check('Restoring it puts coupons back', isEnabled('coupons'));

    // Roles are the keys to the whole console, so only a super admin may cut
    // new ones. Checked from an ordinary admin account because the client also
    // hides these buttons, and a check that only exercises the hidden path
    // proves nothing about the server.
    const opsToken = await signIn('ops@quickbite.app');
    check('A scoped operations admin can sign in', Boolean(opsToken));

    const opsMe = await api('/admin/me', opsToken);
    check('and is NOT a super admin', opsMe.json?.data?.isSuperAdmin === false, JSON.stringify(opsMe.json?.data?.isSuperAdmin));

    const attempt = await fetch(`http://127.0.0.1:${PORT}/api/admin/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opsToken}` },
      body: JSON.stringify({ name: 'Should Not Exist', permissions: ['orders.view'] })
    });
    check('and cannot create a role', attempt.status === 403, String(attempt.status));

    const bySuper = await fetch(`http://127.0.0.1:${PORT}/api/admin/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: `Check ${Date.now()}`, permissions: ['orders.view'] })
    });
    // The other half: a gate that refuses everybody is not a gate.
    check('while a super admin can', bySuper.status === 200 || bySuper.status === 201, String(bySuper.status));
  }

  server.close();

  console.log('');
  console.log('====================================================');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  BACKGROUND WORK, SWITCHES AND LEDGER ALL HOLD    ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log('  SOMETHING THAT RUNS UNATTENDED IS WRONG          ');
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch(err => {
  console.error('[FAIL] Platform tests crashed:', err);
  process.exit(1);
});
