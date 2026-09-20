/**
 * Emptying the platform, on purpose and with difficulty.
 *
 * There is a real need for this: a deployment that has been used for testing
 * accumulates half-finished accounts, abandoned orders and restaurants nobody
 * remembers creating, and at some point the only honest thing is to start
 * again before real customers arrive.
 *
 * There is also no more destructive operation in this product. It deletes every
 * customer, rider, restaurant, menu, order, wallet and ledger entry, and none of
 * it comes back. So it is guarded four ways, and each guard exists because
 * removing it would leave a plausible path to somebody doing this by accident:
 *
 *   1. SUPER ADMIN ONLY. Not `admin` — an operations or support account has no
 *      business holding this, and the role check is the difference between a
 *      compromised support login being bad and being terminal.
 *
 *   2. AN ENVIRONMENT FLAG. `ALLOW_PLATFORM_RESET` must be true on the
 *      deployment. This is the one that matters most: it means the endpoint is
 *      inert on any deployment where somebody has not deliberately turned it
 *      on, so a stolen super-admin token cannot use it against a production
 *      that has never enabled it. Turn it off again afterwards.
 *
 *   3. AN EXACT TYPED PHRASE. Not a boolean. A `confirm: true` is one stray
 *      line in a script; a phrase has to be meant.
 *
 *   4. IT KEEPS THE ADMINISTRATORS. Wiping the accounts that can sign in to
 *      operations, from inside operations, would lock the owner out of their own
 *      platform — which is a bad outcome to reach by pressing the button that
 *      was supposed to give them a clean start.
 *
 * What survives: administrator accounts, the role definitions they depend on,
 * and the audit log — including the entry recording that this happened. An
 * audit trail that can be erased by the action it is auditing is not one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { memoryStore, saveStoreToFile } from '../../db/client.ts';
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';

export const platformRoutes = Router();

/** Typed by a person who means it, not passed by a script that inherited it. */
const CONFIRMATION = 'DELETE ALL PLATFORM DATA';

const ResetSchema = z.object({
  confirm: z.literal(CONFIRMATION, {
    errorMap: () => ({ message: `To confirm, send confirm: "${CONFIRMATION}"` })
  })
});

/**
 * Collections emptied completely.
 *
 * Listed explicitly rather than "everything except a few", so that a collection
 * added later is NOT silently wiped by a route nobody revisited — it will simply
 * survive, which is the safe direction to fail in.
 */
const WIPED = [
  'restaurants',
  'addresses',
  'orders',
  'menus',
  'coupons',
  'payouts',
  'restaurantSettlements',
  'riders',
  'wallets',
  'walletTransactions',
  'kycDocuments',
  'orderMessages',
  'menuRequests',
  'sosAlerts',
  'riderIncentives',
  'refundRequests',
  'supportTickets'
] as const;

platformRoutes.post('/platform/reset', validateBody, async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      throw new AppError(
        'Only a super administrator can reset the platform.',
        403,
        'SUPER_ADMIN_REQUIRED'
      );
    }

    if (!config.ALLOW_PLATFORM_RESET) {
      throw new AppError(
        'Platform reset is switched off on this deployment. Set ALLOW_PLATFORM_RESET=true, ' +
          'perform the reset, then switch it off again.',
        403,
        'PLATFORM_RESET_DISABLED'
      );
    }

    // Counted BEFORE the deletion, because afterwards there is nothing to count
    // and the audit entry would record that nothing happened.
    const removed: Record<string, number> = {};
    for (const name of WIPED) {
      const collection = memoryStore[name as keyof typeof memoryStore] as Map<string, unknown>;
      removed[name] = collection.size;
      collection.clear();
    }

    // Users are filtered rather than cleared: the administrators stay.
    let customersRemoved = 0;
    for (const [id, user] of memoryStore.users) {
      const role = (user as { role?: string })?.role;
      if (role === 'admin' || role === 'super_admin') continue;
      memoryStore.users.delete(id);
      customersRemoved++;
    }
    removed.users = customersRemoved;

    // Written synchronously rather than left to the debounced auto-save. A
    // process that restarts in the next few seconds would otherwise come back
    // with every deleted record still in the snapshot on disk, and the reset
    // would appear to have silently undone itself.
    saveStoreToFile();

    const summary = Object.entries(removed)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');

    await auditRepository.record({
      actorUserId: req.user!.id,
      actorName: req.user!.fullName || req.user!.email || 'super admin',
      actorRole: 'admin',
      action: 'PLATFORM_RESET',
      entityType: 'platform',
      entityId: 'platform',
      summary: `Platform reset. Deleted: ${summary || 'nothing'}. Administrators kept.`
    });

    console.log(JSON.stringify({
      level: 'WARN',
      timestamp: new Date().toISOString(),
      event: 'PLATFORM_RESET',
      byUserId: req.user!.id,
      removed
    }));

    res.json({
      success: true,
      data: {
        removed,
        adminsKept: memoryStore.users.size,
        message: 'Platform data deleted. Administrator accounts kept.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Body validation, written out here rather than through the shared `validate`
 * middleware so the confirmation phrase is checked before anything else runs
 * and the failure message can name the phrase.
 */
function validateBody(req: any, _res: any, next: any) {
  const parsed = ResetSchema.safeParse(req.body);
  if (!parsed.success) {
    next(
      new AppError(
        parsed.error.issues[0]?.message || `To confirm, send confirm: "${CONFIRMATION}"`,
        400,
        'CONFIRMATION_REQUIRED'
      )
    );
    return;
  }
  next();
}
