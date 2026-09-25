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

/**
 * GET /api/wallets/me — the signed-in user's own wallet and its history.
 *
 * Must be declared before `/:userId`, or Express matches "me" as a user id and
 * the ownership check refuses the request with a 403. That is exactly what was
 * happening: the customer app asked for `/wallets/me`, was told it could not
 * access another user's wallet, and quietly showed no balance at all.
 */
walletRouter.get('/me', async (req, res, next) => {
  try {
    const wallet = await walletRepository.getByUserId(req.user!.id);
    const transactions = await walletRepository.getTransactions(wallet.id);
    res.json({
      success: true,
      data: { wallet, transactions },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

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

/*
 * THE TWO WRITE ROUTES REFUSE, AND STAY MOUNTED.
 *
 * The customer wallet cannot be spent anywhere on this platform: checkout takes
 * cash or an online payment and nothing deducts from a wallet. So a credit here
 * recorded money going to somebody who could never use it, and answered "done" —
 * the "told it happened and nothing did" shape this platform has spent two days
 * removing.
 *
 * Refused rather than deleted, because an app built before today may still call
 * them, and a 404 reads to the owner as the app breaking. A refusal that says what
 * to do instead is something an operator can act on.
 *
 * Non-staff callers never reach this: `requireStaff` still answers them 403 first,
 * which is what stops a customer topping themselves up.
 */
const WALLET_RETIRED =
  'The customer wallet has been retired and cannot be spent anywhere, so crediting it gives nobody anything. ' +
  'To give a customer money back, refund the order — it returns to the card or UPI they paid with, or by payout link for a cash order.';

// POST /api/wallets/:userId/credit
walletRouter.post('/:userId/credit', requireStaff, validate({ body: CreditWalletSchema }), (_req, res) => {
  return res.status(410).json({
    success: false,
    error: { code: 'WALLET_RETIRED', message: WALLET_RETIRED }
  });
});

const DebitWalletSchema = z.object({
  amount: z.number().positive('Positive amount is required'),
  description: z.string().optional(),
  orderId: z.string().optional()
});

// POST /api/wallets/:userId/debit — the same retirement, the other direction.
walletRouter.post('/:userId/debit', requireStaff, validate({ body: DebitWalletSchema }), (_req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'WALLET_RETIRED',
      message: 'The customer wallet has been retired. Orders are paid online or in cash, and nothing is deducted from a wallet.'
    }
  });
});
