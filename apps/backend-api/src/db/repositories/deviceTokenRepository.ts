import { memoryStore, triggerAutoSave } from '../client.ts';
import type { DeviceToken, DevicePlatform, UserRole } from '@quick-bites/shared-types';

/**
 * Where a push notification is actually delivered.
 *
 * Until now there was nowhere. `fcmDispatcher` was called from nine places and
 * every one of them wrote a line to the log — there was no token, no device,
 * and no transport. Every notification this platform has ever "sent" went to
 * standard output.
 *
 * One row per INSTALLED APP, not per user. A partner with a phone by the pass
 * and a tablet in the office has to be reached on both, and a rider who
 * changes handset has to stop being reached on the old one. Keyed by the token
 * itself, because that is what the push service deduplicates on.
 */

function all(): DeviceToken[] {
  return Array.from(memoryStore.deviceTokens.values()) as DeviceToken[];
}

export interface RegisterDeviceInput {
  userId: string;
  role: UserRole;
  token: string;
  platform: DevicePlatform;
  deviceId?: string;
  appVersion?: string;
}

export const deviceTokenRepository = {
  /**
   * Records a device, or refreshes one that is already known.
   *
   * A token is the key, so re-registering the same one on every app launch —
   * which is what the apps do, because FCM can rotate a token at any time —
   * updates the row instead of accumulating duplicates. Without that, one
   * phone collects a new row per launch and every notification is delivered to
   * it a dozen times.
   */
  async register(input: RegisterDeviceInput): Promise<DeviceToken> {
    const now = new Date().toISOString();
    const existing = all().find(t => t.token === input.token);

    if (existing) {
      const updated: DeviceToken = {
        ...existing,
        // A handset that changes hands re-registers the same token against a
        // new account. The row must follow the person now using it, or the
        // previous owner keeps receiving somebody else's order updates.
        userId: input.userId,
        role: input.role,
        platform: input.platform,
        deviceId: input.deviceId ?? existing.deviceId,
        appVersion: input.appVersion ?? existing.appVersion,
        lastSeenAt: now,
        invalidatedAt: undefined
      };
      memoryStore.deviceTokens.set(updated.id, updated);
      triggerAutoSave();
      return updated;
    }

    const id = `dvc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: DeviceToken = {
      id,
      userId: input.userId,
      role: input.role,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId,
      appVersion: input.appVersion,
      createdAt: now,
      lastSeenAt: now
    };
    memoryStore.deviceTokens.set(id, record);
    triggerAutoSave();
    return record;
  },

  /** Live tokens for one person, across every device they have installed. */
  async listForUser(userId: string): Promise<DeviceToken[]> {
    return all().filter(t => t.userId === userId && !t.invalidatedAt);
  },

  /**
   * Marks a token dead after the push service rejects it.
   *
   * Recorded rather than deleted, so a token that fails once during a network
   * blip is not thrown away and re-registered on the next launch as though it
   * were new — and so it is possible to see, later, that a device stopped
   * being reachable rather than never having existed.
   */
  async invalidate(token: string): Promise<void> {
    const existing = all().find(t => t.token === token);
    if (!existing) return;
    memoryStore.deviceTokens.set(existing.id, {
      ...existing,
      invalidatedAt: new Date().toISOString()
    });
    triggerAutoSave();
  },

  /** Removes a device at the person's own request — signing out on that phone. */
  async remove(userId: string, token: string): Promise<boolean> {
    const existing = all().find(t => t.token === token && t.userId === userId);
    if (!existing) return false;
    memoryStore.deviceTokens.delete(existing.id);
    triggerAutoSave();
    return true;
  }
};
