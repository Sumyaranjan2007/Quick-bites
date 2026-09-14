/**
 * Money: what was paid, what the platform earned, what is owed to riders, and
 * the return/refund cases that give some of it back.
 */
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
  note: z.string().trim().max(500).optional()
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

      if (action === 'REJECT' && !note) {
        throw new AppError(
          'Record why the request was rejected — the customer is told this.',
          400,
          'REJECTION_REASON_REQUIRED'
        );
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

      const walletBefore = await walletRepository.getByUserId(order.customerId);
      await walletRepository.credit(
        order.customerId,
        payable,
        `Refund for order #${order.orderNumber}: ${note || request.description}`,
        order.id
      );
      const transaction = Array.from(memoryStore.walletTransactions.values())
        .filter((tx: any) => tx.orderId === order.id && tx.type === 'CREDIT')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      // A partial refund leaves the order delivered — the customer kept the food.
      // Only a full refund reverses the order itself.
      const isFullRefund = payable >= request.orderTotal - 0.01;
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
        note: note || `Rs ${payable} credited to the customer's wallet.`,
        approvedAmount: payable,
        refundTransactionId: transaction?.id
      });

      recordAudit(req, {
        action: 'REFUND_PAID',
        entityType: 'REFUND_REQUEST',
        entityId: request.id,
        summary: `Refunded Rs ${payable} to ${request.customerName || order.customerId} for order #${order.orderNumber}`,
        before: { walletBalance: walletBefore.balance },
        after: { amount: payable, full: isFullRefund }
      });

      res.json({
        success: true,
        data: { request: updated, refundedAmount: payable, fullRefund: isFullRefund },
        message: `Rs ${payable} credited to the customer's Quick Bites wallet.`
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
      const amount = req.body.amount ?? total;
      if (amount > total) {
        throw new AppError(`A refund cannot exceed the order total of Rs ${total}.`, 400, 'REFUND_EXCEEDS_ORDER');
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

      await walletRepository.credit(
        order.customerId,
        amount,
        `Refund for order #${order.orderNumber}: ${reason}`,
        order.id
      );

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
        approvedAmount: amount
      });

      recordAudit(req, {
        action: 'REFUND_DIRECT',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Issued a direct refund of Rs ${amount} on order #${order.orderNumber}: ${reason}`,
        after: { amount, full: isFullRefund }
      });

      res.json({
        success: true,
        data: { orderId: order.id, refundAmount: amount, request: resolved, reason },
        message: `Rs ${amount} credited to the customer's wallet.`
      });
    } catch (err) {
      next(err);
    }
  }
);

/* --------------------------------- Payouts -------------------------------- */

/** Trips a rider has completed that no settlement has covered yet. */
async function unsettledFor(riderId: string) {
  const orders = await orderRepository.listByRiderId(riderId);
  return orders.filter(o => o.status === 'DELIVERED' && !o.payoutId);
}

/**
 * GET /api/admin/payouts
 *
 * One row per rider: what they have earned, what has already been paid, and what
 * is outstanding — plus the settlement history behind those numbers.
 */
financeRoutes.get('/payouts', requirePermission('finance.payouts.view'), async (req, res, next) => {
  try {
    const { q } = req.query as Record<string, string>;
    const riders = await riderRepository.findAll();

    let rows = await Promise.all(
      riders.map(async rider => {
        const unsettled = await unsettledFor(rider.id);
        const allTrips = (await orderRepository.listByRiderId(rider.id)).filter(o => o.status === 'DELIVERED');
        const pending = Math.round(unsettled.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100;
        return {
          riderId: rider.id,
          riderName: rider.fullName,
          driverCode: rider.driverCode,
          phone: rider.phone,
          isOnline: rider.isOnline,
          kycStatus: rider.kycStatus,
          lifetimeTrips: allTrips.length,
          lifetimeEarnings:
            Math.round(allTrips.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100,
          unsettledTrips: unsettled.length,
          pendingAmount: pending,
          // Cash the rider is holding from COD orders is netted off what they
          // are owed; paying the full trip fee while they still hold the cash
          // would pay them twice.
          codCashInHand: rider.codCashInHand || 0,
          netPayable: Math.round((pending - (rider.codCashInHand || 0)) * 100) / 100,
          paidToDate: await payoutRepository.paidTotal(rider.id),
          payouts: await payoutRepository.list({ riderId: rider.id })
        };
      })
    );

    if (q) rows = rows.filter(r => matchesQuery(q, r.riderName, r.driverCode, r.phone));
    rows.sort((a, b) => b.pendingAmount - a.pendingAmount);

    res.json({
      success: true,
      data: {
        payouts: rows,
        totals: {
          pending: Math.round(rows.reduce((t, r) => t + r.pendingAmount, 0) * 100) / 100,
          paid: Math.round(rows.reduce((t, r) => t + r.paidToDate, 0) * 100) / 100,
          codOutstanding: Math.round(rows.reduce((t, r) => t + r.codCashInHand, 0) * 100) / 100
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

const PayoutDraftSchema = z.object({
  riderId: z.string().min(1),
  bonuses: z.number().min(0).max(100000).optional(),
  deductions: z.number().min(0).max(100000).optional(),
  note: z.string().trim().max(300).optional()
});

/**
 * POST /api/admin/payouts
 *
 * Drafts a settlement covering everything the rider has completed and not yet
 * been paid for. The trips are stamped with the payout id in the same step, so
 * a second draft cannot pick up the same work.
 */
financeRoutes.post(
  '/payouts',
  requirePermission('finance.payouts.manage'),
  validate({ body: PayoutDraftSchema }),
  async (req, res, next) => {
    try {
      const rider = await riderRepository.findById(req.body.riderId);
      if (!rider) throw new AppError('Delivery partner not found.', 404, 'RIDER_NOT_FOUND');

      const trips = await unsettledFor(rider.id);
      if (trips.length === 0) {
        throw new AppError('This partner has no unsettled trips.', 409, 'NOTHING_TO_SETTLE');
      }

      const tripEarnings = Math.round(trips.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100;
      const incentives = Array.from(memoryStore.riderIncentives.values())
        .filter((i: any) => i.riderId === rider.id && !i.payoutId)
        .reduce((t: number, i: any) => t + (Number(i.amount) || 0), 0);
      const bonuses = Number(req.body.bonuses) || 0;
      const deductions = Number(req.body.deductions) || rider.codCashInHand || 0;
      const netAmount = Math.round((tripEarnings + incentives + bonuses - deductions) * 100) / 100;

      const periodStart = trips.reduce(
        (earliest, o) => (new Date(o.deliveredAt || o.createdAt) < new Date(earliest) ? o.deliveredAt || o.createdAt : earliest),
        trips[0].deliveredAt || trips[0].createdAt
      );

      const payout = await payoutRepository.create({
        riderId: rider.id,
        riderName: rider.fullName,
        driverCode: rider.driverCode,
        periodStart,
        periodEnd: new Date().toISOString(),
        tripsCompleted: trips.length,
        tripEarnings,
        incentives: Math.round(incentives * 100) / 100,
        bonuses,
        deductions,
        netAmount,
        note: req.body.note
      });

      for (const trip of trips) {
        trip.payoutId = payout.id;
        memoryStore.orders.set(trip.id, trip);
      }
      triggerAutoSave();

      recordAudit(req, {
        action: 'PAYOUT_DRAFTED',
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary: `Drafted a payout of Rs ${netAmount} for ${rider.fullName} covering ${trips.length} trip(s)`,
        after: payout
      });

      res.status(201).json({ success: true, data: { payout } });
    } catch (err) {
      next(err);
    }
  }
);

const PayoutStatusSchema = z.object({
  status: z.enum(['PROCESSING', 'PAID', 'FAILED']),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional()
});

/**
 * POST /api/admin/payouts/:id/status
 *
 * Marking a payout PAID credits the rider's wallet and clears the COD cash that
 * was deducted from it, because that cash has now been settled against earnings.
 * A FAILED payout releases its trips so the next draft picks them up again.
 */
financeRoutes.post(
  '/payouts/:id/status',
  requirePermission('finance.payouts.manage'),
  validate({ body: PayoutStatusSchema }),
  async (req, res, next) => {
    try {
      const payout = await payoutRepository.findById(req.params.id);
      if (!payout) throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
      if (payout.status === 'PAID') {
        throw new AppError('This payout has already been paid.', 409, 'ALREADY_PAID');
      }

      const { status, reference, note } = req.body;
      const rider = await riderRepository.findById(payout.riderId);

      if (status === 'PAID' && rider) {
        if (payout.netAmount > 0) {
          await walletRepository.credit(
            rider.userId,
            payout.netAmount,
            `Payout ${payout.id} for ${payout.tripsCompleted} trip(s)`
          );
        }
        if (payout.deductions > 0) {
          await riderRepository.adjustCashInHand(rider.id, -payout.deductions);
        }
      }

      if (status === 'FAILED') {
        for (const order of memoryStore.orders.values()) {
          if (order.payoutId === payout.id) {
            delete order.payoutId;
            memoryStore.orders.set(order.id, order);
          }
        }
        triggerAutoSave();
      }

      const updated = await payoutRepository.setStatus(payout.id, status, { userId: req.user!.id }, { reference, note });

      recordAudit(req, {
        action: `PAYOUT_${status}`,
        entityType: 'PAYOUT',
        entityId: payout.id,
        summary: `Payout of Rs ${payout.netAmount} to ${payout.riderName} marked ${status}${
          reference ? ` (ref ${reference})` : ''
        }`,
        before: { status: payout.status },
        after: { status }
      });

      res.json({ success: true, data: { payout: updated } });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/reports/financial — a period summary for export. */
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
  return orders.filter(o => o.status === 'DELIVERED' && !o.settlementId);
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
        const pending = Math.round(shares.reduce((t, s) => t + s.net, 0) * 100) / 100;
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
          paidToDate: await settlementRepository.paidTotal(restaurant.id),
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
      const adjustments = Number(req.body.adjustments) || 0;
      const netAmount = Math.round((grossSales - commission - tds - adjustments) * 100) / 100;

      if (netAmount < 0) {
        throw new AppError('Deductions exceed the amount outstanding.', 400, 'NEGATIVE_SETTLEMENT');
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
