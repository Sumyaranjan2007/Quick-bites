/**
 * Payout accounts, from operations' side of the desk.
 *
 * Two jobs. Seeing which partners and riders can actually be paid — because a
 * settlement run that discovers half its payees have no verified account is a
 * settlement run that has already failed — and deciding the cases the automatic
 * check deliberately would not.
 *
 * -------------------------------------------------------------------------
 * WHY THERE IS A QUEUE AT ALL
 * -------------------------------------------------------------------------
 * A penny drop returns the name the bank holds and a 0–100 comparison against
 * ours. Above 90 the platform accepts it and below 70 it refuses. The band
 * between is left to a person on purpose, because two very different things
 * land in it and look identical to a score:
 *
 *   - "R Sharma" at the bank against "Rahul Sharma" on the KYC. The same
 *     person, and refusing them would lock out an honest partner who has no way
 *     to find out why.
 *   - Somebody being paid into a relative's account, or a stranger's.
 *
 * Nothing automatic can separate those. Guessing in either direction is a
 * decision, and this queue is where a person makes it with both names in front
 * of them.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import {
  reviewQueue,
  reviewAccount,
  listFor,
  publicView,
  NAME_MATCH_ACCEPT,
  NAME_MATCH_REVIEW
} from '../../modules/payments/payeeAccounts.ts';
import { isRazorpayXConfigured } from '../../modules/payments/razorpayXAdapter.ts';
import type { PayeeAccount } from '@quick-bites/shared-types';

export const payeeRoutes = Router();

/** Who an account belongs to, in words an administrator can act on. */
async function describeOwner(account: PayeeAccount): Promise<{ name: string; detail: string }> {
  if (account.ownerType === 'RIDER') {
    const rider = await riderRepository.findById(account.ownerId);
    return {
      name: rider?.fullName || 'Unknown rider',
      detail: rider?.driverCode ? `Rider ${rider.driverCode}` : 'Rider'
    };
  }
  const restaurant = await restaurantRepository.findById(account.ownerId);
  return {
    name: restaurant?.name || 'Unknown restaurant',
    detail: restaurant?.city ? `Restaurant, ${restaurant.city}` : 'Restaurant'
  };
}

/**
 * GET /api/admin/payee-accounts/review
 *
 * Everything the automatic check could not settle. Each row carries BOTH names
 * and the score, because the decision cannot be made without seeing them side
 * by side — a queue that shows only "needs review" is a queue that gets
 * approved on autopilot.
 */
payeeRoutes.get(
  '/payee-accounts/review',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  async (_req, res, next) => {
    try {
      const queue = reviewQueue();
      const rows = await Promise.all(
        queue.map(async account => {
          const owner = await describeOwner(account);
          return {
            ...publicView(account),
            ownerType: account.ownerType,
            ownerId: account.ownerId,
            ownerName: owner.name,
            ownerDetail: owner.detail
          };
        })
      );

      res.json({
        success: true,
        data: {
          queue: rows,
          thresholds: { accept: NAME_MATCH_ACCEPT, review: NAME_MATCH_REVIEW },
          verificationAvailable: isRazorpayXConfigured()
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/payee-accounts/coverage
 *
 * Who can be paid and who cannot, before a payout run rather than during one.
 *
 * This exists because the expensive way to learn that eleven riders have no
 * verified account is to draft eleven payouts and watch them refuse. An
 * administrator should be able to see the gap on a Monday and have somebody
 * chase it, rather than meet it on payday.
 */
payeeRoutes.get(
  '/payee-accounts/coverage',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (_req, res, next) => {
    try {
      const [riders, restaurants] = await Promise.all([
        riderRepository.findAll(),
        restaurantRepository.listAll()
      ]);

      const summarise = (
        people: Array<{ id: string; name: string }>,
        ownerType: 'RIDER' | 'RESTAURANT'
      ) => {
        const withoutAccount: Array<{ id: string; name: string; reason: string }> = [];
        let payable = 0;

        for (const person of people) {
          const accounts = listFor(ownerType, person.id);
          const verified = accounts.find(a => a.validationStatus === 'VERIFIED');
          if (verified) {
            payable++;
            continue;
          }
          const pending = accounts[0];
          withoutAccount.push({
            id: person.id,
            name: person.name,
            reason: !pending
              ? 'No account added'
              : pending.validationStatus === 'NAME_MISMATCH'
              ? 'Awaiting review'
              : pending.validationStatus === 'INVALID'
              ? 'The bank refused it'
              : 'Not verified'
          });
        }

        return { total: people.length, payable, withoutAccount };
      };

      res.json({
        success: true,
        data: {
          riders: summarise(
            riders.map((r: { id: string; fullName?: string; driverCode?: string }) => ({
              id: r.id,
              name: r.fullName || r.driverCode || r.id
            })),
            'RIDER'
          ),
          restaurants: summarise(
            restaurants.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })),
            'RESTAURANT'
          )
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const ReviewDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z
    .string()
    .trim()
    .min(3, 'Record what you checked. This is the only evidence that a person looked at it.')
    .max(400)
});

/**
 * POST /api/admin/payee-accounts/:id/review
 *
 * A human's decision. Only reachable for an account the automatic check left
 * undecided — an administrator cannot approve one the bank said does not exist,
 * because that is not a judgement call and allowing it would make the penny
 * drop advisory.
 *
 * The note is required in BOTH directions. A rejection the payee cannot act on
 * is a payee who re-submits the same account, and an approval with no recorded
 * reason is the one an auditor will ask about.
 */
payeeRoutes.post(
  '/payee-accounts/:id/review',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  validate({ body: ReviewDecisionSchema }),
  async (req, res, next) => {
    try {
      const before = reviewQueue().find(a => a.id === req.params.id);
      const account = reviewAccount(
        req.params.id,
        req.body.decision,
        { userId: req.user!.id },
        req.body.note
      );
      const owner = await describeOwner(account);

      recordAudit(req, {
        action: req.body.decision === 'APPROVE' ? 'PAYEE_ACCOUNT_APPROVED' : 'PAYEE_ACCOUNT_REJECTED',
        entityType: 'PAYEE_ACCOUNT',
        entityId: account.id,
        summary:
          `${req.body.decision === 'APPROVE' ? 'Approved' : 'Rejected'} the payout account for ` +
          `${owner.name} — bank name "${account.registeredName || 'not returned'}" against ` +
          `"${account.holderName}", score ${account.nameMatchScore ?? 'none'}. ${req.body.note}`,
        before: { status: before?.validationStatus, score: before?.nameMatchScore },
        after: { status: account.validationStatus }
      });

      res.json({
        success: true,
        data: { account: publicView(account) },
        message:
          req.body.decision === 'APPROVE'
            ? `${owner.name} can now be paid.`
            : `${owner.name} has been told to add a different account.`
      });
    } catch (err) {
      next(err);
    }
  }
);
