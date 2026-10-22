import { memoryStore, triggerAutoSave } from '../client.ts';
import { auditRepository } from './auditRepository.ts';
import type { KycDocument } from '@quick-bites/shared-types';

const newestFirst = (a: KycDocument, b: KycDocument) =>
  new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();

/**
 * Per document type: the newest upload, and the APPROVED document that stands
 * for it. That is the newest upload when approved, else the approved document
 * it replaces (still waiting, or the replacement was refused). An admin who
 * rejects the approved one withdraws it, and then nothing stands.
 */
export function documentsByType(docs: KycDocument[]): Map<string, { latest: KycDocument; standing?: KycDocument }> {
  const out = new Map<string, { latest: KycDocument; standing?: KycDocument }>();
  for (const doc of [...docs].sort(newestFirst)) {
    if (out.has(doc.documentType)) continue;
    const replaced = doc.replacesId ? docs.find(d => d.id === doc.replacesId) : undefined;
    const standing = doc.status === 'APPROVED' ? doc : replaced?.status === 'APPROVED' ? replaced : undefined;
    out.set(doc.documentType, { latest: doc, standing });
  }
  return out;
}

/**
 * The fields a new upload of `documentType` carries over. A waiting upload is
 * replaced outright (it was never reviewed); an approved one is kept and
 * pointed to, so it keeps standing while the new one waits.
 */
export function replacing(docs: KycDocument[], documentType: string): { replacesId?: string; dropId?: string } {
  const current = documentsByType(docs).get(documentType)?.latest;
  if (!current) return {};
  const replacesId = current.status === 'APPROVED' ? current.id : current.replacesId;
  return { replacesId, dropId: current.status === 'PENDING' ? current.id : undefined };
}

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

  /**
   * Drops a waiting upload that a newer one replaces (it was never reviewed). Its
   * type and number stay in the audit log (review K1d), so a document sent and
   * swapped before anyone looked still leaves a trace; the photo itself does not.
   */
  async dropUnreviewed(id: string, by?: { id: string; fullName?: string; role?: string }): Promise<void> {
    const doc = memoryStore.kycDocuments.get(id);
    if (doc?.status !== 'PENDING') return;
    memoryStore.kycDocuments.delete(id);
    triggerAutoSave();
    void auditRepository
      .record({
        actorUserId: by?.id || 'unknown',
        actorName: by?.fullName || 'Uploader',
        actorRole: by?.role || 'unknown',
        action: 'DOCUMENT_REPLACED_BEFORE_REVIEW',
        entityType: 'KYC_DOCUMENT',
        entityId: id,
        summary: `${doc.entityName || doc.entityId}: ${doc.documentType}${doc.documentNumber ? ` ${doc.documentNumber}` : ''} replaced before review`,
        before: { documentType: doc.documentType, documentNumber: doc.documentNumber, entityType: doc.entityType, entityId: doc.entityId, submittedAt: doc.submittedAt }
      })
      .catch(() => undefined);
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

  /** Every document for one kind of entity, grouped by entity id (one pass for a whole feed). */
  async groupByEntity(entityType: 'RESTAURANT' | 'RIDER'): Promise<Map<string, KycDocument[]>> {
    const groups = new Map<string, KycDocument[]>();
    for (const doc of memoryStore.kycDocuments.values()) {
      if (doc.entityType !== entityType) continue;
      const list = groups.get(doc.entityId);
      if (list) list.push(doc);
      else groups.set(doc.entityId, [doc]);
    }
    return groups;
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
    if (status === 'APPROVED') {
      // Approved, it is the document: an earlier refusal's reason goes, and so does
      // the link to the one it replaced (withdrawing it later leaves nothing standing).
      delete doc.rejectionReason;
      delete doc.replacesId;
    } else if (rejectionReason) doc.rejectionReason = rejectionReason;

    memoryStore.kycDocuments.set(id, doc);
    triggerAutoSave();
    return doc;
  }
}

export const kycRepository = new KycRepository();
