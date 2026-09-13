import { memoryStore, triggerAutoSave } from '../client.ts';
import type { MenuChangeRequest, MenuRequestStatus } from '@quick-bites/shared-types';

/**
 * Partner menu-change requests awaiting admin review.
 *
 * Kept separate from the menu itself so a pending request never affects what a
 * customer sees or is charged. Approval is the only thing that writes to a menu.
 */
export const menuRequestRepository = {
  async create(
    input: Omit<MenuChangeRequest, 'id' | 'status' | 'submittedAt'>
  ): Promise<MenuChangeRequest> {
    const id = `mrq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const request: MenuChangeRequest = {
      id,
      ...input,
      status: 'PENDING',
      submittedAt: new Date().toISOString()
    };
    memoryStore.menuRequests.set(id, request);
    triggerAutoSave();
    return request;
  },

  async findById(id: string): Promise<MenuChangeRequest | null> {
    return memoryStore.menuRequests.get(id) ?? null;
  },

  /** Newest first, so a partner sees what they just submitted at the top. */
  async listByRestaurant(restaurantId: string): Promise<MenuChangeRequest[]> {
    return Array.from(memoryStore.menuRequests.values())
      .filter((r: MenuChangeRequest) => r.restaurantId === restaurantId)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  },

  /** Oldest first for the admin queue: whoever waited longest is reviewed first. */
  async listByStatus(status: MenuRequestStatus): Promise<MenuChangeRequest[]> {
    return Array.from(memoryStore.menuRequests.values())
      .filter((r: MenuChangeRequest) => r.status === status)
      .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  },

  async listAll(): Promise<MenuChangeRequest[]> {
    return Array.from(memoryStore.menuRequests.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  },

  /**
   * Records a decision. Returns null if the request is missing, and leaves an
   * already-reviewed request untouched so a double submission cannot approve twice
   * and create the dish a second time.
   */
  async review(
    id: string,
    status: Exclude<MenuRequestStatus, 'PENDING'>,
    reviewedByUserId: string,
    extras: { rejectionReason?: string; resultingDishId?: string } = {}
  ): Promise<MenuChangeRequest | null> {
    const request = memoryStore.menuRequests.get(id) as MenuChangeRequest | undefined;
    if (!request) return null;
    if (request.status !== 'PENDING') return request;

    request.status = status;
    request.reviewedAt = new Date().toISOString();
    request.reviewedByUserId = reviewedByUserId;
    if (extras.rejectionReason) request.rejectionReason = extras.rejectionReason;
    if (extras.resultingDishId) request.resultingDishId = extras.resultingDishId;

    memoryStore.menuRequests.set(id, request);
    triggerAutoSave();
    return request;
  }
};
