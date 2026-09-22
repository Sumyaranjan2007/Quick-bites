/**
 * What a partner or a rider has earned, and asking to be paid it.
 *
 * One router for both, for the same reason `payeeAccountRouter` is one router:
 * the rule is identical and only the record that identifies the payee differs.
 * Writing it twice is how a rider ends up able to see something a partner
 * cannot, or — worse — how one of the two copies quietly loses a check.
 *
 * -------------------------------------------------------------------------
 * EVERY ROUTE IS A `/me` ROUTE
 * -------------------------------------------------------------------------
 * The payee is resolved from the signed-in token and never from a path. There
 * is no id in any URL here, so there is nothing to change in a request to read
 * another restaurant's takings or another rider's earnings. A route shaped
 * `/restaurants/:id/statement` invites exactly one attack and defends against
 * it only by a check somebody has to remember to write.
 *
 * -------------------------------------------------------------------------
 * AND NOTHING HERE NAMES AN AMOUNT
 * -------------------------------------------------------------------------
 * A payout request carries no figure. What is owed is derived from the ledger
 * when an administrator acts. This is the single most important property of
 * this file: nothing a payee sends travels towards a bank.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { resolvePayee, parsePreference } from '../modules/payments/payeeIdentity.ts';
import { effectiveCharges } from '../modules/payments/restaurantCharges.ts';
import { AppError } from '../utils/AppError.ts';
import { statementFor, statementView } from '../modules/payments/statements.ts';
import {
  raiseRequest,
  withdrawRequest,
  listRequests,
  openRequestFor,
  requestView
} from '../modules/payments/payoutRequests.ts';

export const earningsRouter = Router();

const StatementQuery = z.object({
  /** ISO dates. Both optional; the default window is the last 30 days. */
  from: z.string().trim().min(4).optional(),
  to: z.string().trim().min(4).optional(),
  /** Which earnings, for the rare person who is both a partner and a rider. */
  as: z.string().trim().max(20).optional()
});

/**
 * GET /api/earnings/statement
 *
 * Every order in the window, broken into the lines that produced it: the food
 * total, the packaging, the commission at the rate FROZEN onto that order, the
 * tax withheld, and any refund that came off it afterwards.
 *
 * The figures are the ledger's. The order is consulted only to explain them,
 * and where the two disagree the difference is shown as `unexplained` rather
 * than being quietly absorbed into a line. A statement that prefers the
 * prettier number hides the one thing worth knowing.
 */
earningsRouter.get(
  '/statement',
  authMiddleware(),
  validate({ query: StatementQuery }),
  async (req, res, next) => {
    try {
      const payee = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
      const statement = statementFor(payee.ownerType, payee.ownerId, payee.ownerName, {
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined
      });

      const open = openRequestFor(payee.ownerType, payee.ownerId);

      res.json({
        success: true,
        data: {
          statement: statementView(statement),
          openRequest: open ? requestView(open) : null
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const RaiseSchema = z.object({
  /**
   * Their own words. Never acted on automatically, and deliberately not a
   * field anything downstream parses — it is read by a person.
   */
  note: z.string().trim().max(500).optional()
});

/**
 * POST /api/earnings/payout-requests
 *
 * "I would like to be paid."
 *
 * Carries no amount. It makes the payee visible in the admin queue sooner and
 * attaches the statement that explains what they are waiting for; it does not
 * change what they are owed, and it is not a gate they must pass in order to
 * be paid. The daily run pays everybody who is owed, request or no request.
 */
earningsRouter.post(
  '/payout-requests',
  authMiddleware(),
  validate({ body: RaiseSchema }),
  async (req, res, next) => {
    try {
      const payee = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
      const request = raiseRequest({
        ownerType: payee.ownerType,
        ownerId: payee.ownerId,
        ownerName: payee.ownerName,
        raisedByUserId: req.user!.id,
        note: req.body?.note
      });

      res.status(201).json({
        success: true,
        data: { request: requestView(request) },
        message: 'Raised. Our finance team will see it with your statement attached.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/earnings/payout-requests — their own, newest first. */
earningsRouter.get('/payout-requests', authMiddleware(), async (req, res, next) => {
  try {
    const payee = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
    const requests = listRequests({ ownerId: payee.ownerId })
      .filter(r => r.ownerType === payee.ownerType)
      .slice(0, 30);

    res.json({ success: true, data: { requests: requests.map(requestView) } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/earnings/payout-requests/:id — changed their mind. */
earningsRouter.delete('/payout-requests/:id', authMiddleware(), async (req, res, next) => {
  try {
    const payee = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
    const request = withdrawRequest(req.params.id, payee.ownerId);
    res.json({ success: true, data: { request: requestView(request) }, message: 'Withdrawn.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/earnings/packaging
 *
 * What this restaurant will actually be paid for packaging.
 *
 * -------------------------------------------------------------------------
 * THE PARTNER IS SHOWN THEIR FIGURE, NEVER THE CUSTOMER'S
 * -------------------------------------------------------------------------
 * The customer may pay more: an administrator can add a markup, and that markup
 * is the platform's. A partner who sees the marked-up figure on a bill and is
 * paid less will raise a support ticket every single time, and they would be
 * right to — so the app shows what reaches them.
 *
 * It also says plainly when an administrator has set a figure DIFFERENT from
 * the one they declared. Being quietly paid less than you asked for, with the
 * screen still showing your own number, is how a partner concludes the platform
 * is stealing from them.
 */
earningsRouter.get('/packaging', authMiddleware(), async (req, res, next) => {
  try {
    const payee = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
    if (payee.ownerType !== 'RESTAURANT') {
      throw new AppError('Only a restaurant charges for packaging.', 400, 'NOT_A_RESTAURANT');
    }

    const charges = effectiveCharges(payee.ownerId);

    res.json({
      success: true,
      data: {
        /** What they asked for. */
        declared: charges.partnerDeclaredFee,
        /** What they will be paid. The number that matters to them. */
        youEarn: charges.partnerPackagingFee,
        adjusted: charges.partnerFeeAdjusted,
        message: charges.partnerFeeAdjusted
          ? `You asked for Rs ${charges.partnerDeclaredFee} and are being paid Rs ${charges.partnerPackagingFee} for packaging. Raise it from Help if that is wrong.`
          : `You are paid Rs ${charges.partnerPackagingFee} for packaging on every order \u2014 exactly what you asked for.`,
        /**
         * Said out loud rather than left to be discovered from a customer's
         * bill, which is where a partner would otherwise find it.
         */
        note:
          'What a customer pays for packaging may be higher. Anything Quick Bites adds on top is ours and does not change what you earn.'
      }
    });
  } catch (err) {
    next(err);
  }
});
