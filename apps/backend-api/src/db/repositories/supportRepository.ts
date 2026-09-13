import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { SupportTicket, SupportTicketStatus } from '@quick-bites/shared-types';

/** Complaints and questions raised from any of the four apps. */
export const supportRepository = {
  async create(
    input: Omit<SupportTicket, 'id' | 'status' | 'replies' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<SupportTicket, 'priority'>>
  ): Promise<SupportTicket> {
    const now = new Date().toISOString();
    const ticket: SupportTicket = {
      id: `tkt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ...input,
      // After the spread, not before: a caller that passed no priority would
      // otherwise spread `undefined` over the default and leave the field unset.
      priority: input.priority || 'NORMAL',
      status: 'OPEN',
      replies: [],
      createdAt: now,
      updatedAt: now
    };
    memoryStore.supportTickets.set(ticket.id, ticket);
    triggerAutoSave();
    return ticket;
  },

  async findById(id: string): Promise<SupportTicket | null> {
    return memoryStore.supportTickets.get(id) || null;
  },

  async listByUser(userId: string): Promise<SupportTicket[]> {
    return Array.from(memoryStore.supportTickets.values())
      .filter((t: SupportTicket) => t.raisedByUserId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async list(filter: { status?: SupportTicketStatus } = {}): Promise<SupportTicket[]> {
    let rows = Array.from(memoryStore.supportTickets.values()) as SupportTicket[];
    if (filter.status) rows = rows.filter(t => t.status === filter.status);
    const openness = (t: SupportTicket) =>
      t.status === 'OPEN' ? 0 : t.status === 'IN_PROGRESS' ? 1 : 2;
    return rows.sort(
      (a, b) => openness(a) - openness(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  async reply(
    id: string,
    author: { userId: string; name: string; role: string },
    body: string
  ): Promise<SupportTicket | null> {
    const ticket = memoryStore.supportTickets.get(id) as SupportTicket | undefined;
    if (!ticket) return null;
    const now = new Date().toISOString();
    ticket.replies = [...ticket.replies, { at: now, byUserId: author.userId, byName: author.name, byRole: author.role, body }];
    // A staff reply is the moment a ticket stops being untouched; a customer
    // reply on a resolved ticket reopens it rather than disappearing.
    if (ticket.status === 'OPEN' && author.role !== 'customer') ticket.status = 'IN_PROGRESS';
    else if (ticket.status === 'RESOLVED' && author.role === 'customer') ticket.status = 'IN_PROGRESS';
    ticket.updatedAt = now;
    memoryStore.supportTickets.set(id, ticket);
    triggerAutoSave();
    return ticket;
  },

  async setStatus(
    id: string,
    status: SupportTicketStatus,
    actor: { userId: string }
  ): Promise<SupportTicket | null> {
    const ticket = memoryStore.supportTickets.get(id) as SupportTicket | undefined;
    if (!ticket) return null;
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    ticket.assignedToUserId = actor.userId;
    if (status === 'RESOLVED' || status === 'CLOSED') ticket.resolvedAt = ticket.updatedAt;
    memoryStore.supportTickets.set(id, ticket);
    triggerAutoSave();
    return ticket;
  }
};
