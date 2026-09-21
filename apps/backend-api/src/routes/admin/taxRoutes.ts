/**
 * Tax, from operations' side of the desk.
 *
 * Two jobs: telling the platform who it is for tax purposes, and producing the
 * figures a month's returns are filed from.
 *
 * -------------------------------------------------------------------------
 * THE REGISTRATION IS ENTERED ONCE AND IS NOT A RATE
 * -------------------------------------------------------------------------
 * It deliberately does not live in the versioned pricing config. A rate change
 * creates a new version because every past order must keep the rate it was
 * charged at; a GSTIN is not like that. It is a fact about the business, there
 * is exactly one current value, and versioning it would imply that old invoices
 * were issued under an old registration — which, if it ever became true, is a
 * far bigger event than a settings change.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import {
  getTaxIdentity,
  setTaxIdentity,
  taxIdentityGaps,
  monthlyTaxSummary,
  taxSummaryView,
  tdsCsv,
  invoiceFor
} from '../../modules/payments/tax.ts';

export const taxRoutes = Router();

/**
 * GET /api/admin/tax/identity
 *
 * What is configured, and what is still missing. The gaps are returned even
 * when everything is fine (as an empty list) so a screen has one shape to
 * render rather than two.
 */
taxRoutes.get('/tax/identity', requirePermission('finance.config.edit', 'finance.ledger.view'), (_req, res) => {
  res.json({
    success: true,
    data: {
      identity: getTaxIdentity(),
      gaps: taxIdentityGaps(),
      canIssueInvoices: taxIdentityGaps().length === 0
    }
  });
});

const IdentitySchema = z.object({
  gstin: z.string().trim().length(15),
  legalName: z.string().trim().min(3).max(200),
  tradeName: z.string().trim().max(200).optional(),
  addressLine: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  stateName: z.string().trim().min(2).max(100),
  pincode: z.string().trim().regex(/^[0-9]{6}$/, 'A pincode is six digits.'),
  pan: z.string().trim().length(10).optional(),
  tan: z.string().trim().max(15).optional(),
  invoicePrefix: z.string().trim().min(1).max(12).optional(),
  /**
   * Accepted and ignored.
   *
   * The state code is taken from the first two characters of the GSTIN, because
   * a typed one that disagrees with the registration splits CGST/SGST against
   * the wrong state — an error invisible until a return is rejected. The field
   * is tolerated so a client sending the whole object back is not refused.
   */
  stateCode: z.string().trim().optional()
});

/** PUT /api/admin/tax/identity — who the invoices come from. */
taxRoutes.put(
  '/tax/identity',
  requirePermission('finance.config.edit'),
  validate({ body: IdentitySchema }),
  async (req, res, next) => {
    try {
      const before = getTaxIdentity();
      const identity = setTaxIdentity({ ...req.body, stateCode: '' }, req.user!.id);

      recordAudit(req, {
        action: 'TAX_IDENTITY_UPDATED',
        entityType: 'SETTING',
        entityId: 'tax:identity',
        summary: before
          ? `GST registration changed from ${before.gstin} to ${identity.gstin}`
          : `GST registration set to ${identity.gstin} (${identity.legalName})`,
        before: before || undefined,
        after: identity
      });

      res.json({
        success: true,
        data: { identity, gaps: taxIdentityGaps() },
        message: 'Saved. Tax invoices can now be issued.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/tax/summary?month=2026-09
 *
 * Everything a month's returns are built from: outward supplies and the tax on
 * them, the section 52 collection, and section 194-O per partner.
 *
 * The warnings are the important part of this response. A summary that looks
 * clean because it quietly dropped the awkward orders is how a wrong return
 * gets filed confidently.
 */
taxRoutes.get(
  '/tax/summary',
  requirePermission('finance.ledger.view', 'finance.config.edit'),
  async (req, res, next) => {
    try {
      const month =
        typeof req.query.month === 'string' && req.query.month.trim()
          ? req.query.month.trim()
          : new Date().toISOString().slice(0, 7);

      res.json({ success: true, data: taxSummaryView(monthlyTaxSummary(month)) });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/tax/summary/tds.csv?month=2026-09 — one row per partner. */
taxRoutes.get(
  '/tax/summary/tds.csv',
  requirePermission('finance.ledger.view', 'finance.config.edit'),
  async (req, res, next) => {
    try {
      const month =
        typeof req.query.month === 'string' && req.query.month.trim()
          ? req.query.month.trim()
          : new Date().toISOString().slice(0, 7);

      const csv = tdsCsv(monthlyTaxSummary(month));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tds-194O-${month}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/tax/invoice/:orderId
 *
 * The same invoice the customer sees, for answering a query about one.
 *
 * `allocate: false` so opening an invoice from the admin console does not
 * consume a number from the series for an order the customer has never asked
 * about. A gap in a GST invoice series is a question somebody has to answer.
 */
taxRoutes.get(
  '/tax/invoice/:orderId',
  requirePermission('finance.ledger.view', 'finance.config.edit'),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.params.orderId);
      if (!order) throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
      res.json({ success: true, data: { invoice: invoiceFor(order, { allocate: false }) } });
    } catch (err) {
      next(err);
    }
  }
);
