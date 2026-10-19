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
import { notifyAdminsSupportTicketOpened, notifyAdminsRefundRaised } from '../notifications/adminNotifier.ts';
import { refundableRemaining } from '../modules/payments/refundCap.ts';
import { askerFor, isPartyTo, topicsFor, topicFor, matchTopic, orderInQuestion, orderCard, answerFor, helpChatFor } from '../modules/support/helpChat.ts';
const round2 = (n: number) => Math.round(n * 100) / 100;

export const supportRouter = Router();

supportRouter.use(authMiddleware());

const TicketSchema = z.object({
  subject: z.string().trim().min(3, 'Say briefly what the problem is.').max(140),
  category: z.enum(['ORDER', 'PAYMENT', 'DELIVERY', 'ACCOUNT', 'RESTAURANT', 'OTHER']),
  message: z.string().trim().min(10, 'Describe the problem so support can act on it.').max(2000),
  orderId: z.string().optional(),
  attachments: z.array(z.string().max(400000)).max(4).optional(),
  // Help chat (B8): the topics the person went through before "Talk to us".
  // Only the ids: the answers are rebuilt here, never taken from the app.
  helpTopics: z.array(z.string().max(40)).max(10).optional(),
  appVersion: z.string().trim().max(40).optional(),
  platform: z.enum(['android', 'ios', 'web']).optional()
});

const HelpQuerySchema = z.object({ orderId: z.string().max(80).optional() });

/** GET /api/support/help — this app's help topics, with the order it was opened from. */
supportRouter.get('/help', validate({ query: HelpQuerySchema }), async (req, res, next) => {
  try {
    const asker = await askerFor(req.user!);
    const order = req.query.orderId ? await orderInQuestion(asker, String(req.query.orderId)) : null;
    const firstName = String(req.user!.fullName || '').trim().split(/\s+/)[0] || 'there';
    res.json({
      success: true,
      data: { audience: asker.audience, greeting: `Hi ${firstName}, what's this about?`, order: orderCard(order), topics: topicsFor(asker.audience) }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/support/help/:topic — the fixed answer, filled with the person's live data (Q3: no AI). */
supportRouter.get(
  '/help/:topic',
  validate({ params: z.object({ topic: z.string().max(40) }), query: HelpQuerySchema }),
  async (req, res, next) => {
    try {
      const asker = await askerFor(req.user!);
      const topic = topicFor(asker.audience, req.params.topic);
      const order = await orderInQuestion(asker, req.query.orderId ? String(req.query.orderId) : undefined);
      res.json({ success: true, data: { topic, answer: await answerFor(topic.id, asker, order), order: orderCard(order) } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/support/help/match — what the person typed, answered with the ready
 * answer it matches, or `topic: null` when a person should read it.
 */
supportRouter.post(
  '/help/match',
  validate({ body: z.object({ text: z.string().trim().min(1).max(2000), orderId: z.string().max(80).optional() }) }),
  async (req, res, next) => {
    try {
      const asker = await askerFor(req.user!);
      const topic = matchTopic(asker.audience, req.body.text);
      const order = topic ? await orderInQuestion(asker, req.body.orderId) : null;
      res.json({ success: true, data: { topic, answer: topic ? await answerFor(topic.id, asker, order) : null } });
    } catch (err) {
      next(err);
    }
  }
);

const TICKETS_PER_HOUR = 5;
const DOUBLE_TAP_MS = 2 * 60_000;

/** POST /api/support/tickets — raise a complaint from any of the apps. */
supportRouter.post('/tickets', validate({ body: TicketSchema }), async (req, res, next) => {
  try {
    const user = await userRepository.findById(req.user!.id);
    const asker = await askerFor(req.user!);
    let order = null;

    if (req.body.orderId) {
      order = await orderRepository.findById(req.body.orderId);
      if (!order) throw new AppError('That order could not be found.', 404, 'ORDER_NOT_FOUND');
      // A ticket can only be attached to an order the person was part of,
      // otherwise an order id guessed from a URL exposes someone else's order
      // number and restaurant to a stranger's complaint thread. Riders are
      // matched by their rider record and partners by the kitchens they own
      // (`isPartyTo`); comparing the user id refused every rider's own trip.
      if (!isPartyTo(order, asker) && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        throw new AppError('You can only raise a ticket about your own order.', 403, 'NOT_YOUR_ORDER');
      }
    }
    // The help chat was about the person's latest order when the app named none.
    if (req.body.helpTopics?.length && !order) order = await orderInQuestion(asker);
    const helpChat = req.body.helpTopics?.length ? await helpChatFor(req.body.helpTopics, asker, order) : undefined;

    const mine = await supportRepository.listByUser(req.user!.id);
    // A double tap on "Talk to us" is one question, not two tickets.
    const repeat = mine.find(t =>
      t.message === req.body.message && t.orderId === order?.id &&
      Date.now() - new Date(t.createdAt).getTime() < DOUBLE_TAP_MS);
    if (repeat) {
      res.json({ success: true, data: { ticket: repeat }, message: 'Our support team has your request and will reply shortly.' });
      return;
    }
    if (mine.filter(t => Date.now() - new Date(t.createdAt).getTime() < 3_600_000).length >= TICKETS_PER_HOUR) {
      throw new AppError(
        'You have raised several requests in the last hour. We will reply on those; you can add to one by replying.',
        429,
        'TOO_MANY_TICKETS'
      );
    }

    const ticket = await supportRepository.create({
      raisedByUserId: req.user!.id,
      raisedByRole: req.user!.role,
      raisedByName: user?.fullName || req.user!.fullName,
      contactPhone: user?.phone,
      orderId: order?.id,
      orderNumber: order?.orderNumber,
      helpChat,
      appVersion: req.body.appVersion,
      platform: req.body.platform,
      subject: req.body.subject,
      category: req.body.category,
      message: req.body.message,
      attachments: req.body.attachments || [],
      // A complaint about an order in flight is time-critical in a way an
      // account question is not.
      priority: req.body.category === 'DELIVERY' || req.body.category === 'ORDER' ? 'HIGH' : 'NORMAL'
    });

    void notifyAdminsSupportTicketOpened({
      ticketId: ticket.id,
      subjectLine: req.body.subject,
      raisedBy: user?.fullName || req.user!.fullName || 'Somebody'
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

/** GET /api/support/tickets/:id — one of the person's own tickets, with the replies (the chat polls it). */
supportRouter.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await supportRepository.findById(req.params.id);
    if (!ticket || ticket.raisedByUserId !== req.user!.id) throw new AppError('Ticket not found.', 404, 'TICKET_NOT_FOUND');
    res.json({ success: true, data: { ticket } });
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

/** POST /api/support/tickets/:id/resolve — "My issue is solved": only the person who raised it. */
supportRouter.post('/tickets/:id/resolve', async (req, res, next) => {
  try {
    const ticket = await supportRepository.findById(req.params.id);
    if (!ticket || ticket.raisedByUserId !== req.user!.id) throw new AppError('Ticket not found.', 404, 'TICKET_NOT_FOUND');
    res.json({ success: true, data: { ticket: await supportRepository.resolveByRaiser(ticket.id) } });
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
      // A case returning a duplicate payment is the platform's, not the customer's
      // complaint, and waiting on the gateway must not stop them raising one.
      r => r.status !== 'REJECTED' && r.status !== 'REFUNDED' && !r.duplicatePaymentId
    );
    if (existing) {
      throw new AppError(
        'A request for this order is already open. Support will come back to you on it.',
        409,
        'REQUEST_ALREADY_OPEN'
      );
    }

    const total = Number(order.bill?.totalAmount) || 0;
    // What has not already gone back. A second case on a refunded order is
    // how one order used to be refunded twice.
    const remaining = await refundableRemaining(order);
    if (remaining <= 0) {
      throw new AppError('This order has already been refunded in full.', 409, 'ALREADY_REFUNDED');
    }
    const requested = req.body.requestedAmount ?? remaining;
    if (requested > remaining) {
      throw new AppError(
        remaining < total
          ? `Rs ${round2(total - remaining)} of this order has already been refunded. You can ask for up to Rs ${remaining}.`
          : `You cannot ask for more than the order total of Rs ${total}.`,
        400,
        'AMOUNT_TOO_HIGH'
      );
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

    /*
     * The amount IS in this notification, unlike the kitchen push.
     *
     * Only `finance.refunds.manage` receives it, and everybody holding that sees
     * the figure on the screen this opens. Whether it is Rs 40 or Rs 4,000 is the
     * whole of what decides if it waits until morning, so withholding it would
     * make the notification useless to the only people who get it.
     */
    void notifyAdminsRefundRaised({
      requestId: request.id,
      orderNumber: order.orderNumber,
      amountLabel: `Rs ${requested}`
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
