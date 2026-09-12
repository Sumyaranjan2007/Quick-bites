import bcrypt from 'bcryptjs';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { UserProfile, UserRole } from '@quick-bites/shared-types';

export interface UserRecord extends UserProfile {
  passwordHash?: string;
}

export const userRepository = {
  async findById(id: string): Promise<UserRecord | null> {
    return memoryStore.users.get(id) || null;
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const user of memoryStore.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return user;
      }
    }
    return null;
  },

  async create(userData: Omit<UserRecord, 'createdAt'> & { createdAt?: string }): Promise<UserRecord> {
    const user: UserRecord = {
      ...userData,
      createdAt: userData.createdAt || new Date().toISOString()
    };
    memoryStore.users.set(user.id, user);
    triggerAutoSave();
    return user;
  },

  async update(id: string, updates: Partial<UserRecord>): Promise<UserRecord | null> {
    const existing = memoryStore.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    memoryStore.users.set(id, updated);
    triggerAutoSave();
    return updated;
  },

  /**
   * Permanently removes the account and the personal data attached to it.
   * Google Play requires an in-app path to account deletion for any app that
   * lets users create an account.
   *
   * Delivered orders are retained but stripped of identifying fields — the
   * restaurant's financial and tax records must survive the customer deleting
   * their profile.
   */
  async deleteAccount(userId: string): Promise<boolean> {
    const user = memoryStore.users.get(userId);
    if (!user) return false;

    for (const [id, addr] of memoryStore.addresses.entries()) {
      if (addr.userId === userId) memoryStore.addresses.delete(id);
    }

    for (const [id, wallet] of memoryStore.wallets.entries()) {
      if (wallet.userId === userId) memoryStore.wallets.delete(id);
    }
    for (const [id, txn] of memoryStore.walletTransactions.entries()) {
      if (txn.userId === userId) memoryStore.walletTransactions.delete(id);
    }

    for (const order of memoryStore.orders.values()) {
      if (order.customerId === userId) {
        order.customerId = 'deleted_user';
        order.customerName = 'Deleted account';
        delete order.customerPhone;
        delete order.deliveryAddressText;
      }
    }

    memoryStore.users.delete(userId);
    triggerAutoSave();
    return true;
  },

  async list(): Promise<UserRecord[]> {
    return Array.from(memoryStore.users.values());
  },

  async verifyCredentials(email: string, passwordAttempt: string, expectedRole?: UserRole): Promise<UserRecord | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;

    if (expectedRole) {
      const isAdminEquiv = (expectedRole === 'admin' || expectedRole === 'super_admin') && 
                           (user.role === 'admin' || user.role === 'super_admin');
      if (user.role !== expectedRole && !isAdminEquiv) {
        return null;
      }
    }

    if (user.passwordHash) {
      const isBcrypt = user.passwordHash.startsWith('$2a$') || user.passwordHash.startsWith('$2b$');
      let isValid = false;
      if (isBcrypt) {
        isValid = await bcrypt.compare(passwordAttempt, user.passwordHash);
      } else {
        isValid = user.passwordHash === passwordAttempt;
        if (isValid) {
          // Transparently upgrade legacy/plaintext password to bcrypt hash
          user.passwordHash = await bcrypt.hash(passwordAttempt, 10);
        }
      }
      if (!isValid) return null;
    }

    return user;
  }
};
