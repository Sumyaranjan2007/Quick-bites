/**
 * Role-based access control: the roles themselves, the staff accounts that hold
 * them, and the audit trail of what everybody did.
 *
 * These routes are the ones that could be used to grant access, so the guards
 * are tighter than elsewhere: creating a role, assigning one, or provisioning a
 * staff account is Super Admin only, whatever a role happens to say. A role that
 * could hand out `admin.roles.manage` would be a way to promote yourself.
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { requirePermission, requireSuperAdmin } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { adminRoleRepository, sanitizePermissions } from '../../db/repositories/adminRoleRepository.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { resolveAccess } from '../../modules/admin/permissions.ts';
import { ADMIN_PERMISSION_GROUPS } from '@quick-bites/shared-types';

export const rbacRoutes = Router();

/* ---------------------------------- Roles --------------------------------- */

/** GET /api/admin/roles — the roles, what they grant, and who holds them. */
rbacRoutes.get('/roles', requirePermission('admin.roles.manage'), async (_req, res, next) => {
  try {
    const [roles, counts] = await Promise.all([
      adminRoleRepository.list(),
      adminRoleRepository.assignmentCounts()
    ]);
    res.json({
      success: true,
      data: {
        roles: roles.map(role => ({ ...role, assignedCount: counts[role.id] || 0 })),
        permissionCatalogue: ADMIN_PERMISSION_GROUPS
      }
    });
  } catch (err) {
    next(err);
  }
});

const RoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).max(200)
});

rbacRoutes.post('/roles', requireSuperAdmin, validate({ body: RoleSchema }), async (req, res, next) => {
  try {
    const permissions = sanitizePermissions(req.body.permissions);
    if (permissions.length === 0) {
      throw new AppError('A role has to grant at least one permission.', 400, 'EMPTY_ROLE');
    }
    const existing = await adminRoleRepository.list();
    if (existing.some(r => r.name.toLowerCase() === req.body.name.trim().toLowerCase())) {
      throw new AppError('A role with that name already exists.', 409, 'ROLE_EXISTS');
    }

    const role = await adminRoleRepository.create({ ...req.body, createdByUserId: req.user!.id });
    recordAudit(req, {
      action: 'ROLE_CREATED',
      entityType: 'ADMIN_ROLE',
      entityId: role.id,
      summary: `Created admin role "${role.name}" with ${role.permissions.length} permission(s)`,
      after: role
    });
    res.status(201).json({ success: true, data: { role } });
  } catch (err) {
    next(err);
  }
});

rbacRoutes.patch(
  '/roles/:id',
  requireSuperAdmin,
  validate({ body: RoleSchema.partial().extend({ isActive: z.boolean().optional() }) }),
  async (req, res, next) => {
    try {
      const before = await adminRoleRepository.findById(req.params.id);
      if (!before) throw new AppError('Role not found.', 404, 'ROLE_NOT_FOUND');
      if (before.isSystem && (req.body.permissions || req.body.isActive !== undefined)) {
        throw new AppError(
          'A built-in role’s permissions cannot be changed. Copy it into a custom role instead.',
          409,
          'SYSTEM_ROLE_LOCKED'
        );
      }
      if (req.body.permissions && sanitizePermissions(req.body.permissions).length === 0) {
        throw new AppError('A role has to grant at least one permission.', 400, 'EMPTY_ROLE');
      }

      const role = await adminRoleRepository.update(req.params.id, req.body);
      recordAudit(req, {
        action: 'ROLE_UPDATED',
        entityType: 'ADMIN_ROLE',
        entityId: req.params.id,
        summary: `Updated admin role "${role!.name}"`,
        before: { permissions: before.permissions, isActive: before.isActive },
        after: { permissions: role!.permissions, isActive: role!.isActive }
      });
      res.json({ success: true, data: { role } });
    } catch (err) {
      next(err);
    }
  }
);

rbacRoutes.delete('/roles/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const role = await adminRoleRepository.findById(req.params.id);
    if (!role) throw new AppError('Role not found.', 404, 'ROLE_NOT_FOUND');

    const result = await adminRoleRepository.remove(req.params.id);
    if (!result.deleted) {
      if (result.reason === 'SYSTEM_ROLE') {
        throw new AppError('Built-in roles cannot be deleted.', 409, 'SYSTEM_ROLE_LOCKED');
      }
      if (result.reason === 'ROLE_IN_USE') {
        throw new AppError(
          'This role is still assigned to an admin. Move them to another role first.',
          409,
          'ROLE_IN_USE'
        );
      }
      throw new AppError('Role could not be deleted.', 500, 'ROLE_DELETE_FAILED');
    }

    recordAudit(req, {
      action: 'ROLE_DELETED',
      entityType: 'ADMIN_ROLE',
      entityId: req.params.id,
      summary: `Deleted admin role "${role.name}"`,
      before: role
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ Admin accounts ---------------------------- */

/** GET /api/admin/admins — staff accounts and the role each one holds. */
rbacRoutes.get('/admins', requirePermission('admin.accounts.manage', 'admin.roles.manage'), async (_req, res, next) => {
  try {
    const users = await userRepository.list();
    const staff = users.filter(u => u.role === 'admin' || u.role === 'super_admin');
    const roles = await adminRoleRepository.list();

    res.json({
      success: true,
      data: {
        admins: staff.map(user => {
          const access = resolveAccess(user);
          const { passwordHash, ...safe } = user as any;
          return {
            ...safe,
            roleId: user.adminRoleId || null,
            roleName: access.role?.name || (access.isSuperAdmin ? 'Super Admin' : 'Unassigned'),
            permissionCount: access.permissions.length,
            isSuperAdmin: access.isSuperAdmin
          };
        }),
        roles: roles.map(r => ({ id: r.id, name: r.name, isSystem: r.isSystem, isActive: r.isActive }))
      }
    });
  } catch (err) {
    next(err);
  }
});

const CreateAdminSchema = z.object({
  email: z.string().email().max(254),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8).max(128),
  roleId: z.string().min(1)
});

/**
 * POST /api/admin/admins — provisions a staff account.
 *
 * Self-service registration cannot create staff, by design; this is the only
 * path, and it is Super Admin only. The role is required rather than optional so
 * an account is never created with an unstated level of access.
 */
rbacRoutes.post('/admins', requireSuperAdmin, validate({ body: CreateAdminSchema }), async (req, res, next) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    if (await userRepository.findByEmail(email)) {
      throw new AppError('An account with that email already exists.', 409, 'EMAIL_TAKEN');
    }
    const role = await adminRoleRepository.findById(req.body.roleId);
    if (!role) throw new AppError('That role does not exist.', 404, 'ROLE_NOT_FOUND');

    const user = await userRepository.create({
      id: `usr_adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email,
      passwordHash: await bcrypt.hash(req.body.password, 10),
      fullName: req.body.fullName,
      phone: req.body.phone,
      // A staff account holds the platform role `admin`; what it may actually do
      // comes from the assigned role, never from this field.
      role: role.key === 'super_admin' ? 'super_admin' : 'admin',
      adminRoleId: role.id,
      isGold: false,
      preferredLanguage: 'en'
    });

    recordAudit(req, {
      action: 'ADMIN_CREATED',
      entityType: 'ADMIN_ACCOUNT',
      entityId: user.id,
      summary: `Created admin account ${user.email} with role "${role.name}"`,
      after: { email: user.email, roleId: role.id }
    });

    const { passwordHash, ...safe } = user as any;
    res.status(201).json({ success: true, data: { admin: { ...safe, roleName: role.name } } });
  } catch (err) {
    next(err);
  }
});

const AssignRoleSchema = z.object({
  roleId: z.string().min(1).nullable(),
  isBlocked: z.boolean().optional()
});

/**
 * PATCH /api/admin/admins/:id — changes or removes an administrator's role.
 *
 * An account cannot change its own role: that is the one edit that could only
 * ever be used to give yourself more access than you were granted.
 */
rbacRoutes.patch('/admins/:id', requireSuperAdmin, validate({ body: AssignRoleSchema }), async (req, res, next) => {
  try {
    if (req.params.id === req.user!.id) {
      throw new AppError('You cannot change your own role.', 409, 'CANNOT_EDIT_SELF');
    }

    const user = await userRepository.findById(req.params.id);
    if (!user) throw new AppError('Admin account not found.', 404, 'ADMIN_NOT_FOUND');
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      throw new AppError('That account is not a staff account.', 400, 'NOT_STAFF');
    }

    let role = null;
    if (req.body.roleId) {
      role = await adminRoleRepository.findById(req.body.roleId);
      if (!role) throw new AppError('That role does not exist.', 404, 'ROLE_NOT_FOUND');
    }

    const before = { adminRoleId: user.adminRoleId, isBlocked: user.isBlocked };
    await userRepository.update(user.id, {
      adminRoleId: req.body.roleId || undefined,
      role: role?.key === 'super_admin' ? 'super_admin' : 'admin',
      ...(req.body.isBlocked !== undefined ? { isBlocked: req.body.isBlocked } : {})
    });

    recordAudit(req, {
      action: 'ADMIN_ROLE_ASSIGNED',
      entityType: 'ADMIN_ACCOUNT',
      entityId: user.id,
      summary: `Set ${user.email} to role "${role?.name || 'Unassigned'}"${
        req.body.isBlocked ? ' and blocked the account' : ''
      }`,
      before,
      after: { adminRoleId: req.body.roleId, isBlocked: req.body.isBlocked }
    });

    const updated = await userRepository.findById(user.id);
    const { passwordHash, ...safe } = (updated || {}) as any;
    res.json({ success: true, data: { admin: safe } });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- Audit log ------------------------------- */

/** GET /api/admin/audit-log — who did what, most recent first. */
rbacRoutes.get('/audit-log', requirePermission('admin.audit.view'), async (req, res, next) => {
  try {
    const { actorUserId, entityType, action, limit } = req.query as Record<string, string>;
    const entries = await auditRepository.list({
      actorUserId,
      entityType,
      action,
      limit: Number(limit) || 200
    });
    res.json({
      success: true,
      data: {
        entries,
        actors: Array.from(new Set(entries.map(e => e.actorName))),
        entityTypes: Array.from(new Set(entries.map(e => e.entityType)))
      }
    });
  } catch (err) {
    next(err);
  }
});
