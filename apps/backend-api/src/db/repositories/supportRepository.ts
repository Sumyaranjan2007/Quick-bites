import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { SupportTicket, SupportTicketStatus } from '@quick-bites/shared-types';

const OPEN_STATUSES: SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS'];

/**
 * A ticket as both chat screens read it (round 6): who wrote last and whether the
 * other side has seen it. Derived for tickets saved before these fields existed.
 */
export function withChatFields(t: SupportTicket) {
  const last = t.replies[t.replies.length - 1];
  const lastMessageAt = t.lastMessageAt ?? last?.at ?? t.createdAt;
  const lastMessageBy = t.lastMessageBy ?? (last && last.byUserId !== t.raisedByUserId ? 'STAFF' : 'USER');
  return {
    ...t,
    lastMessageAt,
    lastMessageBy,
    unreadForStaff: lastMessageBy === 'USER' && !(t.staffReadAt && t.staffReadAt >= lastMessageAt),
    unreadForUser: lastMessageBy === 'STAFF' && !(t.userReadAt && t.userReadAt >= lastMessageAt)
  };
}

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
      updatedAt: now,
      lastMessageAt: now,
      lastMessageBy: 'USER',
      userReadAt: now
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
    // A staff reply is the moment a ticket stops being untouched; the person's
    // own reply on a resolved ticket reopens it rather than disappearing. Judged
    // by who raised it, not by role: a rider or partner is not staff either.
    const byRaiser = author.userId === ticket.raisedByUserId;
    if (ticket.status === 'OPEN' && !byRaiser) ticket.status = 'IN_PROGRESS';
    else if (ticket.status === 'RESOLVED' && byRaiser) ticket.status = 'IN_PROGRESS';
    ticket.updatedAt = ticket.lastMessageAt = now;
    ticket.lastMessageBy = byRaiser ? 'USER' : 'STAFF';
    // Whoever writes has read everything before it.
    if (byRaiser) ticket.userReadAt = now;
    else ticket.staffReadAt = now;
    memoryStore.supportTickets.set(id, ticket);
    triggerAutoSave();
    return ticket;
  },

  /** The person's live chat in this app (round 6: one at a time, open until it is solved). */
  async openFor(userId: string, role: string): Promise<SupportTicket | null> {
    return (await this.listByUser(userId)).find(t => t.raisedByRole === role && OPEN_STATUSES.includes(t.status)) || null;
  },

  /** The person or Operations has seen the chat up to now. */
  async markRead(id: string, who: 'USER' | 'STAFF'): Promise<SupportTicket | null> {
    const ticket = memoryStore.supportTickets.get(id) as SupportTicket | undefined;
    if (!ticket) return null;
    if (who === 'USER') ticket.userReadAt = new Date().toISOString();
    else ticket.staffReadAt = new Date().toISOString();
    memoryStore.supportTickets.set(id, ticket);
    triggerAutoSave();
    return ticket;
  },

  /** The person says their issue is solved (round 3): the chat moves to their history. */
  async resolveByRaiser(id: string): Promise<SupportTicket | null> {
    const ticket = memoryStore.supportTickets.get(id) as SupportTicket | undefined;
    if (!ticket) return null;
    ticket.status = 'RESOLVED';
    ticket.updatedAt = ticket.resolvedAt = new Date().toISOString();
    ticket.resolvedBy = 'USER';
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
    if (status === 'RESOLVED' || status === 'CLOSED') {
      ticket.resolvedAt = ticket.updatedAt;
      ticket.resolvedBy = 'STAFF';
    }
    memoryStore.supportTickets.set(id, ticket);
    triggerAutoSave();
    return ticket;
  }
};
