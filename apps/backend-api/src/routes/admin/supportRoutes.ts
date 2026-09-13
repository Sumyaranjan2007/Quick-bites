/**
 * Support: complaints raised from the customer, partner and rider apps, and the
 * emergency alerts riders send from the road.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { supportRepository } from '../../db/repositories/supportRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { shapeOrderDetail } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';

export const supportRoutes = Router();

/** GET /api/admin/support/tickets — the complaint queue, oldest open first. */
supportRoutes.get('/support/tickets', requirePermission('support.tickets.view'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'ALL').toUpperCase();
    const tickets = await supportRepository.list(status === 'ALL' ? {} : { status: status as any });
    res.json({
      success: true,
      data: {
        tickets,
        counts: {
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
    res.json({ success: true, data: { ticket, order: order ? await shapeOrderDetail(order) : null } });
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
      recordAudit(req, {
        action: 'TICKET_REPLIED',
        entityType: 'SUPPORT_TICKET',
        entityId: ticket.id,
        summary: `Replied to "${ticket.subject}" from ${ticket.raisedByName}`
      });
      res.json({ success: true, data: { ticket } });
    } catch (err) {
      next(err);
    }
  }
);

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
      const ticket = await supportRepository.setStatus(req.params.id, req.body.status, { userId: req.user!.id });
      if (!ticket) throw new AppError('Support ticket not found.', 404, 'TICKET_NOT_FOUND');
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
      res.json({ success: true, data: { ticket } });
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
