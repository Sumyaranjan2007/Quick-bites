import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { PlatformCategory } from '@quick-bites/shared-types';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const categoryRepository = {
  async list(includeInactive = true): Promise<PlatformCategory[]> {
    return Array.from(memoryStore.categories.values())
      .filter((c: PlatformCategory) => includeInactive || c.isActive)
      .sort((a: PlatformCategory, b: PlatformCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  },

  async findById(id: string): Promise<PlatformCategory | null> {
    return memoryStore.categories.get(id) || null;
  },

  async create(input: { name: string; description?: string; imageUrl?: string; sortOrder?: number }): Promise<PlatformCategory> {
    const category: PlatformCategory = {
      id: `cat_${crypto.randomUUID()}`,
      name: input.name.trim(),
      slug: slugify(input.name),
      description: input.description,
      imageUrl: input.imageUrl,
      sortOrder: input.sortOrder ?? memoryStore.categories.size + 1,
      isActive: true,
      createdAt: new Date().toISOString()
    };
    memoryStore.categories.set(category.id, category);
    triggerAutoSave();
    return category;
  },

  async update(id: string, changes: Partial<PlatformCategory>): Promise<PlatformCategory | null> {
    const category = memoryStore.categories.get(id) as PlatformCategory | undefined;
    if (!category) return null;
    const { id: _id, createdAt: _created, ...editable } = changes as any;
    Object.assign(category, editable);
    if (changes.name) category.slug = slugify(changes.name);
    category.updatedAt = new Date().toISOString();
    memoryStore.categories.set(id, category);
    triggerAutoSave();
    return category;
  },

  async remove(id: string): Promise<boolean> {
    if (!memoryStore.categories.has(id)) return false;
    memoryStore.categories.delete(id);
    triggerAutoSave();
    return true;
  },

  /** How many live restaurants carry each category as a cuisine tag. */
  async usageCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const restaurant of memoryStore.restaurants.values()) {
      for (const tag of restaurant.cuisineTags || []) {
        const slug = slugify(tag);
        counts[slug] = (counts[slug] || 0) + 1;
      }
    }
    return counts;
  }
};
