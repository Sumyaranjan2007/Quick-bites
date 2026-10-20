/**
 * AI dish pictures for Operations (owner, 20 Oct 2026). Plan: docs/plans/round3-owner-items-2026-10-20.md,
 * "AI dish photos in Operations".
 *
 * - A PICTURE LIBRARY: one picture per dish name (sizes, brackets and numbers removed) and veg/non-veg,
 *   reused for every kitchen that sells it; Gemini is asked only for a name it has not drawn before.
 * - KEYS: `GEMINI_API_KEYS` (comma-separated). A key at its limit or refused is skipped for an hour and the
 *   next is tried; with none left, `AI_LIMIT_REACHED` (jobs pause and carry on after a key is added).
 * - JOBS: a whole live menu or a kitchen's pending requests, one step per dish, saved after each step, so a
 *   pause, a deploy or a restart resumes at the next dish.
 */
import crypto from 'node:crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { emitSync } from '../../sockets/socketServer.ts';

export interface DishSpec {
  name: string;
  isVeg: boolean;
  description?: string;
}

/** "Chicken Biryani (Full) 500 ml" and "chicken biryani" are one picture. */
export function dishKey(dish: Pick<DishSpec, 'name' | 'isVeg'>): string {
  const name = String(dish.name || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(half|full|small|medium|large|regular|mini|jumbo|plate|single|double|combo|portion)\b/g, ' ')
    .replace(/\d+(\.\d+)?\s*(ml|l|ltr|g|gm|gms|kg|pcs?|pieces?|inch|")?/g, ' ')
    .replace(/[^a-zऀ-෿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name}|${dish.isVeg ? 'veg' : 'nonveg'}`;
}

/** The public link the apps load, under this server's own address. */
export const imageLink = (baseUrl: string, id: string) => `${baseUrl.replace(/\/+$/, '')}/media/dish-images/${id}.jpg`;

function promptFor(dish: DishSpec): string {
  return [
    `A realistic, appetising professional food photograph of ${dish.name.trim()}`,
    dish.description ? `(${dish.description.trim().slice(0, 200)})` : '',
    'as served in a restaurant in Karnataka, India.',
    dish.isVeg ? 'A vegetarian dish, with no meat, fish or egg.' : 'A non-vegetarian dish.',
    'One serving on a plate or in a bowl, seen from a 45-degree angle, soft natural light, plain neutral background.',
    'No text, no labels, no logos, no watermark, no people, no hands.'
  ]
    .filter(Boolean)
    .join(' ');
}

/* ------------------------------- Gemini ------------------------------- */

/** Keys skipped until this time (limit reached or refused). In memory: a restart retries them all. */
const restingUntil = new Map<string, number>();
const REST_MS = 60 * 60_000;

/** The first base64 image anywhere in a response: Interactions (`output_image`, steps) or generateContent (`inlineData`). */
export function findImageData(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.output_image?.data === 'string') return node.output_image.data;
  if (typeof node.inlineData?.data === 'string') return node.inlineData.data;
  if (typeof node.inline_data?.data === 'string') return node.inline_data.data;
  if ((node.type === 'image' || node.mime_type || node.mimeType) && typeof node.data === 'string' && node.data.length > 100) return node.data;
  for (const value of Object.values(node)) {
    const found = findImageData(value);
    if (found) return found;
  }
  return null;
}

async function callGemini(key: string, prompt: string): Promise<{ status: number; body: any }> {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000)
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const first = await post(`${base}/interactions`, {
    model: config.GEMINI_IMAGE_MODEL,
    input: [{ type: 'text', text: prompt }],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '4:3', image_size: '1K' }
  });
  // Older API shape, for models or accounts the Interactions endpoint does not take.
  if (first.status === 404 || (first.status === 400 && !findImageData(first.body) && /interaction|response_format|unknown/i.test(JSON.stringify(first.body)))) {
    return post(`${base}/models/${config.GEMINI_IMAGE_MODEL}:generateContent`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    });
  }
  return first;
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One picture, trying each usable key. Throws AI_NOT_SET_UP, AI_LIMIT_REACHED or AI_NO_PICTURE. */
export async function generatePicture(prompt: string, keys = config.GEMINI_API_KEYS): Promise<{ data: string; model: string }> {
  if (!keys.length) {
    throw new AppError('The image AI is not set up yet: add GEMINI_API_KEYS on Railway.', 503, 'AI_NOT_SET_UP');
  }
  for (const key of keys) {
    if ((restingUntil.get(key) || 0) > Date.now()) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      let reply: { status: number; body: any };
      try {
        reply = await callGemini(key, prompt);
      } catch {
        reply = { status: 503, body: null }; // network or timeout: retried like a 5xx
      }
      const data = reply.status < 300 ? findImageData(reply.body) : null;
      if (data) return { data, model: config.GEMINI_IMAGE_MODEL };
      if (reply.status < 300) {
        // Answered without a picture: usually the safety filter. Another try rarely helps.
        throw new AppError('The image AI did not draw this dish. Try a clearer dish name, or add a photo.', 422, 'AI_NO_PICTURE');
      }
      if (reply.status === 429 || reply.status >= 500) {
        if (attempt < 2) {
          await pause((attempt + 1) * 2000 + Math.random() * 500);
          continue;
        }
        if (reply.status === 429) break; // limit reached on this key: the next one
        throw new AppError('The image AI is not answering right now. Try again in a minute.', 503, 'AI_UNAVAILABLE');
      }
      break; // 400/401/402/403: this key is refused (wrong, leaked, out of credit)
    }
    restingUntil.set(key, Date.now() + REST_MS);
  }
  throw new AppError(
    'The image AI has used up its limit on every key. Add or change GEMINI_API_KEYS on Railway, then press Generate again: it carries on where it stopped.',
    429,
    'AI_LIMIT_REACHED'
  );
}

/** The picture for a dish: the saved one, or a new one saved for next time. */
export async function pictureForDish(dish: DishSpec, baseUrl: string): Promise<{ imageUrl: string; reused: boolean }> {
  const key = dishKey(dish);
  if (key.startsWith('|')) throw new AppError('Give the dish a name first.', 400, 'DISH_NAME_REQUIRED');
  const saved = [...memoryStore.dishImages.values()].find((p: any) => p.key === key);
  if (saved) {
    saved.uses = (saved.uses || 0) + 1;
    memoryStore.dishImages.set(saved.id, saved);
    return { imageUrl: imageLink(baseUrl, saved.id), reused: true };
  }
  const { data, model } = await generatePicture(promptFor(dish));
  const id = `img_${crypto.randomBytes(8).toString('hex')}`;
  memoryStore.dishImages.set(id, { id, key, name: dish.name.trim(), isVeg: dish.isVeg, data, model, uses: 1, createdAt: new Date().toISOString() });
  triggerAutoSave();
  return { imageUrl: imageLink(baseUrl, id), reused: false };
}

/* -------------------------------- Jobs -------------------------------- */

type Target = { kind: 'DISH' | 'REQUEST'; id: string; name: string; isVeg: boolean; description?: string; status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED'; reused?: boolean; error?: string };
export interface ImageJob {
  id: string;
  restaurantId: string;
  scope: 'MENU' | 'REQUESTS';
  baseUrl: string;
  targets: Target[];
  status: 'RUNNING' | 'PAUSED' | 'DONE';
  pauseReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const hasPicture = (url?: string) => Boolean(url && String(url).trim());

function targetsFor(restaurantId: string, scope: ImageJob['scope']): Target[] {
  if (scope === 'MENU') {
    const menu: any = memoryStore.menus.get(restaurantId);
    return (menu?.categories || []).flatMap((c: any) =>
      (c.items || [])
        .filter((i: any) => !hasPicture(i.imageUrl))
        .map((i: any) => ({ kind: 'DISH', id: i.id, name: i.name, isVeg: Boolean(i.isVeg), description: i.description, status: 'PENDING' }))
    );
  }
  return ([...memoryStore.menuRequests.values()] as any[])
    .filter(r => r.restaurantId === restaurantId && r.status === 'PENDING' && !hasPicture(r.payload?.imageUrl))
    .map(r => ({ kind: 'REQUEST', id: r.id, name: r.payload.name, isVeg: Boolean(r.payload.isVeg), description: r.payload.description, status: 'PENDING' }));
}

const save = (job: ImageJob) => {
  job.updatedAt = new Date().toISOString();
  memoryStore.imageJobs.set(job.id, job);
  triggerAutoSave();
  emitSync([], 'admin/ai-images'); // every Operations console follows the progress
};

/** Starts (or returns the unfinished) job for this kitchen and scope. */
export function startImageJob(restaurantId: string, scope: ImageJob['scope'], baseUrl: string, byUserId: string): ImageJob {
  const open = ([...memoryStore.imageJobs.values()] as ImageJob[]).find(j => j.restaurantId === restaurantId && j.scope === scope && j.status !== 'DONE');
  if (open) {
    resumeImageJob(open.id);
    return open;
  }
  const now = new Date().toISOString();
  const job: ImageJob = {
    id: `ijob_${crypto.randomBytes(6).toString('hex')}`,
    restaurantId,
    scope,
    baseUrl,
    targets: targetsFor(restaurantId, scope),
    status: 'RUNNING',
    createdBy: byUserId,
    createdAt: now,
    updatedAt: now
  };
  save(job);
  void runImageJob(job.id);
  return job;
}

export function resumeImageJob(id: string): ImageJob | null {
  const job = memoryStore.imageJobs.get(id) as ImageJob | undefined;
  if (!job || job.status === 'DONE') return job || null;
  job.status = 'RUNNING';
  job.pauseReason = undefined;
  save(job);
  void runImageJob(id);
  return job;
}

const running = new Set<string>();

/** Works through the pending dishes one by one. Never throws; stops (PAUSED) when the AI's limit is reached. */
export async function runImageJob(id: string): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    for (;;) {
      const job = memoryStore.imageJobs.get(id) as ImageJob | undefined;
      if (!job || job.status !== 'RUNNING') return;
      const step = job.targets.find(t => t.status === 'PENDING');
      if (!step) {
        job.status = 'DONE';
        save(job);
        return;
      }
      // Got a photo meanwhile (a partner upload, a single generate): left as it is.
      const current =
        step.kind === 'DISH'
          ? (memoryStore.menus.get(job.restaurantId) as any)?.categories?.flatMap((c: any) => c.items)?.find((i: any) => i.id === step.id)
          : (memoryStore.menuRequests.get(step.id) as any)?.payload;
      if (!current || hasPicture(current.imageUrl)) {
        step.status = 'SKIPPED';
        save(job);
        continue;
      }
      try {
        const picture = await pictureForDish(step, job.baseUrl);
        if (step.kind === 'DISH') {
          await menuRepository.updateItem(job.restaurantId, step.id, { imageUrl: picture.imageUrl });
        } else {
          const request: any = memoryStore.menuRequests.get(step.id);
          request.payload = { ...request.payload, imageUrl: picture.imageUrl };
          memoryStore.menuRequests.set(step.id, request);
        }
        step.status = 'DONE';
        step.reused = picture.reused;
      } catch (err: any) {
        if (err?.code === 'AI_LIMIT_REACHED' || err?.code === 'AI_NOT_SET_UP' || err?.code === 'AI_UNAVAILABLE') {
          job.status = 'PAUSED';
          job.pauseReason = err.message;
          save(job);
          return;
        }
        step.status = 'FAILED';
        step.error = err?.message || 'Could not make this picture.';
      }
      save(job);
    }
  } finally {
    running.delete(id);
  }
}

/** At boot: jobs that were running when the server stopped carry on. */
export function resumeRunningImageJobs(): void {
  for (const job of memoryStore.imageJobs.values() as Iterable<ImageJob>) {
    if (job.status === 'RUNNING') void runImageJob(job.id);
  }
}
