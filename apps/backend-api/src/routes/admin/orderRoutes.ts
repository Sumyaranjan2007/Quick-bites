/**
 * Every order on the platform, the full file on any one of them, and the live
 * deliveries currently in flight.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { orderService } from '../../modules/orders/orderService.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { LIVE_STATUSES, IN_TRANSIT_STATUSES, economicsOf } from '../../modules/admin/analytics.ts';
import { shapeOrderDetail, summariseOrder, matchesQuery, paginate } from './shared.ts';
import { memoryStore } from '../../db/client.ts';
import { findCancellationReason } from '../../modules/orders/cancellationReasons.ts';
import { takeTripOffRider, reassignTrip, deliverByOperations } from '../../modules/orders/opsRescue.ts';
import type { Order, OrderStatus } from '@quick-bites/shared-types';

export const orderRoutes = Router();

/**
 * GET /api/admin/orders
 *
 * Filterable by status, payment, restaurant, rider, customer, date window and a
 * free-text search over order number, customer, restaurant and rider. Paged,
 * because "every order ever placed" is not a screen.
 */
orderRoutes.get('/orders', requirePermission('orders.view'), async (req, res, next) => {
  try {
    const {
      status,
      paymentStatus,
      restaurantId,
      riderId,
      customerId,
      from,
      to,
      q,
      page,
      pageSize
    } = req.query as Record<string, string>;

    let orders = (await orderRepository.listAll()) as Order[];

    if (status && status !== 'ALL') {
      const wanted = new Set(status.split(',').map(s => s.trim().toUpperCase()));
      orders = orders.filter(o => wanted.has(o.status));
    }
    if (paymentStatus && paymentStatus !== 'ALL') {
      orders = orders.filter(o => o.paymentStatus === paymentStatus.toUpperCase());
    }
    if (restaurantId) orders = orders.filter(o => o.restaurantId === restaurantId);
    if (riderId) orders = orders.filter(o => o.riderId === riderId);
    if (customerId) orders = orders.filter(o => o.customerId === customerId);
    if (from) {
      const since = new Date(from).getTime();
      orders = orders.filter(o => new Date(o.createdAt).getTime() >= since);
    }
    if (to) {
      // Inclusive of the whole end day: an operator asking for "to the 14th"
      // means through the end of the 14th, not up to midnight at its start.
      const until = new Date(to).getTime() + 86_399_999;
      orders = orders.filter(o => new Date(o.createdAt).getTime() <= until);
    }
    if (q) {
      orders = orders.filter(o =>
        matchesQuery(q, o.orderNumber, o.customerName, o.restaurantName, o.riderName, o.id)
      );
    }

    const { rows, pagination } = paginate(orders, Number(page) || 1, Number(pageSize) || 25);
    const totals = orders.reduce(
      (acc, order) => {
        acc.value += Number(order.bill?.totalAmount) || 0;
        if (order.status === 'DELIVERED') acc.delivered += 1;
        if (order.status === 'CANCELLED') acc.cancelled += 1;
        return acc;
      },
      { value: 0, delivered: 0, cancelled: 0 }
    );

    res.json({
      success: true,
      data: {
        orders: rows.map(summariseOrder),
        pagination,
        totals: { ...totals, value: Math.round(totals.value * 100) / 100 }
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/orders/:id — the complete file on one order. */
orderRoutes.get('/orders/:id', requirePermission('orders.detail.view'), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    res.json({ success: true, data: await shapeOrderDetail(order) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/deliveries/live
 *
 * Active trips with the rider's last known position, so the console can draw a
 * map and see which orders are late without opening each one.
 */
orderRoutes.get('/deliveries/live', requirePermission('orders.deliveries.manage', 'orders.view'), async (_req, res, next) => {
  try {
    const orders = (await orderRepository.listAll()) as Order[];
    const live = orders.filter(o => LIVE_STATUSES.has(o.status));
    const now = Date.now();

    const deliveries = live.map(order => {
      const rider = order.riderId ? memoryStore.riders.get(order.riderId) : null;
      const minutesSincePlaced = Math.round((now - new Date(order.createdAt).getTime()) / 60_000);
      return {
        ...summariseOrder(order),
        riderStage: order.riderStage,
        riderPhone: order.riderPhone,
        riderCoordinates: order.riderCoordinates || rider?.currentCoordinates || null,
        riderLocationUpdatedAt: order.riderLocationUpdatedAt,
        deliveryCoordinates: order.deliveryCoordinates,
        deliveryAddressText: order.deliveryAddressText,
        restaurantCoordinates: order.restaurantCoordinates,
        restaurantAddressText: order.restaurantAddressText,
        preparationMinutes: order.preparationMinutes,
        minutesSincePlaced,
        // Surfaced as a flag rather than left for the reader to work out, so the
        // screen can sort the ones that need attention to the top.
        isDelayed: minutesSincePlaced > 45 && order.status !== 'DELIVERED',
        isUnassigned: !order.riderId,
        inTransit: IN_TRANSIT_STATUSES.has(order.status)
      };
    });

    deliveries.sort((a, b) => Number(b.isDelayed) - Number(a.isDelayed) || b.minutesSincePlaced - a.minutesSincePlaced);

    res.json({
      success: true,
      data: {
        deliveries,
        summary: {
          total: deliveries.length,
          inTransit: deliveries.filter(d => d.inTransit).length,
          unassigned: deliveries.filter(d => d.isUnassigned).length,
          delayed: deliveries.filter(d => d.isDelayed).length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/*
 * Kept in step with OrderStatus by hand, and it will not warn if it drifts.
 *
 * `z.enum` takes string literals, so removing a status from OrderStatus does
 * not fail here - the entry simply becomes a value an administrator can send
 * that nothing downstream accepts, or a real status they can no longer set.
 * Neither produces an error; both produce a support ticket. Anything added to
 * OrderStatus has to be added here too.
 */
const StatusSchema = z.object({
  status: z.enum([
    'PAYMENT_PENDING',
    'ORDER_PLACED',
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'HANDED_TO_RIDER',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED'
  ]),
  reason: z.string().trim().max(300).optional(),
  preparationMinutes: z.number().int().positive().max(180).optional()
});

/**
 * PUT /api/admin/orders/:id/status
 *
 * Support moving an order on when the partner cannot — a tablet that died mid
 * service, a rider who handed over without marking it. It goes through the same
 * state machine as the partner's own action, so an administrator cannot put an
 * order into a state the rest of the platform does not understand.
 */
orderRoutes.put(
  '/orders/:id/status',
  requirePermission('orders.status.update'),
  validate({ body: StatusSchema }),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.params.id);
      if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

      const before = order.status;
      const updated = await orderService.transitionStatus(
        order.id,
        req.body.status as OrderStatus,
        req.body.preparationMinutes
      );

      recordAudit(req, {
        action: 'ORDER_STATUS_OVERRIDE',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Moved order #${order.orderNumber} from ${before} to ${req.body.status}${
          req.body.reason ? ` — ${req.body.reason}` : ''
        }`,
        before: { status: before },
        after: { status: req.body.status }
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

const CancelSchema = z.object({
  reason: z.string().trim().min(3, 'Record why the order was cancelled.').max(300),
  refund: z.boolean().optional(),
  /**
   * Optional here, unlike on the customer and partner paths.
   *
   * Operations cancel for reasons that do not fit a fixed list — a fraud
   * investigation, a duplicate, a request over the phone — and the free-text
   * reason above is already mandatory. But a cancellation with no code at all
   * is invisible to every report that counts why orders are lost, so one is
   * recorded either way: the chosen code, or OTHER.
   */
  reasonCode: z.string().min(1).max(64).optional()
});

/**
 * POST /api/admin/orders/:id/cancel
 *
 * Cancels and, when asked, returns the money in the same step. A cancellation
 * that leaves a paid customer to chase their own refund is the complaint this
 * exists to prevent, so the two are one action.
 */
orderRoutes.post(
  '/orders/:id/cancel',
  requirePermission('orders.cancel'),
  validate({ body: CancelSchema }),
  async (req, res, next) => {
    try {
      const order = await orderRepository.findById(req.params.id);
      if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
      if (order.status === 'DELIVERED') {
        throw new AppError(
          'This order was already delivered. Raise a refund against it instead.',
          409,
          'ORDER_ALREADY_DELIVERED'
        );
      }
      if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
        throw new AppError('This order is already closed.', 409, 'ORDER_ALREADY_CLOSED');
      }

      const before = order.status;

      /*
       * THROUGH THE ONE CANCELLATION, AND THIS WAS A THIRD IMPLEMENTATION.
       *
       * What used to be here set the status by hand and then credited
       * `walletRepository` — the customer wallet that no longer exists and that
       * nobody can spend. It marked the order REFUNDED, told the customer their
       * money was back, and posted NOTHING to the ledger. No gateway refund, no
       * refund case, no push to the customer or the kitchen.
       *
       * So an administrator cancelling a paid order produced exactly the lie
       * `refunds.ts` was written to make impossible: a green tick over money that
       * had not moved. The money stayed at the gateway, no record said it was
       * owed, and the one screen anybody would look at said the refund was done.
       *
       * `orderService.cancelOrder` is the path the customer and partner apps use.
       * It validates the transition, refunds by the route the ORDER dictates,
       * opens a case that stays open when the money does not move, tells the
       * kitchen and the customer, and writes the ledger entries. Delegating to it
       * is the fix; nothing here needs to know how a refund works.
       *
       * The specific guards above are kept rather than left to
       * `validateTransition`, because "raise a refund against it instead" is a
       * sentence somebody can act on and a transition error is not.
       */
      const reasonCode = findCancellationReason(req.body.reasonCode || '')?.code ?? 'OTHER';
      const result = await orderService.cancelOrder(
        order.id,
        {
          userId: req.user!.id,
          name: req.user?.fullName || 'admin',
          role: (req.user?.role || 'admin') as any
        },
        reasonCode,
        req.body.reason
      );

      /*
       * `refund` is no longer conditional on the request asking for one.
       *
       * The old flag let a cancellation of a PAID order be recorded with no
       * refund at all, which is not a decision anybody should be able to make in
       * a checkbox: the customer's money is theirs. Every paid order is refunded.
       * The field stays in the response because the admin app reads it.
       */
      const refund = result.refund ? { amount: result.refund.amount, status: result.refund.status } : null;

      recordAudit(req, {
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Cancelled order #${order.orderNumber}: ${req.body.reason}${
          refund ? ` (refund ${refund.status}, Rs ${refund.amount})` : ''
        }`,
        before: { status: before },
        after: { status: result.order?.status }
      });

      res.json({ success: true, data: { order: result.order, refund } });
    } catch (err) {
      next(err);
    }
  }
);

/* ---------------------------------------------------------------------- *
 *  A trip gone wrong on the road (A1, A2, A3). The rules are in opsRescue. *
 * ---------------------------------------------------------------------- */
const opsActor = (req: any) => ({ userId: req.user!.id, name: req.user?.fullName || 'Operations' });

const UnassignSchema = z.object({
  reason: z.string().trim().min(3, 'Record why the trip was taken off the rider.').max(300),
  countAsNoShow: z.boolean().optional()
});

/** POST /api/admin/orders/:id/unassign-rider — A1, before pickup only. */
orderRoutes.post(
  '/orders/:id/unassign-rider',
  requirePermission('orders.deliveries.manage'),
  validate({ body: UnassignSchema }),
  async (req, res, next) => {
    try {
      const before = (await orderRepository.findById(req.params.id))?.riderName;
      const order = await takeTripOffRider(req.params.id, opsActor(req), req.body);
      recordAudit(req, {
        action: 'ORDER_RIDER_UNASSIGNED',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Took order #${order.orderNumber} off ${before || 'the rider'} — ${req.body.reason}`,
        before: { rider: before },
        after: { rider: null }
      });
      res.json({ success: true, data: order, message: 'Trip taken off the rider and offered again.' });
    } catch (err) {
      next(err);
    }
  }
);

const ReassignSchema = z.object({
  riderId: z.string().min(1, 'Choose the rider to give this trip to.'),
  reason: z.string().trim().min(3, 'Record why the trip is being moved.').max(300),
  handoverNote: z.string().trim().max(300).optional()
});

/** POST /api/admin/orders/:id/reassign-rider — A2, before or after pickup. */
orderRoutes.post(
  '/orders/:id/reassign-rider',
  requirePermission('orders.deliveries.manage'),
  validate({ body: ReassignSchema }),
  async (req, res, next) => {
    try {
      const before = (await orderRepository.findById(req.params.id))?.riderName;
      const order = await reassignTrip(req.params.id, opsActor(req), req.body);
      recordAudit(req, {
        action: 'ORDER_RIDER_REASSIGNED',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Gave order #${order.orderNumber} from ${before || 'nobody'} to ${order.riderName} — ${req.body.reason}`,
        before: { rider: before },
        after: { rider: order.riderName, handoverNote: req.body.handoverNote }
      });
      res.json({ success: true, data: order, message: `Trip given to ${order.riderName}.` });
    } catch (err) {
      next(err);
    }
  }
);

const OpsDeliverSchema = z.object({
  reason: z.string().trim().min(5, 'Record how you confirmed the customer has the food.').max(300),
  cashCollectedBy: z.enum(['RIDER', 'NONE']).optional()
});

/** POST /api/admin/orders/:id/mark-delivered — A3, the customer cannot read their code. */
orderRoutes.post(
  '/orders/:id/mark-delivered',
  requirePermission('orders.status.update'),
  validate({ body: OpsDeliverSchema }),
  async (req, res, next) => {
    try {
      const result = await deliverByOperations(req.params.id, opsActor(req), req.body);
      recordAudit(req, {
        action: result.outcome === 'DELIVERED' ? 'ORDER_DELIVERED_BY_OPERATIONS' : 'ORDER_COD_REFUSED',
        entityType: 'ORDER',
        entityId: result.order.id,
        summary:
          result.outcome === 'DELIVERED'
            ? `Marked order #${result.order.orderNumber} delivered — ${req.body.reason}`
            : `Closed order #${result.order.orderNumber}: cash refused at the door — ${req.body.reason}`,
        before: { status: 'OUT_FOR_DELIVERY' },
        after: { status: result.order.status, cashCollectedBy: req.body.cashCollectedBy }
      });
      res.json({
        success: true,
        data: result,
        message:
          result.outcome === 'DELIVERED'
            ? 'Marked delivered.'
            : 'Closed as refused. A case was opened for the kitchen\'s loss.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/orders/:id/economics — the money split for one order. */
orderRoutes.get('/orders/:id/economics', requirePermission('finance.payments.view'), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    res.json({ success: true, data: { orderId: order.id, bill: order.bill, economics: economicsOf(order) } });
  } catch (err) {
    next(err);
  }
});
