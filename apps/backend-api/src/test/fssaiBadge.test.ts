/**
 * The "FSSAI verified" badge: only for a licence an administrator approved.
 *
 * The customer app printed "FSSAI verified partner kitchen" on every restaurant,
 * including kitchens whose licence field held typed letters. The server now
 * sends `fssaiVerified`, true only for a real 14-digit number whose latest FSSAI
 * document was APPROVED (and, where the document records a number, the same
 * one). This suite checks the rule directly and through the two public routes
 * the app reads, both ways round: pending -> no badge, approved -> badge,
 * placeholder number -> no badge even when approved.
 */
import http from 'node:http';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { isFssaiVerified } from '../modules/restaurants/restaurantDocuments.ts';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`[PASS] ${label}`);
  else {
    failures++;
    console.error(`[FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

const doc = (status: 'PENDING' | 'APPROVED' | 'REJECTED', submittedAt: string, documentNumber?: string): any => ({
  id: `kyc_${submittedAt}`, entityType: 'RESTAURANT', entityId: 'r1', entityName: 'R', documentType: 'FSSAI',
  documentNumber, fileUrl: 'https://example.test/f.jpg', status, submittedAt
});

async function run() {
  // The rule on its own.
  const good = '11223344556677';
  check('approved 14-digit licence is verified', isFssaiVerified(good, [doc('APPROVED', '2026-10-01T00:00:00Z', good)]));
  check('approved licence with spaces in the number is verified',
    isFssaiVerified('1122 3344 5566 77', [doc('APPROVED', '2026-10-01T00:00:00Z', good)]));
  check('no document -> not verified', !isFssaiVerified(good, []));
  check('pending document -> not verified', !isFssaiVerified(good, [doc('PENDING', '2026-10-01T00:00:00Z', good)]));
  check('rejected document -> not verified', !isFssaiVerified(good, [doc('REJECTED', '2026-10-01T00:00:00Z', good)]));
  check('placeholder letters -> not verified even when approved',
    !isFssaiVerified('Ysududuebdhdi', [doc('APPROVED', '2026-10-01T00:00:00Z', 'Ysududuebdhdi')]));
  check('13 digits -> not verified', !isFssaiVerified('1122334455667', [doc('APPROVED', '2026-10-01T00:00:00Z')]));
  check('missing number -> not verified', !isFssaiVerified(undefined, [doc('APPROVED', '2026-10-01T00:00:00Z')]));
  check('approved document for a different number -> not verified',
    !isFssaiVerified(good, [doc('APPROVED', '2026-10-01T00:00:00Z', '99999999999999')]));
  check('latest submission wins: approved then rejected re-upload -> not verified',
    !isFssaiVerified(good, [doc('APPROVED', '2026-10-01T00:00:00Z', good), doc('REJECTED', '2026-10-02T00:00:00Z', good)]));
  check('latest submission wins: rejected then approved -> verified',
    isFssaiVerified(good, [doc('REJECTED', '2026-10-01T00:00:00Z', good), doc('APPROVED', '2026-10-02T00:00:00Z', good)]));
  check('a non-FSSAI approval does not count',
    !isFssaiVerified(good, [{ ...doc('APPROVED', '2026-10-01T00:00:00Z', good), documentType: 'PAN' }]));

  // Through the public routes the customer app reads.
  await seedDatabase();
  const server = http.createServer(createApp());
  await new Promise<void>(r => server.listen(0, r));
  const port = (server.address() as any).port;
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}/api${path}`)).json();
  const RESTAURANT = 'rst_bbh_01';
  const inFeed = async () => (await get('/restaurants')).data.restaurants.find((r: any) => r.id === RESTAURANT);
  const detail = async () => (await get(`/restaurants/${RESTAURANT}`)).data.restaurant;

  try {
    const seeded = (await kycRepository.findByEntity('RESTAURANT', RESTAURANT)).find(d => d.documentType === 'FSSAI');
    check('seed has a pending FSSAI document for the demo kitchen', seeded?.status === 'PENDING');

    check('feed: pending licence -> fssaiVerified false', (await inFeed())?.fssaiVerified === false);
    check('detail: pending licence -> fssaiVerified false', (await detail())?.fssaiVerified === false);

    await kycRepository.reviewDocument(seeded!.id, 'APPROVED');
    check('feed: approved licence -> fssaiVerified true', (await inFeed())?.fssaiVerified === true);
    check('detail: approved licence -> fssaiVerified true', (await detail())?.fssaiVerified === true);

    // A placeholder typed into the licence field after approval loses the badge.
    const restaurant: any = memoryStore.restaurants.get(RESTAURANT);
    const real = restaurant.fssaiLicenseNumber;
    restaurant.fssaiLicenseNumber = 'Ysududuebdhdi';
    check('feed: placeholder number -> fssaiVerified false', (await inFeed())?.fssaiVerified === false);
    check('detail: placeholder number -> fssaiVerified false', (await detail())?.fssaiVerified === false);
    restaurant.fssaiLicenseNumber = real;

    const others = (await get('/restaurants')).data.restaurants.filter((r: any) => r.id !== RESTAURANT);
    check('every other seeded kitchen (no approved licence) has no badge',
      others.length > 0 && others.every((r: any) => r.fssaiVerified === false));
  } finally {
    server.close();
  }

  if (failures === 0) {
    console.log('\nFSSAI BADGE: ALL CHECKS PASSED');
    process.exit(0);
  }
  console.log(`\nFSSAI BADGE: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}

run().catch(err => {
  console.error('[FAIL] FSSAI badge suite aborted:', err.message);
  process.exit(1);
});
