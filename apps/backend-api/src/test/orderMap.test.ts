/**
 * THE MAP FITS, AND THE RIDER'S POSITION IS NOT HANDED OUT EARLY.
 *
 * -------------------------------------------------------------------------
 * THE BUG THE OWNER REPORTED
 * -------------------------------------------------------------------------
 * "when its too far it shows outside and it dosnt fit in the box".
 *
 * The native map picked a centre and a span in metres and turned that into a
 * zoom with `log2(40075016.686 / span)` — the zoom at which the span fills one
 * 256-pixel tile — while the tracking map is roughly 320x190.
 *
 * -------------------------------------------------------------------------
 * AND THE EXPLANATION I STARTED WITH WAS WRONG
 * -------------------------------------------------------------------------
 * The plan described four errors, every one of them growing with distance. My
 * first check asserted the pins fell outside the box at 8 km, and it FAILED —
 * they do not. Working it out properly:
 *
 * The span is 1.6x the distance and the zoom is a log of the span, so the two
 * scale together and THE PIXEL SEPARATION IS CONSTANT — 164px at 500m, at 2km
 * and at 30km alike. Nothing compounds. In a 190px-tall box that leaves 12.9px
 * above and below, and the marker is a 14px dot in a 2.5px ring, so the art
 * clips while the coordinate sits just inside.
 *
 * What varies with distance is the `max(400, ...)` FLOOR: under about 250m it
 * takes over and the margin opens to 29px. That is why a short trip looked fine
 * and everything beyond did not — the shape the owner reported as "when its too
 * far".
 *
 * The defect that does not depend on any of this arithmetic is that the function
 * is VIEWPORT-BLIND. It takes one argument and returns the same zoom for a
 * 320x190 box and a 190x320 box. That is the check worth keeping.
 *
 * -------------------------------------------------------------------------
 * WHY IT SURVIVED, AND WHY THIS SUITE EXISTS
 * -------------------------------------------------------------------------
 * The DRAWN FALLBACK always fitted correctly, because its `fitZoom` takes a
 * width and a height. Anybody testing on a machine without the native module saw
 * correct behaviour — which is every machine a test runner has ever run on.
 *
 * And the arithmetic lived inside two files that import React, Expo and a native
 * module, so nothing could load it to check it. It is now in `mapFit.ts` with no
 * imports at all, and this suite loads it directly.
 *
 * The checks below assert PROJECTED PIXEL POSITIONS. "A map rendered" is not the
 * property the owner reported broken; "both markers are inside the box" is.
 *
 * NORTH-SOUTH, deliberately: the box is much wider than it is tall, so the short
 * side is the one that has to hold.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import {
  boundsFor,
  centreOf,
  fitZoom,
  project,
  allPointsVisible,
  distanceMetres,
  zoomForSpanIgnoringViewport,
  FIT_PADDING
} from '../../../customer-mobile/src/lib/mapFit.ts';

const PORT = 5219;
const API = `http://127.0.0.1:${PORT}/api`;

/** The tracking map, as it is actually laid out. */
const W = 320;
const H = 190;

let failed = 0;
let passed = 0;

function check(name: string, fn: () => void) {
  const result: any = fn();
  if (result && typeof result.then === 'function') {
    failed++;
    console.log(`[FAIL] ${name}: async check in a runner that does not await.`);
    return;
  }
  passed++;
  console.log(`[PASS] ${name}`);
}

function it(name: string, fn: () => void) {
  try {
    check(name, fn);
  } catch (err: any) {
    failed++;
    passed--;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

async function api(route: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${route}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  }).catch((err: any) => ({ status: 0, __error: err?.name || String(err) }) as any);
  if (!('json' in res)) return { status: 0, json: { error: (res as any).__error } };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/* Bengaluru, and a point 8 km due north of it. Same longitude, so the
 * separation is entirely north-south — the axis the short side has to hold. */
const SOUTH = { latitude: 12.9716, longitude: 77.5946 };
const NORTH = { latitude: 12.9716 + 8000 / 111320, longitude: 77.5946 };
const EAST = { latitude: 12.9716, longitude: 77.5946 + 8000 / (111320 * Math.cos((12.9716 * Math.PI) / 180)) };

console.log('====================================================');
console.log('  BOTH PINS IN THE BOX, AND NO RIDER BEFORE PICKUP  ');
console.log('====================================================\n');

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');

try {
  /* ---------------------------------------------------------------- *
   *  THE FIXTURE IS WHAT I SAY IT IS                                 *
   * ---------------------------------------------------------------- */
  console.log('-- The two points really are 8 km apart, north to south');

  const nsMetres = distanceMetres(SOUTH, NORTH);
  const ewMetres = distanceMetres(SOUTH, EAST);
  if (Math.abs(nsMetres - 8000) > 120 || Math.abs(ewMetres - 8000) > 120) {
    throw new Error(
      `PRECONDITION: the fixture is not 8 km (north-south ${Math.round(nsMetres)} m, east-west ${Math.round(
        ewMetres
      )} m). Every check below would be about some other distance.`
    );
  }

  it('The north-south pair and the east-west pair are the same distance apart', () => {
    assert.ok(Math.abs(nsMetres - ewMetres) < 120, `${Math.round(nsMetres)} vs ${Math.round(ewMetres)}`);
  });

  /* ---------------------------------------------------------------- *
   *  THE OLD ANSWER, DEMONSTRATED RATHER THAN DESCRIBED              *
   * ---------------------------------------------------------------- */
  console.log('\n-- What the old span-to-zoom formula actually did');

  const oldSpan = Math.max(400, nsMetres * 1.6);
  const oldZoom = zoomForSpanIgnoringViewport(oldSpan);

  it('THE OLD FORMULA IS VIEWPORT-BLIND, which is the defect by construction', () => {
    /*
     * The strongest thing that can be said about it, and the one that does not
     * depend on any particular distance: it takes ONE argument. It gives the
     * same answer for a 320x190 box and a 190x320 box, and those cannot both be
     * right. A function that fits points into a viewport it has never been told
     * about is wrong however plausible its output looks.
     */
    assert.equal(zoomForSpanIgnoringViewport(oldSpan), oldZoom);
    assert.equal(
      zoomForSpanIgnoringViewport.length,
      1,
      'it takes a viewport now, so this check has stopped describing the defect'
    );
  });

  it('and it leaves 12.9px of margin, which is less than a marker is tall', () => {
    /*
     * MEASURED, not asserted. My first version of this check claimed the pins
     * fell outside the box entirely and it FAILED — they do not. The truth is
     * worse in one way and milder in another: the separation is a constant
     * 164px, so the margin is 12.9px above and below at EVERY distance, and the
     * marker is a 14px dot inside a 2.5px ring. The centre is inside; the art is
     * not.
     */
    const centre = centreOf([SOUTH, NORTH])!;
    const cp = project(centre.latitude, centre.longitude, oldZoom);
    const top = project(NORTH.latitude, NORTH.longitude, oldZoom).y - (cp.y - H / 2);
    assert.ok(top > 0, `the pin is outside the box at ${top.toFixed(1)}px, which is a different bug`);
    assert.ok(top < 20, `the margin is ${top.toFixed(1)}px, so the marker no longer clips`);
    assert.ok(top < FIT_PADDING.top, 'the old formula clears the padding a marker needs');
  });

  it('and the margin does NOT change with distance, which is what makes it a floor bug', () => {
    /*
     * The plan said four errors compounding with distance. They do not: the span
     * is 1.6x the distance and the zoom is a log of the span, so the two scale
     * together and the pixel separation is invariant. What actually varies is
     * `max(400, ...)` — under about 250m the floor takes over and the margin
     * opens up. That is why a short trip looked fine and everything else did
     * not, and it is the shape the owner described.
     */
    const marginAt = (metres: number) => {
      const b = { latitude: SOUTH.latitude + metres / 111320, longitude: SOUTH.longitude };
      const z = zoomForSpanIgnoringViewport(Math.max(400, distanceMetres(SOUTH, b) * 1.6));
      const cp = project((SOUTH.latitude + b.latitude) / 2, SOUTH.longitude, z);
      return project(b.latitude, b.longitude, z).y - (cp.y - H / 2);
    };
    const far = marginAt(30000);
    const mid = marginAt(2000);
    assert.ok(Math.abs(far - mid) < 1, `30km gives ${far.toFixed(1)}px and 2km gives ${mid.toFixed(1)}px`);
    assert.ok(marginAt(200) > mid + 10, 'the 400m floor is not what saves the short trips');
  });

  /* ---------------------------------------------------------------- *
   *  THE NEW ANSWER                                                  *
   * ---------------------------------------------------------------- */
  console.log('\n-- Fitting against the real width and height');

  it('BOTH PINS ARE INSIDE THE BOX, NORTH-SOUTH, AT 8 KM', () => {
    const z = fitZoom([SOUTH, NORTH], W, H);
    assert.equal(allPointsVisible([SOUTH, NORTH], z, W, H), true, `zoom ${z} still clips`);
  });

  it('and at 30 km, and at 200 metres', () => {
    // The errors compounded with distance, so the far case is the one that broke
    // — but a fix that only works far away would have broken the near one.
    const far = { latitude: 12.9716 + 30000 / 111320, longitude: 77.5946 };
    const near = { latitude: 12.9716 + 200 / 111320, longitude: 77.5946 };
    assert.equal(allPointsVisible([SOUTH, far], fitZoom([SOUTH, far], W, H), W, H), true, '30 km clips');
    assert.equal(allPointsVisible([SOUTH, near], fitZoom([SOUTH, near], W, H), W, H), true, '200 m clips');
  });

  it('and the pins clear the padding, not just the edge', () => {
    /*
     * A pin is drawn art anchored at its coordinate. One 40px tall sitting
     * exactly on the boundary still clips at the top, so "inside the viewport"
     * is not the property that matters — "inside the viewport minus the padding"
     * is.
     */
    const z = fitZoom([SOUTH, NORTH], W, H);
    const centre = centreOf([SOUTH, NORTH])!;
    const cp = project(centre.latitude, centre.longitude, z);
    for (const point of [SOUTH, NORTH]) {
      const p = project(point.latitude, point.longitude, z);
      const x = p.x - (cp.x - W / 2);
      const y = p.y - (cp.y - H / 2);
      assert.ok(y >= FIT_PADDING.top - 1, `a pin sits ${Math.round(y)}px from the top, inside the padding`);
      assert.ok(y <= H - FIT_PADDING.bottom + 1, `a pin sits ${Math.round(H - y)}px from the bottom`);
      assert.ok(x >= FIT_PADDING.left - 1 && x <= W - FIT_PADDING.right + 1, `x ${Math.round(x)}`);
    }
  });

  /* ---------------------------------------------------------------- *
   *  THE BOX ITSELF                                                  *
   * ---------------------------------------------------------------- */
  console.log('\n-- The bounding box, including the case that renders blank');

  it('A box round two points has the right corners', () => {
    const box = boundsFor([SOUTH, NORTH])!;
    assert.ok(box, 'no box');
    assert.equal(box.sw.latitude, SOUTH.latitude);
    assert.equal(box.ne.latitude, NORTH.latitude);
    assert.ok(box.ne.latitude > box.sw.latitude, 'north is not north of south');
  });

  it('TWO IDENTICAL POINTS PRODUCE NO BOX, because Mapbox renders one blank', () => {
    /*
     * A rider standing at the customer's door. A zero-area bounds makes Mapbox
     * zoom to maximum and draw blank grey, and blank is the one thing a tracking
     * map must never be — it reads as the app being broken at the exact moment
     * the food is arriving. Null here sends the caller to centre-and-span.
     */
    assert.equal(boundsFor([SOUTH, { ...SOUTH }]), null);
  });

  it('and a single point produces no box either, but does produce a centre', () => {
    assert.equal(boundsFor([SOUTH]), null);
    assert.deepEqual(centreOf([SOUTH]), SOUTH);
  });

  it('A rubbish coordinate does not become a box round NaN', () => {
    // These come off a network response and out of a native event. A NaN box
    // renders as a map somewhere in the ocean rather than as an error.
    assert.equal(boundsFor([SOUTH, { latitude: NaN, longitude: 77 } as any]), null);
    assert.equal(boundsFor([]), null);
  });

  /* ---------------------------------------------------------------- *
   *  THE SERVER SIDE                                                 *
   * ---------------------------------------------------------------- */
  console.log('\n-- What the tracking endpoint hands a customer');

  /*
   * THIS SUITE OWNS ITS ORDER.
   *
   * The seed creates none — `memoryStore.orders` is empty after `seedDatabase`,
   * which the first version of this suite discovered by crashing on
   * `order.customerId`. Reaching for "any order that happens to exist" is how a
   * check ends up depending on a fixture somebody else can change, and this one
   * asserts exact coordinates.
   */
  const customer = Array.from(memoryStore.users.values() as any).find(
    (u: any) => u.role === 'customer'
  ) as any;
  const restaurant = Array.from(memoryStore.restaurants.values() as any)[0] as any;

  if (!customer || !restaurant) {
    throw new Error(
      `PRECONDITION: need a customer (${Boolean(customer)}) and a restaurant (${Boolean(
        restaurant
      )}); every check below would be about nothing.`
    );
  }
  if (!restaurant.coordinates) {
    throw new Error(
      'PRECONDITION: the seeded restaurant has no coordinates, so "the restaurant position is there" would pass for the wrong reason.'
    );
  }

  const order: any = {
    id: 'ord_map_suite_1',
    orderNumber: 'QB-MAP-1',
    customerId: customer.id,
    customerName: customer.fullName,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    status: 'READY_FOR_PICKUP',
    riderId: 'rdr_vikram_01',
    riderName: 'Vikram Singh',
    deliveryCoordinates: { latitude: 12.9352, longitude: 77.6245 },
    bill: { totalAmount: 400 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  memoryStore.orders.set(order.id, order);

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: customer.email, password: 'pass123' }
  });
  const customerToken = login.json?.data?.token as string;

  it('The order customer can sign in and track their order', () => {
    assert.ok(customerToken, JSON.stringify(login.json).slice(0, 200));
  });

  // A rider position and NO pickup: the window the plan is about.
  order.riderCoordinates = { latitude: 12.95, longitude: 77.60 };
  order.riderLocationUpdatedAt = new Date().toISOString();
  order.pickedUpAt = undefined;
  memoryStore.orders.set(order.id, order);

  const beforePickup = await api(`/orders/${order.id}/tracking`, {}, customerToken);

  it('A tracking read succeeds', () => {
    assert.equal(beforePickup.status, 200, JSON.stringify(beforePickup.json).slice(0, 250));
  });

  it("THE RIDER'S POSITION IS WITHHELD UNTIL THEY ARE CARRYING THE FOOD", () => {
    /*
     * It used to go out whenever it existed, including while the rider was still
     * riding to the restaurant on a trip this customer's food is not part of
     * yet. Hiding it in the screen would not have hidden it: the coordinates
     * were in JSON any customer could read.
     */
    const d = beforePickup.json.data;
    assert.equal(d.riderCoordinates, null, `coordinates leaked before pickup: ${JSON.stringify(d.riderCoordinates)}`);
    assert.equal(d.riderLocationUpdatedAt, null, 'the timestamp leaked the fact of a position');
    assert.equal(d.riderBearing, 0, 'the bearing leaked which way they were heading');
  });

  it('but the RESTAURANT position is there, which is what phase A draws', () => {
    const d = beforePickup.json.data;
    assert.ok(d.restaurantCoordinates, 'no restaurant coordinates, so the first map phase cannot render');
    assert.equal(typeof d.restaurantCoordinates.latitude, 'number');
    assert.equal(typeof d.restaurantCoordinates.longitude, 'number');
  });

  order.pickedUpAt = new Date().toISOString();
  memoryStore.orders.set(order.id, order);
  const afterPickup = await api(`/orders/${order.id}/tracking`, {}, customerToken);

  it('and once they have collected it, the position is sent', () => {
    const d = afterPickup.json.data;
    assert.ok(d.riderCoordinates, 'the rider vanished after pickup, which is the opposite bug');
    assert.equal(d.riderCoordinates.latitude, 12.95);
    assert.ok(d.pickedUpAt, 'the screen has no way to tell which phase it is in');
  });

  /* ---------------------------------------------------------------- *
   *  THE TWO GATES MUST AGREE                                        *
   * ---------------------------------------------------------------- */
  console.log('\n-- The socket and the tracking endpoint ask the same question');

  it('An order OUT_FOR_DELIVERY always has pickedUpAt, or the socket is a hole', () => {
    /*
     * A RULE TURNED INTO A MECHANISM.
     *
     * Rider pings reach the customer two ways: this endpoint, now gated on
     * `pickedUpAt`, and the socket, gated in riderRouter on
     * `status === 'OUT_FOR_DELIVERY'`. Two gates on one fact, keyed differently.
     *
     * Today they cannot disagree, because orderRepository stamps `pickedUpAt`
     * whenever the status becomes OUT_FOR_DELIVERY (:129) and the verify-pickup
     * path sets both together (:351). If that ever stops being true, the socket
     * starts pushing coordinates the endpoint is deliberately withholding — a
     * privacy hole nothing else would report.
     *
     * Asserted against the source rather than a comment, because §11.2b: prose
     * asserting a checkable fact gets checked.
     */
    const repo = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/repositories/orderRepository.ts'),
      'utf8'
    );
    const stripped = repo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(
      stripped.includes("status === 'OUT_FOR_DELIVERY' && !order.pickedUpAt"),
      'nothing stamps pickedUpAt on OUT_FOR_DELIVERY any more, so the socket can now push coordinates the tracking endpoint withholds'
    );
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] the suite itself threw: ${err?.stack || err}`);
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
