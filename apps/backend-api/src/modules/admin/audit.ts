/**
 * Convenience wrapper for writing the audit trail from a route.
 *
 * Recording is deliberately fire-and-forget and swallows its own errors: by the
 * time a route logs, the change has already been applied and the response is
 * about to be sent. Failing the request because the log could not be written
 * would turn a bookkeeping problem into a user-visible failure, and would leave
 * the caller believing the change did not happen when it did.
 */
import type { Request } from 'express';
import { auditRepository } from '../../db/repositories/auditRepository.ts';

export function recordAudit(
  req: Request,
  entry: {
    action: string;
    entityType: string;
    entityId?: string;
    summary: string;
    before?: any;
    after?: any;
  }
): void {
  const actor = req.user;
  if (!actor) return;

  void auditRepository
    .record({
      actorUserId: actor.id,
      actorName: actor.fullName || actor.email,
      actorRole: req.adminAccess?.role?.name || actor.role,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip,
      ...entry
    })
    .catch(err => {
      console.error('[WARN] Failed to write audit log entry:', err);
    });
}
