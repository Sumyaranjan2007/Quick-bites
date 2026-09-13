import { Router } from 'express';
import { z } from 'zod';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';

export const kycRouter = Router();

const SubmitKycSchema = z.object({
  entityType: z.enum(['RESTAURANT', 'RIDER']),
  entityId: z.string().min(1, 'entityId is required'),
  entityName: z.string().min(1, 'entityName is required'),
  documentType: z.string().min(1, 'documentType is required'),
  fileUrl: z.string().min(1, 'fileUrl is required')
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

    // Update entity status to PENDING_APPROVAL
    if (entityType === 'RESTAURANT') {
      const rest = await restaurantRepository.findById(entityId);
      if (rest) {
        rest.kycStatus = 'PENDING_APPROVAL';
      }
    } else if (entityType === 'RIDER') {
      await riderRepository.updateKycStatus(entityId, 'PENDING_APPROVAL');
    }

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

    let overallStatus = 'PENDING_APPROVAL';
    if (docs.some(d => d.status === 'APPROVED')) {
      overallStatus = 'ACTIVE';
    } else if (docs.some(d => d.status === 'REJECTED')) {
      overallStatus = 'REJECTED';
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
