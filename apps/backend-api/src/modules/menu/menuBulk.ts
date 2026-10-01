/**
 * A whole menu sent at once (owner, 1 Oct 2026).
 *
 * Restaurants have no time to add dishes one form at a time, so the Menu
 * Builder lets them lay out the whole menu — sections, dishes, prices, sizes,
 * extras, photos — and send it in one go. An administrator can do the same on
 * a restaurant's behalf.
 *
 * NOTHING NEW IS TRUSTED. Each dish becomes an ordinary ADD_ITEM menu request,
 * exactly what the one-dish form creates, validated by the same schema. They
 * share a `batchId`, so Catalogue shows "Review 37 dishes" and approves them
 * with the existing bulk review — every option rule, margin hold and markup
 * check applies unchanged. The app sends a large menu in small batches (photos
 * make dishes heavy), marking the last one `final` so administrators are told
 * once, with the total, rather than once per batch.
 */
import { z } from 'zod';
import { menuRequestRepository } from '../../db/repositories/menuRequestRepository.ts';
import { AppError } from '../../utils/AppError.ts';
import type { MenuChangeRequest } from '@quick-bites/shared-types';

/** One dish, as a partner (or an administrator) describes it. */
export const MenuDishSchema = z.object({
  name: z.string().trim().min(1, 'Dish name is required').max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().positive('Price must be greater than zero').max(100000),
  isVeg: z.boolean(),
  categoryName: z.string().trim().min(1, 'Category is required').max(80),
  imageUrl: z.string().trim().max(200000).optional(),
  sizes: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Name each size').max(40),
        price: z.number().positive('Each size needs a price above zero').max(100000)
      })
    )
    .max(4, 'At most 4 sizes')
    .refine(list => list.length === 0 || list.length >= 2, 'Give at least 2 sizes, or none')
    .refine(list => new Set(list.map(s => s.name.toLowerCase())).size === list.length, 'Two sizes have the same name')
    .optional(),
  extras: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Name each extra').max(40),
        price: z.number().positive('Each extra needs a price above zero').max(100000)
      })
    )
    .max(10, 'At most 10 extras')
    .refine(list => new Set(list.map(s => s.name.toLowerCase())).size === list.length, 'Two extras have the same name')
    .optional()
});

/** A batch is small on purpose: dishes carry photos. */
export const MAX_DISHES_PER_BATCH = 10;
/** A whole menu: enough for a large restaurant, not enough to flood review. */
export const MAX_DISHES_PER_MENU = 400;

export const MenuBatchSchema = z.object({
  batchId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Bad batch id'),
  /** Position of the first dish in this batch within the whole menu. */
  startIndex: z.number().int().min(0).max(MAX_DISHES_PER_MENU),
  items: z.array(MenuDishSchema).min(1).max(MAX_DISHES_PER_BATCH),
  /** The last batch of the menu. Administrators are told once, then. */
  final: z.boolean().optional(),
  /** The draft started from AI-read photos; shown to the reviewer. */
  fromAiDraft: z.boolean().optional()
});

export type MenuBatch = z.infer<typeof MenuBatchSchema>;

/**
 * Creates one ADD_ITEM request per dish. A batch id that already has dishes at
 * these positions is a retry of the same batch (a phone that lost signal after
 * sending) and creates nothing twice.
 */
export async function createMenuBatch(input: {
  restaurant: { id: string; name: string };
  requestedByUserId: string;
  batch: MenuBatch;
  uploadedByAdminName?: string;
}): Promise<{ created: MenuChangeRequest[]; totalInBatch: number; duplicates: number }> {
  const { restaurant, batch } = input;
  const existing = (await menuRequestRepository.listByRestaurant(restaurant.id)).filter(
    r => r.batchId === batch.batchId
  );
  if (existing.length + batch.items.length > MAX_DISHES_PER_MENU) {
    throw new AppError(
      `A menu can have at most ${MAX_DISHES_PER_MENU} dishes in one upload. Send the rest as a second menu.`,
      400,
      'MENU_TOO_LARGE'
    );
  }
  const taken = new Set(existing.map(r => r.batchSeq));

  const created: MenuChangeRequest[] = [];
  let duplicates = 0;
  for (let i = 0; i < batch.items.length; i++) {
    const seq = batch.startIndex + i;
    if (taken.has(seq)) {
      duplicates += 1;
      continue;
    }
    const dish = batch.items[i];
    created.push(
      await menuRequestRepository.create({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        requestedByUserId: input.requestedByUserId,
        kind: 'ADD_ITEM',
        payload: dish as MenuChangeRequest['payload'],
        batchId: batch.batchId,
        batchSeq: seq,
        ...(input.uploadedByAdminName ? { uploadedByAdminName: input.uploadedByAdminName } : {}),
        ...(batch.fromAiDraft ? { fromAiDraft: true } : {})
      })
    );
  }
  return { created, totalInBatch: existing.length + created.length, duplicates };
}

/** Oldest first, and within one menu in the order the partner laid it out. */
export function menuOrder(a: MenuChangeRequest, b: MenuChangeRequest): number {
  if (a.batchId && a.batchId === b.batchId) return (a.batchSeq ?? 0) - (b.batchSeq ?? 0);
  return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
}
