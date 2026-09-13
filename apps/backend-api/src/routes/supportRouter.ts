/**
 * Support as the apps see it.
 *
 * The customer, partner and rider apps had a help screen that only listed FAQs:
 * a complaint typed there went nowhere, and no administrator ever saw it. These
 * routes give that screen somewhere to post, and are the other end of the
 * support queue in the admin console.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { supportRepository } from '../db/repositories/supportRepository.ts';
import { refundRepository } from '../db/repositories/refundRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';

export const supportRouter = Router();

supportRouter.use(authMiddleware());

const TicketSchema = z.object({
  subject: z.string().trim().min(3, 'Say briefly what the problem is.').max(140),
  category: z.enum(['ORDER', 'PAYMENT', 'DELIVERY', 'ACCOUNT', 'RESTAURANT', 'OTHER']),
  message: z.string().trim().min(10, 'Describe the problem so support can act on it.').max(2000),
  orderId: z.string().optional(),
  attachments: z.array(z.string().max(400000)).max(4).optional()
});

/** POST /api/support/tickets — raise a complaint from any of the apps. */
supportRouter.post('/tickets', validate({ body: TicketSchema }), async (req, res, next) => {
  try {
    const user = await userRepository.findById(req.user!.id);
    let orderNumber: string | undefined;

    if (req.body.orderId) {
      const order = await orderRepository.findById(req.body.orderId);
      if (!order) throw new AppError('That order could not be found.', 404, 'ORDER_NOT_FOUND');
      // A ticket can only be attached to an order the person was part of,
      // otherwise an order id guessed from a URL exposes someone else's order
      // number and restaurant to a stranger's complaint thread.
      const involved =
        order.customerId === req.user!.id ||
        order.riderId === req.user!.id ||
        (await orderRepository.listByRiderId(req.user!.id)).some(o => o.id === order.id);
      if (!involved && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        throw new AppError('You can only raise a ticket about your own order.', 403, 'NOT_YOUR_ORDER');
      }
      orderNumber = order.orderNumber;
    }

    const ticket = await supportRepository.create({
      raisedByUserId: req.user!.id,
      raisedByRole: req.user!.role,
      raisedByName: user?.fullName || req.user!.fullName,
      contactPhone: user?.phone,
      orderId: req.body.orderId,
      orderNumber,
      subject: req.body.subject,
      category: req.body.category,
      message: req.body.message,
      attachments: req.body.attachments || [],
      // A complaint about an order in flight is time-critical in a way an
      // account question is not.
      priority: req.body.category === 'DELIVERY' || req.body.category === 'ORDER' ? 'HIGH' : 'NORMAL'
    });

    res.status(201).json({
      success: true,
      data: { ticket },
      message: 'Our support team has your request and will reply shortly.'
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/support/tickets — the signed-in user's own tickets. */
supportRouter.get('/tickets', async (req, res, next) => {
  try {
    res.json({ success: true, data: { tickets: await supportRepository.listByUser(req.user!.id) } });
  } catch (err) {
    next(err);
  }
});

const ReplySchema = z.object({ body: z.string().trim().min(1).max(2000) });

supportRouter.post('/tickets/:id/reply', validate({ body: ReplySchema }), async (req, res, next) => {
  try {
    const ticket = await supportRepository.findById(req.params.id);
    if (!ticket) throw new AppError('Ticket not found.', 404, 'TICKET_NOT_FOUND');
    if (ticket.raisedByUserId !== req.user!.id) {
      throw new AppError('You can only reply to your own ticket.', 403, 'NOT_YOUR_TICKET');
    }

    const updated = await supportRepository.reply(
      ticket.id,
      { userId: req.user!.id, name: req.user!.fullName, role: req.user!.role },
      req.body.body
    );
    res.json({ success: true, data: { ticket: updated } });
  } catch (err) {
    next(err);
  }
});

const RefundRequestSchema = z.object({
  orderId: z.string().min(1),
  reasonCode: z.enum([
    'ITEM_MISSING',
    'WRONG_ITEM',
    'FOOD_QUALITY',
    'SPILLED_DAMAGED',
    'LATE_DELIVERY',
    'NEVER_ARRIVED',
    'RIDER_ISSUE',
    'PAYMENT_ISSUE',
    'OTHER'
  ]),
  description: z.string().trim().min(10, 'Describe what went wrong.').max(1000),
  requestedAmount: z.number().positive().max(1000000).optional(),
  attachments: z.array(z.string().max(400000)).max(4).optional()
});

/**
 * POST /api/support/refund-requests
 *
 * Opens a return/refund case. It does not move any money: the case goes into the
 * admin queue and is decided there. A customer describing a problem and a
 * platform agreeing to pay for it are two different events, and conflating them
 * is how a refund gets issued for something nobody checked.
 */
supportRouter.post('/refund-requests', validate({ body: RefundRequestSchema }), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.body.orderId);
    if (!order) throw new AppError('That order could not be found.', 404, 'ORDER_NOT_FOUND');

    // The customer is identified by their user id; a rider is identified by
    // their rider id, which is not the same value, so that has to be looked up.
    if (order.customerId !== req.user!.id) {
      const rider = await riderRepository.findByUserId(req.user!.id);
      if (!rider || rider.id !== order.riderId) {
        throw new AppError('You can only raise a request about your own order.', 403, 'NOT_YOUR_ORDER');
      }
    }

    if (order.status === 'PAYMENT_PENDING') {
      throw new AppError('This order was never paid for, so there is nothing to refund.', 409, 'ORDER_UNPAID');
    }

    const existing = (await refundRepository.listByOrder(order.id)).find(
      r => r.status !== 'REJECTED' && r.status !== 'REFUNDED'
    );
    if (existing) {
      throw new AppError(
        'A request for this order is already open. Support will come back to you on it.',
        409,
        'REQUEST_ALREADY_OPEN'
      );
    }

    const total = Number(order.bill?.totalAmount) || 0;
    const requested = req.body.requestedAmount ?? total;
    if (requested > total) {
      throw new AppError(`You cannot ask for more than the order total of Rs ${total}.`, 400, 'AMOUNT_TOO_HIGH');
    }

    const user = await userRepository.findById(req.user!.id);
    const request = await refundRepository.create({
      orderId: order.id,
      orderNumber: order.orderNumber,
      raisedByUserId: req.user!.id,
      raisedByRole: req.user!.role as any,
      raisedByName: user?.fullName || req.user!.fullName,
      customerId: order.customerId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurantName,
      riderId: order.riderId,
      riderName: order.riderName,
      reasonCode: req.body.reasonCode,
      description: req.body.description,
      attachments: req.body.attachments || [],
      requestedAmount: requested,
      orderTotal: total
    });

    res.status(201).json({
      success: true,
      data: { request },
      message: 'Your request has been received. Support will review it and get back to you.'
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/support/refund-requests — the signed-in user's own cases. */
supportRouter.get('/refund-requests', async (req, res, next) => {
  try {
    res.json({ success: true, data: { requests: await refundRepository.listByUser(req.user!.id) } });
  } catch (err) {
    next(err);
  }
});
