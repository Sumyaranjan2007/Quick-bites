import bcrypt from 'bcryptjs';
import { memoryStore, triggerAutoSave } from '../client.ts';
import { normalizeIndianPhone } from '../../utils/phone.ts';
import type { UserProfile, UserRole } from '@quick-bites/shared-types';

export interface UserRecord extends UserProfile {
  passwordHash?: string;
}

export const userRepository = {
  async findById(id: string): Promise<UserRecord | null> {
    return memoryStore.users.get(id) || null;
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    // Trimmed as well as lowercased. Phone keyboards routinely append a space
    // after an email autocomplete, and an address that differs only by
    // surrounding whitespace is the same address to every human who types it.
    // Without this, sign-in failed with "invalid credentials" for a password
    // that was entirely correct.
    const normalized = email.trim().toLowerCase();
    for (const user of memoryStore.users.values()) {
      if (user.email.trim().toLowerCase() === normalized) {
        return user;
      }
    }
    return null;
  },

  /**
   * Finds an account by phone number.
   *
   * Phone is the customer's identity now, not a profile detail, so the lookup
   * has to agree with every way a human types the same number. Seeded records
   * hold `+91-98765-43210` and a sign-in form sends `9876543210`; both
   * normalise to the same ten digits, so both find the same person. Comparing
   * the raw strings would have created a second account for the same phone.
   */
  async findByPhone(phone: string): Promise<UserRecord | null> {
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) return null;

    for (const user of memoryStore.users.values()) {
      if (user.phone && normalizeIndianPhone(user.phone) === normalized) {
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
        memoryStore.orders.set(order.id, order);
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
      /*
       * Any role the person HOLDS, not only the primary one. `grantRole` adds
       * a second role to `roles` and deliberately leaves `role` alone, so a
       * rider who also opens a restaurant (or a customer who becomes a
       * partner) was refused by the partner app's sign-in with 401 — the very
       * case grantRole exists for.
       */
      const held = rolesOf(user);
      const isAdminEquiv =
        (expectedRole === 'admin' || expectedRole === 'super_admin') &&
        (held.includes('admin') || held.includes('super_admin'));
      if (!held.includes(expectedRole) && !isAdminEquiv) {
        return null;
      }
    }

    // An account with no password cannot be signed into with a password.
    //
    // This branch used to be `if (user.passwordHash) { ...check... }`, so an
    // account without one fell past the check and was returned as authenticated.
    // That was unreachable while every account was created with a password. It
    // stopped being unreachable the moment customers began signing in by phone:
    // those accounts hold no hash, and their address is `<phone>@phone.
    // quickbite.app` — derivable from the number. Anyone who knew a customer's
    // phone number could have signed in as them with any password they liked,
    // straight past the one-time code.
    if (!user.passwordHash) {
      return null;
    }

    {
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
  },

  async updateProfile(
    id: string,
    changes: { fullName?: string; phone?: string; preferredLanguage?: string }
  ): Promise<UserRecord | null> {
    const user = memoryStore.users.get(id);
    if (!user) return null;
    if (changes.fullName !== undefined) user.fullName = changes.fullName;
    if (changes.phone !== undefined) user.phone = changes.phone;
    if (changes.preferredLanguage !== undefined) user.preferredLanguage = changes.preferredLanguage;
    memoryStore.users.set(id, user);
    triggerAutoSave();
    return user;
  }
};

/**
 * Every role this account holds.
 *
 * The one place that answers the question, because the answer has two shapes:
 * accounts created before multi-role have only `role`, and treating an absent
 * `roles` as "no roles" would lock out every existing customer, partner and
 * rider on the platform at once.
 *
 * `role` is always included even when `roles` is present, so a record that was
 * migrated badly, or written by an older build, still works.
 */
export function rolesOf(user: { role?: string; roles?: string[] } | null | undefined): string[] {
  if (!user) return [];
  const all = new Set<string>();
  if (user.role) all.add(user.role);
  for (const r of user.roles || []) if (r) all.add(r);
  return Array.from(all);
}

export function hasRole(user: { role?: string; roles?: string[] } | null | undefined, role: string): boolean {
  return rolesOf(user).includes(role);
}

/**
 * Grants a role to an existing person.
 *
 * `role` — the primary — is deliberately NOT changed. It is what the account
 * opens as and what every issued token carries, and moving it would change
 * where an existing app lands on launch. Somebody who signs up to deliver
 * keeps opening the customer app as a customer; the delivery app asks for the
 * rider role and now gets it.
 */
export async function grantRole(userId: string, role: string): Promise<UserRecord | null> {
  const user = memoryStore.users.get(userId);
  if (!user) return null;

  const existing = new Set<string>(rolesOf(user));
  existing.add(role);
  user.roles = Array.from(existing);

  memoryStore.users.set(userId, user);
  triggerAutoSave();
  return user;
}
