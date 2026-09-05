import { orderRouter } from './orderRouter.ts';
import { searchRouter } from './searchRouter.ts';
import { Router } from 'express';
import { getHealth } from '../controllers/healthController.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { z } from 'zod';
import { validate } from '../middlewares/validate.ts';

export const apiRouter = Router();

apiRouter.use("/orders", orderRouter);
apiRouter.use("/search", searchRouter);

// Public Health Check
apiRouter.get('/health', getHealth);

// Test Schema for verification
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

// Protected Profile Route (Demonstrates Auth Middleware)
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
