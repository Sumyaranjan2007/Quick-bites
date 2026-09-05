import { memoryStore } from '../client.ts';
import type { UserProfile } from '@quick-bites/shared-types';

export const userRepository = {
  async findById(id: string): Promise<UserProfile | null> {
    return memoryStore.users.get(id) || null;
  },

  async findByEmail(email: string): Promise<UserProfile | null> {
    for (const user of memoryStore.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return user;
      }
    }
    return null;
  },

  async create(userData: Omit<UserProfile, 'createdAt'> & { createdAt?: string }): Promise<UserProfile> {
    const user: UserProfile = {
      ...userData,
      createdAt: userData.createdAt || new Date().toISOString()
    };
    memoryStore.users.set(user.id, user);
    return user;
  },

  async update(id: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
    const existing = memoryStore.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    memoryStore.users.set(id, updated);
    return updated;
  },

  async list(): Promise<UserProfile[]> {
    return Array.from(memoryStore.users.values());
  }
};
