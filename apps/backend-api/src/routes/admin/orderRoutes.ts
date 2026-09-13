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
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { orderService } from '../../modules/orders/orderService.ts';
import { emitOrderStatusUpdate } from '../../sockets/socketServer.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { LIVE_STATUSES, IN_TRANSIT_STATUSES, economicsOf } from '../../modules/admin/analytics.ts';
import { shapeOrderDetail, summariseOrder, matchesQuery, paginate } from './shared.ts';
import { memoryStore } from '../../db/client.ts';
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

const StatusSchema = z.object({
  status: z.enum([
    'PAYMENT_PENDING',
    'ORDER_PLACED',
    'ACCEPTED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'RIDER_ASSIGNED',
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
  refund: z.boolean().optional()
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
      order.status = 'CANCELLED';
      order.cancellationReason = req.body.reason;
      order.cancelledAt = new Date().toISOString();
      order.updatedAt = order.cancelledAt;
      memoryStore.orders.set(order.id, order);

      // A rider already on the trip has to be released, or dispatch keeps
      // believing they are busy and stops offering them work.
      if (order.riderId) {
        await riderRepository.update(order.riderId, {});
      }

      let refund: { amount: number } | null = null;
      if (req.body.refund && order.paymentStatus === 'PAID') {
        const { walletRepository } = await import('../../db/repositories/walletRepository.ts');
        const amount = Number(order.bill?.totalAmount) || 0;
        await walletRepository.credit(
          order.customerId,
          amount,
          `Refund for cancelled order #${order.orderNumber}: ${req.body.reason}`,
          order.id
        );
        order.paymentStatus = 'REFUNDED';
        order.status = 'REFUNDED';
        memoryStore.orders.set(order.id, order);
        refund = { amount };
      }

      emitOrderStatusUpdate(order.id, {
        orderId: order.id,
        status: order.status,
        updatedAt: order.updatedAt
      });

      recordAudit(req, {
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: order.id,
        summary: `Cancelled order #${order.orderNumber}: ${req.body.reason}${
          refund ? ` (refunded Rs ${refund.amount})` : ''
        }`,
        before: { status: before },
        after: { status: order.status }
      });

      res.json({ success: true, data: { order, refund } });
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
