/**
 * AI dish pictures (owner, 20 Oct 2026). Gemini is simulated: only calls to googleapis are answered here.
 * Checks: one picture per dish name (reused, never remade), key rotation, the limit pausing a job and the job
 * carrying on from the next dish, the routes and their permission, and the secret Operations address.
 */
process.env.ADMIN_WEB_PATH = 'ops-test-secret-path';
process.env.GEMINI_API_KEYS = 'key-a,key-b';

const assert = (await import('node:assert/strict')).default;
const { createApp } = await import('../app.ts');
const { seedDatabase } = await import('../db/seed.ts');
const { memoryStore } = await import('../db/client.ts');
const { resetAuthRateLimit } = await import('../middlewares/rateLimiter.ts');
const { dishKey, findImageData, generatePicture, pictureForDish, startImageJob, resumeImageJob } = await import('../modules/menu/dishImages.ts');
const fs = await import('node:fs');
const path = await import('node:path');

const PORT = 5285;
const API = `http://127.0.0.1:${PORT}/api`;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
};
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err: any) {
    return err?.code;
  }
};

/* Simulated Gemini: per key, a queue of answers ('img' | 429 | 403). */
const PICTURE = Buffer.from('jpeg-bytes-'.repeat(20)).toString('base64');
const answers = new Map<string, Array<'img' | number>>();
let googleCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  if (!String(url).includes('googleapis.com')) return realFetch(url, init);
  googleCalls++;
  const key = init?.headers?.['x-goog-api-key'];
  const next = (answers.get(key) || ['img']).shift() ?? 'img';
  const body = next === 'img' ? { output_image: { mime_type: 'image/jpeg', data: PICTURE } } : { error: { code: next } };
  return new Response(JSON.stringify(body), { status: next === 'img' ? 200 : (next as number) });
}) as any;
const always = (key: string, answer: 'img' | number) => answers.set(key, Array(30).fill(answer));

console.log('-- The picture library: one picture per dish name');
check('sizes, brackets and numbers do not make a new picture', () =>
  assert.equal(dishKey({ name: 'Chicken Biryani (Full) 500 ml', isVeg: false }), dishKey({ name: 'chicken  biryani', isVeg: false })));
check('veg and non-veg are different pictures', () =>
  assert.notEqual(dishKey({ name: 'Biryani', isVeg: true }), dishKey({ name: 'Biryani', isVeg: false })));
check('both API answer shapes are read', () => {
  assert.equal(findImageData({ output_image: { data: PICTURE } }), PICTURE);
  assert.equal(findImageData({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: PICTURE } }] } }] }), PICTURE);
});

console.log('\n-- Keys');
check('no key: says it is not set up', async () => undefined);
assert.equal(await rejects(generatePicture('x', [])), 'AI_NOT_SET_UP');
always('key-a', 429);
always('key-b', 'img');
const got = await generatePicture('a dosa');
check('a key at its limit is passed over for the next one', () => assert.equal(got.data, PICTURE));
always('key-b', 429);
check('every key at its limit: "used up its limit"', () => undefined);
const limitCode = await rejects(generatePicture('a dosa'));
check('...the error says so', () => assert.equal(limitCode, 'AI_LIMIT_REACHED'));
const freshKey = await rejects(generatePicture('a dosa', ['key-c']));
check('a fresh key works (resting is per key)', () => assert.equal(freshKey, null));

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));
resetAuthRateLimit();
const api = async (p: string, init: any = {}, token?: string) => {
  const res = await realFetch(`${API}${p}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => ({}))) as any };
};

try {
  const { config } = await import('../config/env.ts');
  console.log('\n-- Reuse');
  config.GEMINI_API_KEYS = ['key-d'];
  always('key-d', 'img');
  googleCalls = 0;
  const one = await pictureForDish({ name: 'Ghee Roast Dosa', isVeg: true }, 'https://x.test/api');
  const two = await pictureForDish({ name: 'ghee roast dosa (Large)', isVeg: true }, 'https://x.test/api');
  check('the same dish again reuses the saved picture, no new AI call', () => {
    assert.equal(two.reused, true);
    assert.equal(two.imageUrl, one.imageUrl);
    assert.equal(googleCalls, 1);
  });

  console.log('\n-- A whole menu: pauses at the limit, carries on from the next dish');
  const restaurantId = 'rst_bbh_01';
  const menu: any = memoryStore.menus.get(restaurantId);
  const items = menu.categories.flatMap((c: any) => c.items);
  items.forEach((i: any, n: number) => {
    i.imageUrl = n < 2 ? '' : 'https://example.test/real.jpg';
    i.name = ['Kori Rotti Special', 'Pundi Gassi Special', 'Other Dish', 'Another Dish', 'More Dish'][n % 5] + ' Test';
  });
  config.GEMINI_API_KEYS = ['key-f'];
  answers.set('key-f', ['img', 429, 429, 429]);
  const job = startImageJob(restaurantId, 'MENU', 'https://x.test/api', 'usr_admin_01');
  // One picture, then 429 three times with back-off (~7 s) before the job pauses.
  for (let waited = 0; waited < 20000 && (memoryStore.imageJobs.get(job.id) as any)?.status === 'RUNNING'; waited += 250) {
    await new Promise(r => setTimeout(r, 250));
  }
  const paused: any = memoryStore.imageJobs.get(job.id);
  check('two dishes without a photo; one drawn, then paused at the limit', () => {
    assert.equal(paused.targets.length, 2);
    assert.equal(paused.status, 'PAUSED', paused.status);
    assert.equal(paused.targets.filter((t: any) => t.status === 'DONE').length, 1);
    assert.match(paused.pauseReason, /used up its limit/);
  });
  check('dishes that had a real photo were not touched', () => assert.equal(items[2].imageUrl, 'https://example.test/real.jpg'));
  config.GEMINI_API_KEYS = ['key-g'];
  always('key-g', 'img');
  resumeImageJob(job.id);
  for (let waited = 0; waited < 5000 && (memoryStore.imageJobs.get(job.id) as any)?.status === 'RUNNING'; waited += 100) {
    await new Promise(r => setTimeout(r, 100));
  }
  const finished: any = memoryStore.imageJobs.get(job.id);
  check('after a new key, Resume carries on from the next dish and finishes', () => {
    assert.equal(finished.status, 'DONE');
    assert.ok(items[0].imageUrl && items[1].imageUrl, 'both dishes have a picture');
  });

  console.log('\n-- Routes');
  const admin = (await api('/auth/login', { method: 'POST', body: { email: 'admin@quickbite.app', password: 'pass123' } })).json?.data?.token;
  const partner = (await api('/auth/login', { method: 'POST', body: { email: 'partner@quickbite.app', password: 'pass123' } })).json?.data?.token;
  config.GEMINI_API_KEYS = ['key-h'];
  always('key-h', 'img');
  const made = await api('/admin/ai-images/dish', { method: 'POST', body: { name: 'Neer Dosa', isVeg: true } }, admin);
  check('Operations gets a picture link for a dish', () => {
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.match(made.json?.data?.imageUrl, /\/api\/media\/dish-images\/img_[0-9a-f]{16}\.jpg$/);
  });
  const file = await realFetch(made.json?.data?.imageUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`));
  check('the picture link serves the image', () => {
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
  });
  const denied = await api('/admin/ai-images/dish', { method: 'POST', body: { name: 'Neer Dosa', isVeg: true } }, partner);
  check('a partner cannot use it (Operations only)', () => assert.ok(denied.status === 401 || denied.status === 403, String(denied.status)));

  console.log('\n-- The secret Operations address');
  const built = fs.existsSync(path.resolve('web/admin/index.html'));
  const plain = await realFetch(`http://127.0.0.1:${PORT}/admin`);
  check('/admin no longer serves the console page', () => assert.notEqual(plain.status, 200));
  if (built) {
    const secret = await realFetch(`http://127.0.0.1:${PORT}/ops-test-secret-path`);
    check('the secret address serves it, not indexed by search engines', () => {
      assert.equal(secret.status, 200);
      assert.match(String(secret.headers.get('x-robots-tag')), /noindex/);
    });
  } else {
    console.log('[SKIP] web/admin not built here: run scripts/build-web.mjs to check the secret address');
  }
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL AI IMAGE CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
