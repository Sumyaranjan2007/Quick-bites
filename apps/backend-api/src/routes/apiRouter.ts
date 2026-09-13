import { Router } from 'express';
import { orderRouter } from './orderRouter.ts';
import { searchRouter } from './searchRouter.ts';
import { authRouter } from './authRouter.ts';
import { kycRouter } from './kycRouter.ts';
import { adminRouter } from './adminRouter.ts';
import { addressRouter } from './addressRouter.ts';
import { riderRouter } from './riderRouter.ts';
import { walletRouter } from './walletRouter.ts';
import { restaurantRouter } from './restaurantRouter.ts';
import { supportRouter } from './supportRouter.ts';
import { getHealth } from '../controllers/healthController.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { z } from 'zod';

export const apiRouter = Router();

// Public Health Check
apiRouter.get('/health', getHealth);

// Test Echo Schema for automated tests
const TestEchoSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  vegOnly: z.boolean().optional()
});

apiRouter.post('/test/echo', validate({ body: TestEchoSchema }), (req, res) => {
  res.json({
    success: true,
    data: {
      echo: req.body,
      receivedAt: new Date().toISOString()
    },
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId
    }
  });
});

// Protected Profile Route (Compatible with bearer token tests)
apiRouter.get('/auth/me', authMiddleware(), (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user
    },
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId
    }
  });
});

// Core Domain Routers
apiRouter.use('/auth', authRouter);
apiRouter.use('/kyc', authMiddleware(), kycRouter);
apiRouter.use('/admin', authMiddleware('admin'), adminRouter);
apiRouter.use('/riders', authMiddleware('rider'), riderRouter);
apiRouter.use('/wallets', authMiddleware(), walletRouter);
// Complaints and refund requests raised from the customer, partner and rider
// apps. Authentication is applied inside the router, which also decides who may
// see which case.
apiRouter.use('/support', supportRouter);
apiRouter.use('/addresses', authMiddleware(), addressRouter);
apiRouter.use('/restaurants', restaurantRouter);
apiRouter.use('/orders', orderRouter);
// Search reads are public; the reindex inside is admin-gated on its own route.
apiRouter.use('/search', searchRouter);
