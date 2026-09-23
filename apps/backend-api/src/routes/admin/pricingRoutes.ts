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
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import {
  getGrievanceContact,
  setGrievanceContact,
  policyGaps
} from '../../modules/payments/paymentPolicies.ts';
import { runPaymentsHealthCheck } from '../../modules/payments/paymentsHealth.ts';
import { listPlans, savePlans } from '../../modules/membership/membershipService.ts';
import { incentiveSettings, setIncentiveSettings } from '../../modules/payments/incentiveConfig.ts';
import {
  effectiveCharges,
  setCharges,
  chargesView,
  CHARGE_BOUNDS
} from '../../modules/payments/restaurantCharges.ts';
import {
  getActiveConfig,
  listConfigs,
  createVersion,
  findConfigByVersion,
  getActiveRates,
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

/* ------------------------------------------------------------------ *
 *  WHAT EACH RESTAURANT COSTS                                         *
 *
 *  The Rates screen the owner actually described: not partners, riders or
 *  payouts, but a list of restaurants where an administrator sets what the
 *  platform charges for each one — and sees, in words, how much of it is ours.
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/rates/restaurants
 *
 * Every restaurant with what it currently charges and what we make on it.
 *
 * The margin is COMPUTED from the two stored figures rather than stored, so it
 * cannot drift away from them. A stored margin is a third number that has to be
 * kept in step with two others, and the moment it is not, a screen confidently
 * reports a profit that does not exist.
 */
pricingRoutes.get(
  '/rates/restaurants',
  requirePermission('finance.config.edit', 'finance.reports.view'),
  async (_req, res, next) => {
    try {
      const rates = getActiveRates();
      const restaurants = await restaurantRepository.listAll();

      const rows = restaurants.map((restaurant: any) => {
        const charges = effectiveCharges(restaurant.id, rates);
        return {
          name: restaurant.name,
          /** What the partner asked for, and whether they have asked at all. */
          partnerDeclared: Number.isFinite(Number(restaurant.partnerPackagingFee)),
          ...chargesView(charges)
        };
      });

      res.json({
        success: true,
        data: {
          restaurants: rows,
          /** What a restaurant falls back to when it has no figure of its own. */
          defaults: {
            packagingFee: rates.packagingFeeDefault,
            platformFee: rates.platformFeeBase,
            gstFoodPercent: rates.gstFoodPercent,
            commissionPercent: rates.defaultCommissionPercent,
            deliveryBaseFee: rates.deliveryBaseFee
          },
          bounds: CHARGE_BOUNDS
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const ChargesSchema = z.object({
  /** `null` puts a field back to following the platform default. */
  /** What the partner EARNS. `null` accepts whatever they declared. */
  partnerApprovedFee: z.number().min(0).max(200).nullable().optional(),
  /** What WE add on top and keep. */
  packagingMarkup: z.number().min(0).max(200).optional(),
  /** A percentage added to every dish price for this restaurant, kept by us. */
  foodMarkupPercent: z.number().min(0).max(100).optional(),
  platformFee: z.number().min(0).max(100).nullable().optional(),
  gstFoodPercent: z.number().min(0).max(28).nullable().optional(),
  // Refused by setCharges unless a GSTIN is stored. Accepted here so the
  // refusal names the reason rather than the field being silently unknown.
  platformGstPercent: z.number().min(0).max(28).nullable().optional(),
  commissionPercent: z.number().min(0).max(40).nullable().optional(),
  deliveryBaseFee: z.number().min(0).max(200).nullable().optional(),
  extraCharge: z.number().min(0).max(200).optional(),
  extraChargeLabel: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional()
});

/**
 * PUT /api/admin/rates/restaurants/:restaurantId
 *
 * Changes what one restaurant costs a customer.
 *
 * It does not touch a single order that has already been placed. Every order
 * freezes what it was charged onto its own bill, so a change here prices the
 * next order and restates nothing — not a bill, not a statement, not a
 * settlement.
 */
pricingRoutes.put(
  '/rates/restaurants/:restaurantId',
  requirePermission('finance.config.edit'),
  validate({ body: ChargesSchema }),
  async (req, res, next) => {
    try {
      const before = effectiveCharges(req.params.restaurantId);
      const { note, ...changes } = req.body;
      const after = setCharges(req.params.restaurantId, changes, req.user!.id, note);

      recordAudit(req, {
        action: 'RESTAURANT_CHARGES_UPDATED',
        entityType: 'RESTAURANT',
        entityId: req.params.restaurantId,
        summary:
          `Packaging \u2014 restaurant earns ${before.partnerPackagingFee} \u2192 ${after.partnerPackagingFee}, ` +
          `we keep ${before.packagingMarkup} \u2192 ${after.packagingMarkup}, ` +
          `customer pays ${before.customerPackagingFee} \u2192 ${after.customerPackagingFee}. ` +
          `Commission ${before.commissionPercent}% \u2192 ${after.commissionPercent}%` +
          (note ? ` \u2014 ${note}` : ''),
        before: before as any,
        after: after as any
      });

      res.json({
        success: true,
        data: chargesView(after),
        message: 'Saved. It applies to the next order from this restaurant, and changes nothing already placed.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  POLICIES: WHO A COMPLAINT GOES TO                                  *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/policies/grievance
 *
 * The named person a formal complaint escalates to, and whether one has been
 * published at all. Until it has, every payment policy says so in its own text
 * rather than naming somebody who does not exist — a customer writing to an
 * invented address would reasonably conclude the complaint had been received.
 */
pricingRoutes.get(
  '/policies/grievance',
  requirePermission('finance.config.edit', 'finance.ledger.view'),
  (_req, res) => {
    res.json({
      success: true,
      data: { contact: getGrievanceContact(), gaps: policyGaps() }
    });
  }
);

const GrievanceSchema = z.object({
  officerName: z.string().trim().min(3).max(120),
  designation: z.string().trim().max(120).optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().max(20).optional(),
  /** A postal address is required by the e-commerce rules, not optional. */
  address: z.string().trim().min(10).max(400),
  hours: z.string().trim().max(200).optional()
});

pricingRoutes.put(
  '/policies/grievance',
  requirePermission('finance.config.edit'),
  validate({ body: GrievanceSchema }),
  async (req, res, next) => {
    try {
      const before = getGrievanceContact();
      const contact = setGrievanceContact(req.body);

      recordAudit(req, {
        action: 'GRIEVANCE_OFFICER_UPDATED',
        entityType: 'SETTING',
        entityId: 'policy:grievance',
        summary: before
          ? `Grievance officer changed from ${before.officerName} to ${contact.officerName}`
          : `Grievance officer published: ${contact.officerName} (${contact.email})`,
        before: before || undefined,
        after: contact
      });

      res.json({
        success: true,
        data: { contact, gaps: policyGaps() },
        message: 'Published. It now appears at the end of every payment policy.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  THE HEALTH SWEEP, ON DEMAND                                        *
 * ------------------------------------------------------------------ */

/**
 * POST /api/admin/payments/health-check
 *
 * Runs the sweep now rather than waiting for the next quarter hour.
 *
 * It resolves payouts whose outcome we never learnt by ASKING the gateway, and
 * raises cash that has been out too long and any ledger imbalance. It never
 * sends a payment and never corrects the books: an imbalance means an
 * assumption somewhere is wrong, and a job that quietly rebalanced them would
 * destroy the only evidence of which one.
 */
pricingRoutes.post(
  '/payments/health-check',
  requirePermission('finance.payouts.manage', 'finance.settlements.manage'),
  async (req, res, next) => {
    try {
      const report = await runPaymentsHealthCheck();

      recordAudit(req, {
        action: 'PAYMENTS_HEALTH_CHECK',
        entityType: 'SYSTEM',
        entityId: 'payments',
        summary:
          `Sweep run by hand: ${report.uncertainPayouts.resolvedPaid} confirmed paid, ` +
          `${report.uncertainPayouts.resolvedFailed} confirmed failed, ` +
          `${report.uncertainPayouts.stillUnknown} still unknown, ` +
          `ledger ${report.ledger.balanced ? 'balanced' : 'NOT BALANCED'}`,
        after: report as any
      });

      res.json({
        success: true,
        data: {
          ...report,
          cash: { ...report.cash, total: toRupees(report.cash.totalPaise) }
        },
        message:
          report.alerts.length === 0
            ? 'Nothing needs attention.'
            : `${report.alerts.length} thing${report.alerts.length === 1 ? '' : 's'} need attention.`
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  RIDER BONUSES                                                      *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/rates/incentives
 *
 * Which rider bonuses the platform pays, and what they are worth.
 *
 * All five ship DISABLED. They used to be hardcoded and unconditional, which is
 * how the owner found a ₹700 bonus on a payout they had never approved. The
 * safe default for automatically giving money away is not to.
 */
pricingRoutes.get(
  '/rates/incentives',
  requirePermission('finance.config.edit', 'finance.reports.view'),
  (_req, res) => {
    res.json({
      success: true,
      data: {
        incentives: incentiveSettings(),
        note:
          'Every bonus is off until you switch it on. A rider only sees a target that is actually being paid.'
      }
    });
  }
);

const IncentiveSchema = z.object({
  changes: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(40),
        enabled: z.boolean().optional(),
        reward: z.number().min(0).max(5000).optional(),
        target: z.number().min(0.1).max(500).optional()
      })
    )
    .min(1)
});

/** PUT /api/admin/rates/incentives — switch one on, or change what it pays. */
pricingRoutes.put(
  '/rates/incentives',
  requirePermission('finance.config.edit'),
  validate({ body: IncentiveSchema }),
  async (req, res, next) => {
    try {
      const before = incentiveSettings();
      const after = setIncentiveSettings(req.body.changes, req.user!.id);

      recordAudit(req, {
        action: 'RIDER_INCENTIVES_UPDATED',
        entityType: 'SETTING',
        entityId: 'incentives:config',
        summary:
          'Rider bonuses changed. Now paying: ' +
          (after.filter(s => s.enabled).map(s => `${s.code} at Rs ${s.reward}`).join(', ') || 'nothing'),
        before: { rules: before } as any,
        after: { rules: after } as any
      });

      res.json({
        success: true,
        data: { incentives: after },
        message:
          'Saved. Bonuses already earned are not taken back \u2014 turning one off stops it being awarded from now on.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ *
 *  GOLD MEMBERSHIP PLANS                                              *
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/rates/membership
 *
 * What Gold costs and what it gives.
 *
 * `savePlans` has existed in the membership service since it was written and
 * was called by nothing — the plans were editable in principle and unreachable
 * in practice, so the prices, the discount and the free-delivery floor were all
 * effectively hardcoded. The owner asked for the opposite: *"admin can really
 * set how much what they can really get from gold membership."*
 *
 * The benefit text is generated from the numbers and returned with them, so an
 * administrator can see exactly what a customer will be promised before they
 * save.
 */
pricingRoutes.get(
  '/rates/membership',
  requirePermission('finance.config.edit', 'finance.reports.view'),
  (_req, res) => {
    res.json({
      success: true,
      data: {
        plans: listPlans(true),
        note:
          'What a customer is promised is written from these numbers, so the wording can never say more than the plan does.'
      }
    });
  }
);

const PlanSchema = z.object({
  plans: z
    .array(
      z.object({
        id: z.string().trim().min(3).max(60),
        name: z.string().trim().min(2).max(60),
        price: z.number().min(0).max(100000),
        durationDays: z.number().int().min(1).max(3650),
        /**
         * The delivery benefit. Its absence here would have been silent: zod
         * strips keys it does not know, so an administrator saving a plan would
         * have got a success and a plan whose delivery discount had quietly
         * become undefined -- the same shape as the rate that vanished from
         * RATE_BOUNDS and reported success while changing nothing.
         */
        deliveryDiscountPercent: z.number().min(0).max(100),
        extraDiscountPercent: z.number().min(0).max(50),
        /** Zero means uncapped, which is how a cheap plan becomes a liability. */
        maxDiscountPerOrder: z.number().min(0).max(10000),
        freeDeliveryMinOrder: z.number().min(0).max(10000),
        isActive: z.boolean()
      })
    )
    .min(1)
    .max(10)
});

/**
 * PUT /api/admin/rates/membership
 *
 * Replaces the whole set, so a plan removed here is really removed.
 *
 * Customers who already hold a plan keep what they bought: a membership records
 * the plan id it was sold under, and the benefit is read from that. Changing a
 * price changes what the NEXT person pays. Retroactively altering what somebody
 * already paid for would be the platform reaching into a sale it had already
 * made.
 */
pricingRoutes.put(
  '/rates/membership',
  requirePermission('finance.config.edit'),
  validate({ body: PlanSchema }),
  async (req, res, next) => {
    try {
      const before = listPlans(true);

      /*
       * An uncapped percentage is allowed but warned about, not refused.
       *
       * It is a legitimate choice — a launch offer, a plan meant to be
       * loss-leading — and refusing it would be this file deciding the owner's
       * pricing for them. But it is also how one large basket costs more than
       * the membership sold for, so it is said out loud rather than discovered.
       */
      const uncapped = req.body.plans.filter(
        (p: any) => p.extraDiscountPercent > 0 && p.maxDiscountPerOrder === 0
      );

      const saved = savePlans(req.body.plans);

      recordAudit(req, {
        action: 'MEMBERSHIP_PLANS_UPDATED',
        entityType: 'SETTING',
        entityId: 'membership:plans',
        summary:
          'Gold plans changed: ' +
          saved
            .filter(p => p.isActive)
            .map(p => `${p.name} Rs ${p.price}/${p.durationDays}d`)
            .join(', '),
        before: { plans: before } as any,
        after: { plans: saved } as any
      });

      res.json({
        success: true,
        data: { plans: listPlans(true) },
        message:
          uncapped.length > 0
            ? `Saved. ${uncapped.length} plan${uncapped.length === 1 ? ' has' : 's have'} no discount ceiling — one large order can cost you more than the plan sold for.`
            : 'Saved. Customers who already hold a plan keep what they bought.'
      });
    } catch (err) {
      next(err);
    }
  }
);
