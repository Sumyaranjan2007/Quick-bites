import { memoryStore, triggerAutoSave } from '../../db/client.ts';

/**
 * Emailed "confirm it is you" links for adding a partner/rider role to a
 * Customer-app account (routes/authRouter.ts). Kept in the store, keyed by a
 * hash of the link's token, for 30 minutes (K3). Here rather than in the router
 * so the order sweeper can prune them without importing a route (review T2).
 */
export type PendingRole = {
  userId: string;
  role: 'restaurant_owner' | 'rider';
  passwordHash: string;
  body: Record<string, any>;
  createdAt: number;
};
/** Read through memoryStore each time: loading a snapshot replaces the map. */
export const pendingRoles = (): Map<string, PendingRole> => memoryStore.pendingRoleConfirmations;
export const CONFIRM_TTL_MS = 30 * 60_000;

/**
 * Deletes confirm links past their 30 minutes (review R3, 18 Oct 2026). Each
 * holds a password hash and sign-up details, and since K3 they are saved, so
 * an unused one would otherwise sit in the database for ever. Run by the
 * order sweeper; returns how many went.
 */
export function pruneExpiredConfirmLinks(now = Date.now()): number {
  let pruned = 0;
  for (const [key, p] of pendingRoles()) {
    if (now - p.createdAt > CONFIRM_TTL_MS) {
      pendingRoles().delete(key);
      pruned++;
    }
  }
  if (pruned > 0) triggerAutoSave();
  return pruned;
}
