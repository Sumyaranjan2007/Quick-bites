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
import { recordAudit } from '../../modules/admin/audit.ts';
import {
  businessIdentity,
  saveBusinessIdentity
} from '../../modules/platform/businessIdentity.ts';

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
  'supportTickets',
  /**
   * The ledger goes with the orders it describes. Every entry references an
   * order, a rider or a restaurant that this reset is deleting, and books whose
   * every counterparty has ceased to exist are not a record of anything — they
   * are a balance nobody can explain, against a party nobody can find.
   *
   * `pricingConfigs` is deliberately NOT here. Rates are platform configuration,
   * like the admin roles that also survive: an owner clearing out test data
   * should not silently find themselves back on 15% commission because the
   * button that emptied the orders also emptied the decisions.
   */
  'ledgerEntries',
  /**
   * A bank account whose rider has just been deleted belongs to nobody, and a
   * cash deposit against a rider who no longer exists is a debt against a
   * ghost. Both go with the people they describe.
   *
   * There is a second reason for `payeeAccounts` specifically: leaving verified
   * bank destinations behind after a reset means the next person to register
   * could be handed an account somebody else verified. Whatever that is, it is
   * not a clean start.
   */
  'payeeAccounts',
  'cashDeposits',
  'payoutRequests',
  'restaurantCharges',
  /**
   * A profile change goes with the restaurant that asked for it. What is left
   * otherwise is a request to rename a kitchen that no longer exists, sitting
   * in the approval queue forever because approving it has nothing to write to.
   */
  'profileEdits',
  /**
   * A push token addresses an installed app, not a person. After a reset the
   * accounts those tokens belonged to are gone, so every one of them is either
   * dead or - worse - still live on somebody's phone, ready to deliver a
   * notification about an order placed by an account that no longer exists.
   */
  'deviceTokens'
] as const;

/*
 * THE GUARDS ANSWER IN THE ORDER THEY MATTER, so the refusal says which one
 * stopped you.
 *
 * The confirmation phrase used to be checked first, in middleware, before
 * anything else ran. That made the two refusals indistinguishable from
 * outside: sending a deliberately wrong phrase to find out whether the
 * deployment was armed came back `CONFIRMATION_REQUIRED` either way, because
 * the phrase was rejected before the flag was ever read.
 *
 * That is not a theoretical problem. It was used exactly that way, twice, to
 * check whether `ALLOW_PLATFORM_RESET` was still set on a live deployment, and
 * it gave the wrong answer both times — reporting a platform as armed when it
 * was not. A diagnostic that answers confidently and wrongly is worse than one
 * that refuses to answer.
 *
 * Caller first, then the deployment, then the phrase. Nothing is leaked by
 * this ordering: every one of these replies is already behind an
 * authenticated admin route, and the flag's state is something the person
 * holding a super-admin token set themselves.
 */
platformRoutes.post('/platform/reset', async (req, res, next) => {
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

    const parsed = ResetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message || `To confirm, send confirm: "${CONFIRMATION}"`,
        400,
        'CONFIRMATION_REQUIRED'
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

const BusinessIdentitySchema = z.object({
  legalName: z.string().trim().min(2).max(160).optional(),
  tradingName: z.string().trim().min(2).max(160).optional(),
  // Format checked, because a Udyam number that does not look like one is a
  // typo, and a typo on a receipt is a registration nobody can verify.
  udyamNumber: z
    .string()
    .trim()
    .regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'A Udyam number looks like UDYAM-KR-29-0052148.')
    .optional(),
  enterpriseType: z.enum(['Micro', 'Small', 'Medium']).optional(),
  majorActivity: z.string().trim().max(60).optional(),
  addressLine: z.string().trim().max(200).optional(),
  street: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'A pincode is six digits.').optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Ten digits, starting 6 to 9.')
    .optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
  incorporatedOn: z.string().trim().max(20).optional(),
  commencedOn: z.string().trim().max(20).optional(),
  registeredOn: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(2000).optional()
});

/**
 * GET / PUT /api/admin/platform/business — the platform's own legal record.
 *
 * Super administrator only. This is not an operational setting: it is what the
 * business says it is on every receipt and in every policy, and getting it
 * wrong is a different class of mistake from getting a delivery radius wrong.
 *
 * Editable at all — rather than compiled in — because an address moves, a
 * phone number changes, and an enterprise is reclassified from Micro to Small
 * on its next return. Each of those should be a correction somebody types, not
 * a release somebody cuts.
 */
platformRoutes.get('/platform/business', async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      throw new AppError(
        'Only a super administrator can view the platform registration.',
        403,
        'SUPER_ADMIN_REQUIRED'
      );
    }
    res.json({ success: true, data: { identity: businessIdentity() } });
  } catch (err) {
    next(err);
  }
});

platformRoutes.put('/platform/business', async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      throw new AppError(
        'Only a super administrator can change the platform registration.',
        403,
        'SUPER_ADMIN_REQUIRED'
      );
    }

    const parsed = BusinessIdentitySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message || 'Those registration details are not valid.',
        400,
        'INVALID_BUSINESS_IDENTITY'
      );
    }

    const identity = saveBusinessIdentity(parsed.data);
    recordAudit(req, {
      action: 'BUSINESS_IDENTITY_UPDATED',
      entityType: 'PLATFORM',
      entityId: 'business-identity',
      summary: `Updated the platform registration (${identity.udyamNumber})`,
      after: parsed.data
    });

    res.json({ success: true, data: { identity } });
  } catch (err) {
    next(err);
  }
});
