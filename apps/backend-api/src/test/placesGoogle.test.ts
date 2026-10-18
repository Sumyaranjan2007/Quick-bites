/**
 * Address search and pin-to-address on Google (master plan B2, owner 18 Oct
 * 2026): Places (New) autocomplete and details, Geocoding for a pin. Google is
 * used when GOOGLE_MAPS_SERVER_KEY is set; Mapbox until then. Google's answers
 * are simulated here: no network, no key.
 */
import assert from 'node:assert/strict';
import { config } from '../config/env.ts';
import { suggestAddresses, resolvePlace, reverseGeocode, clearPlacesCache, placesStatus } from '../modules/places/placesService.ts';

let passed = 0;
let failed = 0;
async function it(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

const realFetch = globalThis.fetch;
type Call = { url: string; method: string; headers: any; body: any };
function stub(answer: (url: string) => { status?: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method || 'GET', headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : null });
    const a = answer(String(url));
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as any;
  return calls;
}
const google = () => {
  (config as any).GOOGLE_MAPS_SERVER_KEY = 'g-test-key';
  (config as any).MAPBOX_ACCESS_TOKEN = 'mapbox-test';
  clearPlacesCache();
};

const HAROHALLI = { latitude: 12.68, longitude: 77.47 };

await it('Search asks Google Places (New) for India, near the customer, key in a header', async () => {
  google();
  const calls = stub(() => ({
    body: {
      suggestions: [
        { placePrediction: { placeId: 'ChIJ1', structuredFormat: { mainText: { text: 'Sweet Land Bakery' }, secondaryText: { text: 'Harohalli, Karnataka' } } } },
        { queryPrediction: { text: { text: 'bakery near me' } } }
      ]
    }
  }));
  const found = await suggestAddresses('sweet land', 'caller-1', { near: HAROHALLI });
  assert.deepEqual(found, [{ placeId: 'ChIJ1', primary: 'Sweet Land Bakery', secondary: 'Harohalli, Karnataka' }]);
  assert.ok(calls[0].url.endsWith('/v1/places:autocomplete'));
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['X-Goog-Api-Key'], 'g-test-key');
  assert.deepEqual(calls[0].body.includedRegionCodes, ['in']);
  assert.equal(calls[0].body.locationBias.circle.center.latitude, 12.68);
  assert.ok(!calls[0].url.includes('g-test-key'));
});

await it('Choosing a suggestion gets its position and locality from Place Details', async () => {
  google();
  const calls = stub(() => ({
    body: {
      formattedAddress: 'Sweet Land Bakery, Main Rd, Harohalli, Karnataka 562112',
      location: { latitude: 12.6812, longitude: 77.4745 },
      addressComponents: [
        { longText: 'Harohalli', types: ['locality', 'political'] },
        { longText: '562112', types: ['postal_code'] }
      ]
    }
  }));
  const place = await resolvePlace('ChIJ1', 'caller-1', 'session-1');
  assert.equal(place?.latitude, 12.6812);
  assert.equal(place?.locality, 'Harohalli');
  assert.equal(place?.postalCode, '562112');
  assert.ok(calls[0].url.includes('/v1/places/ChIJ1?sessionToken=session-1'), calls[0].url);
  assert.equal(calls[0].headers['X-Goog-FieldMask'], 'formattedAddress,location,addressComponents');
});

await it('A map pin becomes an address through Geocoding', async () => {
  google();
  stub(() => ({
    body: {
      status: 'OK',
      results: [{
        formatted_address: 'Near Sweet Land Bakery, Harohalli 562112',
        geometry: { location: { lat: 12.6811, lng: 77.4744 } },
        address_components: [{ long_name: 'Harohalli', types: ['locality'] }, { long_name: '562112', types: ['postal_code'] }]
      }]
    }
  }));
  const pin = await reverseGeocode(12.6811, 77.4744, 'caller-1');
  assert.equal(pin?.formattedAddress, 'Near Sweet Land Bakery, Harohalli 562112');
  assert.equal(pin?.locality, 'Harohalli');
});

await it('A refused key (REQUEST_DENIED) answers nothing, is reported, and is not remembered', async () => {
  google();
  stub(() => ({ body: { status: 'REQUEST_DENIED', error_message: 'API key not valid' } }));
  const refused = await reverseGeocode(12.69, 77.48, 'caller-2');
  assert.equal(refused, null);
  assert.equal(placesStatus().lastRefusal?.status, 'REQUEST_DENIED');
  stub(() => ({ body: { status: 'OK', results: [{ formatted_address: 'Fixed', geometry: { location: { lat: 12.69, lng: 77.48 } }, address_components: [] }] } }));
  const later = await reverseGeocode(12.69, 77.48, 'caller-2');
  assert.equal(later?.formattedAddress, 'Fixed', 'the refusal was cached');
});

await it('Without a Google key, Mapbox is still asked (live keeps working until the key is set)', async () => {
  (config as any).GOOGLE_MAPS_SERVER_KEY = '';
  (config as any).MAPBOX_ACCESS_TOKEN = 'mapbox-test';
  clearPlacesCache();
  const calls = stub(() => ({ body: { suggestions: [] } }));
  await suggestAddresses('main road', 'caller-3');
  assert.ok(calls[0]?.url.includes('api.mapbox.com'), calls[0]?.url);
  assert.equal(placesStatus().provider, 'MAPBOX');
});

globalThis.fetch = realFetch;
console.log(`\n  ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
