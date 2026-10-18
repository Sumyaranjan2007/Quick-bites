/**
 * One record per person (master plan B7, #11): Admin → People → restaurant |
 * rider | customer → Record.
 *
 * The People detail routes (`peopleRoutes.ts`) already give the profile,
 * orders/trips, money and documents for review; this adds what they lacked:
 * documents grouped by type with each file downloadable and "Download all"
 * as one ZIP, photos, support tickets, and the audit history about that one
 * person. Each part is withheld (null) unless the caller holds its permission,
 * so one screen can show a finance admin the record without identity papers.
 * Downloads of documents are written to the audit log.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AdminPermission, KycDocument } from '@quick-bites/shared-types';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { zip } from '../../utils/simpleZip.ts';
import { memoryStore } from '../../db/client.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { userRepository, rolesOf } from '../../db/repositories/userRepository.ts';
import { kycRepository, documentsByType } from '../../db/repositories/kycRepository.ts';
import { supportRepository } from '../../db/repositories/supportRepository.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';

export const recordRoutes = Router();

type Kind = 'restaurant' | 'rider' | 'customer';
const VIEW: Record<Kind, AdminPermission> = {
  restaurant: 'users.restaurants.view',
  rider: 'users.drivers.view',
  customer: 'users.customers.view'
};
const Params = z.object({ kind: z.enum(['restaurant', 'rider', 'customer']), id: z.string().min(1).max(80) }).passthrough();
const mayView = [
  validate({ params: Params }),
  (req: Request, res: any, next: any) => requirePermission(VIEW[req.params.kind as Kind])(req, res, next)
];
const can = (req: Request, permission: AdminPermission) =>
  Boolean(req.adminAccess?.isSuperAdmin || req.adminAccess?.permissions.includes(permission));

interface Person {
  kind: Kind;
  id: string;
  userId: string;
  name: string;
  documents: KycDocument[];
  photos: Array<{ label: string; url: string }>;
}

async function personFor(kind: Kind, id: string): Promise<Person> {
  if (kind === 'rider') {
    const rider = await riderRepository.findById(id);
    if (rider) {
      return {
        kind, id, userId: rider.userId, name: rider.fullName,
        documents: await kycRepository.findByEntity('RIDER', id),
        photos: rider.profilePhotoUrl ? [{ label: 'Profile photo', url: rider.profilePhotoUrl }] : []
      };
    }
  } else if (kind === 'restaurant') {
    const kitchen = await restaurantRepository.findById(id);
    if (kitchen) {
      const dishes = (memoryStore.menus.get(id)?.categories || []).flatMap((c: any) => c.items || []);
      return {
        kind, id, userId: kitchen.ownerId, name: kitchen.name,
        documents: await kycRepository.findByEntity('RESTAURANT', id),
        photos: [
          ...(kitchen.bannerUrl ? [{ label: 'Cover', url: kitchen.bannerUrl }] : []),
          ...(kitchen.galleryUrls || []).map(url => ({ label: 'Gallery', url })),
          ...dishes.filter((d: any) => d.imageUrl).map((d: any) => ({ label: d.name, url: d.imageUrl }))
        ]
      };
    }
  } else {
    const user = await userRepository.findById(id);
    if (user && rolesOf(user).includes('customer')) {
      const avatar = (user as any).avatarUrl;
      return { kind, id, userId: user.id, name: user.fullName, documents: [], photos: avatar ? [{ label: 'Profile photo', url: avatar }] : [] };
    }
  }
  throw new AppError('No such person.', 404, 'PERSON_NOT_FOUND');
}

const GROUPS: Array<[string, string[]]> = [
  ['Licences', ['FSSAI', 'DRIVING_LICENSE', 'VEHICLE_RC', 'INSURANCE']],
  ['Tax', ['GSTIN', 'PAN']],
  ['Identity', ['AADHAAR']],
  ['Bank', ['BANK_PROOF']]
];
const groupOf = (type: string) => GROUPS.find(([, types]) => types.includes(type))?.[0] || 'Other';
const fileKind = (url: string) => (url?.startsWith('data:') ? 'image' : /^https?:\/\//.test(url || '') ? 'link' : 'missing');
// An Aadhaar number is shown masked, as UIDAI requires of anyone holding one.
const shownNumber = (d: KycDocument) =>
  d.documentType === 'AADHAAR' && d.documentNumber ? `XXXX XXXX ${d.documentNumber.replace(/\D/g, '').slice(-4)}` : d.documentNumber;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const fileName = (p: Person, d: KycDocument, ext: string) => `${p.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${d.documentType}.${ext}`;
function decode(url: string): { type: string; data: Buffer } | null {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(url);
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null;
}

/** GET /api/admin/records/:kind/:id — the parts of one person's record the caller may see. */
recordRoutes.get('/records/:kind/:id', ...mayView, async (req, res, next) => {
  try {
    const p = await personFor(req.params.kind as Kind, req.params.id);
    const base = `/api/admin/records/${p.kind}/${p.id}`;
    const byType = documentsByType(p.documents);
    const documents = can(req, 'documents.view')
      ? GROUPS.map(([g]) => g).concat('Other')
          .map(group => ({
            group,
            // Newest first; `current` marks the upload in force for its type, `standing` the
            // approved one that counts (an earlier one while a replacement waits or was refused).
            items: p.documents.filter(d => groupOf(d.documentType) === group).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map(d => ({
              id: d.id, documentType: d.documentType, documentNumber: shownNumber(d), status: d.status,
              rejectionReason: d.rejectionReason, submittedAt: d.submittedAt, reviewedAt: d.reviewedAt,
              current: byType.get(d.documentType)?.latest.id === d.id,
              standing: byType.get(d.documentType)?.standing?.id === d.id,
              replacesId: d.replacesId,
              file: fileKind(d.fileUrl), downloadPath: `${base}/documents/${d.id}/file`
            }))
          }))
          .filter(g => g.items.length > 0)
      : null;
    const tickets = await supportRepository.listByUser(p.userId);
    const support = can(req, 'support.tickets.view')
      ? { tickets: tickets.map(t => ({ id: t.id, subject: t.subject, category: t.category, status: t.status, orderNumber: t.orderNumber, replies: t.replies.length, createdAt: t.createdAt, updatedAt: t.updatedAt })) }
      : null;
    // About them: their record, their account, their documents and tickets.
    const about = new Set([p.id, p.userId, ...p.documents.map(d => d.id), ...tickets.map(t => t.id)]);
    const history = can(req, 'admin.audit.view')
      ? (await auditRepository.list({ limit: Number.MAX_SAFE_INTEGER })).filter(a => a.entityId && about.has(a.entityId)).slice(0, 200)
      : null;
    res.json({
      success: true,
      data: {
        kind: p.kind, id: p.id, userId: p.userId, name: p.name, photos: p.photos, documents, support, history,
        // Orders/trips, money and the profile stay on the People detail route.
        detailPath: { restaurant: `/api/admin/restaurants/${p.id}`, rider: `/api/admin/drivers/${p.id}`, customer: `/api/admin/customers/${p.id}` }[p.kind]
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/records/:kind/:id/documents/:docId/file — one document, only through its own person. */
recordRoutes.get('/records/:kind/:id/documents/:docId/file', ...mayView, requirePermission('documents.view'), async (req, res, next) => {
  try {
    const p = await personFor(req.params.kind as Kind, req.params.id);
    const doc = p.documents.find(d => d.id === req.params.docId);
    if (!doc) throw new AppError('No such document for this person.', 404, 'DOCUMENT_NOT_FOUND');
    const kind = fileKind(doc.fileUrl);
    if (kind === 'missing') throw new AppError('This document has no file. Ask them to upload it again.', 404, 'FILE_MISSING');
    recordAudit(req, { action: 'DOCUMENT_DOWNLOADED', entityType: 'KYC_DOCUMENT', entityId: doc.id, summary: `Downloaded ${p.name}'s ${doc.documentType}` });
    // An old document stored as a link is not followed for the admin (security L8): its address is
    // given as text so it is opened knowingly. New uploads cannot be links any more (L5).
    if (kind === 'link') {
      return res.status(409).json({
        success: false,
        error: { code: 'DOCUMENT_IS_A_LINK', message: `This document is a link, not a photo: ${doc.fileUrl}. Ask them to upload a photo instead.` }
      });
    }
    const file = decode(doc.fileUrl);
    if (!file) throw new AppError('This document has no file. Ask them to upload it again.', 404, 'FILE_MISSING');
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(p, doc, EXT[file.type] || 'bin')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.data);
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/records/:kind/:id/documents.zip — every stored file, plus an index of all of them. */
recordRoutes.get('/records/:kind/:id/documents.zip', ...mayView, requirePermission('documents.view'), async (req, res, next) => {
  try {
    const p = await personFor(req.params.kind as Kind, req.params.id);
    if (p.documents.length === 0) throw new AppError('This person has no documents.', 404, 'NO_DOCUMENTS');
    const files: Array<{ name: string; data: Buffer }> = [];
    const index: string[] = [`Documents of ${p.name} (${p.kind} ${p.id}), ${new Date().toISOString()}`, ''];
    for (const d of p.documents) {
      const file = decode(d.fileUrl);
      let name = file ? fileName(p, d, EXT[file.type] || 'bin') : '';
      for (let n = 2; name && files.some(f => f.name === name); n++) name = fileName(p, d, `${n}.${EXT[file!.type] || 'bin'}`);
      if (file) files.push({ name, data: file.data });
      const where = file ? name : fileKind(d.fileUrl) === 'link' ? `link: ${d.fileUrl}` : 'FILE MISSING';
      index.push(`${d.documentType}\t${d.status}\t${shownNumber(d) || '-'}\t${where}`);
    }
    files.push({ name: 'index.txt', data: Buffer.from(index.join('\r\n') + '\r\n', 'utf8') });
    recordAudit(req, { action: 'DOCUMENTS_DOWNLOADED_ALL', entityType: p.kind.toUpperCase(), entityId: p.id, summary: `Downloaded all ${p.documents.length} documents of ${p.name}` });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/[^A-Za-z0-9]+/g, '-')}-documents.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(zip(files));
  } catch (err) {
    next(err);
  }
});
