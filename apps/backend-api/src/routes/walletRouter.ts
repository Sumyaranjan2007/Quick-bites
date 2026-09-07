import { Router } from 'express';
import { z } from 'zod';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';

export const walletRouter = Router();

// Enforce authentication on all wallet operations
walletRouter.use(authMiddleware());

function checkWalletAccess(req: any, res: any, next: any) {
  const isSelf = req.user?.id === req.params.userId;
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: You cannot access or modify another user\'s wallet.'
    });
  }
  next();
}

// GET /api/wallets/:userId
walletRouter.get('/:userId', checkWalletAccess, async (req, res) => {
  try {
    const wallet = await walletRepository.getByUserId(req.params.userId);
    const transactions = await walletRepository.getTransactions(wallet.id);
    return res.json({
      success: true,
      data: {
        wallet,
        transactions
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const CreditWalletSchema = z.object({
  amount: z.number().positive('Positive amount is required'),
  description: z.string().optional()
});

// POST /api/wallets/:userId/credit
walletRouter.post('/:userId/credit', checkWalletAccess, validate({ body: CreditWalletSchema }), async (req, res) => {
  try {
    const { amount, description } = req.body;
    const wallet = await walletRepository.credit(
      req.params.userId,
      Number(amount),
      description || 'Top-up Credit'
    );
    return res.json({ success: true, data: { wallet } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const DebitWalletSchema = z.object({
  amount: z.number().positive('Positive amount is required'),
  description: z.string().optional(),
  orderId: z.string().optional()
});

// POST /api/wallets/:userId/debit
walletRouter.post('/:userId/debit', checkWalletAccess, validate({ body: DebitWalletSchema }), async (req, res) => {
  try {
    const { amount, description, orderId } = req.body;
    const wallet = await walletRepository.debit(
      req.params.userId,
      Number(amount),
      description || 'Order Payment Deduction',
      orderId
    );
    return res.json({ success: true, data: { wallet } });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});
