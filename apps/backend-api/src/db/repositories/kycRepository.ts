import { memoryStore, triggerAutoSave } from '../client.ts';
import type { KycDocument } from '@quick-bites/shared-types';

export class KycRepository {
  async submitDocument(data: Omit<KycDocument, 'id' | 'status' | 'submittedAt'> & { id?: string }): Promise<KycDocument> {
    const id = data.id || `kyc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const doc: KycDocument = {
      id,
      ...data,
      status: 'PENDING',
      submittedAt: new Date().toISOString()
    };
    memoryStore.kycDocuments.set(id, doc);
    triggerAutoSave();
    return doc;
  }

  async getPendingDocuments(): Promise<KycDocument[]> {
    const pending: KycDocument[] = [];
    for (const doc of memoryStore.kycDocuments.values()) {
      if (doc.status === 'PENDING') {
        pending.push(doc);
      }
    }
    return pending.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async findByEntity(entityType: 'RESTAURANT' | 'RIDER', entityId: string): Promise<KycDocument[]> {
    const list: KycDocument[] = [];
    for (const doc of memoryStore.kycDocuments.values()) {
      if (doc.entityType === entityType && doc.entityId === entityId) {
        list.push(doc);
      }
    }
    return list;
  }

  async reviewDocument(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string
  ): Promise<KycDocument | null> {
    const doc = memoryStore.kycDocuments.get(id);
    if (!doc) return null;

    doc.status = status;
    doc.reviewedAt = new Date().toISOString();
    if (rejectionReason) doc.rejectionReason = rejectionReason;

    memoryStore.kycDocuments.set(id, doc);
    triggerAutoSave();
    return doc;
  }
}

export const kycRepository = new KycRepository();
