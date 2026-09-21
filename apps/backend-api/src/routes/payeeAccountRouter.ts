/**
 * A partner's or a rider's payout account: adding one, and seeing whether the
 * bank agreed it is theirs.
 *
 * In a router of its own rather than appended to `restaurantRouter` and
 * `riderRouter`, for two reasons. The rule is identical for both — the only
 * difference is which record identifies the owner — and writing it twice is how
 * a rider ends up able to do something a partner cannot. And a second session is
 * working in this repository at the same time and owns both of those files; a
 * new file cannot collide with anything they write.
 *
 * -------------------------------------------------------------------------
 * WHO MAY SEE WHOSE ACCOUNT
 * -------------------------------------------------------------------------
 * Only their own. Every route resolves the owner from the SIGNED-IN USER and
 * never from a path parameter, so there is no id to change in a request to read
 * somebody else's banking. That is why these are `/me` routes rather than
 * `/restaurants/:id/payee-accounts` — a route shaped like the latter invites
 * exactly one attack, and the only defence is a check somebody has to remember
 * to write.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import {
  addAccount,
  listFor,
  findById,
  archiveAccount,
  publicView
} from '../modules/payments/payeeAccounts.ts';
import { isRazorpayXConfigured } from '../modules/payments/razorpayXAdapter.ts';
import type { PayeeOwnerType } from '@quick-bites/shared-types';

export const payeeAccountRouter = Router();

/**
 * Which payee the signed-in user is.
 *
 * A restaurant owner is identified by the restaurant they own; a rider by their
 * rider record. Both are looked up from the token's user id. Anyone else has no
 * payout account and is refused here rather than deeper in, where the refusal
 * would be about a missing record instead of about not being a payee.
 */
async function resolveOwner(userId: string, role: string): Promise<{
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerUserId: string;
  kycName: string;
  contactPhone?: string;
}> {
  if (role === 'rider') {
    const rider = await riderRepository.findByUserId(userId);
    if (!rider) throw new AppError('No rider profile for this account.', 404, 'RIDER_NOT_FOUND');
    return {
      ownerType: 'RIDER',
      ownerId: rider.id,
      ownerUserId: userId,
      kycName: rider.fullName || '',
      contactPhone: (rider as any).phone
    };
  }

  if (role === 'restaurant_owner') {
    const all = await restaurantRepository.listAll();
    const restaurant = all.find(r => r.ownerId === userId);
    if (!restaurant) throw new AppError('No restaurant for this account.', 404, 'RESTAURANT_NOT_FOUND');
    const owner = await userRepository.findById(userId);
    return {
      ownerType: 'RESTAURANT',
      ownerId: restaurant.id,
      ownerUserId: userId,
      // The bank is asked to confirm the name the account is in. For a kitchen
      // that is the registered business name, not the owner's personal one —
      // comparing against the person would fail every properly-held business
      // account, which is most of them.
      kycName: restaurant.name || owner?.fullName || '',
      contactPhone: restaurant.phone
    };
  }

  throw new AppError(
    'Only partners and riders are paid by Quick Bites.',
    403,
    'NOT_A_PAYEE'
  );
}

/**
 * GET /api/payee-accounts/me
 *
 * Their accounts, and whether the platform can currently pay anybody at all —
 * which a screen needs in order to explain a PENDING account honestly instead
 * of leaving a spinner running against a gateway that was never configured.
 */
payeeAccountRouter.get('/me', authMiddleware(), async (req, res, next) => {
  try {
    const owner = await resolveOwner(req.user!.id, req.user!.role);
    const accounts = listFor(owner.ownerType, owner.ownerId);
    res.json({
      success: true,
      data: {
        accounts: accounts.map(publicView),
        verificationAvailable: isRazorpayXConfigured(),
        /** What the bank's answer is compared against, so a screen can show it. */
        registeredName: owner.kycName
      }
    });
  } catch (err) {
    next(err);
  }
});

const AddAccountSchema = z
  .object({
    method: z.enum(['BANK', 'VPA']),
    holderName: z.string().trim().min(3).max(120),
    accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/).optional(),
    /**
     * Asked for twice, and required to match.
     *
     * The one input on this platform where a typo sends money to a stranger who
     * will not give it back. A penny drop catches a number that does not exist;
     * it does NOT catch a number that exists and belongs to somebody else with
     * a similar name. Typing it twice is the only thing that catches that, and
     * it costs a partner fifteen seconds once.
     */
    accountNumberConfirm: z.string().trim().optional(),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
    vpa: z.string().trim().max(96).optional()
  })
  .superRefine((value, ctx) => {
    if (value.method === 'BANK') {
      if (!value.accountNumber) {
        ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'An account number is required.' });
      }
      if (!value.ifsc) {
        ctx.addIssue({ code: 'custom', path: ['ifsc'], message: 'An IFSC is required.' });
      }
      if (value.accountNumber && value.accountNumberConfirm !== value.accountNumber) {
        ctx.addIssue({
          code: 'custom',
          path: ['accountNumberConfirm'],
          message: 'The two account numbers do not match. Check both — money sent to a wrong account is not recoverable.'
        });
      }
    } else if (!value.vpa) {
      ctx.addIssue({ code: 'custom', path: ['vpa'], message: 'A UPI id is required.' });
    }
  });

/**
 * POST /api/payee-accounts/me
 *
 * Adds an account and verifies it in the same request. Verification is not a
 * second button: an account left unverified because somebody did not press one
 * is an account that silently cannot be paid, and the first anyone hears of it
 * is a settlement that never arrived.
 */
payeeAccountRouter.post('/me', authMiddleware(), validate({ body: AddAccountSchema }), async (req, res, next) => {
  try {
    const owner = await resolveOwner(req.user!.id, req.user!.role);

    if (!owner.kycName || owner.kycName.trim().length < 3) {
      throw new AppError(
        'Complete your profile name before adding a bank account — it is what the bank’s answer is checked against.',
        409,
        'KYC_NAME_MISSING'
      );
    }

    const account = await addAccount({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      ownerUserId: owner.ownerUserId,
      method: req.body.method,
      holderName: req.body.holderName,
      accountNumber: req.body.accountNumber,
      ifsc: req.body.ifsc,
      vpa: req.body.vpa,
      kycName: owner.kycName,
      contactPhone: owner.contactPhone,
      createdByUserId: req.user!.id
    });

    res.status(201).json({
      success: true,
      data: { account: publicView(account) },
      message: account.validationMessage
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/payee-accounts/me/:id
 *
 * Archived, never deleted: a payout already sent points at it, and a settlement
 * history that cannot say where the money went is not a history.
 */
payeeAccountRouter.delete('/me/:id', authMiddleware(), async (req, res, next) => {
  try {
    const owner = await resolveOwner(req.user!.id, req.user!.role);
    const account = findById(req.params.id);

    // Checked rather than assumed. The id is in the path, and a route that
    // archives whatever id it is handed is a route that archives somebody
    // else's account.
    if (!account || account.ownerType !== owner.ownerType || account.ownerId !== owner.ownerId) {
      throw new AppError('No such payout account.', 404, 'PAYEE_ACCOUNT_NOT_FOUND');
    }

    archiveAccount(account.id);
    res.json({ success: true, message: 'That account has been removed. Add another before your next payout.' });
  } catch (err) {
    next(err);
  }
});
