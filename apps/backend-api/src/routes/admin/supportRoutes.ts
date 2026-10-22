/**
 * Support: complaints raised from the customer, partner and rider apps, and the
 * emergency alerts riders send from the road.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { supportRepository, withChatFields } from '../../db/repositories/supportRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { shapeOrderDetail } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';

export const supportRoutes = Router();

/** Who is asking, at a glance (owner, 20 Oct): their kitchen(s) or rider code. */
function raiserOf(userId: string) {
  const kitchens = [...memoryStore.restaurants.values()].filter((r: any) => r.ownerId === userId).map((r: any) => r.name);
  const rider: any = [...memoryStore.riders.values()].find((r: any) => r.userId === userId);
  return { kitchens, riderCode: rider?.driverCode || rider?.id || null };
}

const ACTIVE = ['OPEN', 'IN_PROGRESS'];

/**
 * GET /api/admin/support/tickets — the chats. `status=ACTIVE` (round 6) is every open chat,
 * unread first, then the longest-waiting; the old values still work for older Operations apps.
 */
supportRoutes.get('/support/tickets', requirePermission('support.tickets.view'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'ALL').toUpperCase();
    const rows = await supportRepository.list(status === 'ALL' || status === 'ACTIVE' ? {} : { status: status as any });
    const tickets = rows
      .filter(t => status !== 'ACTIVE' || ACTIVE.includes(t.status))
      .map(t => {
        const last = t.replies[t.replies.length - 1];
        return { ...withChatFields(t), preview: String(last?.body ?? t.message).slice(0, 80), ...raiserOf(t.raisedByUserId) };
      });
    if (status === 'ACTIVE') {
      // Unread first; then chats waiting on Operations, longest wait first; then the rest, newest first.
      const waiting = (t: { lastMessageBy: string }) => (t.lastMessageBy === 'USER' ? 0 : 1);
      tickets.sort(
        (a, b) =>
          Number(b.unreadForStaff) - Number(a.unreadForStaff) ||
          waiting(a) - waiting(b) ||
          (waiting(a) === 0 ? a.lastMessageAt.localeCompare(b.lastMessageAt) : b.lastMessageAt.localeCompare(a.lastMessageAt))
      );
    }
    res.json({
      success: true,
      data: {
        tickets,
        counts: {
          unread: tickets.filter(t => t.unreadForStaff && ACTIVE.includes(t.status)).length,
          active: tickets.filter(t => ACTIVE.includes(t.status)).length,
          open: tickets.filter(t => t.status === 'OPEN').length,
          inProgress: tickets.filter(t => t.status === 'IN_PROGRESS').length,
          resolved: tickets.filter(t => t.status === 'RESOLVED').length,
          closed: tickets.filter(t => t.status === 'CLOSED').length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/support/tickets/:id — the case, with the order it is about. */
supportRoutes.get('/support/tickets/:id', requirePermission('support.tickets.view'), async (req, res, next) => {
  try {
    const ticket = await supportRepository.findById(req.params.id);
    if (!ticket) throw new AppError('Support ticket not found.', 404, 'TICKET_NOT_FOUND');
    const order = ticket.orderId ? await orderRepository.findById(ticket.orderId) : null;
    const earlier = (await supportRepository.listByUser(ticket.raisedByUserId)).filter(t => t.id !== ticket.id).length;
    // Their People record ("Open profile", round 6), by the app they wrote from.
    const kitchen: any = ticket.raisedByRole === 'restaurant_owner' ? [...memoryStore.restaurants.values()].find((r: any) => r.ownerId === ticket.raisedByUserId) : null;
    const riderRecord: any = ticket.raisedByRole === 'rider' ? [...memoryStore.riders.values()].find((r: any) => r.userId === ticket.raisedByUserId) : null;
    const record = kitchen
      ? { kind: 'restaurant', id: kitchen.id }
      : riderRecord
        ? { kind: 'rider', id: riderRecord.id }
        : { kind: 'customer', id: ticket.raisedByUserId };
    res.json({
      success: true,
      data: {
        ticket: withChatFields(ticket),
        order: order ? await shapeOrderDetail(order) : null,
        raiser: { ...raiserOf(ticket.raisedByUserId), earlierRequests: earlier, record }
      }
    });
  } catch (err) {
    next(err);
  }
});

const ReplySchema = z.object({ body: z.string().trim().min(1).max(2000) });

supportRoutes.post(
  '/support/tickets/:id/reply',
  requirePermission('support.tickets.manage'),
  validate({ body: ReplySchema }),
  async (req, res, next) => {
    try {
      const ticket = await supportRepository.reply(
        req.params.id,
        { userId: req.user!.id, name: req.user!.fullName || 'Quick Bites Support', role: req.user!.role },
        req.body.body
      );
      if (!ticket) throw new AppError('Support ticket not found.', 404, 'TICKET_NOT_FOUND');
      // The reply lands in the person's help thread; tell them it is there. The
      // body stays out of the push: a lock screen is not the place for it.
      void fcmDispatcher.sendPushNotification({
        userId: ticket.raisedByUserId,
        title: 'Quick Bites support replied',
        body: `About "${ticket.subject}". Open Help to read it.`,
        androidChannelId: ticket.raisedByRole === 'customer' ? 'order-updates' : undefined,
        // Only the app the chat is in (round 6): a partner who is also a customer hears it once.
        appRole: ticket.raisedByRole,
        data: { type: 'SUPPORT_REPLY', ticketId: ticket.id }
      });
      recordAudit(req, {
        action: 'TICKET_REPLIED',
        entityType: 'SUPPORT_TICKET',
        entityId: ticket.id,
        summary: `Replied to "${ticket.subject}" from ${ticket.raisedByName}`
      });
      res.json({ success: true, data: { ticket: withChatFields(ticket) } });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/admin/support/tickets/:id/read — Operations has seen the chat (the person sees "Seen"). */
supportRoutes.post('/support/tickets/:id/read', requirePermission('support.tickets.view'), async (req, res, next) => {
  try {
    const ticket = await supportRepository.markRead(req.params.id, 'STAFF');
    if (!ticket) throw new AppError('Support ticket not found.', 404, 'TICKET_NOT_FOUND');
    res.json({ success: true, data: { ticket: withChatFields(ticket) } });
  } catch (err) {
    next(err);
  }
});

const TicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional()
});

supportRoutes.post(
  '/support/tickets/:id/status',
  requirePermission('support.tickets.manage'),
  validate({ body: TicketStatusSchema }),
  async (req, res, next) => {
    try {
      const before = (await supportRepository.findById(req.params.id))?.status;
      const ticket = await supportRepository.setStatus(req.params.id, req.body.status, { userId: req.user!.id });
      if (!ticket) throw new AppError('Support ticket not found.', 404, 'TICKET_NOT_FOUND');
      // Solved by Operations: the person is told, in the app the chat is in (round 6).
      if ((req.body.status === 'RESOLVED' || req.body.status === 'CLOSED') && ACTIVE.includes(String(before))) {
        void fcmDispatcher.sendPushNotification({
          userId: ticket.raisedByUserId,
          title: 'Your help chat is marked solved',
          body: 'Tap to read it, or write again any time.',
          androidChannelId: ticket.raisedByRole === 'customer' ? 'order-updates' : undefined,
          appRole: ticket.raisedByRole,
          data: { type: 'SUPPORT_RESOLVED', ticketId: ticket.id }
        });
      }
      if (req.body.priority) {
        ticket.priority = req.body.priority;
        memoryStore.supportTickets.set(ticket.id, ticket);
        triggerAutoSave();
      }
      recordAudit(req, {
        action: `TICKET_${req.body.status}`,
        entityType: 'SUPPORT_TICKET',
        entityId: ticket.id,
        summary: `Marked "${ticket.subject}" as ${req.body.status}`
      });
      res.json({ success: true, data: { ticket: withChatFields(ticket) } });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/sos — rider emergency alerts, open ones first. */
supportRoutes.get('/sos', requirePermission('support.tickets.view', 'users.drivers.view'), async (_req, res, next) => {
  try {
    const alerts = Array.from(memoryStore.sosAlerts.values()).sort((a: any, b: any) => {
      const rank = (s: string) => (s === 'OPEN' ? 0 : s === 'ACKNOWLEDGED' ? 1 : 2);
      return rank(a.status) - rank(b.status) || new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime();
    });
    res.json({ success: true, data: { alerts, open: alerts.filter((a: any) => a.status === 'OPEN').length } });
  } catch (err) {
    next(err);
  }
});

const SosStatusSchema = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']), note: z.string().trim().max(300).optional() });

supportRoutes.post(
  '/sos/:id/status',
  requirePermission('support.tickets.manage', 'users.drivers.manage'),
  validate({ body: SosStatusSchema }),
  async (req, res, next) => {
    try {
      const alert = memoryStore.sosAlerts.get(req.params.id);
      if (!alert) throw new AppError('Alert not found.', 404, 'SOS_NOT_FOUND');

      alert.status = req.body.status;
      if (req.body.status === 'ACKNOWLEDGED') alert.acknowledgedAt = new Date().toISOString();
      if (req.body.status === 'RESOLVED') alert.resolvedAt = new Date().toISOString();
      if (req.body.note) alert.note = `${alert.note ? `${alert.note}\n` : ''}${req.body.note}`;
      memoryStore.sosAlerts.set(alert.id, alert);
      triggerAutoSave();

      recordAudit(req, {
        action: `SOS_${req.body.status}`,
        entityType: 'SOS_ALERT',
        entityId: alert.id,
        summary: `${req.body.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'} the SOS from ${alert.riderName}`
      });

      res.json({ success: true, data: { alert } });
    } catch (err) {
      next(err);
    }
  }
);
