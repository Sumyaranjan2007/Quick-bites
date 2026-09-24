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
import {
  payableAccountFor,
  publicView as payeeView,
  awaitingApply
} from '../../modules/payments/payeeAccounts.ts';
import {
  backfillEarnings,
  earningsPosted,
  heldEarnings,
  settlementEvidence,
  recordOrderEarnings
} from '../../modules/payments/earnings.ts';
import { platformMarginPaiseFor } from '../../modules/payments/restaurantCharges.ts';
import { reviewQueue } from '../../modules/payments/payeeAccounts.ts';
import { memoryStore } from '../../db/client.ts';
import {
  listDeposits,
  confirmDeposit,
  cashAgeing,
  recordCashReturn,
  bankOfficeCash,
  officeCashPaise
} from '../../modules/payments/cashDeposits.ts';
import { gatewayReceivablePaise, recordGatewaySettlement, gatewayFeesPaise } from '../../modules/payments/gatewaySettlements.ts';
import { customerPrepaidPaise } from '../../modules/payments/capture.ts';
import { ledger, accountFor } from '../../modules/payments/ledger.ts';
import {
  listRequests,
  openRequestFor,
  markSeen,
  declineRequest,
  settleRequestsFor,
  requestView
} from '../../modules/payments/payoutRequests.ts';
import { statementFor, statementView } from '../../modules/payments/statements.ts';
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
          dues: dues.map(d => {
            // Whether this payee has actually asked. It changes nothing about
            // what they are owed — it changes the order somebody works the
            // queue in, which is the only thing a request was ever for.
            const asked = openRequestFor(d.ownerType, d.ownerId);
            return {
              ...d,
              payable: toRupees(d.payablePaise),
              held: toRupees(d.heldPaise),
              outstanding: toRupees(d.outstandingPaise),
              cashInHand: toRupees(d.cashInHandPaise),
              requestedAt: asked?.raisedAt || null,
              requestId: asked?.id || null,
              requestNote: asked?.note || null
            };
          }),
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

      /*
       * Close whatever this payee was waiting on.
       *
       * Done here rather than inside `executePayout` so the payments module
       * does not import the requests module, which imports it. Done at all
       * because a request left open after the money has landed is a request
       * somebody works a second time.
       *
       * Only on PAID: a FAILED or UNCERTAIN payout has not answered anybody.
       */
      if (payout.state === 'PAID') {
        settleRequestsFor(payout.ownerType, payout.ownerId, payout.id);
      }

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
          ledgerKind: kind,
          /*
           * The same figures the payee sees in their own app.
           *
           * Deliberately the same function, not a second implementation. Two
           * statements of one settlement that disagree is the single worst
           * outcome available here: it destroys the trust the ledger was built
           * to create, and whichever one is wrong, the argument is now about
           * our competence rather than about the order.
           */
          statement: statementView(statementFor(ownerType, req.params.ownerId, ownerName)),
          openRequest: (() => {
            const open = openRequestFor(ownerType, req.params.ownerId);
            return open ? requestView(open) : null;
          })()
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
/**
 * POST /api/admin/payments/held/:orderId/release
 *
 * A person has checked a refused order and says it was real.
 *
 * Exists because the alternative to a release path is not "no releases" — it
 * is an administrator reading a blocker that tells them to check something and
 * finding no way to act on it, which ends with the refusal being worked around
 * somewhere it is not recorded.
 *
 * The note is mandatory and is written into the audit trail with the reason the
 * order was refused. What an auditor asks about a payment made against a
 * missing proof of delivery is who decided and on what basis, so both are kept.
 */
const ReleaseHeldSchema = z.object({
  note: z.string().trim().min(8, 'Say what you checked, in a sentence.')
});

payoutRoutes.post(
  '/payments/held/:orderId/release',
  requirePermission('finance.settlements.manage'),
  validate({ body: ReleaseHeldSchema }),
  async (req, res, next) => {
    try {
      const order = memoryStore.orders.get(req.params.orderId);
      if (!order) throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');

      const evidence = settlementEvidence(order);
      if (evidence.ok) {
        // Not an error worth failing on, but it must not be recorded as an
        // override: overriding nothing would put a person's name against a
        // decision they did not take.
        throw new AppError(
          'That order is not being held — nothing needs releasing.',
          409,
          'ORDER_NOT_HELD'
        );
      }

      recordOrderEarnings(order, { byUserId: req.user!.id, note: req.body.note });

      recordAudit(req, {
        action: 'HELD_EARNINGS_RELEASED',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Released earnings for ${order.orderNumber || order.id} despite: ${evidence.reason}`,
        after: { reason: evidence.reason, note: req.body.note }
      });

      res.json({
        success: true,
        data: { orderId: order.id },
        message: 'Earnings posted. What it was held for, and your note, are on the audit trail.'
      });
    } catch (err) {
      next(err);
    }
  }
);

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

/* ------------------------------------------------------------------ *
 *  PAYOUT REQUESTS                                                    *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/payouts/requests
 *
 * Who has asked to be paid.
 *
 * This list is a courtesy to whoever works the queue, not a work list. Every
 * payee who is owed money is already in `/payouts/dues` whether or not they
 * asked, and the daily run clears all of them. A platform that pays the people
 * who complain is a platform that does not pay the quiet ones, and the owner
 * asked for the opposite of that.
 */
payoutRoutes.get(
  '/payouts/requests',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (req, res, next) => {
    try {
      const openOnly = req.query.all !== 'true';
      const requests = listRequests(openOnly ? { open: true } : {});

      res.json({
        success: true,
        data: {
          requests: requests.map(request => {
            // What they are owed NOW, not what they were owed when they asked.
            // A refund may have landed since, and the difference between the
            // two figures is exactly what a partner will ring up about.
            const due = duesFor(request.ownerType, request.ownerId, request.ownerName);
            return {
              ...requestView(request),
              payableNow: toRupees(due.payablePaise),
              payableNowPaise: due.payablePaise,
              movedSinceRequest: due.payablePaise !== request.payableAtRequestPaise,
              blockedReason: due.blockedReason,
              // Picked explicitly here, unlike the dues list which spreads the
              // whole row. A request is answered by pressing Pay, so this is
              // one of the screens that must not offer to send money without
              // showing where it goes.
              willPayInto: due.willPayInto
            };
          })
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/admin/payouts/requests/:id/seen — somebody has opened it. */
payoutRoutes.post(
  '/payouts/requests/:id/seen',
  requirePermission('finance.payouts.view', 'finance.settlements.view'),
  async (req, res, next) => {
    try {
      const request = markSeen(req.params.id, req.user!.id);
      res.json({ success: true, data: { request: requestView(request) } });
    } catch (err) {
      next(err);
    }
  }
);

const DeclineSchema = z.object({
  /** Shown to the payee verbatim, which is why it cannot be blank. */
  reason: z.string().trim().min(4).max(400)
});

/**
 * POST /api/admin/payouts/requests/:id/decline
 *
 * Closes the conversation. It does NOT close the debt: what they are owed
 * stays owed, stays in the dues queue, and will be paid on the ordinary run.
 * Declining says "not now, and here is why" — and the why is compulsory,
 * because a request that vanishes without explanation is how a partner
 * concludes the platform is not paying them.
 */
payoutRoutes.post(
  '/payouts/requests/:id/decline',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  validate({ body: DeclineSchema }),
  async (req, res, next) => {
    try {
      const request = declineRequest(req.params.id, req.user!.id, req.body.reason);

      recordAudit(req, {
        action: 'PAYOUT_REQUEST_DECLINED',
        entityType: 'PAYOUT_REQUEST',
        entityId: request.id,
        summary: `${request.ownerName}'s payout request declined: ${request.declineReason}`,
        after: { status: request.status, reason: request.declineReason }
      });

      res.json({
        success: true,
        data: { request: requestView(request) },
        message: 'Declined, with your reason shown to them. What they are owed is unchanged.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  CASH DEPOSITS                                                      *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/cash/deposits
 *
 * Declarations waiting to be counted, and every rider carrying cash.
 *
 * The ageing list is the half that matters. A rider quietly accumulating cash
 * and never coming in is invisible from any single order, and this is where it
 * becomes obvious before it becomes expensive.
 */
payoutRoutes.get(
  '/cash/deposits',
  requirePermission('finance.payouts.view', 'finance.payouts.manage'),
  async (_req, res, next) => {
    try {
      res.json({
        success: true,
        data: {
          awaiting: listDeposits({ status: 'DECLARED' }).map(d => ({
            ...d,
            declared: toRupees(d.declaredPaise)
          })),
          recent: listDeposits()
            .filter(d => d.status !== 'DECLARED')
            .slice(0, 30)
            .map(d => ({
              ...d,
              declared: toRupees(d.declaredPaise),
              received: d.receivedPaise != null ? toRupees(d.receivedPaise) : null
            })),
          ageing: cashAgeing()
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const ConfirmDepositSchema = z.object({
  /** What was ACTUALLY counted. Never what the rider said. */
  receivedAmount: z.number().min(0).max(1000000),
  varianceNote: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/cash/deposits/:id/confirm
 *
 * An administrator counts the cash and records what arrived.
 *
 * The rider's cash-in-hand comes down by what was RECEIVED, never by what was
 * declared. That distinction is the entire control: reducing by the declaration
 * would let a rider write off any amount simply by claiming they had brought
 * it.
 */
payoutRoutes.post(
  '/cash/deposits/:id/confirm',
  requirePermission('finance.payouts.manage'),
  validate({ body: ConfirmDepositSchema }),
  async (req, res, next) => {
    try {
      const { deposit, variancePaise, remainingPaise } = confirmDeposit({
        depositId: req.params.id,
        receivedPaise: toPaise(req.body.receivedAmount),
        actorUserId: req.user!.id,
        varianceNote: req.body.varianceNote
      });

      recordAudit(req, {
        action: variancePaise === 0 ? 'CASH_DEPOSIT_CONFIRMED' : 'CASH_DEPOSIT_VARIANCE',
        entityType: 'CASH_DEPOSIT',
        entityId: deposit.id,
        summary:
          `${deposit.riderName || deposit.riderId} declared ${formatPaise(deposit.declaredPaise)}, ` +
          `received ${formatPaise(deposit.receivedPaise || 0)}` +
          (variancePaise === 0 ? '' : ` — ${formatPaise(Math.abs(variancePaise))} ${variancePaise < 0 ? 'short' : 'over'}: ${req.body.varianceNote}`),
        after: {
          declaredPaise: deposit.declaredPaise,
          receivedPaise: deposit.receivedPaise,
          variancePaise,
          remainingPaise
        }
      });

      res.json({
        success: true,
        data: {
          deposit,
          variance: toRupees(variancePaise),
          remainingCashInHand: toRupees(remainingPaise)
        },
        message:
          variancePaise === 0
            ? remainingPaise === 0
              ? `${formatPaise(deposit.receivedPaise || 0)} received. They are carrying nothing and can be paid.`
              : `${formatPaise(deposit.receivedPaise || 0)} received. ${formatPaise(remainingPaise)} still outstanding.`
            : `Recorded with a variance of ${formatPaise(Math.abs(variancePaise))}. It stays against the rider.`
      });
    } catch (err) {
      next(err);
    }
  }
);

const CashReturnSchema = z.object({
  riderId: z.string().trim().min(1).max(120),
  amount: z.number().positive('Enter the amount you counted.'),
  note: z.string().trim().max(300).optional()
});

/**
 * POST /api/admin/cash/returns
 *
 * A rider walks into the office with cash and has tapped nothing in the app.
 *
 * Every other path needs a deposit the RIDER declared first, so somebody
 * standing at the desk holding four thousand rupees could not be cleared by
 * anyone. The office is where this actually happens; the app was the only way
 * in. It reuses declare-then-confirm rather than posting its own entry, so the
 * refusals, the received-not-declared rule and the single ledger movement all
 * come along unchanged.
 *
 * It credits NO revenue. The profit on a cash order was recognised at delivery;
 * booking it again when the notes are counted would show a profit near double
 * the truth on a screen that adds up perfectly.
 */
payoutRoutes.post(
  '/cash/returns',
  requirePermission('finance.payouts.manage'),
  validate({ body: CashReturnSchema }),
  async (req, res, next) => {
    try {
      const { deposit, variancePaise, remainingPaise } = recordCashReturn({
        riderId: req.body.riderId,
        amountPaise: toPaise(req.body.amount),
        actorUserId: req.user!.id,
        note: req.body.note
      });

      recordAudit(req, {
        action: 'CASH_RETURN_RECORDED',
        entityType: 'CASH_DEPOSIT',
        entityId: deposit.id,
        summary:
          `${formatPaise(deposit.receivedPaise || 0)} taken at the office from ` +
          `${deposit.riderName || deposit.riderId}. ${formatPaise(remainingPaise)} still with them.`,
        after: { receivedPaise: deposit.receivedPaise, variancePaise, remainingPaise }
      });

      res.json({
        success: true,
        data: {
          deposit,
          remainingCashInHand: toRupees(remainingPaise),
          officeCash: toRupees(officeCashPaise())
        },
        // Partial returns are normal and the remainder still blocks their
        // payout, so the number they are still carrying is said every time
        // rather than only when it is zero.
        message:
          remainingPaise === 0
            ? `${formatPaise(deposit.receivedPaise || 0)} received. They are carrying nothing and can be paid.`
            : `${formatPaise(deposit.receivedPaise || 0)} received. ${formatPaise(remainingPaise)} is still with them, and still blocks their payout.`
      });
    } catch (err) {
      next(err);
    }
  }
);

const BankDepositSchema = z.object({
  amount: z.number().positive('Enter how much was paid into the bank.'),
  reference: z.string().trim().min(1, 'Record the deposit slip or reference number.').max(120),
  depositedOn: z.string().trim().max(40).optional()
});

/**
 * POST /api/admin/cash/bank-deposits
 *
 * The walk to the branch: office cash becomes bank cash.
 *
 * A separate act from taking the money off a rider, days apart, and collapsing
 * the two is what made the platform believe it could pay people out of money
 * sitting in a drawer.
 */
payoutRoutes.post(
  '/cash/bank-deposits',
  requirePermission('finance.payouts.manage'),
  validate({ body: BankDepositSchema }),
  async (req, res, next) => {
    try {
      const { bankedPaise, officeRemainingPaise } = bankOfficeCash({
        amountPaise: toPaise(req.body.amount),
        actorUserId: req.user!.id,
        reference: req.body.reference,
        depositedOn: req.body.depositedOn
      });

      recordAudit(req, {
        action: 'CASH_BANKED',
        entityType: 'LEDGER',
        entityId: req.body.reference,
        summary: `${formatPaise(bankedPaise)} office cash paid into the bank (ref ${req.body.reference}).`,
        after: { bankedPaise, officeRemainingPaise }
      });

      res.json({
        success: true,
        data: {
          banked: toRupees(bankedPaise),
          officeCash: toRupees(officeRemainingPaise)
        },
        message: `${formatPaise(bankedPaise)} banked. The office is holding ${formatPaise(officeRemainingPaise)}.`
      });
    } catch (err) {
      next(err);
    }
  }
);

/*
 * Named in the words Razorpay's own settlement row uses, because every one of
 * these is transcribed from it and a label that does not match the page it is
 * copied from is how the wrong column gets typed.
 */
const GatewaySettlementSchema = z.object({
  amountSettled: z.number().positive('Enter the amount settled, from the settlement row.'),
  fees: z.number().min(0, 'Fees cannot be negative.'),
  tax: z.number().min(0, 'Tax cannot be negative.'),
  reference: z.string().trim().min(1, 'Record the settlement id from the statement.').max(120),
  note: z.string().trim().max(300).optional()
});

/**
 * GET /api/admin/gateway/receivable
 *
 * What the payment gateway is holding, and what it has kept in fees.
 *
 * Both figures were invisible before this: online payments booked straight to the
 * bank, so money at the gateway looked like money in the account, and the fee was
 * recorded nowhere at all.
 */
payoutRoutes.get(
  '/gateway/receivable',
  requirePermission('finance.payouts.view', 'finance.payouts.manage', 'finance.reports.view'),
  async (_req, res, next) => {
    try {
      const outstandingPaise = gatewayReceivablePaise();
      const prepaidPaise = customerPrepaidPaise();
      res.json({
        success: true,
        data: {
          atGateway: toRupees(outstandingPaise),
          feesKeptToDate: toRupees(gatewayFeesPaise()),
          /*
           * What customers have paid for food that has not been delivered.
           *
           * Included because it is the figure that says a cancelled order's
           * refund never went through. A cancellation discharges this debt at the
           * same moment it reverses the payment, so a balance that sits here
           * while nothing is out for delivery is money owed to somebody who has
           * not been given it back — and nothing else on any screen would say so.
           */
          prepaidForUndeliveredFood: toRupees(prepaidPaise),
          /*
           * Said plainly, because the number will look wrong to anybody who
           * remembers the old screen. Orders paid before this was switched on
           * were booked straight to the bank and are not part of any settlement.
           */
          note:
            outstandingPaise > 0
              ? 'Money the gateway has taken from customers and not yet paid into the bank. It usually arrives within a day or two.'
              : 'The gateway is not holding anything. Everything it has collected has been settled.'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/gateway/settlements
 *
 * The gateway paid us, and this is where its fee stops being invisible.
 *
 * EVERY FIGURE IS TRANSCRIBED, NONE IS COMPUTED BY THE PERSON TYPING. The amount
 * settled, the fees and the tax are the three columns the settlement row prints.
 * What the gateway discharged is derived from them, so no input can contradict
 * another and nobody has to do arithmetic to use this screen.
 *
 * Recorded by a person from the statement for the same reason §4.5 records a bank
 * deposit that way: Razorpay's settlement API can be read and should be one day,
 * but there are no live keys yet, and a feature that only works once there are is
 * a feature that does not work.
 */
payoutRoutes.post(
  '/gateway/settlements',
  requirePermission('finance.payouts.manage'),
  validate({ body: GatewaySettlementSchema }),
  async (req, res, next) => {
    try {
      /*
       * Recorded FIRST, and the audit line written only after it succeeds. A
       * re-submitted form throws here, so it cannot leave an audit entry claiming
       * a settlement that was never written.
       */
      const result = recordGatewaySettlement({
        netPaise: toPaise(req.body.amountSettled),
        feesPaise: toPaise(req.body.fees),
        taxPaise: toPaise(req.body.tax),
        reference: req.body.reference,
        actorUserId: req.user!.id,
        note: req.body.note
      });

      recordAudit(req, {
        action: 'GATEWAY_SETTLED',
        entityType: 'LEDGER',
        entityId: result.reference,
        summary:
          `Gateway settled ${formatPaise(result.netPaise)} to the bank, keeping ` +
          `${formatPaise(result.feeTotalPaise)} out of ${formatPaise(result.dischargedPaise)}.`,
        after: result
      });

      res.json({
        success: true,
        data: {
          amountSettled: toRupees(result.netPaise),
          fees: toRupees(result.feesPaise),
          tax: toRupees(result.taxPaise),
          keptByGateway: toRupees(result.feeTotalPaise),
          discharged: toRupees(result.dischargedPaise),
          stillAtGateway: toRupees(gatewayReceivablePaise())
        },
        message:
          `${formatPaise(result.netPaise)} reached the bank. The gateway kept ${formatPaise(result.feeTotalPaise)}, ` +
          'which is now recorded as an expense rather than quietly missing from the books.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  WHY IS THIS SCREEN EMPTY, AND WHAT DID WE EARN                     *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/payments/overview
 *
 * The screen the owner asked for: *"I am not understanding the finance of that
 * part... I can give a proper payouts to everyone... and really it will show
 * how much we are also earning by all the orders."*
 *
 * Two halves, and the first is the one that was missing.
 *
 * **Why a list is empty.** An empty payouts queue can mean "everybody has been
 * paid" or "nothing has ever been recorded and nobody can be paid at all".
 * Those look identical and mean opposite things, and being unable to tell them
 * apart is most of what the owner was describing. So every blocker is named,
 * counted, and given the thing that clears it.
 *
 * **What we earned.** Commission, the packaging markup, the platform fee, any
 * extra charge, and what delivery cost us — derived from the FROZEN bill on
 * each delivered order, so it stays right for orders priced before the last
 * rate change.
 */
payoutRoutes.get(
  '/payments/overview',
  requirePermission('finance.payouts.view', 'finance.reports.view', 'finance.settlements.view'),
  async (req, res, next) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
      const since = new Date(Date.now() - days * 86_400_000).toISOString();

      const [riders, restaurants] = await Promise.all([
        riderRepository.findAll(),
        restaurantRepository.listAll()
      ]);

      /* ---- What we earned ---- */

      let orders = 0;
      let grossPaise = 0;
      const earned = {
        commissionPaise: 0,
        packagingMarginPaise: 0,
        platformFeePaise: 0,
        extraChargePaise: 0,
        deliveryMarginPaise: 0,
        totalPaise: 0
      };

      /*
       * Orders whose earnings were never recorded.
       *
       * These are the ones nobody can be paid for, and they are invisible from
       * the dues queue precisely because they are not in it. Counting them is
       * the difference between "nothing to do" and "nothing is working".
       */
      let unposted = 0;

      for (const order of memoryStore.orders.values()) {
        const typed: any = order;
        if (typed.status !== 'DELIVERED') continue;
        const at = typed.deliveredAt || typed.updatedAt;
        if (!at || at < since) continue;

        orders += 1;
        grossPaise += toPaise(Number(typed.bill?.totalAmount) || 0);

        const margin = platformMarginPaiseFor(typed);
        earned.commissionPaise += margin.commissionPaise;
        earned.packagingMarginPaise += margin.packagingMarginPaise;
        earned.platformFeePaise += margin.platformFeePaise;
        earned.extraChargePaise += margin.extraChargePaise;
        earned.deliveryMarginPaise += margin.deliveryMarginPaise;
        earned.totalPaise += margin.totalPaise;

        if (!earningsPosted(typed.id)) unposted += 1;
      }

      /* ---- Why the queue looks the way it does ---- */

      const everyone = [
        ...restaurants.map((r: any) => ({ ownerType: 'RESTAURANT' as const, ownerId: r.id, ownerName: r.name })),
        ...riders.map((r: any) => ({
          ownerType: 'RIDER' as const,
          ownerId: r.id,
          ownerName: r.fullName || r.driverCode || r.id
        }))
      ];

      const dues = allDues(everyone);
      const noAccount = dues.filter(d => d.outstandingPaise > 0 && !d.hasVerifiedAccount);
      const holdingCash = dues.filter(d => d.cashInHandPaise > 0);
      const stillHeld = dues.filter(d => d.payablePaise === 0 && d.heldPaise > 0);
      const ready = dues.filter(d => !d.blockedReason && d.payablePaise > 0);

      const awaitingReview = reviewQueue().length;
      const cashWaiting = listDeposits({ status: 'DECLARED' }).length;

      /*
       * Each blocker in one sentence, with what clears it.
       *
       * Prose rather than counts, because the complaint was never that the
       * numbers were missing. It was that nobody could tell what they meant or
       * what to do next.
       */
      const blockers: Array<{ what: string; count: number; fix: string; where: string }> = [];

      if (unposted > 0) {
        blockers.push({
          what: `${unposted} delivered order${unposted === 1 ? ' has' : 's have'} no earnings recorded, so nobody can be paid for ${unposted === 1 ? 'it' : 'them'}.`,
          count: unposted,
          fix: 'Run the catch-up. Safe to run more than once — an order already recorded is skipped.',
          where: 'CATCH_UP'
        });
      }
      if (awaitingReview > 0) {
        blockers.push({
          what: `${awaitingReview} bank account${awaitingReview === 1 ? '' : 's'} waiting for you to approve.`,
          count: awaitingReview,
          fix: 'Until an account is approved there is nowhere to send that person’s money.',
          where: 'BANK'
        });
      }
      if (noAccount.length > 0) {
        blockers.push({
          what: `${noAccount.length} ${noAccount.length === 1 ? 'person is' : 'people are'} owed money with no approved account to send it to.`,
          count: noAccount.length,
          fix: 'They add one in their own app. Chase them — they cannot be paid until they do.',
          where: 'BANK'
        });
      }
      if (cashWaiting > 0) {
        blockers.push({
          what: `${cashWaiting} rider${cashWaiting === 1 ? ' is' : 's are'} bringing cash in.`,
          count: cashWaiting,
          fix: 'Count it and record what you counted. Their payout is blocked until their cash is zero.',
          where: 'CASH'
        });
      }
      if (holdingCash.length > 0) {
        blockers.push({
          what: `${holdingCash.length} rider${holdingCash.length === 1 ? ' is' : 's are'} still holding our cash, so their earnings are on hold.`,
          count: holdingCash.length,
          fix: 'They must deposit it. We never net it off — that would be paying out money we are owed.',
          where: 'CASH'
        });
      }

      /*
       * Orders that say they were delivered but cannot show it, so nobody has
       * been paid for them.
       *
       * Surfaced here because the gate that refuses them REMOVES them from the
       * dues list. Without this line the money does not appear anywhere and
       * nothing says why — a figure quietly short on a money screen, which is
       * the failure the refusal was written to prevent in the first place.
       */
      /*
       * Accounts nobody has applied yet.
       *
       * The owner's rule is that their tap makes an account payable, so the
       * count of un-tapped accounts IS the queue. Without this line the gate
       * would be invisible in exactly the way the held-earnings gate was:
       * people go unpaid and the screen shows nothing.
       */
      /*
       * PAYDAY VERSUS THE DAILY CEILING.
       *
       * The cap is a fraud blast-radius control: whatever goes wrong, only so
       * much can leave in one day. It is deliberately NOT being raised to suit
       * a schedule — weakening a security control to fix a calendar problem is
       * the wrong trade.
       *
       * But the owner moved payouts from daily to weekly, so one payday now
       * carries a week of earnings through a ceiling sized for a day. Enforced
       * at execution, that stops the run partway: some partners paid, the rest
       * refused with DAILY_PAYOUT_CAP_REACHED, and nothing saying why until
       * somebody reads an error on the twelfth payout. This says it BEFORE the
       * run rather than during it.
       */
      const readyPaise = ready.reduce((total, d) => total + d.payablePaise, 0);
      const capPaise = toPaise(getActiveRates().dailyPayoutCap);
      if (capPaise > 0 && readyPaise > capPaise) {
        blockers.push({
          what: `${formatPaise(readyPaise)} is ready to pay and the daily ceiling is ${formatPaise(capPaise)}.`,
          count: ready.length,
          fix:
            `Payday will stop once ${formatPaise(capPaise)} has gone out. Either raise the ceiling in Inflation ` +
            `before you start, or pay across two days — whichever you choose, decide it now rather than halfway through.`,
          where: 'PAYOUTS'
        });
      }

      const waitingApply = awaitingApply();
      if (waitingApply.length > 0) {
        blockers.push({
          what: `${waitingApply.length} bank or UPI account${waitingApply.length === 1 ? '' : 's'} waiting for you to apply ${waitingApply.length === 1 ? 'it' : 'them'}.`,
          count: waitingApply.length,
          fix: 'Open Banks, check the name against the account, and apply it. Nobody can be paid until you do.',
          where: 'BANKS'
        });
      }

      const held = heldEarnings();
      if (held.length > 0) {
        blockers.push({
          what: `${held.length} delivered order${held.length === 1 ? '' : 's'} cannot be paid out until somebody checks ${held.length === 1 ? 'it' : 'them'}.`,
          count: held.length,
          fix: 'Each one is missing proof that the food was collected or that the money arrived. Open it, check what happened, and release it if it was real.',
          where: 'HELD'
        });
      }

      /*
       * Can the bank actually cover the run?
       *
       * A WARNING, not a blocker, and deliberately so: the owner may hold
       * capital this ledger knows nothing about, and refusing a payday over a
       * number the platform cannot see would be the system overruling the
       * person who owns the money.
       *
       * But it must name UN-BANKED CASH as the cause. "Insufficient balance"
       * sends somebody to check a bank statement that is perfectly correct,
       * and the actual fix -- the office cash has not been paid in yet -- is
       * nowhere on the screen. This is the same defect as the daily cap from
       * the other side: a payday that stops halfway with no visible reason.
       */
      const readyPaiseTotal = ready.reduce((total, d) => total + d.payablePaise, 0);
      const bankPaise = ledger.balanceOf('PLATFORM_BANK');
      const officePaise = officeCashPaise();
      /*
       * THE FOURTH PLACE MONEY CAN BE, and until now the least visible.
       *
       * Card payments used to book straight to PLATFORM_BANK, so money sitting at
       * Razorpay for a day or two was counted as bank. This warning then read the
       * overstated figure and said the funds were present while they were at the
       * gateway — a payday funded by it is marked sent and bounces.
       *
       * Now it is its own number, and it goes in the fix line for the same reason
       * the office cash does: "insufficient balance" sends somebody to check a
       * bank statement that is perfectly correct, and the real answer — the money
       * is at the gateway and arrives tomorrow — is nowhere on the screen.
       */
      const atGatewayPaise = gatewayReceivablePaise();
      if (readyPaiseTotal > bankPaise) {
        const shortfall = readyPaiseTotal - bankPaise;

        /*
         * The causes, in the order somebody can act on them. Cash in the office
         * can be banked this afternoon; money at the gateway arrives by itself and
         * only needs waiting for. Both are better news than "top up the account",
         * so both are said before it.
         */
        const causes: string[] = [];
        if (officePaise > 0) {
          causes.push(
            `${formatPaise(officePaise)} of cash is in the office and has not been paid in — bank it and record the slip.`
          );
        }
        if (atGatewayPaise > 0) {
          causes.push(
            `${formatPaise(atGatewayPaise)} is still at the payment gateway and has not settled yet — it usually arrives within a day or two, and nothing needs doing.`
          );
        }

        blockers.push({
          what:
            `${formatPaise(readyPaiseTotal)} is ready to pay and the bank holds ` +
            `${formatPaise(bankPaise)} — ${formatPaise(shortfall)} short.`,
          count: 1,
          fix:
            causes.length > 0
              ? `${causes.join(' ')} Then run payday.`
              : 'Top up the payout account before running payday, or the run will stop partway and some partners will go unpaid with no visible cause.',
          where: 'CASH'
        });
      }

      res.json({
        success: true,
        data: {
          period: { days, since },
          cashPosition: {
            inOurBank: toRupees(bankPaise),
            inTheOffice: toRupees(officePaise),
            readyToPay: toRupees(readyPaiseTotal)
          },
          business: {
            orders,
            gross: toRupees(grossPaise),
            earned: {
              commission: toRupees(earned.commissionPaise),
              packagingMarkup: toRupees(earned.packagingMarginPaise),
              platformFee: toRupees(earned.platformFeePaise),
              extraCharges: toRupees(earned.extraChargePaise),
              /** Negative when delivery costs more than it is charged for. */
              deliveryMargin: toRupees(earned.deliveryMarginPaise),
              total: toRupees(earned.totalPaise)
            }
          },
          queue: {
            readyToPay: ready.length,
            readyToPayTotal: toRupees(ready.reduce((t, d) => t + d.payablePaise, 0)),
            stillInHoldPeriod: stillHeld.length,
            blockedCount: noAccount.length + holdingCash.length
          },
          blockers,
          held,
          /** True when there is genuinely nothing to do, not merely nothing visible. */
          allClear: blockers.length === 0 && ready.length === 0
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
