import { Router } from 'express';
import { z } from 'zod';
import { addressRepository } from '../db/repositories/addressRepository.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';

export const addressRouter = Router();

const AddressSchema = z.object({
  label: z.string().min(1, 'label is required').max(40),
  addressLine: z.string().min(5, 'addressLine must be a full street address').max(200),
  landmark: z.string().max(120).optional(),
  city: z.string().min(1, 'city is required').max(60),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'pincode must be a valid 6-digit Indian PIN'),
  coordinates: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
  isDefault: z.boolean().optional()
});

// GET /api/v1/addresses — the signed-in customer's saved addresses
addressRouter.get('/', async (req, res, next) => {
  try {
    const addresses = await addressRepository.listByUserId(req.user!.id);
    res.json({ success: true, data: { addresses } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/addresses
addressRouter.post('/', validate({ body: AddressSchema }), async (req, res, next) => {
  try {
    const address = await addressRepository.create({ ...req.body, userId: req.user!.id });
    res.status(201).json({ success: true, data: { address } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/addresses/:id
addressRouter.put('/:id', validate({ body: AddressSchema.partial() }), async (req, res, next) => {
  try {
    const address = await addressRepository.update(req.params.id, req.user!.id, req.body);
    if (!address) throw new AppError('Address not found.', 404, 'ADDRESS_NOT_FOUND');
    res.json({ success: true, data: { address } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/addresses/:id
addressRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await addressRepository.remove(req.params.id, req.user!.id);
    if (!removed) throw new AppError('Address not found.', 404, 'ADDRESS_NOT_FOUND');
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});
