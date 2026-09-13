import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { RefundRequest, RefundRequestStatus, RefundCaseEvent } from '@quick-bites/shared-types';

/**
 * Return and refund cases.
 *
 * A case is kept separate from the order it concerns. The order records what was
 * bought and what state it reached; the case records the dispute about it — who
 * complained, what they said, what was attached, and every step of the decision.
 * Folding one into the other would lose the history as soon as the order moved on.
 */
export const refundRepository = {
  async create(
    input: Omit<RefundRequest, 'id' | 'status' | 'timeline' | 'createdAt' | 'updatedAt'>
  ): Promise<RefundRequest> {
    const now = new Date().toISOString();
    const request: RefundRequest = {
      id: `rfr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ...input,
      status: 'REQUESTED',
      timeline: [
        {
          at: now,
          status: 'REQUESTED',
          byUserId: input.raisedByUserId,
          byName: input.raisedByName,
          note: 'Request submitted.'
        }
      ],
      createdAt: now,
      updatedAt: now
    };
    memoryStore.refundRequests.set(request.id, request);
    triggerAutoSave();
    return request;
  },

  async findById(id: string): Promise<RefundRequest | null> {
    return memoryStore.refundRequests.get(id) || null;
  },

  async listByOrder(orderId: string): Promise<RefundRequest[]> {
    return Array.from(memoryStore.refundRequests.values()).filter(
      (r: RefundRequest) => r.orderId === orderId
    );
  },

  async listByUser(userId: string): Promise<RefundRequest[]> {
    return Array.from(memoryStore.refundRequests.values())
      .filter((r: RefundRequest) => r.raisedByUserId === userId || r.customerId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async list(filter: { status?: RefundRequestStatus } = {}): Promise<RefundRequest[]> {
    let rows = Array.from(memoryStore.refundRequests.values()) as RefundRequest[];
    if (filter.status) rows = rows.filter(r => r.status === filter.status);
    // Open cases first, then newest, so the queue reads as work to be done.
    const openness = (r: RefundRequest) =>
      r.status === 'REQUESTED' ? 0 : r.status === 'PROCESSING' ? 1 : r.status === 'APPROVED' ? 2 : 3;
    return rows.sort(
      (a, b) => openness(a) - openness(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  /**
   * Moves a case on and appends to its timeline in one step, so a status can
   * never be changed without a matching entry explaining it.
   */
  async transition(
    id: string,
    status: RefundRequestStatus,
    actor: { userId: string; name: string },
    extras: { note?: string; approvedAmount?: number; refundTransactionId?: string } = {}
  ): Promise<RefundRequest | null> {
    const request = memoryStore.refundRequests.get(id) as RefundRequest | undefined;
    if (!request) return null;

    const now = new Date().toISOString();
    const event: RefundCaseEvent = {
      at: now,
      status,
      byUserId: actor.userId,
      byName: actor.name,
      note: extras.note
    };

    request.status = status;
    request.timeline = [...request.timeline, event];
    request.updatedAt = now;
    request.handledByUserId = actor.userId;
    request.handledByName = actor.name;
    if (extras.note) request.decisionNote = extras.note;
    if (extras.approvedAmount !== undefined) request.approvedAmount = extras.approvedAmount;
    if (extras.refundTransactionId) request.refundTransactionId = extras.refundTransactionId;
    if (status === 'REFUNDED' || status === 'REJECTED') request.resolvedAt = now;

    memoryStore.refundRequests.set(id, request);
    triggerAutoSave();
    return request;
  }
};
