import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { AuditLogEntry } from '@quick-bites/shared-types';

/**
 * The administrative audit trail.
 *
 * Entries are append-only and there is deliberately no update or delete: a log
 * somebody can rewrite answers no question worth asking. Recording is best
 * effort — a failure to write the log must never fail the action that was
 * already applied, so callers do not await it in a way that can reject.
 */
export const auditRepository = {
  async record(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const record: AuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ...entry,
      createdAt: new Date().toISOString()
    };
    memoryStore.auditLogs.set(record.id, record);
    triggerAutoSave();
    return record;
  },

  async list(filter: {
    actorUserId?: string;
    entityType?: string;
    action?: string;
    limit?: number;
  } = {}): Promise<AuditLogEntry[]> {
    let rows = Array.from(memoryStore.auditLogs.values()) as AuditLogEntry[];
    if (filter.actorUserId) rows = rows.filter(r => r.actorUserId === filter.actorUserId);
    if (filter.entityType) rows = rows.filter(r => r.entityType === filter.entityType);
    if (filter.action) rows = rows.filter(r => r.action === filter.action);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return rows.slice(0, filter.limit ?? 200);
  }
};
