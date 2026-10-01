/**
 * The app-side maths behind three of the owner's 1 Oct 2026 requests, loaded
 * straight from the apps' own files (they import nothing):
 *
 *   - "after the restaurant accepts, the customer sees the whole map of India"
 *     and the same for the rider: the camera must frame the actual trip;
 *   - "admins can't download documents": the saved file needs a usable name.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCamera, isPlottable } from '../../../customer-mobile/src/lib/cameraFit.ts';
import { documentFileName } from '../../../admin-mobile/src/lib/fileName.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

console.log('====================================================');
console.log('  MAP FRAMING AND SAVED FILE NAMES                   ');
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

// Where a point lands on screen for a given camera: Mapbox GL's own projection
// (zoom 0 = one 512-dp tile), measured from the centre of the view.
function onScreen(p: { latitude: number; longitude: number }, cam: { centre: any; zoom: number }, w: number, h: number) {
  const world = (q: any) => {
    const sin = Math.sin((q.latitude * Math.PI) / 180);
    return { x: ((q.longitude + 180) / 360) * 512, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 512 };
  };
  const scale = 2 ** cam.zoom;
  const a = world(p);
  const c = world(cam.centre);
  return { x: w / 2 + (a.x - c.x) * scale, y: h / 2 + (a.y - c.y) * scale };
}

const KITCHEN = { latitude: 12.9763, longitude: 77.5929 };
const DOOR = { latitude: 12.9352, longitude: 77.6245 }; // ~5.7 km away
const W = 360;
const H = 220;

console.log('-- The map frames the trip, not the country');
const cam = fitCamera([KITCHEN, DOOR], W, H)!;
it('Two points 5 km apart give a city-street zoom, not India', () => {
  assert.ok(cam, 'no camera');
  assert.ok(cam.zoom >= 11 && cam.zoom <= 14, `zoom ${cam.zoom}`);
});
it('Both points are on screen, clear of the edges', () => {
  for (const p of [KITCHEN, DOOR]) {
    const s = onScreen(p, cam, W, H);
    assert.ok(s.x >= W * 0.1 && s.x <= W * 0.9 && s.y >= H * 0.1 && s.y <= H * 0.9, JSON.stringify(s));
  }
});
it('and the trip fills a good part of the map rather than a speck in it', () => {
  const a = onScreen(KITCHEN, cam, W, H);
  const b = onScreen(DOOR, cam, W, H);
  assert.ok(Math.abs(a.x - b.x) >= W * 0.4 || Math.abs(a.y - b.y) >= H * 0.4, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
});
it('A missing location stored as 0,0 is ignored, not framed', () => {
  assert.equal(isPlottable({ latitude: 0, longitude: 0 }), false);
  assert.equal(isPlottable(null), false);
  const withJunk = fitCamera([KITCHEN, { latitude: 0, longitude: 0 }, DOOR], W, H)!;
  assert.equal(withJunk.zoom, cam.zoom);
});
it('A rider at the door is shown close, not at country scale', () => {
  const near = fitCamera([DOOR, { latitude: DOOR.latitude + 0.0002, longitude: DOOR.longitude }], W, H)!;
  assert.equal(near.zoom, 17);
  assert.equal(fitCamera([DOOR, DOOR], W, H)!.zoom, 16);
});
it('A map that has not been measured yet gives no camera, rather than a wrong one', () => {
  assert.equal(fitCamera([KITCHEN, DOOR], 0, 0), null);
});
it('A long trip is still framed at city-region scale at worst', () => {
  const far = fitCamera([KITCHEN, { latitude: 13.2, longitude: 77.7 }], W, H)!;
  assert.ok(far.zoom >= 8 && far.zoom < cam.zoom, `zoom ${far.zoom}`);
});
it('The customer app and the rider app frame a trip the same way', () => {
  const a = fs.readFileSync(path.join(ROOT, 'apps/customer-mobile/src/lib/cameraFit.ts'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'apps/delivery-mobile/src/lib/cameraFit.ts'), 'utf8');
  assert.equal(a, b, 'the two copies of cameraFit.ts have drifted');
});

console.log('\n-- A saved document has a name a person can use');
it('The name says what it is, whose, and the date', () => {
  const name = documentFileName(['Bangalore Biryani House', 'FSSAI licence']);
  assert.match(name, /^Bangalore-Biryani-House_FSSAI-licence_\d{4}-\d{2}-\d{2}$/);
});
it('Characters a phone refuses in a file name are removed, and blanks skipped', () => {
  const name = documentFileName(['R/K: "Kitchen" <1>', undefined, '', null, 'PAN?']);
  assert.ok(!/[\/\:*?"<>|]/.test(name), name);
  assert.match(name, /^R-K-Kitchen-1_PAN_/);
});
it('A very long name is cut to a length every phone accepts', () => {
  assert.ok(documentFileName(['x'.repeat(300)]).length <= 90);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
