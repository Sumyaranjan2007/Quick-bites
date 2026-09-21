import { memoryStore, triggerAutoSave } from '../client.ts';
import type {
  EditableProfile,
  EditableProfileField,
  ProfileEdit,
  ProfileEditStatus,
  ProfileFieldRejection
} from '../../modules/restaurants/profileEdits.ts';

/**
 * Partner profile changes awaiting review.
 *
 * The same shape as `menuRequestRepository`, for the same reason: a pending
 * change must never be visible to a customer, and approval must be the only
 * thing that writes to the live record.
 */

function edits(): ProfileEdit[] {
  return Array.from(memoryStore.profileEdits.values()) as ProfileEdit[];
}

export interface CreateProfileEditInput {
  restaurantId: string;
  submittedByUserId: string;
  changes: Partial<EditableProfile>;
  previous: Partial<EditableProfile>;
}

export const profileEditRepository = {
  /**
   * Records a submission, and retires whatever the partner had waiting.
   *
   * A partner who edits their hours, notices a typo and edits them again has
   * expressed one intention, not two. Queueing the second behind the first
   * would have a reviewer approve the typo, then approve the correction — and
   * in between, the typo is live and customers are turned away. So the earlier
   * pending edit is marked SUPERSEDED, and only the current intention is
   * reviewable.
   *
   * Superseding is per restaurant rather than per field: a reviewer reads a
   * submission as one screen, and two half-live submissions for one restaurant
   * is the thing that makes an approval queue impossible to reason about.
   */
  async create(input: CreateProfileEditInput): Promise<ProfileEdit> {
    const id = `ped_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const edit: ProfileEdit = {
      id,
      restaurantId: input.restaurantId,
      submittedByUserId: input.submittedByUserId,
      submittedAt: now,
      status: 'PENDING',
      changes: input.changes,
      previous: input.previous
    };

    for (const existing of edits()) {
      if (existing.restaurantId !== input.restaurantId || existing.status !== 'PENDING') continue;
      memoryStore.profileEdits.set(existing.id, {
        ...existing,
        status: 'SUPERSEDED' as ProfileEditStatus,
        supersededByEditId: id
      });
    }

    memoryStore.profileEdits.set(id, edit);
    triggerAutoSave();
    return edit;
  },

  async findById(id: string): Promise<ProfileEdit | null> {
    return (memoryStore.profileEdits.get(id) as ProfileEdit | undefined) ?? null;
  },

  /** The one submission a reviewer should be looking at for this restaurant. */
  async findPendingByRestaurant(restaurantId: string): Promise<ProfileEdit | null> {
    return (
      edits().find(e => e.restaurantId === restaurantId && e.status === 'PENDING') ?? null
    );
  },

  /** Newest first, so a partner sees what they just submitted at the top. */
  async listByRestaurant(restaurantId: string): Promise<ProfileEdit[]> {
    return edits()
      .filter(e => e.restaurantId === restaurantId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  },

  /**
   * Oldest first: whoever has waited longest is reviewed first.
   *
   * The opposite order is the tempting one — newest at the top, like every
   * other feed — and it is how a submission at the bottom of a busy queue waits
   * a fortnight while newer ones are cleared above it.
   */
  async listPending(): Promise<ProfileEdit[]> {
    return edits()
      .filter(e => e.status === 'PENDING')
      .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  },

  async recordReview(
    id: string,
    review: {
      status: ProfileEditStatus;
      approvedFields: EditableProfileField[];
      rejections: ProfileFieldRejection[];
      reviewedByUserId: string;
    }
  ): Promise<ProfileEdit | null> {
    const existing = memoryStore.profileEdits.get(id) as ProfileEdit | undefined;
    if (!existing) return null;

    const updated: ProfileEdit = {
      ...existing,
      status: review.status,
      approvedFields: review.approvedFields,
      rejections: review.rejections,
      reviewedByUserId: review.reviewedByUserId,
      reviewedAt: new Date().toISOString()
    };
    memoryStore.profileEdits.set(id, updated);
    triggerAutoSave();
    return updated;
  }
};
