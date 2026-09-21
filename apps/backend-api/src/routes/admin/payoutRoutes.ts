/**
 * Paying people, from operations' side of the desk.
 *
 * One queue for everybody the platform owes — partners and riders together,
 * because paying a kitchen and paying a rider is the same job done twice and
 * splitting it across two screens is how one of them gets forgotten on a
 * Friday.
 *
 * -------------------------------------------------------------------------
 * WHAT IS ENFORCED HERE VERSUS IN THE SCREEN
 * -------------------------------------------------------------------------
 * Everything. The maker-checker rule, the daily cap and the verified-account
 * requirement are all checked on the server at the moment of execution. The
 * admin app disables buttons as a convenience; it is not the control, and a
 * request sent by hand to this endpoint meets exactly the same refusals.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import {
  allDues,
  duesFor,
  draftPayout,
  approvePayout,
  cancelPayout,
  executePayout,
  findPayout,
  listPayouts,
  payoutView,
  paidInLast24hPaise
} from '../../modules/payments/payouts.ts';
import { railCatalogue, defaultRail } from '../../modules/payments/rails.ts';
import { getActiveRates } from '../../modules/payments/pricingConfig.ts';
import { payableAccountFor, publicView as payeeView } from '../../modules/payments/payeeAccounts.ts';
import { backfillEarnings } from '../../modules/payments/earnings.ts';
import { ledger, accountFor } from '../../modules/payments/ledger.ts';
import { toPaise, toRupees, formatPaise } from '../../modules/payments/money.ts';
import type { PayeeOwnerType, PayoutRailId } from '@quick-bites/shared-types';

export const payoutRoutes = Router();

/** Everyone the platform could owe money to. */
async function everybody(): Promise<Array<{ ownerType: PayeeOwnerType; ownerId: string; ownerName: string }>> {
  const [riders, restaurants] = await Promise.all([
    riderRepository.findAll(),
    restaurantRepository.listAll()
  ]);

  return [
    ...restaurants.map((r: { id: string; name: string }) => ({
      ownerType: 'RESTAURANT' as const,
      ownerId: r.id,
      ownerName: r.name
    })),
    ...riders.map((r: { id: string; fullName?: string; driverCode?: string }) => ({
      ownerType: 'RIDER' as const,
      ownerId: r.id,
      ownerName: r.fullName || r.driverCode || r.id
    }))
  ];
}

/**
 * GET /api/admin/payouts/dues
 *
 * The daily queue: who is owed what, who is blocked and why.
 *
 * The blocked rows are shown rather than filtered out, and that is the point of
 * the screen. A list of only the payable ones looks finished; a list that says
 * "four riders are holding cash and two partners have no verified account" is
 * the day's actual work.
 */
payoutRoutes.get(
  '/payouts/dues',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (_req, res, next) => {
    try {
      const rates = getActiveRates();
      const dues = allDues(await everybody());

      const payable = dues.filter(d => !d.blockedReason && d.payablePaise > 0);
      const blocked = dues.filter(d => d.blockedReason && d.outstandingPaise > 0);

      const capPaise = toPaise(rates.dailyPayoutCap);
      const usedPaise = paidInLast24hPaise();

      res.json({
        success: true,
        data: {
          dues: dues.map(d => ({
            ...d,
            payable: toRupees(d.payablePaise),
            held: toRupees(d.heldPaise),
            outstanding: toRupees(d.outstandingPaise),
            cashInHand: toRupees(d.cashInHandPaise)
          })),
          summary: {
            payableCount: payable.length,
            payableTotal: toRupees(payable.reduce((t, d) => t + d.payablePaise, 0)),
            blockedCount: blocked.length,
            blockedTotal: toRupees(blocked.reduce((t, d) => t + d.outstandingPaise, 0)),
            heldTotal: toRupees(dues.reduce((t, d) => t + d.heldPaise, 0))
          },
          limits: {
            dailyCap: rates.dailyPayoutCap,
            usedToday: toRupees(usedPaise),
            remainingToday: toRupees(Math.max(0, capPaise - usedPaise)),
            makerCheckerThreshold: rates.makerCheckerThreshold,
            minPayoutAmount: rates.minPayoutAmount,
            partnerHoldDays: rates.partnerHoldDays,
            riderHoldDays: rates.riderHoldDays
          },
          rails: railCatalogue(),
          defaultRail: defaultRail()
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/payouts/list — everything drafted, sent, failed or waiting. */
payoutRoutes.get(
  '/payouts/list',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (req, res, next) => {
    try {
      const state = typeof req.query.state === 'string' ? (req.query.state as any) : undefined;
      res.json({
        success: true,
        data: { payouts: listPayouts(state ? { state } : {}).map(payoutView) }
      });
    } catch (err) {
      next(err);
    }
  }
);

const DraftSchema = z.object({
  ownerType: z.enum(['RESTAURANT', 'RIDER']),
  ownerId: z.string().trim().min(1).max(120),
  rail: z.enum(['RAZORPAYX', 'PAYOUT_LINK', 'MANUAL_BANK', 'UPI_MANUAL']).optional(),
  note: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/payouts
 *
 * Drafts a payout for everything released and unpaid. The amount is computed
 * from the ledger and frozen onto the draft — an administrator cannot name a
 * figure, because a payouts screen where somebody types an amount is a payouts
 * screen where somebody can type any amount.
 */
payoutRoutes.post(
  '/payouts',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  validate({ body: DraftSchema }),
  async (req, res, next) => {
    try {
      const ownerType = req.body.ownerType as PayeeOwnerType;
      const ownerName =
        ownerType === 'RIDER'
          ? (await riderRepository.findById(req.body.ownerId))?.fullName || req.body.ownerId
          : (await restaurantRepository.findById(req.body.ownerId))?.name || req.body.ownerId;

      const payout = draftPayout({
        ownerType,
        ownerId: req.body.ownerId,
        ownerName,
        actorUserId: req.user!.id,
        rail: req.body.rail as PayoutRailId | undefined,
        note: req.body.note
      });

      recordAudit(req, {
        action: 'PAYOUT_DRAFTED',
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary: `Drafted ${formatPaise(payout.amountPaise)} for ${ownerName} via ${payout.rail}`,
        after: { amountPaise: payout.amountPaise, state: payout.state }
      });

      res.status(201).json({
        success: true,
        data: { payout: payoutView(payout) },
        message:
          payout.state === 'AWAITING_APPROVAL'
            ? `${formatPaise(payout.amountPaise)} drafted. It needs a second administrator to approve it before it can be sent.`
            : `${formatPaise(payout.amountPaise)} drafted and ready to send.`
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/payouts/:id/approve
 *
 * The second signature. The drafter is refused by name — without that the
 * threshold is decoration, because the same person presses both buttons.
 */
payoutRoutes.post(
  '/payouts/:id/approve',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  async (req, res, next) => {
    try {
      const payout = approvePayout(req.params.id, req.user!.id);

      recordAudit(req, {
        action: 'PAYOUT_APPROVED',
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary:
          `Approved ${formatPaise(payout.amountPaise)} for ${payout.ownerName}, ` +
          `drafted by ${payout.draftedByUserId}`,
        after: { state: payout.state }
      });

      res.json({ success: true, data: { payout: payoutView(payout) }, message: 'Approved. It can now be sent.' });
    } catch (err) {
      next(err);
    }
  }
);

const ExecuteSchema = z.object({
  /** Required on a manual rail: the UTR or reference of the transfer made. */
  manualReference: z.string().trim().max(120).optional(),
  payeePhone: z.string().trim().max(20).optional()
});

/**
 * POST /api/admin/payouts/:id/send
 *
 * The moment money leaves. Every control is checked here rather than at draft,
 * because a draft can sit for a day and twenty drafts can each be under the cap
 * while their sum is far over it.
 */
payoutRoutes.post(
  '/payouts/:id/send',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  validate({ body: ExecuteSchema }),
  async (req, res, next) => {
    try {
      const before = findPayout(req.params.id);
      if (!before) throw new AppError('No such payout.', 404, 'PAYOUT_NOT_FOUND');

      // A payout link needs somewhere to send the link. Resolved from the
      // payee's own record rather than accepted from the request, so nobody
      // can redirect a payout by supplying a different number.
      let payeePhone = req.body.payeePhone;
      if (before.rail === 'PAYOUT_LINK' && !payeePhone) {
        if (before.ownerType === 'RIDER') {
          const rider = await riderRepository.findById(before.ownerId);
          payeePhone = (rider as any)?.phone;
        } else {
          const restaurant = await restaurantRepository.findById(before.ownerId);
          payeePhone = restaurant?.phone;
        }
      }

      const payout = await executePayout({
        id: req.params.id,
        actorUserId: req.user!.id,
        manualReference: req.body.manualReference,
        payeePhone
      });

      recordAudit(req, {
        action: payout.state === 'PAID' ? 'PAYOUT_SENT' : `PAYOUT_${payout.state}`,
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary:
          `${formatPaise(payout.amountPaise)} to ${payout.ownerName} via ${payout.rail} — ` +
          `${payout.state}${payout.reference ? ` (${payout.reference})` : ''}`,
        before: { state: before.state },
        after: { state: payout.state, reference: payout.reference }
      });

      res.json({
        success: true,
        data: { payout: payoutView(payout) },
        message:
          payout.state === 'PAID'
            ? `${formatPaise(payout.amountPaise)} sent to ${payout.ownerName}.`
            : payout.state === 'FAILED'
            ? `Refused: ${payout.failureReason || 'the payout method rejected it'}. Nothing has left the account.`
            : 'The request was sent and its outcome is not yet known. It will be reconciled — do not send it again.'
      });
    } catch (err) {
      next(err);
    }
  }
);

const CancelSchema = z.object({
  reason: z.string().trim().min(3, 'Record why it was cancelled.').max(400)
});

payoutRoutes.post(
  '/payouts/:id/cancel',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  validate({ body: CancelSchema }),
  async (req, res, next) => {
    try {
      const payout = cancelPayout(req.params.id, req.user!.id, req.body.reason);
      recordAudit(req, {
        action: 'PAYOUT_CANCELLED',
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary: `Cancelled ${formatPaise(payout.amountPaise)} for ${payout.ownerName} — ${req.body.reason}`,
        after: { state: payout.state }
      });
      res.json({
        success: true,
        data: { payout: payoutView(payout) },
        message: 'Cancelled. What they were owed goes back into the queue.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/payouts/statement/:ownerType/:ownerId
 *
 * Why a number is what it is, entry by entry.
 *
 * This is the answer to "why am I being paid this?", and it is the reason the
 * ledger exists. A settlement total with nothing behind it is a number a
 * partner has to take on trust, and a partner who cannot check their own
 * settlement eventually stops believing any of them.
 */
payoutRoutes.get(
  '/payouts/statement/:ownerType/:ownerId',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (req, res, next) => {
    try {
      const ownerType = req.params.ownerType.toUpperCase() as PayeeOwnerType;
      if (ownerType !== 'RESTAURANT' && ownerType !== 'RIDER') {
        throw new AppError('A payee is a restaurant or a rider.', 400, 'BAD_OWNER_TYPE');
      }

      const ownerName =
        ownerType === 'RIDER'
          ? (await riderRepository.findById(req.params.ownerId))?.fullName || req.params.ownerId
          : (await restaurantRepository.findById(req.params.ownerId))?.name || req.params.ownerId;

      const due = duesFor(ownerType, req.params.ownerId, ownerName);
      const account = payableAccountFor(ownerType, req.params.ownerId);

      const kind = ownerType === 'RESTAURANT' ? 'PARTNER_PAYABLE' : 'RIDER_PAYABLE';
      const account_ = accountFor(kind as any, req.params.ownerId);

      // The entries behind the figure, newest first. This is what turns a total
      // into something a partner can check line by line.
      const entries = ledger.query({ account: account_, limit: 200 }).map(entry => ({
        id: entry.id,
        occurredAt: entry.occurredAt,
        event: entry.event,
        orderId: entry.orderId,
        direction: entry.direction,
        amount: toRupees(entry.amountPaise),
        narration: entry.narration,
        /** Whether this entry is inside the figure being paid now. */
        inThisPayout: due.ledgerIds.includes(entry.id)
      }));

      res.json({
        success: true,
        data: {
          owner: { ownerType, ownerId: req.params.ownerId, ownerName },
          due: {
            ...due,
            payable: toRupees(due.payablePaise),
            held: toRupees(due.heldPaise),
            outstanding: toRupees(due.outstandingPaise),
            cashInHand: toRupees(due.cashInHandPaise)
          },
          account: account ? payeeView(account) : null,
          payouts: listPayouts({ ownerId: req.params.ownerId }).map(payoutView),
          entries,
          ledgerKind: kind
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/payouts/backfill
 *
 * Posts earnings for delivered orders that have none.
 *
 * Needed once, for every order delivered before the ledger existed — their
 * partners are owed money the platform cannot currently see. Idempotent, so
 * running it twice is harmless, and it is the recovery path if any future code
 * completes an order without posting its earnings.
 */
payoutRoutes.post(
  '/payouts/backfill',
  requirePermission('finance.settlements.manage'),
  async (req, res, next) => {
    try {
      const result = backfillEarnings();
      recordAudit(req, {
        action: 'EARNINGS_BACKFILLED',
        entityType: 'LEDGER',
        summary: `Scanned ${result.scanned} delivered orders, posted earnings for ${result.posted}`,
        after: result
      });
      res.json({
        success: true,
        data: result,
        message:
          result.posted === 0
            ? `All ${result.scanned} delivered orders already had their earnings posted.`
            : `Posted earnings for ${result.posted} of ${result.scanned} delivered orders.`
      });
    } catch (err) {
      next(err);
    }
  }
);
