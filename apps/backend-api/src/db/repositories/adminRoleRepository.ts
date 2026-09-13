import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import { SYSTEM_ROLE_DEFINITIONS } from '../../modules/admin/permissions.ts';
import type { AdminPermission, AdminRole } from '@quick-bites/shared-types';
import { ALL_ADMIN_PERMISSIONS } from '@quick-bites/shared-types';

/** Drops anything the build does not recognise, so a stale client cannot grant
 *  a permission no route enforces. */
export function sanitizePermissions(input: unknown): AdminPermission[] {
  if (!Array.isArray(input)) return [];
  const known = new Set<string>(ALL_ADMIN_PERMISSIONS);
  return Array.from(new Set(input.filter((p): p is AdminPermission => typeof p === 'string' && known.has(p))));
}

export const adminRoleRepository = {
  async list(): Promise<AdminRole[]> {
    return Array.from(memoryStore.adminRoles.values()).sort((a: AdminRole, b: AdminRole) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  async findById(id: string): Promise<AdminRole | null> {
    return memoryStore.adminRoles.get(id) || null;
  },

  async findByKey(key: string): Promise<AdminRole | null> {
    for (const role of memoryStore.adminRoles.values()) {
      if ((role as AdminRole).key === key) return role as AdminRole;
    }
    return null;
  },

  async create(input: {
    name: string;
    description?: string;
    permissions: unknown;
    createdByUserId?: string;
  }): Promise<AdminRole> {
    const key = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const role: AdminRole = {
      id: `rol_${crypto.randomUUID()}`,
      key: key || `role_${Date.now()}`,
      name: input.name.trim(),
      description: input.description?.trim() || '',
      permissions: sanitizePermissions(input.permissions),
      isSystem: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdByUserId: input.createdByUserId
    };
    memoryStore.adminRoles.set(role.id, role);
    triggerAutoSave();
    return role;
  },

  /**
   * Applies changes to a role.
   *
   * A system role's permissions are deliberately not editable: they are the
   * definitions the fallback and the seed depend on, and letting someone empty
   * Super Admin would be a one-way door. Renaming and disabling custom roles is
   * allowed, and disabling takes effect on the holder's next request.
   */
  async update(
    id: string,
    changes: { name?: string; description?: string; permissions?: unknown; isActive?: boolean }
  ): Promise<AdminRole | null> {
    const role = memoryStore.adminRoles.get(id) as AdminRole | undefined;
    if (!role) return null;

    if (changes.name !== undefined) role.name = String(changes.name).trim();
    if (changes.description !== undefined) role.description = String(changes.description).trim();
    if (changes.permissions !== undefined && !role.isSystem) {
      role.permissions = sanitizePermissions(changes.permissions);
    }
    if (changes.isActive !== undefined && !role.isSystem) {
      role.isActive = Boolean(changes.isActive);
    }
    role.updatedAt = new Date().toISOString();
    memoryStore.adminRoles.set(id, role);
    triggerAutoSave();
    return role;
  },

  async remove(id: string): Promise<{ deleted: boolean; reason?: string }> {
    const role = memoryStore.adminRoles.get(id) as AdminRole | undefined;
    if (!role) return { deleted: false, reason: 'NOT_FOUND' };
    if (role.isSystem) return { deleted: false, reason: 'SYSTEM_ROLE' };

    // A role still assigned to somebody cannot simply vanish: the holder would
    // silently fall back to the default set, quietly gaining access nobody chose
    // to give them.
    for (const user of memoryStore.users.values()) {
      if (user.adminRoleId === id) return { deleted: false, reason: 'ROLE_IN_USE' };
    }

    memoryStore.adminRoles.delete(id);
    triggerAutoSave();
    return { deleted: true };
  },

  /** Counts how many staff accounts hold each role, for the roles screen. */
  async assignmentCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const user of memoryStore.users.values()) {
      if (user.adminRoleId) counts[user.adminRoleId] = (counts[user.adminRoleId] || 0) + 1;
    }
    return counts;
  },

  /** Creates any shipped role the store does not have yet. Safe to re-run. */
  async ensureSystemRoles(): Promise<void> {
    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const existing = await this.findByKey(definition.key);
      if (existing) {
        // Keep shipped roles in step with the build: a permission added in a
        // release must reach the role that is supposed to hold it.
        existing.permissions = [...definition.permissions];
        existing.name = definition.name;
        existing.description = definition.description;
        existing.isSystem = true;
        existing.isActive = true;
        memoryStore.adminRoles.set(existing.id, existing);
        continue;
      }
      const role: AdminRole = {
        id: `rol_${definition.key}`,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        permissions: [...definition.permissions],
        isSystem: true,
        isActive: true,
        createdAt: new Date().toISOString()
      };
      memoryStore.adminRoles.set(role.id, role);
    }
    triggerAutoSave();
  }
};
