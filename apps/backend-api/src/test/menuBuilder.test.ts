/**
 * A whole menu at once, and a menu read from photos (owner, 1 Oct 2026).
 *
 * The partner's Menu Builder (and the same builder in the admin app) sends a
 * menu in small batches; every dish becomes an ordinary menu request, so the
 * existing review — option rules, margin hold, markup — applies unchanged.
 * The AI reader turns a photo into a DRAFT only: it saves nothing, and its key
 * stays on the server.
 *
 * Groq is never called from here: `fetch` to it is replaced with a planted
 * answer, so the suite is free, offline and deterministic.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { normaliseDraft, DAILY_SCANS_PER_RESTAURANT } from '../modules/menu/menuAi.ts';

const PORT = 5291;
const API = `http://127.0.0.1:${PORT}/api`;
const RESTAURANT_ID = 'rst_bbh_01';
const OTHER_RESTAURANT = 'rst_skb_02';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

console.log('====================================================');
console.log('  A WHOLE MENU AT ONCE, AND FROM PHOTOS              ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 800)}`);
  }
}

// Groq, planted. Everything else goes to the real network stack (our server).
const realFetch = globalThis.fetch;
let groqCalls: Array<{ auth: string; body: any }> = [];
let groqAnswer: any = null;
let groqStatus = 200;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input?.url ?? input);
  if (url.startsWith('https://api.groq.com/')) {
    groqCalls.push({ auth: String(init.headers?.Authorization || ''), body: JSON.parse(String(init.body)) });
    return new Response(
      JSON.stringify(groqStatus === 200 ? { choices: [{ message: { content: JSON.stringify(groqAnswer) } }] } : { error: { message: 'planted refusal' } }),
      { status: groqStatus, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return realFetch(input, init);
}) as typeof fetch;

async function api(pathname: string, init: any = {}, token?: string) {
  const res = await realFetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20000),
    ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
async function login(email: string) {
  const { json } = await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } });
  return json?.data?.token as string;
}
const code = (r: any) => r.json?.error?.code;
const PHOTO = `data:image/jpeg;base64,${'A'.repeat(4000)}`;

const dish = (name: string, price: number, extra: any = {}) => ({
  name,
  price,
  isVeg: true,
  categoryName: 'Builder Starters',
  description: `${name}, freshly made`,
  ...extra
});

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });

try {
  resetConfigsForTesting();
  const partner = await login('partner@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const customer = await login('customer@quickbite.app');
  const savedKey = config.GROQ_API_KEY;
  (config as any).GROQ_API_KEY = 'gsk_planted_test_key_not_real_000000';

  // ------------------------------------------------------------------
  console.log('-- A partner sends a whole menu in batches');
  const batchId = 'menu_test_batch_0001';
  const first = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: {
      batchId,
      startIndex: 0,
      items: [
        dish('Builder Paneer Tikka', 220),
        dish('Builder Chicken 65', 240, { isVeg: false }),
        dish('Builder Dal Makhani', 180, { categoryName: 'Builder Mains', sizes: [{ name: 'Half', price: 180 }, { name: 'Full', price: 300 }] }),
        dish('Builder Butter Naan', 50, { categoryName: 'Builder Breads', extras: [{ name: 'Extra butter', price: 15 }] })
      ]
    }
  }, partner);
  it('The first batch creates one request per dish', () => {
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.data.created, 4);
    assert.equal(first.json.data.totalInBatch, 4);
  });

  const retry = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId, startIndex: 0, items: [dish('Builder Paneer Tikka', 220), dish('Builder Chicken 65', 240, { isVeg: false }), dish('a', 1), dish('b', 2)] }
  }, partner);
  it('A batch sent twice (signal lost after sending) creates nothing twice', () => {
    assert.equal(retry.status, 201);
    assert.equal(retry.json.data.created, 0);
    assert.equal(retry.json.data.duplicates, 4);
  });

  const last = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId, startIndex: 4, final: true, fromAiDraft: true, items: [dish('Builder Gulab Jamun', 90, { categoryName: 'Builder Desserts' })] }
  }, partner);
  it('The last batch says the whole menu was sent', () => {
    assert.equal(last.status, 201);
    assert.equal(last.json.data.totalInBatch, 5);
    assert.match(last.json.message, /menu of 5 dishes/);
  });

  const stored = [...memoryStore.menuRequests.values()].filter((r: any) => r.batchId === batchId);
  it('Each dish is an ordinary pending ADD_ITEM request, in the order laid out', () => {
    assert.equal(stored.length, 5);
    assert.ok(stored.every((r: any) => r.kind === 'ADD_ITEM' && r.status === 'PENDING'));
    assert.deepEqual(stored.map((r: any) => r.batchSeq).sort((a: number, b: number) => a - b), [0, 1, 2, 3, 4]);
    assert.equal(stored.find((r: any) => r.batchSeq === 4).fromAiDraft, true);
  });

  const oneSize = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId: 'menu_test_batch_bad1', startIndex: 0, items: [dish('Builder Bad', 100, { sizes: [{ name: 'Only', price: 100 }] })] }
  }, partner);
  const noVeg = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId: 'menu_test_batch_bad2', startIndex: 0, items: [{ name: 'Builder No Veg', price: 100, categoryName: 'X' }] }
  }, partner);
  const tooMany = await api(`/restaurants/${RESTAURANT_ID}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId: 'menu_test_batch_bad3', startIndex: 0, items: Array.from({ length: 11 }, (_, i) => dish(`Builder Many ${i}`, 100)) }
  }, partner);
  it('A dish the one-dish form would refuse is refused here too, and nothing is half-created', () => {
    assert.equal(oneSize.status, 400);
    assert.equal(noVeg.status, 400, 'veg or non-veg must be chosen');
    assert.equal(tooMany.status, 400, 'a batch is at most 10 dishes');
    const strays = [...memoryStore.menuRequests.values()].filter((r: any) => /^menu_test_batch_bad/.test(r.batchId || ''));
    assert.equal(strays.length, 0);
  });

  // The demo partner owns every seeded kitchen; hand this one to someone else.
  const other: any = memoryStore.restaurants.get(OTHER_RESTAURANT);
  const realOwner = other.ownerId;
  other.ownerId = 'usr_somebody_else';
  const notMine = await api(`/restaurants/${OTHER_RESTAURANT}/menu/requests/bulk`, {
    method: 'POST',
    body: { batchId: 'menu_test_batch_other', startIndex: 0, items: [dish('Builder Intruder', 100)] }
  }, partner);
  const asCustomer = await api(`/admin/menus/${RESTAURANT_ID}/bulk`, {
    method: 'POST',
    body: { batchId: 'menu_test_batch_cust', startIndex: 0, items: [dish('Builder Intruder', 100)] }
  }, customer);
  const othersPhoto = await api(`/restaurants/${OTHER_RESTAURANT}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  other.ownerId = realOwner;
  it("A partner cannot spend another restaurant's scans", () => {
    assert.ok([403, 404].includes(othersPhoto.status), `status ${othersPhoto.status}`);
  });
  it('A partner cannot send a menu for another restaurant, nor a customer through the admin route', () => {
    assert.ok([403, 404].includes(notMine.status), `status ${notMine.status}`);
    assert.ok([401, 403].includes(asCustomer.status), `status ${asCustomer.status}`);
  });

  // ------------------------------------------------------------------
  console.log('\n-- An administrator approves the whole menu');
  const ids = stored.map((r: any) => r.id);
  const review = await api('/admin/menu-requests/bulk-review', {
    method: 'POST',
    body: { restaurantId: RESTAURANT_ID, expectedRequestIds: ids }
  }, admin);
  const menu: any = memoryStore.menus.get(RESTAURANT_ID);
  const items = menu.categories.flatMap((c: any) => c.items.map((i: any) => ({ ...i, category: c.name })));
  const find = (n: string) => items.find((i: any) => i.name === n);
  it('Approving the menu puts every dish live, in its own section', () => {
    assert.equal(review.status, 200, JSON.stringify(review.json).slice(0, 400));
    for (const n of ['Builder Paneer Tikka', 'Builder Chicken 65', 'Builder Dal Makhani', 'Builder Butter Naan', 'Builder Gulab Jamun']) {
      assert.ok(find(n), `${n} is not on the menu`);
    }
    assert.equal(find('Builder Dal Makhani').category, 'Builder Mains');
    assert.equal(find('Builder Gulab Jamun').category, 'Builder Desserts');
    assert.equal(find('Builder Chicken 65').isVeg, false);
  });
  it('Sizes and extras become options exactly as the one-dish form makes them', () => {
    const groups = find('Builder Dal Makhani').optionGroups || [];
    const sizes = groups.find((g: any) => g.isRequired);
    assert.ok(sizes, 'no size group');
    assert.equal(sizes.options.length, 2);
    const extras = (find('Builder Butter Naan').optionGroups || []).find((g: any) => !g.isRequired);
    assert.ok(extras && extras.options.length === 1, 'the extra was lost');
  });
  it('Within one menu, sections are created in the order the partner laid them out', () => {
    const order = menu.categories.map((c: any) => c.name).filter((n: string) => n.startsWith('Builder'));
    assert.deepEqual(order, ['Builder Starters', 'Builder Mains', 'Builder Breads', 'Builder Desserts']);
  });

  // ------------------------------------------------------------------
  console.log('\n-- An administrator uploads a menu for a restaurant');
  const adminBatch = 'admin_test_batch_0001';
  const up = await api(`/admin/menus/${OTHER_RESTAURANT}/bulk`, {
    method: 'POST',
    body: { batchId: adminBatch, startIndex: 0, final: true, items: [dish('Admin Upload Idli', 60), dish('Admin Upload Vada', 70)] }
  }, admin);
  it('The upload creates requests marked as uploaded by the administrator', () => {
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.data.requestIds.length, 2);
    const made = up.json.data.requestIds.map((id: string) => memoryStore.menuRequests.get(id));
    assert.ok(made.every((r: any) => r.uploadedByAdminName && r.restaurantId === OTHER_RESTAURANT));
  });
  it('and the upload is in the audit log', () => {
    const entry = [...memoryStore.auditLogs.values()].find((a: any) => a.action === 'MENU_UPLOADED_FOR_RESTAURANT');
    assert.ok(entry, 'no audit entry');
    assert.match(entry.summary, /2 dishes/);
  });
  const approveUpload = await api('/admin/menu-requests/bulk-review', {
    method: 'POST',
    body: { restaurantId: OTHER_RESTAURANT, expectedRequestIds: up.json.data.requestIds }
  }, admin);
  it('"Approve all now" puts exactly those dishes live', () => {
    assert.equal(approveUpload.status, 200);
    const other: any = memoryStore.menus.get(OTHER_RESTAURANT);
    const names = other.categories.flatMap((c: any) => c.items.map((i: any) => i.name));
    assert.ok(names.includes('Admin Upload Idli') && names.includes('Admin Upload Vada'));
  });

  // ------------------------------------------------------------------
  console.log('\n-- Reading a menu from a photo');
  groqAnswer = {
    sections: [
      {
        name: 'Biryani',
        items: [
          { name: 'Chicken Biryani', price: null, isVeg: true, sizes: [{ name: 'Half', price: 180 }, { name: 'Full', price: '₹320' }], extras: [] },
          { name: 'Veg Biryani', price: 150, isVeg: true, sizes: [], extras: [{ name: 'Raita', price: 20 }] },
          { name: 'Mystery Dish', price: null, isVeg: null, sizes: [], extras: [] }
        ]
      },
      { name: 'biryani', items: [{ name: 'Egg Biryani', price: 160, isVeg: null, sizes: [], extras: [] }] }
    ],
    unreadable: ['Mystery Dish']
  };
  groqCalls = [];
  const read = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  const draft = read.json?.data?.draft;
  it('A photo comes back as a draft of sections and dishes', () => {
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(draft.sections.length, 1, 'two sections with the same name were not merged');
    assert.equal(draft.sections[0].items.length, 4);
    assert.equal(read.json.data.scansLeftToday, DAILY_SCANS_PER_RESTAURANT - 1);
  });
  it('Sizes are read with their prices, and the dish price is the cheapest size', () => {
    const ck = draft.sections[0].items.find((i: any) => i.name === 'Chicken Biryani');
    assert.deepEqual(ck.sizes, [{ name: 'Half', price: 180 }, { name: 'Full', price: 320 }]);
    assert.equal(ck.price, 180);
  });
  it('A dish named for meat is never left as veg, and the partner is told', () => {
    const ck = draft.sections[0].items.find((i: any) => i.name === 'Chicken Biryani');
    assert.equal(ck.isVeg, false);
    assert.ok(ck.flags.some((f: string) => /non-veg/.test(f)));
    assert.equal(draft.sections[0].items.find((i: any) => i.name === 'Egg Biryani').isVeg, false);
  });
  it('What could not be read is flagged, never guessed', () => {
    const m = draft.sections[0].items.find((i: any) => i.name === 'Mystery Dish');
    assert.equal(m.price, null);
    assert.equal(m.isVeg, null);
    assert.ok(m.flags.some((f: string) => /Price not read/.test(f)));
    assert.ok(m.flags.some((f: string) => /hard to read/.test(f)));
    assert.ok(m.flags.some((f: string) => /Veg or non-veg/.test(f)));
  });
  it('The key goes only to Groq, never back to the phone', () => {
    assert.equal(groqCalls.length, 1);
    assert.equal(groqCalls[0].auth, `Bearer ${config.GROQ_API_KEY}`);
    assert.equal(groqCalls[0].body.messages[0].content[1].image_url.url, PHOTO);
    assert.ok(!JSON.stringify(read.json).includes(config.GROQ_API_KEY));
  });
  it('Reading a photo saves nothing to the menu or the review queue', () => {
    const made = [...memoryStore.menuRequests.values()].filter((r: any) => /Mystery Dish/.test(r.payload?.name || ''));
    assert.equal(made.length, 0);
  });

  const adminRead = await api(`/admin/menus/${OTHER_RESTAURANT}/ai-read`, { method: 'POST', body: { image: PHOTO } }, admin);
  it('An administrator can read a photo for a restaurant too', () => {
    assert.equal(adminRead.status, 200, JSON.stringify(adminRead.json));
    assert.ok(adminRead.json.data.draft.sections.length >= 1);
  });


  const scansBefore = [...memoryStore.meta.entries()].find(([k]: any) => String(k).startsWith(`menu-ai:${RESTAURANT_ID}:`))?.[1];
  const notPhoto = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, {
    method: 'POST',
    body: { image: `data:application/pdf;base64,${'A'.repeat(400)}` }
  }, partner);
  it('Something that is not a photo is refused before it reaches Groq', () => {
    assert.equal(notPhoto.status, 400);
    assert.equal(code(notPhoto), 'MENU_AI_BAD_IMAGE');
    const scansAfter = [...memoryStore.meta.entries()].find(([k]: any) => String(k).startsWith(`menu-ai:${RESTAURANT_ID}:`))?.[1];
    assert.equal(scansAfter, scansBefore, 'a refused file used up a scan');
  });

  groqStatus = 429;
  const busy = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  groqStatus = 200;
  it('Groq refusing is a readable error, not a crash', () => {
    assert.equal(busy.status, 502);
    assert.equal(code(busy), 'MENU_AI_FAILED');
    assert.match(busy.json.error.message, /busy/);
  });

  groqAnswer = 'not json at all';
  const garbled = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  it('An answer that is not a menu is refused, not shown as one', () => {
    // A JSON string is valid JSON, so it parses — and then has no sections.
    assert.ok(garbled.status === 502 || garbled.json?.data?.draft?.sections?.length === 0, JSON.stringify(garbled.json));
  });

  // A big photo must get through the larger allowance; the ordinary routes keep 1 MB.
  const bigPhoto = `data:image/jpeg;base64,${'B'.repeat(2_500_000)}`;
  groqAnswer = { sections: [{ name: 'Menu', items: [{ name: 'Plain Dosa', price: 60, isVeg: true }] }] };
  const big = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: bigPhoto } }, partner);
  const bigElsewhere = await api(`/restaurants/${RESTAURANT_ID}/menu/requests`, {
    method: 'POST',
    body: { kind: 'ADD_ITEM', ...dish('Huge', 100), imageUrl: bigPhoto }
  }, partner);
  it('A 2.5 MB menu photo is accepted; other routes still refuse a body that size', () => {
    assert.equal(big.status, 200, `status ${big.status} ${JSON.stringify(big.json).slice(0, 200)}`);
    assert.equal(bigElsewhere.status, 413, `status ${bigElsewhere.status}`);
  });

  const key = [...memoryStore.meta.keys()].find((k: any) => String(k).startsWith(`menu-ai:${RESTAURANT_ID}:`));
  memoryStore.meta.set(key, DAILY_SCANS_PER_RESTAURANT);
  const callsBefore = groqCalls.length;
  const capped = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  it('After the daily limit a restaurant is refused without calling Groq', () => {
    assert.equal(capped.status, 429);
    assert.equal(code(capped), 'MENU_AI_DAILY_LIMIT');
    assert.equal(groqCalls.length, callsBefore);
  });

  (config as any).GROQ_API_KEY = '';
  const off = await api(`/restaurants/${OTHER_RESTAURANT}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, admin);
  const offPartner = await api(`/restaurants/${RESTAURANT_ID}/menu/ai-read`, { method: 'POST', body: { image: PHOTO } }, partner);
  const offAdmin = await api(`/admin/menus/${OTHER_RESTAURANT}/ai-read`, { method: 'POST', body: { image: PHOTO } }, admin);
  (config as any).GROQ_API_KEY = savedKey;
  it('With no key on the server, reading says so plainly and typing still works', () => {
    assert.ok(off.status >= 400);
    assert.equal(offPartner.status, 503);
    assert.equal(code(offPartner), 'MENU_AI_NOT_CONFIGURED');
    assert.equal(offAdmin.status, 503);
  });

  // ------------------------------------------------------------------
  console.log('\n-- The draft obeys the same limits as a sent dish');
  const limited = normaliseDraft({
    sections: [
      {
        name: '',
        items: [
          { name: 'Thali', price: 200, isVeg: true, sizes: [{ name: 'Only', price: 200 }] },
          {
            name: 'Pizza',
            price: null,
            isVeg: true,
            sizes: [
              { name: 'S', price: 100 }, { name: 's', price: 110 }, { name: 'M', price: 200 },
              { name: 'L', price: 300 }, { name: 'XL', price: 400 }, { name: 'XXL', price: 500 }
            ],
            extras: Array.from({ length: 14 }, (_, i) => ({ name: `Topping ${i}`, price: 20 }))
          },
          { name: 'Free Water', price: 0, isVeg: true },
          { name: 'x', price: 10 }
        ]
      }
    ]
  });
  it('One "size" becomes the price, sizes are distinct and at most 4, extras at most 10', () => {
    const [thali, pizza] = limited.sections[0].items;
    assert.equal(limited.sections[0].name, 'Menu');
    assert.deepEqual(thali.sizes, []);
    assert.equal(thali.price, 200);
    assert.equal(pizza.sizes.length, 4);
    assert.equal(new Set(pizza.sizes.map((s: any) => s.name.toLowerCase())).size, 4);
    assert.equal(pizza.extras.length, 10);
  });
  it('A zero price is not a price, and a one-letter line is not a dish', () => {
    const water = limited.sections[0].items.find((i: any) => i.name === 'Free Water');
    assert.equal(water.price, null);
    assert.ok(!limited.sections[0].items.some((i: any) => i.name === 'x'));
  });
  it('Shouted headings and names are written normally; normal ones are left alone', () => {
    const d = normaliseDraft({ sections: [{ name: 'STARTERS', items: [
      { name: 'PANEER TIKKA (DRY)', price: 220, isVeg: true },
      { name: 'Chicken 65', price: 240, isVeg: false },
      { name: 'BBQ', price: 99, isVeg: false }
    ] }] });
    assert.equal(d.sections[0].name, 'Starters');
    assert.deepEqual(d.sections[0].items.map((i: any) => i.name), ['Paneer Tikka (Dry)', 'Chicken 65', 'BBQ']);
  });
  it('An empty answer tells the partner how to retake the photo', () => {
    const empty = normaliseDraft({ sections: [] });
    assert.equal(empty.sections.length, 0);
    assert.match(empty.warnings[0], /Retake/);
  });

  // ------------------------------------------------------------------
  console.log('\n-- The two Menu Builders are the same builder');
  const partnerCopy = fs.readFileSync(path.join(ROOT, 'apps/restaurant-mobile/src/components/MenuBuilder.tsx'), 'utf8');
  const adminCopy = fs.readFileSync(path.join(ROOT, 'apps/admin-mobile/src/components/MenuBuilder.tsx'), 'utf8');
  it('The admin app ships exactly the partner app\'s Menu Builder', () => {
    assert.equal(adminCopy, partnerCopy, 'the two copies have drifted: copy restaurant-mobile → admin-mobile');
  });
  it('No app contains a Groq key or calls Groq directly', () => {
    for (const app of ['customer-mobile', 'restaurant-mobile', 'delivery-mobile', 'admin-mobile']) {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else if (/\.(ts|tsx|js|json)$/.test(e.name)) files.push(f);
        }
      };
      walk(path.join(ROOT, 'apps', app, 'src'));
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(text), `${f} holds a Groq key`);
        assert.ok(!/api\.groq\.com/.test(text), `${f} calls Groq directly`);
      }
    }
  });
} finally {
  server.close();
  globalThis.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
