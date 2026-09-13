import { Router } from 'express';
import { z } from 'zod';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';

export const walletRouter = Router();

// Enforce authentication on all wallet operations
walletRouter.use(authMiddleware());

function isAdmin(req: any): boolean {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

/** Reading a balance is allowed for the owner of the wallet, or for staff. */
function checkWalletAccess(req: any, res: any, next: any) {
  const isSelf = req.user?.id === req.params.userId;
  if (!isSelf && !isAdmin(req)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: You cannot access or modify another user\'s wallet.'
    });
  }
  next();
}

/**
 * Moving money is staff-only. Ownership is *not* sufficient: this endpoint used to
 * accept "is this my own wallet?" as authorisation for a credit, which let any
 * signed-in user top themselves up to an arbitrary balance and order for free.
 * Real top-ups must originate from a settled payment, and trip payouts are credited
 * by the server when a delivery is confirmed — never on the client's say-so.
 */
function requireStaff(req: any, res: any, next: any) {
  if (!isAdmin(req)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: wallet balances can only be adjusted by platform staff.'
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
walletRouter.post('/:userId/credit', requireStaff, validate({ body: CreditWalletSchema }), async (req, res) => {
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
walletRouter.post('/:userId/debit', requireStaff, validate({ body: DebitWalletSchema }), async (req, res) => {
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
