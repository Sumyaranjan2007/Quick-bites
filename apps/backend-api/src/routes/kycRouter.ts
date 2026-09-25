import { Router } from 'express';
import { z } from 'zod';
import { notifyAdminsKycSubmitted } from '../notifications/adminNotifier.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { RIDER_DOCUMENT_TYPES, MANDATORY_RIDER_DOCUMENTS } from '../db/repositories/riderRepository.ts';
import {
  RESTAURANT_DOCUMENT_TYPES,
  buildDocumentOverview
} from '../modules/restaurants/restaurantDocuments.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';

export const kycRouter = Router();

/*
 * ONE VOCABULARY, shared with the requirement catalogues.
 *
 * `documentType` used to be any non-empty string here, while the partner and
 * rider routes accept a fixed enum and the requirement catalogues are written
 * in that same enum. So a client could submit `FSSAI_LICENSE` through this
 * route — a plausible-looking name that is not the `FSSAI` the catalogue asks
 * for — and the document would be filed, queued, and approved by a reviewer
 * without ever satisfying the requirement it was sent to satisfy.
 *
 * Nothing caught it because approving any single document used to approve the
 * whole partner. With approval now derived from the catalogue, a document
 * filed under a name the catalogue does not know is a document that can never
 * verify anybody, and the partner waits for an approval that has already
 * happened.
 *
 * A type is checked against the ENTITY it belongs to, so a rider cannot file a
 * FSSAI licence and a restaurant cannot file a driving licence.
 */
const ENTITY_DOCUMENT_TYPES: Record<string, readonly string[]> = {
  RESTAURANT: RESTAURANT_DOCUMENT_TYPES,
  RIDER: RIDER_DOCUMENT_TYPES
};

const SubmitKycSchema = z
  .object({
    entityType: z.enum(['RESTAURANT', 'RIDER']),
    entityId: z.string().min(1, 'entityId is required'),
    entityName: z.string().min(1, 'entityName is required'),
    documentType: z.string().min(1, 'documentType is required'),
    /* Bounded and typed as on the partner and rider routes: a photograph or a
     * link to one, never a sentence describing where the file was emailed. */
    fileUrl: z
      .string()
      .max(700_000, 'That photo is too large. Take a new one from inside the app.')
      .refine(
        v => v.startsWith('data:image/') || /^https?:\/\//.test(v),
        'Attach a photo of the document.'
      )
  })
  .superRefine((value, ctx) => {
    const allowed = ENTITY_DOCUMENT_TYPES[value.entityType] || [];
    if (!allowed.includes(value.documentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documentType'],
        message: `Not a document this platform asks for. Expected one of: ${allowed.join(', ')}.`
      });
    }
  });

/**
 * KYC records carry government identity numbers. Both routes used to accept any
 * entityId from any signed-in account, so anyone could read another partner's
 * document numbers, or push a rival's listing into re-verification.
 */
async function assertControlsEntity(req: any, entityType: string, entityId: string) {
  const role = req.user?.role;
  if (role === 'admin' || role === 'super_admin') return;

  if (entityType === 'RESTAURANT') {
    const restaurant = await restaurantRepository.findById(entityId);
    if (!restaurant || restaurant.ownerId !== req.user?.id) {
      throw new AppError('You do not manage this restaurant.', 403, 'NOT_RESTAURANT_OWNER');
    }
    return;
  }

  const rider = await riderRepository.findByUserId(req.user!.id);
  if (!rider || rider.id !== entityId) {
    throw new AppError('You can only manage your own rider record.', 403, 'NOT_YOUR_RIDER_RECORD');
  }
}

// POST /api/kyc/submit
kycRouter.post('/submit', validate({ body: SubmitKycSchema }), async (req, res, next) => {
  try {
    const { entityType, entityId, entityName, documentType, fileUrl } = req.body;
    await assertControlsEntity(req, entityType, entityId);

    const doc = await kycRepository.submitDocument({
      entityType,
      entityId,
      entityName,
      documentType,
      fileUrl
    });

    /*
     * A submission puts the entity back into review — unless it is already
     * trading, in which case sending an optional extra document must not
     * quietly un-verify a live restaurant or take a rider off the road.
     *
     * The restaurant branch used to assign `rest.kycStatus` directly and never
     * call `triggerAutoSave`, so the change survived only if some unrelated
     * write happened to save the store before the next restart. That is the
     * same defect the kitchen toggle and the document review both had.
     */
    if (entityType === 'RESTAURANT') {
      const rest = await restaurantRepository.findById(entityId);
      if (rest && rest.status !== 'ACTIVE' && rest.kycStatus !== 'ACTIVE') {
        rest.kycStatus = 'PENDING_APPROVAL';
        memoryStore.restaurants.set(rest.id, rest);
        triggerAutoSave();
      }
    } else if (entityType === 'RIDER') {
      const rider = await riderRepository.findById(entityId);
      if (rider && rider.kycStatus !== 'ACTIVE') {
        await riderRepository.updateKycStatus(entityId, 'PENDING_APPROVAL');
      }
    }

    /*
     * Told from the ROUTE, not from `kycRepository.submitDocument`.
     *
     * The repository is the tempting place — one chokepoint, three callers, no
     * risk of a fourth being forgotten. But `db/seed.ts` calls it three times,
     * so a notification there would push "a document needs checking" to the
     * owner's phone every time anybody seeds a demo database. A notifier wired
     * into a data layer cannot tell a real event from a fixture.
     */
    void notifyAdminsKycSubmitted({
      documentId: doc.id,
      ownerName: entityName,
      documentLabel: String(documentType).toLowerCase().replace(/_/g, ' ')
    });

    return res.status(201).json({
      success: true,
      data: { document: doc },
      message: 'KYC document submitted successfully. Awaiting operations review.'
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/kyc/status/:entityType/:entityId
kycRouter.get('/status/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    await assertControlsEntity(req, entityType, entityId);

    const docs = await kycRepository.findByEntity(entityType as any, entityId);

    /*
     * ACTIVE means every REQUIRED document is approved, not that one of them is.
     *
     * This read said ACTIVE as soon as any single document was approved, so a
     * restaurant with an approved bank proof and no food licence reported
     * itself verified to anything asking — which is the same mistake the review
     * route made when it wrote the decision.
     */
    let overallStatus: string;
    if (entityType === 'RESTAURANT') {
      const overview = buildDocumentOverview(docs);
      const requiredRejected = overview.slots.some(s => s.required && s.status === 'REJECTED');
      overallStatus = overview.verified ? 'ACTIVE' : requiredRejected ? 'REJECTED' : 'PENDING_APPROVAL';
    } else {
      const approved = new Set(docs.filter(d => d.status === 'APPROVED').map(d => d.documentType));
      const requiredRejected = docs.some(
        d =>
          d.status === 'REJECTED' &&
          (MANDATORY_RIDER_DOCUMENTS as readonly string[]).includes(d.documentType)
      );
      overallStatus = MANDATORY_RIDER_DOCUMENTS.every(t => approved.has(t))
        ? 'ACTIVE'
        : requiredRejected
          ? 'REJECTED'
          : 'PENDING_APPROVAL';
    }

    return res.json({
      success: true,
      data: {
        entityType,
        entityId,
        overallStatus,
        documents: docs
      }
    });
  } catch (err) {
    next(err);
  }
});
