/**
 * Endpoints an already-released admin build still calls.
 *
 * A published APK cannot be changed retroactively, so removing these would break
 * every copy already installed. They are thin adapters onto the current
 * repositories — no second implementation of the behaviour — and each one is
 * gated by the same permission as the route that replaced it.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { kycRepository } from '../../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';

export const legacyRoutes = Router();

/** GET /api/admin/kyc/pending — superseded by GET /api/admin/documents. */
legacyRoutes.get('/kyc/pending', requirePermission('documents.view'), async (_req, res, next) => {
  try {
    res.json({ success: true, data: { pending: await kycRepository.getPendingDocuments() } });
  } catch (err) {
    next(err);
  }
});

const ReviewKycSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional()
});

/** POST /api/admin/kyc/review — superseded by POST /api/admin/documents/review. */
legacyRoutes.post(
  '/kyc/review',
  requirePermission('documents.review'),
  validate({ body: ReviewKycSchema }),
  async (req, res, next) => {
    try {
      const { documentId, action, rejectionReason } = req.body;
      const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const doc = await kycRepository.reviewDocument(documentId, status, rejectionReason);
      if (!doc) throw new AppError('Document not found.', 404, 'DOCUMENT_NOT_FOUND');

      if (doc.entityType === 'RESTAURANT') {
        const restaurant = await restaurantRepository.findById(doc.entityId);
        if (restaurant) {
          restaurant.kycStatus = action === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
          if (action === 'APPROVE' && restaurant.status === 'PENDING_APPROVAL') restaurant.status = 'ACTIVE';
          memoryStore.restaurants.set(restaurant.id, restaurant);
          triggerAutoSave();
        }
      } else if (doc.entityType === 'RIDER') {
        await riderRepository.updateKycStatus(doc.entityId, action === 'APPROVE' ? 'ACTIVE' : 'REJECTED');
      }

      recordAudit(req, {
        action: `DOCUMENT_${action}`,
        entityType: 'KYC_DOCUMENT',
        entityId: doc.id,
        summary: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} ${doc.documentType} for ${
          doc.entityName || doc.entityId
        }`
      });

      res.json({
        success: true,
        data: { document: doc },
        message: `KYC Document ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`
      });
    } catch (err) {
      next(err);
    }
  }
);

const SuspendEntitySchema = z.object({
  entityType: z.enum(['RESTAURANT', 'RIDER']),
  entityId: z.string().min(1, 'entityId is required'),
  reason: z.string().optional()
});

/** POST /api/admin/suspend — superseded by the PATCH routes on each entity. */
legacyRoutes.post(
  '/suspend',
  requirePermission('users.restaurants.manage', 'users.drivers.manage'),
  validate({ body: SuspendEntitySchema }),
  async (req, res, next) => {
    try {
      const { entityType, entityId, reason } = req.body;

      if (entityType === 'RESTAURANT') {
        const restaurant = await restaurantRepository.findById(entityId);
        if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
        restaurant.status = 'SUSPENDED';
        restaurant.kycStatus = 'SUSPENDED';
        restaurant.isOpen = false;
        memoryStore.restaurants.set(restaurant.id, restaurant);
        triggerAutoSave();
        recordAudit(req, {
          action: 'RESTAURANT_SUSPENDED',
          entityType: 'RESTAURANT',
          entityId,
          summary: `Suspended ${restaurant.name}${reason ? ` — ${reason}` : ''}`
        });
        return res.json({ success: true, message: `Restaurant ${restaurant.name} suspended.` });
      }

      const rider = await riderRepository.findById(entityId);
      if (!rider) throw new AppError('Delivery partner not found.', 404, 'RIDER_NOT_FOUND');
      await riderRepository.updateKycStatus(entityId, 'SUSPENDED');
      recordAudit(req, {
        action: 'DRIVER_SUSPENDED',
        entityType: 'RIDER',
        entityId,
        summary: `Suspended ${rider.fullName}${reason ? ` — ${reason}` : ''}`
      });
      res.json({ success: true, message: `Rider ${rider.fullName} suspended.` });
    } catch (err) {
      next(err);
    }
  }
);
