import { Router } from 'express';
import { z } from 'zod';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { validate } from '../middlewares/validate.ts';

export const kycRouter = Router();

const SubmitKycSchema = z.object({
  entityType: z.enum(['RESTAURANT', 'RIDER']),
  entityId: z.string().min(1, 'entityId is required'),
  entityName: z.string().min(1, 'entityName is required'),
  documentType: z.string().min(1, 'documentType is required'),
  fileUrl: z.string().min(1, 'fileUrl is required')
});

// POST /api/kyc/submit
kycRouter.post('/submit', validate({ body: SubmitKycSchema }), async (req, res) => {
  try {
    const { entityType, entityId, entityName, documentType, fileUrl } = req.body;

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
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/kyc/status/:entityType/:entityId
kycRouter.get('/status/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
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
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
