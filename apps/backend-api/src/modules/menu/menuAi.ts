/**
 * Reading a restaurant's printed menu from a photo (owner, 1 Oct 2026).
 *
 * A partner (or an administrator for them) photographs each menu page. Each
 * photo is sent HERE, and this calls Groq's vision model with the platform's
 * key, which lives only in the server's environment — it is never sent to, or
 * built into, an app.
 *
 * NOTHING IS SAVED. The answer is a draft: sections, dishes, prices, sizes,
 * extras, veg or not. It opens in the Menu Builder, the partner checks it, adds
 * photos, and sends the whole menu for approval like any other menu request.
 * Anything the model was unsure of is flagged so the screen can point at it.
 *
 * Every field is checked against the same limits the menu-request route
 * enforces, so a draft that passes here cannot be refused when it is sent.
 */
import { config } from '../../config/env.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** One photo per call keeps each request small and lets the app show progress. */
export const MAX_IMAGE_CHARS = 6_000_000;
/** Scans a restaurant may run in one IST day, so a mistake cannot run up a bill. */
export const DAILY_SCANS_PER_RESTAURANT = 40;

export interface DraftDish {
  name: string;
  description?: string;
  /** The plain price. With sizes, the cheapest size. */
  price: number | null;
  /** true / false, or null when the menu does not say and the name does not tell. */
  isVeg: boolean | null;
  sizes: Array<{ name: string; price: number }>;
  extras: Array<{ name: string; price: number }>;
  /** Plain words for anything the partner must check. */
  flags: string[];
}

export interface DraftSection {
  name: string;
  items: DraftDish[];
}

export interface MenuDraft {
  sections: DraftSection[];
  warnings: string[];
}

export function isMenuAiConfigured(): boolean {
  return config.GROQ_API_KEY.length > 0;
}

const PROMPT = `You are reading ONE page of an Indian restaurant's printed menu from a photo.
Return ONLY a JSON object, no prose, in exactly this shape:
{"sections":[{"name":string,"items":[{"name":string,"description":string,"price":number|null,"isVeg":true|false|null,"sizes":[{"name":string,"price":number}],"extras":[{"name":string,"price":number}]}]}],"unreadable":string[]}
Rules:
- "sections" follow the menu's own headings (e.g. "Starters", "Biryani"). If a dish has no heading, use "Menu".
- "price" is in rupees as a plain number. If the dish has several sizes (Half/Full, Regular/Large, Quarter/Half/Full), put each in "sizes" with its own price and set "price" to null.
- "extras" are optional add-ons listed WITH a price (e.g. "Extra cheese +30"). Do not invent any.
- "isVeg": true for vegetarian, false for chicken/mutton/fish/egg/prawn/meat, null if you cannot tell. A green dot means veg, a red/brown dot means non-veg.
- "description": the menu's own short description, or "" if there is none. Do not write one yourself.
- Copy names exactly as printed, fixing only obvious capitalisation.
- Never guess a price. If a price is unreadable, use null and list the dish name in "unreadable".`;

function istDayKey(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Counts a scan; refuses beyond the daily limit. */
export function consumeScan(restaurantId: string): number {
  const key = `menu-ai:${restaurantId}:${istDayKey()}`;
  const used = Number(memoryStore.meta.get(key)) || 0;
  if (used >= DAILY_SCANS_PER_RESTAURANT) {
    throw new AppError(
      `This restaurant has read ${DAILY_SCANS_PER_RESTAURANT} menu photos today, the daily limit. Try again tomorrow, or type the rest in.`,
      429,
      'MENU_AI_DAILY_LIMIT'
    );
  }
  memoryStore.meta.set(key, used + 1);
  triggerAutoSave();
  return DAILY_SCANS_PER_RESTAURANT - used - 1;
}

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const money = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
};

/** "PANEER TIKKA" -> "Paneer Tikka". Printed menus shout; a menu screen should not. */
const unshout = (s: string) =>
  /[A-Z]{4}/.test(s) && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s;

const NON_VEG = /\b(chicken|mutton|lamb|fish|prawn|shrimp|egg|keema|beef|pork|crab|meat|tandoori chicken|seekh)\b/i;

/**
 * Turns the model's answer into a draft the Menu Builder can trust: every
 * limit the menu-request route enforces is applied here, and whatever had to
 * be changed or could not be read becomes a flag the partner sees.
 */
export function normaliseDraft(raw: any): MenuDraft {
  const warnings: string[] = [];
  const unreadable = new Set(
    (Array.isArray(raw?.unreadable) ? raw.unreadable : []).map((n: unknown) => clean(n, 120).toLowerCase())
  );
  const sections: DraftSection[] = [];

  for (const rawSection of Array.isArray(raw?.sections) ? raw.sections : []) {
    const name = unshout(clean(rawSection?.name, 80)) || 'Menu';
    const items: DraftDish[] = [];
    for (const rawItem of Array.isArray(rawSection?.items) ? rawSection.items : []) {
      const dishName = unshout(clean(rawItem?.name, 120));
      if (dishName.length < 2) continue;
      const flags: string[] = [];

      const seenSize = new Set<string>();
      let sizes = (Array.isArray(rawItem?.sizes) ? rawItem.sizes : [])
        .map((s: any) => ({ name: clean(s?.name, 40), price: money(s?.price) }))
        .filter((s: any) => s.name && s.price !== null && !seenSize.has(s.name.toLowerCase()) && seenSize.add(s.name.toLowerCase()))
        .slice(0, 4) as Array<{ name: string; price: number }>;
      if (sizes.length === 1) {
        // One "size" is just the price.
        sizes = [];
      }

      const seenExtra = new Set<string>();
      const extras = (Array.isArray(rawItem?.extras) ? rawItem.extras : [])
        .map((s: any) => ({ name: clean(s?.name, 40), price: money(s?.price) }))
        .filter((s: any) => s.name && s.price !== null && !seenExtra.has(s.name.toLowerCase()) && seenExtra.add(s.name.toLowerCase()))
        .slice(0, 10) as Array<{ name: string; price: number }>;

      let price = money(rawItem?.price);
      if (sizes.length >= 2) price = Math.min(...sizes.map(s => s.price));
      if (price === null && sizes.length < 2) flags.push('Price not read — type it in.');
      if (unreadable.has(dishName.toLowerCase())) flags.push('Part of this line was hard to read — check it.');

      let isVeg: boolean | null = rawItem?.isVeg === true ? true : rawItem?.isVeg === false ? false : null;
      // A dish NAMED for meat is not veg, whatever the model said.
      if (NON_VEG.test(dishName) && isVeg !== false) {
        if (isVeg === true) flags.push('Marked veg but the name suggests non-veg — check.');
        isVeg = false;
      }
      if (isVeg === null) flags.push('Veg or non-veg? Choose one.');

      items.push({
        name: dishName,
        description: clean(rawItem?.description, 400) || undefined,
        price,
        isVeg,
        sizes,
        extras,
        flags
      });
    }
    if (items.length === 0) continue;
    const existing = sections.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.items.push(...items);
    else sections.push({ name, items });
  }

  if (sections.length === 0) {
    warnings.push('No dishes could be read from this photo. Retake it flat, in good light, with the whole page in the frame.');
  }
  return { sections, warnings };
}

/** Refuses what is not a photo of a usable size, before a scan is counted. */
export function checkMenuPhoto(imageDataUri: string): void {
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(imageDataUri)) {
    throw new AppError('That is not a photo this can read. Use a JPEG or PNG.', 400, 'MENU_AI_BAD_IMAGE');
  }
  if (imageDataUri.length > MAX_IMAGE_CHARS) {
    throw new AppError('That photo is too large. Take it again at a normal size.', 413, 'MENU_AI_IMAGE_TOO_LARGE');
  }
}

/** Asks the model to read one photo. Throws an AppError a screen can show. */
export async function readMenuPhoto(imageDataUri: string): Promise<MenuDraft> {
  if (!isMenuAiConfigured()) {
    throw new AppError(
      'AI menu reading is not switched on yet. You can still type the menu in.',
      503,
      'MENU_AI_NOT_CONFIGURED'
    );
  }
  checkMenuPhoto(imageDataUri);

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ]
      })
    });
  } catch {
    throw new AppError('The menu reader did not answer. Try again in a minute.', 502, 'MENU_AI_UNREACHABLE');
  }

  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    console.log(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'MENU_AI_REFUSED',
        httpStatus: response.status,
        // The provider's message only; the key is never logged.
        detail: body?.error?.message
      })
    );
    throw new AppError(
      response.status === 429
        ? 'The menu reader is busy. Try again in a minute.'
        : 'The menu reader could not read this photo. Try a clearer photo, or type the menu in.',
      502,
      'MENU_AI_FAILED'
    );
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(String(body?.choices?.[0]?.message?.content || ''));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    throw new AppError('The menu reader gave an answer that could not be used. Try the photo again.', 502, 'MENU_AI_UNPARSEABLE');
  }
  return normaliseDraft(parsed);
}
