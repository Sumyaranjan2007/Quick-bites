/**
 * Money: what was paid, what the platform earned, what is owed to riders, and
 * the return/refund cases that give some of it back.
 */
import { lossMakingOrders } from '../../modules/payments/orderMargin.ts';
import { refundableRemaining } from '../../modules/payments/refundCap.ts';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { walletRepository } from '../../db/repositories/walletRepository.ts';
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import { payoutRepository } from '../../db/repositories/payoutRepository.ts';
import { settlementRepository } from '../../db/repositories/settlementRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { emitOrderStatusUpdate } from '../../sockets/socketServer.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { economicsOf, revenueSeries, revenueForPeriod, istDayStart } from '../../modules/admin/analytics.ts';
import { matchesQuery, paginate, shapeOrderDetail } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { sendRefund } from '../../modules/payments/refunds.ts';
import { toPaise, toRupees, formatPaise } from '../../modules/payments/money.ts';
import { duesFor, draftPayout, executePayout, listPayouts } from '../../modules/payments/payouts.ts';
import { settlementEvidence } from '../../modules/payments/earnings.ts';
import { connectedAccountFor, accountBlockReason } from '../../modules/payments/payeeAccounts.ts';
import type { Order, RefundRequest } from '@quick-bites/shared-types';

export const financeRoutes = Router();

/* -------------------------------- Payments -------------------------------- */

/** GET /api/admin/payments — order-by-order payment ledger. */
financeRoutes.get('/payments', requirePermission('finance.payments.view'), async (req, res, next) => {
  try {
    const { status, method, q, page, pageSize } = req.query as Record<string, string>;
    let orders = (await orderRepository.listAll()) as Order[];

    if (status && status !== 'ALL') orders = orders.filter(o => o.paymentStatus === status.toUpperCase());
    if (method && method !== 'ALL') orders = orders.filter(o => o.paymentMethod === method.toUpperCase());
    if (q) orders = orders.filter(o => matchesQuery(q, o.orderNumber, o.customerName, o.restaurantName));

    const rows = orders.map(order => {
      const economics = economicsOf(order);
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        restaurantName: order.restaurantName,
        amount: economics.gross,
        method: order.paymentMethod,
        status: order.paymentStatus,
        orderStatus: order.status,
        couponCode: order.couponCode || null,
        discount: economics.discount,
        tax: economics.tax,
        platformEarning: economics.netRevenue,
        restaurantPayout: economics.restaurantPayout,
        riderPayout: economics.riderPayout,
        createdAt: order.createdAt,
        settledAt: order.deliveredAt
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        if (row.status === 'PAID') acc.collected += row.amount;
        if (row.status === 'PENDING') acc.pending += row.amount;
        if (row.status === 'FAILED') acc.failed += row.amount;
        if (row.status === 'REFUNDED') acc.refunded += row.amount;
        return acc;
      },
      { collected: 0, pending: 0, failed: 0, refunded: 0 }
    );
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] = Math.round(totals[key] * 100) / 100;
    }

    const { rows: paged, pagination } = paginate(rows, Number(page) || 1, Number(pageSize) || 25);
    res.json({ success: true, data: { payments: paged, pagination, totals } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/revenue?period=today|week|month|all — the revenue screen. */
financeRoutes.get('/revenue', requirePermission('finance.revenue.view'), async (req, res, next) => {
  try {
    const period = (String(req.query.period || 'week') as 'today' | 'week' | 'month' | 'all');
    const orders = (await orderRepository.listAll()) as Order[];
    const delivered = orders.filter(o => o.status === 'DELIVERED');

    // Top partners by what they actually brought in, which is the question the
    // revenue screen is asked to answer.
    const byRestaurant = new Map<string, { id: string; name: string; orders: number; gross: number; commission: number }>();
    for (const order of delivered) {
      const economics = economicsOf(order);
      const row = byRestaurant.get(order.restaurantId) || {
        id: order.restaurantId,
        name: order.restaurantName || 'Restaurant',
        orders: 0,
        gross: 0,
        commission: 0
      };
      row.orders += 1;
      row.gross = Math.round((row.gross + economics.gross) * 100) / 100;
      row.commission = Math.round((row.commission + economics.commission) * 100) / 100;
      byRestaurant.set(order.restaurantId, row);
    }

    res.json({
      success: true,
      data: {
        summary: revenueForPeriod(period),
        periods: {
          today: revenueForPeriod('today'),
          week: revenueForPeriod('week'),
          month: revenueForPeriod('month'),
          all: revenueForPeriod('all')
        },
        trend: revenueSeries(30),
        topRestaurants: Array.from(byRestaurant.values()).sort((a, b) => b.gross - a.gross).slice(0, 10)
      }
    });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- Refund requests ---------------------------- */

/** GET /api/admin/refund-requests — the return and refund queue. */
financeRoutes.get(
  '/refund-requests',
  requirePermission('orders.refunds.handle', 'finance.refunds.manage', 'support.tickets.view'),
  async (req, res, next) => {
    try {
      const status = String(req.query.status || 'ALL').toUpperCase();
      const rows = await refundRepository.list(status === 'ALL' ? {} : { status: status as any });
      res.json({
        success: true,
        data: {
          requests: rows,
          counts: {
            requested: rows.filter(r => r.status === 'REQUESTED').length,
            processing: rows.filter(r => r.status === 'PROCESSING').length,
            approved: rows.filter(r => r.status === 'APPROVED').length,
            rejected: rows.filter(r => r.status === 'REJECTED').length,
            refunded: rows.filter(r => r.status === 'REFUNDED').length
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/refund-requests/:id — the complete case, with its order. */
financeRoutes.get(
  '/refund-requests/:id',
  requirePermission('orders.refunds.handle', 'finance.refunds.manage', 'support.tickets.view'),
  async (req, res, next) => {
    try {
      const request = await refundRepository.findById(req.params.id);
      if (!request) throw new AppError('Refund request not found.', 404, 'REFUND_REQUEST_NOT_FOUND');
      const order = await orderRepository.findById(request.orderId);
      res.json({
        success: true,
        data: { request, order: order ? await shapeOrderDetail(order) : null }
      });
    } catch (err) {
      next(err);
    }
  }
);

const RefundDecisionSchema = z.object({
  action: z.enum(['PROCESSING', 'APPROVE', 'REJECT', 'REFUND']),
  amount: z.number().positive().max(1000000).optional(),
  note: z.string().trim().max(500).optional(),
  /**
   * Set when the administrator has already refunded this by hand — a bank
   * transfer, or cash over the counter — and is recording it.
   *
   * The only way to settle a cash-order refund on a deployment that cannot
   * create a payout link, which would otherwise leave the customer owed money
   * indefinitely while a case sat in a queue nobody could clear.
   */
  manualReference: z.string().trim().min(4).max(120).optional()
});

/**
 * POST /api/admin/refund-requests/:id/decision
 *
 * Walks a case through Requested → Processing → Approved/Rejected → Refunded.
 * The money only moves on REFUND, and only once: the case is marked with the
 * transaction that paid it, and a second attempt is refused rather than
 * crediting the customer twice.
 */
financeRoutes.post(
  '/refund-requests/:id/decision',
  requirePermission('finance.refunds.manage', 'orders.refunds.handle'),
  validate({ body: RefundDecisionSchema }),
  async (req, res, next) => {
    try {
      const request = (await refundRepository.findById(req.params.id)) as RefundRequest | null;
      if (!request) throw new AppError('Refund request not found.', 404, 'REFUND_REQUEST_NOT_FOUND');

      const actor = { userId: req.user!.id, name: req.user!.fullName || req.user!.email };
      const { action, amount, note } = req.body;
      // A case returning a customer's SECOND payment (duplicateCapture.ts). Its
      // money was never the order's, so the order's refund cap does not apply,
      // it is reversed against that payment, and it never refunds the order.
      const duplicateOf = request.duplicatePaymentId;

      if (action === 'REJECT' && !note) {
        throw new AppError(
          'Record why the request was rejected — the customer is told this.',
          400,
          'REJECTION_REASON_REQUIRED'
        );
      }

      // Approving commits money: it is capped by what the OTHER committed cases
      // on the order have not already taken (refundCap counts APPROVED too).
      if (action === 'APPROVE' && !duplicateOf) {
        const approving = amount ?? request.requestedAmount;
        const forOrder = await orderRepository.findById(request.orderId);
        if (forOrder) {
          const remaining = await refundableRemaining(forOrder, request.id);
          if (approving > remaining) {
            throw new AppError(
              remaining <= 0
                ? 'This order is already refunded, or committed to be, in full by another case.'
                : `Only Rs ${remaining} of this order is not already refunded or committed.`,
              409,
              'REFUND_EXCEEDS_REMAINING'
            );
          }
        }
      }

      if (action === 'PROCESSING' || action === 'APPROVE' || action === 'REJECT') {
        const status = action === 'PROCESSING' ? 'PROCESSING' : action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const updated = await refundRepository.transition(request.id, status, actor, {
          note,
          approvedAmount: action === 'APPROVE' ? amount ?? request.requestedAmount : undefined
        });
        recordAudit(req, {
          action: `REFUND_${status}`,
          entityType: 'REFUND_REQUEST',
          entityId: request.id,
          summary: `Refund case for order #${request.orderNumber} marked ${status}${note ? ` — ${note}` : ''}`,
          before: { status: request.status },
          after: { status }
        });
        return res.json({ success: true, data: { request: updated } });
      }

      // action === 'REFUND': the money actually moves here.
      if (request.status === 'REFUNDED') {
        throw new AppError('This case has already been refunded.', 409, 'ALREADY_REFUNDED');
      }
      if (request.status === 'REJECTED') {
        throw new AppError('A rejected case cannot be refunded. Reopen it first.', 409, 'CASE_REJECTED');
      }

      const order = await orderRepository.findById(request.orderId);
      if (!order) throw new AppError('The order behind this case no longer exists.', 404, 'ORDER_NOT_FOUND');

      const payable = amount ?? request.approvedAmount ?? request.requestedAmount;
      if (payable > request.orderTotal) {
        throw new AppError(
          `A refund cannot exceed the order total of Rs ${request.orderTotal}.`,
          400,
          'REFUND_EXCEEDS_ORDER'
        );
      }
      // Across every case on the order, not just this one.
      const remaining = await refundableRemaining(order, request.id);
      if (!duplicateOf && payable > remaining) {
        throw new AppError(
          remaining <= 0
            ? 'This order has already been refunded in full by another case.'
            : `Only Rs ${remaining} of this order has not already been refunded.`,
          409,
          'REFUND_EXCEEDS_REMAINING'
        );
      }

      /*
       * Money goes back the way it came.
       *
       * This used to call `walletRepository.credit` unconditionally, without
       * ever looking at how the order was paid. A customer who paid by UPI and
       * complained was given Quick Bites credit, and the response said so. The
       * cancellation path a few files away did it correctly all along, so the
       * route a machine took was right and the route a person took was wrong.
       *
       * `sendRefund` decides the route from the ORDER — reversed at the gateway
       * where there is a payment to reverse, and by a payout link the customer
       * claims with their own UPI where there is not. It never throws on a
       * gateway failure, because losing the decision to refund would be worse
       * than a case left open.
       */
      const outcome = await sendRefund({
        order,
        amountPaise: toPaise(payable),
        reason: note || request.description || 'Refund approved',
        actorUserId: req.user!.id,
        caseId: request.id,
        customerPhone: order.customerPhone,
        manualReference: req.body.manualReference,
        duplicatePaymentId: duplicateOf
      });

      if (!outcome.settled) {
        // Deliberately NOT marked refunded. The customer's money has not moved,
        // and a green tick here would stop anybody looking for it.
        const stalled = await refundRepository.transition(
          request.id,
          'PROCESSING',
          actor,
          { note: `Could not be settled: ${outcome.failureReason || 'unknown reason'}`, approvedAmount: payable }
        );
        recordAudit(req, {
          action: 'REFUND_FAILED',
          entityType: 'REFUND_REQUEST',
          entityId: request.id,
          summary: `Refund of Rs ${payable} on #${order.orderNumber} could not be settled: ${outcome.failureReason}`,
          after: { route: outcome.route, settled: false }
        });
        return res.status(502).json({
          success: false,
          error: {
            code: 'REFUND_NOT_SETTLED',
            message: outcome.message
          },
          data: { request: stalled }
        });
      }

      // A partial refund leaves the order delivered — the customer kept the food.
      // Only a full refund reverses the order itself.
      const isFullRefund = !duplicateOf && payable >= request.orderTotal - 0.01;
      if (isFullRefund) {
        order.status = 'REFUNDED';
        order.paymentStatus = 'REFUNDED';
        order.updatedAt = new Date().toISOString();
        memoryStore.orders.set(order.id, order);
        triggerAutoSave();
        emitOrderStatusUpdate(order.id, {
          orderId: order.id,
          status: 'REFUNDED',
          updatedAt: order.updatedAt
        });
      }

      const updated = await refundRepository.transition(request.id, 'REFUNDED', actor, {
        note: note || outcome.message,
        approvedAmount: payable,
        // The gateway's own refund id, or the payout link id. What proves it.
        refundTransactionId: outcome.reference
      });

      recordAudit(req, {
        action: 'REFUND_PAID',
        entityType: 'REFUND_REQUEST',
        entityId: request.id,
        summary:
          `Refunded Rs ${payable} to ${request.customerName || order.customerId} for order ` +
          `#${order.orderNumber} via ${outcome.route}${outcome.reference ? ` (${outcome.reference})` : ''}`,
        before: { status: request.status },
        after: { amount: payable, full: isFullRefund, route: outcome.route }
      });

      res.json({
        success: true,
        data: {
          request: updated,
          refundedAmount: payable,
          fullRefund: isFullRefund,
          route: outcome.route,
          reference: outcome.reference,
          // Where the customer goes to claim a cash-order refund. Handed back
          // so an administrator can pass it on — SMS needs TRAI DLT
          // registration, which is not done, so nothing is sent automatically.
          claimUrl: outcome.claimUrl
        },
        message: outcome.message
      });
    } catch (err) {
      next(err);
    }
  }
);

const DirectRefundSchema = z.object({
  amount: z.number().positive().max(1000000).optional(),
  reason: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/orders/:id/refund
 *
 * A refund with no case behind it — a goodwill credit an administrator decides
 * on directly. It opens a case and immediately resolves it, so a refund issued
 * this way is as auditable as one that came through the queue.
 */
financeRoutes.post(
  '/orders/:id/refund',
  requirePermission('finance.refunds.manage', 'orders.refunds.handle'),
  validate({ body: DirectRefundSchema }),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.params.id);
      if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
      if (order.status === 'REFUNDED') {
        throw new AppError('This order has already been refunded.', 409, 'ALREADY_REFUNDED');
      }

      const total = Number(order.bill?.totalAmount) || 0;
      const remaining = await refundableRemaining(order);
      // Nothing left means nothing to do: defaulting the amount to "what is
      // left" would otherwise record a Rs 0 refund as a settled case.
      if (remaining <= 0) {
        throw new AppError(
          'This order is already refunded, or committed to be, in full.',
          409,
          'REFUND_EXCEEDS_REMAINING'
        );
      }
      const amount = req.body.amount ?? remaining;
      if (amount > total) {
        throw new AppError(`A refund cannot exceed the order total of Rs ${total}.`, 400, 'REFUND_EXCEEDS_ORDER');
      }
      if (amount > remaining) {
        throw new AppError(
          remaining <= 0
            ? 'This order has already been refunded in full.'
            : `Only Rs ${remaining} of this order has not already been refunded.`,
          409,
          'REFUND_EXCEEDS_REMAINING'
        );
      }
      const reason = req.body.reason || 'Admin dispute resolution';
      const actor = { userId: req.user!.id, name: req.user!.fullName || req.user!.email };

      const request = await refundRepository.create({
        orderId: order.id,
        orderNumber: order.orderNumber,
        raisedByUserId: req.user!.id,
        raisedByRole: req.user!.role as any,
        raisedByName: actor.name,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        riderId: order.riderId,
        riderName: order.riderName,
        reasonCode: 'OTHER',
        description: reason,
        attachments: [],
        requestedAmount: amount,
        orderTotal: total
      });

      // The same defect as the queue route had, in the second place it lived.
      // A goodwill refund is still a refund, and it goes back the way the
      // money came rather than becoming store credit.
      const outcome = await sendRefund({
        order,
        amountPaise: toPaise(amount),
        reason,
        actorUserId: req.user!.id,
        caseId: request.id,
        customerPhone: order.customerPhone
      });

      if (!outcome.settled) {
        await refundRepository.transition(request.id, 'PROCESSING', actor, {
          note: `Could not be settled: ${outcome.failureReason || 'unknown reason'}`,
          approvedAmount: amount
        });
        return res.status(502).json({
          success: false,
          error: { code: 'REFUND_NOT_SETTLED', message: outcome.message },
          data: { orderId: order.id, request }
        });
      }

      const isFullRefund = amount >= total - 0.01;
      if (isFullRefund) {
        order.status = 'REFUNDED';
        order.paymentStatus = 'REFUNDED';
        order.updatedAt = new Date().toISOString();
        memoryStore.orders.set(order.id, order);
        triggerAutoSave();
        emitOrderStatusUpdate(order.id, {
          orderId: order.id,
          status: 'REFUNDED',
          updatedAt: order.updatedAt
        });
      }

      const resolved = await refundRepository.transition(request.id, 'REFUNDED', actor, {
        note: reason,
        approvedAmount: amount,
        refundTransactionId: outcome.reference
      });

      recordAudit(req, {
        action: 'REFUND_DIRECT',
        entityType: 'ORDER',
        entityId: order.id,
        summary:
          `Issued a direct refund of Rs ${amount} on order #${order.orderNumber} via ${outcome.route}` +
          `${outcome.reference ? ` (${outcome.reference})` : ''}: ${reason}`,
        after: { amount, full: isFullRefund, route: outcome.route }
      });

      res.json({
        success: true,
        data: {
          orderId: order.id,
          refundAmount: amount,
          request: resolved,
          reason,
          route: outcome.route,
          reference: outcome.reference,
          claimUrl: outcome.claimUrl
        },
        message: outcome.message
      });
    } catch (err) {
      next(err);
    }
  }
);

/*
 * THE RIDER SIDE OF THIS FILE IS DELIBERATELY EMPTY.
 *
 * A `unsettledFor(riderId)` helper and a docblock for `GET /api/admin/payouts`
 * stood here, left behind when the second payout system was removed. The route
 * was gone; the function had no callers and the compiler does not complain
 * about an unused one, so both sat here looking like working code.
 *
 * They are not being revived for the Settlements screen, and that is the point
 * worth recording. This helper derived what a rider is owed by SCANNING ORDERS;
 * `duesFor` in payouts.ts derives it from the LEDGER. Two sources for one
 * number is how Pay and Settlements would come to disagree about the same rider
 * on the same morning, and whichever screen somebody happened to open would be
 * the one they believed.
 *
 * Rider settlements therefore read `/admin/payouts/dues`, the same source Pay
 * reads. If a rider figure is ever wrong, it is wrong in one place.
 */

/**
 * GET /api/admin/finance/wallet-audit
 *
 * Replays every wallet's journal and reports the ones whose stored balance no
 * longer matches it. An empty list is the expected answer and is the point:
 * this is the check that turns "the balances are probably right" into a
 * statement somebody has actually verified today.
 *
 * Reports rather than repairs. A silent correction would destroy the evidence
 * of whatever caused the divergence, which is the only thing here worth acting
 * on.
 */
financeRoutes.get('/wallet-audit', requirePermission('finance.revenue.view'), async (_req, res, next) => {
  try {
    const discrepancies = await walletRepository.auditAllBalances();
    res.json({
      success: true,
      data: {
        balanced: discrepancies.length === 0,
        discrepancies,
        checkedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/*
 * THE SECOND PAYOUT SYSTEM USED TO LIVE HERE, AND IT IS GONE.
 *
 * It drafted a rider settlement, credited the rider's WALLET, and adjusted a
 * `codCashInHand` counter on the rider record — writing nothing to the ledger
 * at any point. That gave the platform two answers to "what is this rider
 * owed" and two answers to "how much of our cash are they carrying", and the
 * two drifted apart the moment a payout carried a deduction: the counter came
 * down, the ledger did not, and the books went on claiming cash that had
 * already been handed back. The audit still balanced, because nothing was
 * posted at all — a balanced set of books with a wrong number in it.
 *
 * It also registered `POST /payouts`, which shadowed the ledger-backed system
 * in `payoutRoutes` and stopped the admin app paying anybody at all.
 *
 * Everything it did is done properly by `modules/payments/payouts.ts`, where
 * the amount comes from the ledger rather than from a figure somebody typed,
 * a second administrator approves anything large, the daily cap is enforced at
 * execution, and every state change posts double-entry rows. Removed rather
 * than fixed, because the defect was not the arithmetic — it was having two
 * systems for one job.
 *
 * Driver payouts are made from the Payouts section of the admin app.
 */

/** GET /api/admin/reports/financial — a period summary for export. */
/**
 * GET /api/admin/reports/losses?days=1
 *
 * Delivered orders that cost the platform money (N11 / A7), worst first, with
 * what drove each: the coupon, the membership, a delivery fee below the rider's
 * pay. Before the gateway fee, which is booked at settlement.
 */
financeRoutes.get('/reports/losses', requirePermission('finance.reports.view'), async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 1));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const report = lossMakingOrders(since);
    res.json({
      success: true,
      data: {
        days,
        delivered: report.delivered,
        lossMaking: report.orders.length,
        totalLoss: report.totalLoss,
        orders: report.orders.slice(0, 200),
        note: 'Before the payment gateway fee, which is recorded when Razorpay settles.'
      }
    });
  } catch (err) {
    next(err);
  }
});

financeRoutes.get('/reports/financial', requirePermission('finance.reports.view'), async (req, res, next) => {
  try {
    const period = (String(req.query.period || 'month') as 'today' | 'week' | 'month' | 'all');
    const summary = revenueForPeriod(period);
    const payouts = await payoutRepository.list();
    const refunds = await refundRepository.list({ status: 'REFUNDED' });

    res.json({
      success: true,
      data: {
        summary,
        trend: revenueSeries(30),
        payouts: {
          paid: Math.round(payouts.filter(p => p.status === 'PAID').reduce((t, p) => t + p.netAmount, 0) * 100) / 100,
          pending:
            Math.round(
              payouts.filter(p => p.status === 'PENDING' || p.status === 'PROCESSING').reduce((t, p) => t + p.netAmount, 0) *
                100
            ) / 100,
          count: payouts.length
        },
        refunds: {
          count: refunds.length,
          amount: Math.round(refunds.reduce((t, r) => t + (r.approvedAmount || 0), 0) * 100) / 100
        },
        generatedAt: new Date().toISOString(),
        sinceIstDay: istDayStart().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------- Restaurant settlements -------------------------- */

/**
 * Orders a restaurant has delivered that no settlement has covered yet.
 *
 * Cancelled orders are excluded by the status check; a refunded order is not,
 * because the money it returns to the customer is recovered through the
 * `adjustments` field rather than by pretending the trading never happened.
 */
async function unsettledOrdersFor(restaurantId: string): Promise<Order[]> {
  const orders = await orderRepository.listByRestaurantId(restaurantId);
  // Same evidence check as rider payouts, and for the same reason.
  return orders.filter(o => settlementEvidence(o).ok && !o.settlementId);
}

/** What a restaurant is owed for one order, using the same split as analytics. */
function restaurantShareOf(order: Order) {
  const economics = economicsOf(order);
  const grossSales = Number(order.bill?.itemsTotal) || 0;
  const commission = economics.commission;
  const tds = Math.round(commission * 0.01 * 100) / 100;
  return { grossSales, commission, tds, net: Math.round((grossSales - commission - tds) * 100) / 100 };
}

/**
 * GET /api/admin/settlements
 *
 * One row per restaurant: earned, already paid, outstanding, and the history.
 * The shape deliberately matches `/payouts` so the console can present paying a
 * kitchen and paying a rider as the same job.
 */
financeRoutes.get('/settlements', requirePermission('finance.settlements.view'), async (req, res, next) => {
  try {
    const { q } = req.query as Record<string, string>;
    const restaurants = await restaurantRepository.listAll();

    let rows = await Promise.all(
      restaurants.map(async restaurant => {
        const unsettled = await unsettledOrdersFor(restaurant.id);
        const shares = unsettled.map(restaurantShareOf);
        /*
         * WHAT THEY ARE OWED COMES FROM THE LEDGER, NOT FROM HERE.
         *
         * `restaurantShareOf` is a SECOND formula: TDS at 1% of commission where
         * earnings.ts uses the bill's own figure, no packaging at all, and no sight of
         * anything else posted to PARTNER_PAYABLE — refund clawbacks, corrections, the
         * negative adjustment that nets off an overpayment. So this screen's "pending"
         * and the Pay screen's "owed" were two different numbers for the same partner,
         * and an administrator had no way to know which to believe.
         *
         * The breakdown below stays, because a statement should show gross, commission
         * and TDS. What changes is that the FIGURE is the ledger's.
         */
        const dues = duesFor('RESTAURANT', restaurant.id, restaurant.name);
        /*
         * `pendingAmount` keeps meaning WHAT THEY ARE OWED, held or not.
         *
         * That is what the label says and what the screen has always shown, so mapping
         * it to payable-now would have made a kitchen with a day-old delivery read as
         * owed nothing — true of the payout gate, false of the money. The gate is
         * `payableNowAmount`, beside it, which is the figure the pay action uses.
         */
        const pending = toRupees(dues.outstandingPaise);
        const allDelivered = (await orderRepository.listByRestaurantId(restaurant.id)).filter(
          o => o.status === 'DELIVERED'
        );
        return {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          phone: restaurant.phone,
          city: restaurant.city,
          ordersAllTime: allDelivered.length,
          ordersPending: unsettled.length,
          grossPending: Math.round(shares.reduce((t, s) => t + s.grossSales, 0) * 100) / 100,
          commissionPending: Math.round(shares.reduce((t, s) => t + s.commission, 0) * 100) / 100,
          pendingAmount: pending,
          heldAmount: toRupees(dues.heldPaise),
          outstandingAmount: toRupees(dues.outstandingPaise),
          payableNowAmount: toRupees(dues.payablePaise),
          paidToDate: await settlementRepository.paidTotal(restaurant.id),
          /*
           * Where a settlement would actually land.
           *
           * The owner's words: the verified account is added to their profile
           * "so they can pay everything as settlement". This is the other half
           * of that -- it is no use knowing the destination on the profile
           * screen if the screen you settle from does not show it.
           *
           * Read from the one account record by id. Nothing is copied onto the
           * restaurant row, so there is no second copy to disagree after an
           * administrator connects a different account.
           */
          willPayInto: (() => {
            const account = connectedAccountFor('RESTAURANT', restaurant.id);
            return account
              ? {
                  method: account.method,
                  holderName: account.holderName,
                  accountLast4: account.accountLast4,
                  ifsc: account.ifsc,
                  vpa: account.vpa
                }
              : null;
          })(),
          /*
           * The SAME blocker Pay uses, from the same function.
           *
           * This asked `accountBlockReason`, which knows about accounts and nothing
           * about hold periods, cash or the minimum — so a partner inside their hold
           * period read as payable here and blocked on Pay. `duesFor` now carries
           * `accountBlockReason`'s wording for the account case, so nothing is lost:
           * the better sentence is the one both screens show.
           */
          payoutBlockedReason: dues.blockedReason,
          payoutBlockedCode: dues.blockedCode,
          payoutBlockers: dues.blockers,
          settlements: await settlementRepository.list({ restaurantId: restaurant.id })
        };
      })
    );

    if (q) rows = rows.filter(r => matchesQuery(q, r.restaurantName, r.restaurantId, r.phone, r.city));
    rows.sort((a, b) => b.pendingAmount - a.pendingAmount);

    res.json({
      success: true,
      data: {
        settlements: rows,
        totals: {
          pending: Math.round(rows.reduce((t, r) => t + r.pendingAmount, 0) * 100) / 100,
          paid: Math.round(rows.reduce((t, r) => t + r.paidToDate, 0) * 100) / 100
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/settlements/:restaurantId — the detailed breakdown.
 *
 * Every order that makes up the outstanding figure, so an administrator paying a
 * restaurant can see what they are paying for rather than being asked to trust
 * a total.
 */
financeRoutes.get(
  '/settlements/:restaurantId',
  requirePermission('finance.settlements.view'),
  async (req, res, next) => {
    try {
      const restaurant = await restaurantRepository.findById(req.params.restaurantId);
      if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

      const unsettled = await unsettledOrdersFor(restaurant.id);
      const lines = unsettled.map(order => {
        const share = restaurantShareOf(order);
        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          deliveredAt: order.deliveredAt || order.updatedAt,
          grossSales: share.grossSales,
          commission: share.commission,
          tds: share.tds,
          net: share.net
        };
      });

      res.json({
        success: true,
        data: {
          restaurant: { id: restaurant.id, name: restaurant.name, phone: restaurant.phone, city: restaurant.city },
          pending: {
            orders: lines.length,
            grossSales: Math.round(lines.reduce((t, l) => t + l.grossSales, 0) * 100) / 100,
            commission: Math.round(lines.reduce((t, l) => t + l.commission, 0) * 100) / 100,
            tds: Math.round(lines.reduce((t, l) => t + l.tds, 0) * 100) / 100,
            netAmount: Math.round(lines.reduce((t, l) => t + l.net, 0) * 100) / 100
          },
          lines,
          history: await settlementRepository.list({ restaurantId: restaurant.id }),
          paidToDate: await settlementRepository.paidTotal(restaurant.id)
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const DraftSettlementSchema = z.object({
  restaurantId: z.string().min(1),
  adjustments: z.number().min(0).optional(),
  note: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/settlements — draft a settlement for everything outstanding.
 *
 * The orders are stamped with the settlement id in the same step, so a second
 * run cannot pay for the same trading again. A settlement that later fails
 * releases them.
 */
financeRoutes.post(
  '/settlements',
  requirePermission('finance.settlements.manage'),
  validate({ body: DraftSettlementSchema }),
  async (req, res, next) => {
    try {
      /*
       * A NON-ZERO ADJUSTMENT IS REFUSED, AND THAT IS NOT PEDANTRY.
       *
       * This screen's own hint said "use adjustments to recover a refund". But
       * `refunds.ts` already posts SETTLEMENT_ADJUSTMENT debiting PARTNER_PAYABLE for
       * the kitchen's share of every refund, automatically, the moment the refund is
       * sent. So an administrator following that hint deducts the same refund TWICE —
       * the mirror image of the payout defect, pointed at the partner instead of the
       * platform.
       *
       * Silently ignoring it would be worse than either: the screen would show a
       * deduction that did nothing, which is the exact shape of lie this work has
       * spent its time removing. So it refuses and says where the money already went.
       *
       * If a genuine deduction the ledger cannot express turns up — a penalty, damages
       * — it needs its own ledger event and its own audit trail, not a free-text
       * number on a settlement form.
       *
       * Checked BEFORE anything is looked up, because it is a fact about the request
       * rather than about the restaurant. Behind the "nothing outstanding" check it
       * would report the wrong problem to anybody who sent it on a settled kitchen.
       */
      const adjustments = Number(req.body.adjustments) || 0;
      if (adjustments !== 0) {
        throw new AppError(
          'Refunds are already deducted from what a restaurant is owed, automatically, when the refund is sent — ' +
            'entering them here would deduct them twice. Anything else needs recording against the order it relates to.',
          400,
          'ADJUSTMENTS_ALREADY_APPLIED'
        );
      }

      const restaurant = await restaurantRepository.findById(req.body.restaurantId);
      if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

      const orders = await unsettledOrdersFor(restaurant.id);
      if (!orders.length) {
        throw new AppError('There is nothing outstanding for this restaurant.', 409, 'NOTHING_TO_SETTLE');
      }

      const shares = orders.map(restaurantShareOf);
      const grossSales = Math.round(shares.reduce((t, s) => t + s.grossSales, 0) * 100) / 100;
      const commission = Math.round(shares.reduce((t, s) => t + s.commission, 0) * 100) / 100;
      const tds = Math.round(shares.reduce((t, s) => t + s.tds, 0) * 100) / 100;

      /*
       * THE AMOUNT IS THE LEDGER'S, NOT THIS FORMULA'S.
       *
       * The breakdown above is the statement — gross, commission, TDS — and it stays.
       * But `netAmount` is what will actually be PAID, and paying a figure computed
       * here would mean showing an administrator one number and sending another: this
       * formula has a different TDS base, no packaging, and no sight of clawbacks.
       */
      const dues = duesFor('RESTAURANT', restaurant.id, restaurant.name);
      const netAmount = toRupees(dues.payablePaise);

      if (netAmount <= 0) {
        throw new AppError(
          dues.blockedReason || 'There is nothing payable for this restaurant right now.',
          409,
          'NOTHING_TO_SETTLE'
        );
      }

      const timestamps = orders
        .map(o => new Date(o.deliveredAt || o.updatedAt || o.createdAt).getTime())
        .filter(t => Number.isFinite(t));

      const settlement = await settlementRepository.create({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        periodStart: new Date(Math.min(...timestamps)).toISOString(),
        periodEnd: new Date(Math.max(...timestamps)).toISOString(),
        ordersCount: orders.length,
        grossSales,
        commission,
        tds,
        adjustments,
        netAmount,
        note: req.body.note
      });

      for (const order of orders) {
        order.settlementId = settlement.id;
      }
      triggerAutoSave();

      await recordAudit(req, {
        action: 'SETTLEMENT_DRAFTED',
        entityType: 'RESTAURANT_SETTLEMENT',
        entityId: settlement.id,
        summary: `Drafted a settlement of Rs ${netAmount} for ${restaurant.name} covering ${orders.length} order(s)`,
        after: settlement
      });

      res.status(201).json({ success: true, data: { settlement } });
    } catch (err) {
      next(err);
    }
  }
);

const SettlementStatusSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'PAID', 'FAILED']),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/settlements/:id/status
 *
 * A FAILED settlement releases its orders so the next draft picks them up again;
 * without that, a bank transfer that bounced would quietly write the money off.
 */
financeRoutes.post(
  '/settlements/:id/status',
  requirePermission('finance.settlements.manage'),
  validate({ body: SettlementStatusSchema }),
  async (req, res, next) => {
    try {
      const existing = await settlementRepository.findById(req.params.id);
      if (!existing) throw new AppError('Settlement not found.', 404, 'SETTLEMENT_NOT_FOUND');
      if (existing.status === 'PAID' && req.body.status !== 'PAID') {
        throw new AppError('A settlement that has been paid cannot be reopened.', 409, 'SETTLEMENT_ALREADY_PAID');
      }

      /*
       * MARKING IT PAID NOW ACTUALLY PAYS IT.
       *
       * This wrote the record, released orders on FAILED, recorded an audit line, and
       * posted NOTHING to the ledger. So PARTNER_PAYABLE was untouched: `duesFor` still
       * showed the money owed, and the next Pay run paid the same partner AGAIN.
       *
       * That was masked until today by a second defect — after a partner's first payout
       * they were owed "nothing" regardless, so the second payment never happened.
       * Fixing that one made this one live, which is why they had to be fixed together.
       *
       * It goes through `payouts.ts` rather than posting here, so this button gets the
       * hold period, the cash-in-hand rule, the minimum, the daily cap, maker-checker,
       * the ledger entry and the payee's notification — every control the Pay screen
       * has. The button, its reference field and its response shape are unchanged,
       * because the shipped admin app cannot be rebuilt yet and a button that starts
       * failing reads as the app breaking.
       *
       * Keyed on the SETTLEMENT, so marking it paid twice sends once.
       */
      if (req.body.status === 'PAID' && existing.status !== 'PAID') {
        const alreadySent = listPayouts({}).find(
          p => p.ownerType === 'RESTAURANT' && p.settlementId === existing.id
        );

        if (!alreadySent) {
          const dues = duesFor('RESTAURANT', existing.restaurantId, existing.restaurantName);
          if (dues.blockedReason) {
            /*
             * It can now refuse where it used to "succeed", and that is the point. The
             * refusal names which rule and what to do about it, because the app shows
             * this message and an administrator cannot act on "could not pay".
             */
            throw new AppError(
              `${existing.restaurantName} cannot be paid right now: ${dues.blockedReason}`,
              409,
              dues.blockedCode || 'PAYOUT_BLOCKED'
            );
          }

          const drafted = draftPayout({
            ownerType: 'RESTAURANT',
            ownerId: existing.restaurantId,
            ownerName: existing.restaurantName,
            actorUserId: req.user!.id,
            rail: 'MANUAL_BANK',
            note: `Settlement ${existing.id}`,
            settlementId: existing.id
          });

          if (drafted.state === 'AWAITING_APPROVAL') {
            throw new AppError(
              `${formatPaise(drafted.amountPaise)} is over the amount one person may send alone. ` +
                'It has been drafted and needs a second administrator to approve it on the Pay screen.',
              409,
              'SECOND_APPROVER_REQUIRED'
            );
          }

          await executePayout({
            id: drafted.id,
            actorUserId: req.user!.id,
            manualReference: req.body.reference
          });

          /*
           * Stamped on the settlement so the legacy backfill can tell these apart from
           * the ones that were paid before any of this existed. Without it, a
           * settlement paid properly today would be posted a second time at the next
           * boot — the same double-count this whole change is about.
           */
          (existing as any).payoutId = drafted.id;
          memoryStore.restaurantSettlements.set(existing.id, existing);
          triggerAutoSave();
        }
      }

      const settlement = await settlementRepository.setStatus(
        req.params.id,
        req.body.status,
        { userId: req.user!.id },
        { reference: req.body.reference, note: req.body.note }
      );

      if (req.body.status === 'FAILED') {
        const orders = await orderRepository.listByRestaurantId(existing.restaurantId);
        for (const order of orders) {
          if (order.settlementId === existing.id) delete (order as any).settlementId;
        }
        triggerAutoSave();
      }

      await recordAudit(req, {
        action: 'SETTLEMENT_STATUS_CHANGED',
        entityType: 'RESTAURANT_SETTLEMENT',
        entityId: existing.id,
        summary: `Marked ${existing.restaurantName}'s settlement of Rs ${existing.netAmount} as ${req.body.status}`,
        before: existing,
        after: settlement
      });

      res.json({ success: true, data: { settlement } });
    } catch (err) {
      next(err);
    }
  }
);
