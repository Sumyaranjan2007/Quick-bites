/**
 * The rates, and the ledger that records what they produced.
 *
 * Every number the platform charges or withholds is set here by an
 * administrator. Before this existed they were literals in source: commission
 * in two files, GST in one, the platform fee in another, and changing any of
 * them meant a deploy.
 *
 * A rate is never edited. A change writes a new version, and an order records
 * the version it was priced under — so a settlement drafted next month can
 * still explain a commission charged this one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import {
  getActiveConfig,
  listConfigs,
  createVersion,
  findConfigByVersion,
  RATE_BOUNDS,
  DEFAULT_RATES
} from '../../modules/payments/pricingConfig.ts';
import { ledger } from '../../modules/payments/ledger.ts';
import { toRupees } from '../../modules/payments/money.ts';
import type { LedgerAccountKind, PricingRates } from '@quick-bites/shared-types';

export const pricingRoutes = Router();

/* --------------------------------- Rates ---------------------------------- */

/**
 * GET /api/admin/pricing/config
 *
 * The rates in force, the bounds each one may be set within, and the platform
 * defaults. The bounds travel with the values so the admin screen renders the
 * same limits the server will judge a change by — a form that permits what the
 * server refuses is a form that wastes somebody's afternoon.
 */
pricingRoutes.get(
  '/pricing/config',
  requirePermission('finance.config.edit', 'finance.reports.view'),
  async (_req, res, next) => {
    try {
      const config = getActiveConfig();
      res.json({
        success: true,
        data: {
          config,
          bounds: RATE_BOUNDS,
          defaults: DEFAULT_RATES,
          /** Versions are kept forever; this is how many decisions have been taken. */
          versionCount: listConfigs().length
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/pricing/config/history — every version, newest first. */
pricingRoutes.get('/pricing/config/history', requirePermission('finance.config.edit'), async (_req, res, next) => {
  try {
    res.json({ success: true, data: { versions: listConfigs() } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/pricing/config/:version — what the rates were at a point in time. */
pricingRoutes.get('/pricing/config/:version', requirePermission('finance.config.edit'), async (req, res, next) => {
  try {
    const version = Number(req.params.version);
    if (!Number.isInteger(version)) throw new AppError('A version is a whole number.', 400, 'BAD_VERSION');

    const config = findConfigByVersion(version);
    if (!config) throw new AppError('No such pricing version.', 404, 'PRICING_VERSION_NOT_FOUND');

    res.json({ success: true, data: { config } });
  } catch (err) {
    next(err);
  }
});

/**
 * Only the keys the platform recognises, all optional, all numbers.
 *
 * Built from `RATE_BOUNDS` rather than written out, so a rate added later
 * cannot be accepted by the schema and then silently ignored — or refused by a
 * schema nobody remembered to update.
 */
const RateChangeSchema = z.object({
  rates: z
    .object(
      Object.fromEntries(
        RATE_BOUNDS.map(bound => [bound.key, z.number().finite().min(bound.min).max(bound.max).optional()])
      ) as Record<keyof PricingRates, z.ZodOptional<z.ZodNumber>>
    )
    .strict(),
  note: z
    .string()
    .trim()
    .min(3, 'Record why the rate is changing — it appears in the audit log and on the version.')
    .max(400)
});

/**
 * PUT /api/admin/pricing/config
 *
 * Writes a new version from the rates supplied, carrying everything else
 * forward. A partial on purpose: sending a whole configuration to change one
 * number is how the other twenty-three get reverted to whatever the screen
 * happened to be showing.
 *
 * Nothing already priced is affected. An order carries the rates it was priced
 * under, and a rate change cannot reach backwards into money somebody has
 * already earned.
 */
pricingRoutes.put(
  '/pricing/config',
  requirePermission('finance.config.edit'),
  validate({ body: RateChangeSchema }),
  async (req, res, next) => {
    try {
      const before = getActiveConfig();
      const changes = req.body.rates as Partial<PricingRates>;

      if (Object.keys(changes).length === 0) {
        throw new AppError('Name at least one rate to change.', 400, 'NO_RATES_SUPPLIED');
      }

      const { config, changed } = createVersion(changes, { userId: req.user!.id }, req.body.note);

      if (changed.length === 0) {
        // Every value sent already equalled the one in force. Reported rather
        // than treated as success, because an administrator who believes they
        // changed a rate and did not will find out at settlement otherwise.
        return res.json({
          success: true,
          data: { config, changed: [] },
          message: 'Those rates are already in force. No new version was written.'
        });
      }

      recordAudit(req, {
        action: 'PRICING_RATES_CHANGED',
        entityType: 'PRICING_CONFIG',
        entityId: config.id,
        summary:
          `Pricing version ${config.version}: ` +
          changed.map(c => `${c.key} ${c.from} to ${c.to}`).join(', ') +
          ` — ${req.body.note}`,
        before: { version: before.version, rates: before.rates },
        after: { version: config.version, rates: config.rates }
      });

      const touchesCustomerBill = changed.some(
        c => RATE_BOUNDS.find(b => b.key === c.key)?.affectsCustomerBill
      );

      res.json({
        success: true,
        data: { config, changed },
        message: touchesCustomerBill
          ? `Version ${config.version} is live. The next order placed will be charged at these rates.`
          : `Version ${config.version} is live. Orders already placed keep the rates they were priced under.`
      });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------- Ledger ---------------------------------- */

const LedgerQuerySchema = z.object({
  account: z.string().trim().max(120).optional(),
  accountKind: z.string().trim().max(60).optional(),
  partyId: z.string().trim().max(120).optional(),
  orderId: z.string().trim().max(120).optional(),
  payoutId: z.string().trim().max(120).optional(),
  event: z.string().trim().max(60).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

/**
 * GET /api/admin/ledger
 *
 * Every money movement, filterable. Amounts are returned in both paise and
 * rupees: paise because that is what was recorded and what must be checked,
 * rupees because that is what a person reads.
 */
pricingRoutes.get(
  '/ledger',
  requirePermission('finance.ledger.view', 'finance.reports.view'),
  validate({ query: LedgerQuerySchema }),
  async (req, res, next) => {
    try {
      const q = req.query as any;
      const entries = ledger.query({
        account: q.account,
        accountKind: q.accountKind as LedgerAccountKind | undefined,
        partyId: q.partyId,
        orderId: q.orderId,
        payoutId: q.payoutId,
        event: q.event,
        from: q.from,
        to: q.to,
        limit: q.limit || 100
      });

      res.json({
        success: true,
        data: {
          entries: entries.map(e => ({ ...e, amount: toRupees(e.amountPaise) })),
          count: entries.length
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/ledger/balances/:kind — every account of one kind, with its balance. */
pricingRoutes.get(
  '/ledger/balances/:kind',
  requirePermission('finance.ledger.view', 'finance.reports.view'),
  async (req, res, next) => {
    try {
      const rows = ledger.balancesByKind(req.params.kind as LedgerAccountKind);
      res.json({
        success: true,
        data: {
          kind: req.params.kind,
          accounts: rows.map(r => ({ ...r, balance: toRupees(r.balancePaise) })),
          totalPaise: rows.reduce((t, r) => t + r.balancePaise, 0),
          total: toRupees(rows.reduce((t, r) => t + r.balancePaise, 0))
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/ledger/audit
 *
 * Re-derives every balance and reports what disagrees. An empty result is the
 * expected answer and is the whole point: it turns "the books are probably
 * right" into something somebody has verified today.
 *
 * Reports rather than repairs. A silent correction would destroy the evidence
 * of whatever caused the divergence, which is the only thing here worth acting
 * on.
 */
pricingRoutes.get('/ledger/audit', requirePermission('finance.ledger.view'), async (_req, res, next) => {
  try {
    const result = ledger.audit();
    res.json({
      success: true,
      data: {
        ...result,
        totalDebit: toRupees(result.totalDebitPaise),
        totalCredit: toRupees(result.totalCreditPaise)
      },
      message: result.balanced
        ? `The books balance. ${result.transactionCount} transactions, ${result.entryCount} entries.`
        : 'The books do NOT balance. See unbalancedTransactions, duplicateKeys and fractionalAmounts.'
    });
  } catch (err) {
    next(err);
  }
});
