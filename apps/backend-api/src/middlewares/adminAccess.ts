/**
 * Enforces admin permissions on the server.
 *
 * The admin app hides sections an account cannot use, but hiding a button is a
 * courtesy, not a control: the API answers anything holding a valid token, so a
 * restricted administrator who types a URL or replays a request must be refused
 * here. Every write route under /api/admin names the permission it needs.
 *
 * Permissions are resolved from the stored user record on each request, not from
 * the token. Tokens last a week; a role that was narrowed or switched off has to
 * take effect on the next request, not at the next sign-in.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AdminPermission } from '@quick-bites/shared-types';
import { userRepository } from '../db/repositories/userRepository.ts';
import { resolveAccess, isStaffRole, type ResolvedAccess } from '../modules/admin/permissions.ts';

declare global {
  namespace Express {
    interface Request {
      adminAccess?: ResolvedAccess;
    }
  }
}

function deny(req: Request, res: Response, code: string, message: string, status = 403): void {
  res.status(status).json({
    success: false,
    error: { code, message },
    meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
  });
}

/**
 * Attaches the caller's effective access. Runs before the individual permission
 * guards so each of them is a cheap array check rather than another lookup.
 */
export async function attachAdminAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user || !isStaffRole(req.user.role)) {
    deny(req, res, 'FORBIDDEN', 'This area is restricted to Quick Bites staff accounts.');
    return;
  }

  // The stored record is authoritative; the token's copy of the role may predate
  // a change. A demo-mode token has no stored record, so it falls back to the
  // claims it carries.
  const stored = await userRepository.findById(req.user.id);
  const subject = stored || { role: req.user.role };
  const access = resolveAccess(subject as any);

  if (access.roleDisabled) {
    deny(
      req,
      res,
      'ROLE_DISABLED',
      'Your admin role has been disabled. Contact a Super Admin to restore access.'
    );
    return;
  }

  req.adminAccess = access;
  next();
}

/**
 * Guards a route behind one or more permissions.
 *
 * Several permissions listed together mean "any of these is enough" — a screen
 * reachable from two directions, such as a refund case a support admin and a
 * finance admin both work.
 */
export function requirePermission(...permissions: AdminPermission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const access = req.adminAccess;
    if (!access) {
      deny(req, res, 'FORBIDDEN', 'Permissions were not resolved for this request.');
      return;
    }
    if (access.isSuperAdmin || permissions.some(p => access.permissions.includes(p))) {
      next();
      return;
    }
    deny(
      req,
      res,
      'PERMISSION_DENIED',
      `Your role does not include the permission required for this action (${permissions.join(' or ')}).`
    );
  };
}

/** Routes only the platform owner may reach, whatever a role happens to grant. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.adminAccess?.isSuperAdmin) {
    next();
    return;
  }
  deny(req, res, 'SUPER_ADMIN_ONLY', 'Only a Super Admin can perform this action.');
}
