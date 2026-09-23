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
import {
  addAccount,
  listFor,
  findById,
  archiveAccount,
  publicView,
  allAccounts,
  awaitingApply
} from '../modules/payments/payeeAccounts.ts';
import { isRazorpayXConfigured } from '../modules/payments/razorpayXAdapter.ts';
import { resolvePayee, parsePreference } from '../modules/payments/payeeIdentity.ts';
import { memoryStore } from '../db/client.ts';
import { isDatabaseConfigured, storeLoadedAt } from '../db/postgresStore.ts';

export const payeeAccountRouter = Router();

/**
 * GET /api/payee-accounts/me/diagnostic
 *
 * What the server actually sees when this person asks to be paid.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * A restaurant owner submitted a payout account on the live deployment and it
 * never appeared in the admin console. Four readings of the source by two
 * sessions found nothing: the route exists, the identity resolves, the write
 * persists generically, the admin endpoint filters only archived rows, and an
 * end-to-end HTTP test of exactly that chain passes and fails correctly under
 * mutation. Every layer reports "correct" and not one of them reports what it
 * is actually holding.
 *
 * So this returns observations rather than conclusions. It is the difference
 * between "the code is right" and "here is the row, and here is the id it is
 * filed under".
 *
 * It answers, in one call from the person's own session:
 *
 *   - who the server resolves this token to, and which restaurant or rider
 *     record it matched, which is the candidate where an account exists but is
 *     filed under an owner id the admin list does not look for
 *   - whether ANY row exists for this user at all, searched by user id rather
 *     than by owner id, so a mismatch shows up as "found, but filed elsewhere"
 *     instead of as "nothing here"
 *   - whether the store is durable, because an account written to a process
 *     that restarts before it persists is gone and looks identical to one that
 *     was never sent
 *
 * -------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * -------------------------------------------------------------------------
 * It needs no administrator. Asking the owner for the admin password to debug
 * their own submission is the wrong trade, and their own token is sufficient.
 *
 * It never returns another person's banking. Rows are matched on
 * `ownerUserId === this caller` before any detail is read, so the mismatch case
 * is diagnosable using only the caller's own data. Everyone else exists here as
 * a count and nothing more — a diagnostic that leaks account numbers is a worse
 * problem than the one it was written to solve.
 */
payeeAccountRouter.get('/me/diagnostic', authMiddleware(), async (req, res, next) => {
  try {
    const userId = req.user!.id;

    /*
     * Resolution is reported, not thrown on. NOT_A_PAYEE is itself one of the
     * answers — a partner whose restaurant is not matched to their user id
     * cannot submit at all, and that would be the whole explanation.
     */
    let identity: any = null;
    let identityError: { code?: string; message: string } | null = null;
    try {
      identity = await resolvePayee(userId, req.user!.role, parsePreference(req.query.as));
    } catch (err: any) {
      identityError = { code: err?.code, message: err?.message || String(err) };
    }

    const everyRow = Array.from(memoryStore.payeeAccounts.values()) as any[];

    // Searched by USER id, not by owner id. If the account was filed under an
    // owner id the admin list does not look for, this is the search that finds
    // it and the one keyed by ownerId does not.
    const minePersonally = everyRow.filter(a => a.ownerUserId === userId);

    const mineByResolvedOwner = identity
      ? everyRow.filter(a => a.ownerType === identity.ownerType && a.ownerId === identity.ownerId)
      : [];

    res.json({
      success: true,
      data: {
        youAre: {
          userId,
          role: req.user!.role,
          resolvedTo: identity
            ? {
                ownerType: identity.ownerType,
                ownerId: identity.ownerId,
                ownerName: identity.ownerName,
                // The gate that refuses a submission before it is ever written.
                kycName: identity.kycName || '',
                kycNameLongEnough: Boolean(identity.kycName && identity.kycName.trim().length >= 3),
                alsoOtherPayee: identity.alsoOtherPayee
              }
            : null,
          resolutionFailed: identityError
        },
        yourAccounts: {
          foundByYourUserId: minePersonally.length,
          foundByYourResolvedOwnerId: mineByResolvedOwner.length,
          /*
           * The finding that would explain everything. A row that exists for
           * this user but is filed under a different owner id is invisible to
           * every screen, because every screen looks it up by owner.
           */
          filedUnderADifferentOwnerId: minePersonally
            .filter(a => !mineByResolvedOwner.some(b => b.id === a.id))
            .map(a => ({ id: a.id, ownerType: a.ownerType, ownerId: a.ownerId, createdAt: a.createdAt })),
          rows: minePersonally.map(a => ({
            id: a.id,
            method: a.method,
            ownerType: a.ownerType,
            ownerId: a.ownerId,
            validationStatus: a.validationStatus,
            createdAt: a.createdAt,
            appliedAt: a.appliedAt ?? null,
            archivedAt: a.archivedAt ?? null,
            // Whether the admin list would show it. Archived rows are filtered
            // there, and an archived row is the other way a submission exists
            // and is invisible.
            wouldAppearInAdminList: !a.archivedAt
          }))
        },
        /*
         * WHICH SERVER ANSWERED, and what it would put on each screen.
         *
         * The owner sees a badge on the Bank nav item and an empty list on the
         * screen behind it. Within one process those two cannot disagree: the
         * badge is awaitingApply(), which is allAccounts() with a filter, so a
         * non-zero badge and an empty list are a contradiction.
         *
         * Unless two processes answered. The store lives in memory with
         * Postgres behind it, so a second instance that has not reloaded serves
         * its own stale copy, and the badge and the list are separate requests
         * that can land on different instances. That is invisible to every test
         * on this project, because a test is one process.
         *
         * So: run this twice, a few seconds apart. Two different pids is the
         * answer. The same pid both times kills the idea outright, and the
         * counts below then say whether this process can see the account at
         * all.
         */
        whoAnswered: {
          pid: process.pid,
          startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
          uptimeSeconds: Math.round(process.uptime()),
          lastLoadedFromDatabaseAt: storeLoadedAt()
        },
        whatTheAdminWouldSee: {
          // The number on the nav badge.
          badgeCount: awaitingApply().length,
          // The number of rows the Bank screen lists. Always >= badgeCount in
          // an honest process, because the badge counts a subset of this.
          listCount: allAccounts().length
        },
        theStore: {
          // No detail, only shape. Tells "nothing was ever written" apart from
          // "something was written and is not yours".
          totalAccountsOnThisDeployment: everyRow.length,
          notArchived: everyRow.filter(a => !a.archivedAt).length,
          /*
           * An account written to a process that restarts before it persists is
           * gone, and that is indistinguishable from one that was never sent.
           * If this says false on production, that is the answer by itself.
           */
          durable: isDatabaseConfigured()
        },
        verificationAvailable: isRazorpayXConfigured()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payee-accounts/me
 *
 * Their accounts, and whether the platform can currently pay anybody at all —
 * which a screen needs in order to explain a PENDING account honestly instead
 * of leaving a spinner running against a gateway that was never configured.
 */
payeeAccountRouter.get('/me', authMiddleware(), async (req, res, next) => {
  try {
    const owner = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
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
    const owner = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));

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
    const owner = await resolvePayee(req.user!.id, req.user!.role, parsePreference(req.query.as ?? req.body?.as));
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
