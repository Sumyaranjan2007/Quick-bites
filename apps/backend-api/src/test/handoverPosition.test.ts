/**
 * Where the rider was when a delivery was confirmed, checked on EVERY delivery path.
 *
 * The far-from-the-door check lived in orderService.transitionStatus, which the
 * rider app never calls: riders deliver through POST /riders/orders/:id/verify-otp.
 * So it never ran for one real delivery, and its test passed because it called
 * transitionStatus directly. It now lives in completeDelivery, which every
 * delivery path reaches, and every check here drives a REAL route.
 *
 * Run: node --experimental-strip-types src/test/handoverPosition.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { completeDelivery } from '../modules/orders/deliveryCompletion.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';

const PORT = 5272;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const DISH = 'dish_ck_biryani';
const ADDRESS = 'addr_sample_01';
const SILENT_MINUTES = 10;

console.log('====================================================');
console.log('  EVERY DELIVERY SAYS WHERE THE RIDER WAS           ');
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
async function login(email: string) {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return { token: json?.data?.token as string, user: json?.data?.user };
}

/* The fraud alert, counted where it is raised. */
const alertsFor = new Map<string, number>();
const realLog = console.log;
console.log = (...args: any[]) => {
  const line = String(args[0] ?? '');
  if (line.includes('"OPS_ALERT_DELIVERY_LOCATION_MISMATCH"')) {
    const id = /"orderId":"([^"]+)"/.exec(line)?.[1] || '?';
    alertsFor.set(id, (alertsFor.get(id) || 0) + 1);
  }
  realLog(...args);
};

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetConfigsForTesting();
  createVersion({ riderLocationSilentMinutes: SILENT_MINUTES, codCashCeiling: 100000 }, { userId: 'usr_admin_01' }, 'handover');

  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const rider = await login('rider@quickbite.app');
  const admin = await login('admin@quickbite.app');
  await api('/riders/shift', { method: 'POST', body: { isOnline: true } }, rider.token);

  /** A cash order the rider has collected and is carrying. */
  async function outForDelivery() {
    const res = await api('/orders', {
      method: 'POST',
      body: {
        restaurantId: RESTAURANT_ID,
        deliveryAddressId: ADDRESS,
        items: [{ dishId: DISH, quantity: 1, selectedOptions: [] }],
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: crypto.randomUUID()
      }
    }, customer.token);
    const order = res.json?.data?.order ?? res.json?.data;
    for (const next of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) {
      await api(`/orders/${order.id}/status`, { method: 'PUT', body: { status: next, preparationMinutes: 15 } }, partner.token);
    }
    await api(`/riders/orders/${order.id}/claim`, { method: 'POST', body: {} }, rider.token);
    await api(`/riders/orders/${order.id}/verify-pickup`, { method: 'POST', body: { pickupCode: (memoryStore.orders.get(order.id) as any).pickupCode } }, rider.token);
    return order.id as string;
  }
  const stored = (id: string) => memoryStore.orders.get(id) as any;
  /** The rider's app reporting where they are, `northMetres` from the door. */
  const reportPosition = (id: string, northMetres: number) => {
    const dest = stored(id).deliveryCoordinates;
    return api('/riders/telemetry', { method: 'POST', body: { orderId: id, lat: dest.latitude + northMetres / 111_000, lng: dest.longitude } }, rider.token);
  };
  const handOver = (id: string) =>
    api(`/riders/orders/${id}/verify-otp`, { method: 'POST', body: { deliveryOtp: stored(id).deliveryOtp } }, rider.token);

  /* ================================================================ */
  console.log('-- Far from the door, with a fresh position, through the rider route');
  const far = await outForDelivery();
  const farPosition = await reportPosition(far, 1100);
  const farDone = await handOver(far);
  it('Control: the position was accepted and the order is out for delivery', () => {
    assert.equal(farPosition.status, 200, JSON.stringify(farPosition.json).slice(0, 200));
  });
  it('The delivery completes: an honest rider is never stranded by GPS', () => {
    assert.equal(farDone.status, 200, JSON.stringify(farDone.json).slice(0, 200));
    assert.equal(stored(far).status, 'DELIVERED');
  });
  it('and it is FLAGGED, with the distance', () => {
    const flag = stored(far).deliveryProximityFlag;
    assert.equal(flag?.proximity, 'FAR', JSON.stringify(flag));
    assert.ok(flag.distanceMetres > 1000 && flag.distanceMetres < 1200, `distance ${flag.distanceMetres}`);
    assert.ok(!flag.byOperations);
  });
  it('and operations are alerted, once', () => {
    assert.equal(alertsFor.get(far) || 0, 1);
  });
  await completeDelivery(stored(far));
  it('and completing it again raises no second alert', () => {
    assert.equal(alertsFor.get(far) || 0, 1);
  });

  /* ================================================================ */
  console.log('\n-- At the door');
  const door = await outForDelivery();
  await reportPosition(door, 20);
  const doorDone = await handOver(door);
  it('A handover at the door completes, with no flag and no alert', () => {
    assert.equal(doorDone.status, 200, JSON.stringify(doorDone.json).slice(0, 200));
    assert.equal(stored(door).deliveryProximityFlag, undefined, JSON.stringify(stored(door).deliveryProximityFlag));
    assert.equal(alertsFor.get(door) || 0, 0);
  });

  /* ================================================================ */
  console.log('\n-- Far, but the last position is stale (GPS dropped on the way)');
  const stale = await outForDelivery();
  await reportPosition(stale, 3000);
  // The last point was sent half an hour ago; nothing since.
  const aged = stored(stale);
  aged.riderLocationUpdatedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  memoryStore.orders.set(stale, aged);
  const staleDone = await handOver(stale);
  it('The delivery completes', () => {
    assert.equal(staleDone.status, 200, JSON.stringify(staleDone.json).slice(0, 200));
  });
  it('and records NO_RECENT_POSITION instead of a distance nobody can trust', () => {
    const flag = stored(stale).deliveryProximityFlag;
    assert.equal(flag?.proximity, 'NO_RECENT_POSITION', JSON.stringify(flag));
    assert.equal(flag.distanceMetres, undefined);
    assert.ok(flag.positionAgeMinutes >= 30, `age ${flag.positionAgeMinutes}`);
  });
  it('and raises NO fraud alert', () => {
    assert.equal(alertsFor.get(stale) || 0, 0);
  });

  /* ================================================================ */
  console.log('\n-- Marked delivered by operations, far from the door');
  const ops = await outForDelivery();
  await reportPosition(ops, 1100);
  const opsDone = await api(
    `/admin/orders/${ops}/mark-delivered`,
    { method: 'POST', body: { reason: 'Customer confirmed by phone they have the food.', cashCollectedBy: 'RIDER' } },
    admin.token
  );
  it('Operations mark it delivered', () => {
    assert.equal(opsDone.status, 200, JSON.stringify(opsDone.json).slice(0, 200));
    assert.equal(stored(ops).status, 'DELIVERED');
  });
  it('and the distance is recorded, marked as theirs', () => {
    const flag = stored(ops).deliveryProximityFlag;
    assert.equal(flag?.proximity, 'FAR', JSON.stringify(flag));
    assert.ok(flag.distanceMetres > 1000, `distance ${flag.distanceMetres}`);
    assert.equal(flag.byOperations, true);
  });
  it('but raises no fraud alert: the staff member\'s reason is the record', () => {
    assert.equal(alertsFor.get(ops) || 0, 0);
  });

  /* ================================================================ */
  console.log('\n-- Nothing marks an order DELIVERED around completeDelivery');
  /*
   * Two functions write DELIVERED: orderRepository.updateStatus (reached only
   * through orderService.transitionStatus) and orderRepository.verifyDeliveryOtp
   * (reached only from the rider route). Each caller must then complete the
   * delivery. Checked from source, comments stripped, so the next route that
   * marks an order delivered cannot quietly skip the handover check again.
   */
  const srcRoot = fileURLToPath(new URL('..', import.meta.url));
  const strip = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const sources: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') walk(full);
      } else if (entry.name.endsWith('.ts')) {
        sources.push([path.relative(srcRoot, full), strip(fs.readFileSync(full, 'utf8'))]);
      }
    }
  };
  walk(srcRoot);
  const repoFile = path.join('db', 'repositories', 'orderRepository.ts');
  it("Only orderRepository assigns status 'DELIVERED'", () => {
    const writers = sources
      .filter(([, code]) => /\.status\s*=\s*'DELIVERED'/.test(code))
      .map(([file]) => file);
    assert.deepEqual(writers, [repoFile]);
  });
  it('and every caller of its two DELIVERED writers completes the delivery', () => {
    const callers = sources.filter(([, code]) => /orderRepository\.(verifyDeliveryOtp|updateStatus)\(/.test(code));
    assert.ok(callers.length >= 2, `found ${callers.length} callers`);
    for (const [file, code] of callers) {
      assert.match(code, /completeDelivery\(/, `${file} marks an order DELIVERED without completeDelivery`);
    }
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] The suite could not complete: ${err?.stack || err}`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
