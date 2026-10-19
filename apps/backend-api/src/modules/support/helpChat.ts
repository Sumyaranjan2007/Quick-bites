/**
 * Help chat (master plan B8, owner decision Q3, 18 Oct 2026).
 *
 * A guided menu per app whose answers are FIXED sentences from our policies
 * (`modules/payments/paymentPolicies.ts`), filled in with the asker's live data:
 * order status and arrival, refund state, money owed, cash carried. Nothing
 * here is written by an AI; the same question over the same data always gets
 * the same words. "Talk to us" is an ordinary support ticket (supportRouter)
 * that carries these answers rebuilt here, never the app's copy, so staff read
 * what we actually said rather than what a client claims we said.
 */
import type { Order, OrderStatus, Restaurant, SupportTicket } from '@quick-bites/shared-types';
import type { AuthenticatedUser } from '../../middlewares/auth.ts';
import { memoryStore } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { estimateArrival } from '../orders/eta.ts';
import { duesFor, listPayouts } from '../payments/payouts.ts';
import { cashStanding } from '../payments/cashDeposits.ts';
import { formatPaise, toPaise } from '../payments/money.ts';

export type HelpAudience = 'customer' | 'partner' | 'rider';
type Topic = { id: string; label: string; category: SupportTicket['category'] };

const TOPICS: Record<HelpAudience, Topic[]> = {
  customer: [
    { id: 'ORDER_LATE', label: 'My order is late', category: 'DELIVERY' },
    { id: 'ITEM_MISSING', label: 'Item missing or wrong', category: 'ORDER' },
    { id: 'REFUND_STATUS', label: 'Refund status', category: 'PAYMENT' },
    { id: 'PAYMENT', label: 'Payment problem', category: 'PAYMENT' },
    { id: 'CHANGE_ADDRESS', label: 'Change the address', category: 'DELIVERY' },
    { id: 'CANCEL', label: 'Cancel my order', category: 'ORDER' },
    { id: 'ACCOUNT', label: 'My account', category: 'ACCOUNT' },
    { id: 'OTHER', label: 'Something else', category: 'OTHER' }
  ],
  partner: [
    { id: 'PAYOUTS', label: 'Payouts', category: 'PAYMENT' },
    { id: 'MENU_CHANGES', label: 'Menu change requests', category: 'RESTAURANT' },
    { id: 'ORDERS', label: 'An order', category: 'ORDER' },
    { id: 'DOCUMENTS', label: 'Documents', category: 'ACCOUNT' },
    { id: 'ACCOUNT', label: 'My account', category: 'ACCOUNT' },
    { id: 'OTHER', label: 'Something else', category: 'OTHER' }
  ],
  rider: [
    { id: 'PAYOUTS', label: 'Payouts', category: 'PAYMENT' },
    { id: 'CASH_DEPOSIT', label: 'Cash deposit', category: 'PAYMENT' },
    { id: 'TRIP_ISSUE', label: 'A trip', category: 'DELIVERY' },
    { id: 'DOCUMENTS', label: 'Documents', category: 'ACCOUNT' },
    { id: 'ACCOUNT', label: 'My account', category: 'ACCOUNT' },
    { id: 'OTHER', label: 'Something else', category: 'OTHER' }
  ]
};

/** Who is asking, resolved once: their app and the records they own. */
export interface Asker {
  user: AuthenticatedUser;
  audience: HelpAudience;
  riderId?: string;
  restaurants: Restaurant[];
}

/*
 * The app is the session's role; what they own comes from `roles`, which a
 * customer-app session narrows to ['customer'] (middlewares/auth.ts), so a
 * partner asking from the Customer app never reaches their kitchen's orders.
 */
export async function askerFor(user: AuthenticatedUser): Promise<Asker> {
  const audience: HelpAudience =
    user.role === 'restaurant_owner' ? 'partner' : user.role === 'rider' ? 'rider' : 'customer';
  const rider = user.roles.includes('rider') ? await riderRepository.findByUserId(user.id) : null;
  const restaurants = user.roles.includes('restaurant_owner')
    ? (Array.from(memoryStore.restaurants.values()) as Restaurant[]).filter(r => r.ownerId === user.id)
    : [];
  return { user, audience, riderId: rider?.id, restaurants };
}

export function topicsFor(audience: HelpAudience): Topic[] {
  return TOPICS[audience];
}

/*
 * What a person types, matched to a ready answer (owner, 19 Oct: "a real chat").
 * Plain words, no AI (Q3): the topic whose words appear most in the message wins;
 * nothing matched means a person should read it.
 */
const KEYWORDS: Record<string, string[]> = {
  ORDER_LATE: ['late', 'delay', 'where is', 'waiting', 'still not', 'not arrived', 'how long', 'slow', 'eta'],
  ITEM_MISSING: ['missing', 'wrong item', 'wrong food', 'not in the bag', 'forgot', 'spilled', 'damaged', 'cold'],
  REFUND_STATUS: ['refund', 'money back', 'return'],
  PAYMENT: ['payment', 'paid', 'charged', 'upi', 'card', 'deducted', 'debited', 'twice'],
  CHANGE_ADDRESS: ['address', 'location', 'deliver to', 'wrong place'],
  CANCEL: ['cancel'],
  ACCOUNT: ['account', 'login', 'log in', 'sign in', 'password', 'email', 'phone number', 'delete', 'otp', 'code'],
  PAYOUTS: ['payout', 'settlement', 'earnings', 'bank', 'transfer', 'not paid', 'my money'],
  MENU_CHANGES: ['menu', 'dish', 'price', 'item', 'photo'],
  ORDERS: ['order', 'customer'],
  DOCUMENTS: ['document', 'fssai', 'pan', 'gst', 'licence', 'license', 'kyc', 'verify', 'upload', 'rejected'],
  CASH_DEPOSIT: ['cash', 'deposit', 'collected'],
  TRIP_ISSUE: ['trip', 'pickup', 'pick up', 'customer not', 'not answering', 'restaurant closed', 'offer']
};

export function matchTopic(audience: HelpAudience, text: string): Topic | null {
  const said = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of TOPICS[audience]) {
    const score = (KEYWORDS[topic.id] || []).filter(word => said.includes(word)).length;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

export function topicFor(audience: HelpAudience, id: string): Topic {
  const topic = TOPICS[audience].find(t => t.id === id);
  if (!topic) throw new AppError('There is no such help topic in this app.', 404, 'TOPIC_NOT_FOUND');
  return topic;
}

/** The customer, the rider on the trip (rider record, not user id) or the kitchen's owner. */
export function isPartyTo(order: Order, asker: Asker): boolean {
  return (
    order.customerId === asker.user.id ||
    (Boolean(asker.riderId) && order.riderId === asker.riderId) ||
    asker.restaurants.some(r => r.id === order.restaurantId)
  );
}

/** One order the person was part of; refuses anyone else's. */
export async function ownOrder(orderId: string, asker: Asker): Promise<Order> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('That order could not be found.', 404, 'ORDER_NOT_FOUND');
  if (!isPartyTo(order, asker)) {
    throw new AppError('You can only ask about your own order.', 403, 'NOT_YOUR_ORDER');
  }
  return order;
}

const DONE: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

/** The order a question is about: the one named, else their latest live one, else their latest. */
export async function orderInQuestion(asker: Asker, orderId?: string): Promise<Order | null> {
  if (orderId) return ownOrder(orderId, asker);
  const mine =
    asker.audience === 'rider'
      ? asker.riderId ? await orderRepository.listByRiderId(asker.riderId) : []
      : asker.audience === 'customer'
        ? await orderRepository.listByCustomerId(asker.user.id)
        : [];
  return mine.find(o => !DONE.includes(o.status)) || mine[0] || null;
}

export function orderCard(order: Order | null) {
  return order
    ? { id: order.id, orderNumber: order.orderNumber, status: order.status, restaurantName: order.restaurantName }
    : null;
}

const STATUS_WORDS: Record<OrderStatus, string> = {
  PAYMENT_PENDING: 'is waiting for the payment to be confirmed',
  ORDER_PLACED: 'is waiting for the kitchen to accept it',
  ACCEPTED: 'has been accepted by the kitchen',
  PREPARING: 'is being prepared',
  READY_FOR_PICKUP: 'is ready and waiting for the rider',
  HANDED_TO_RIDER: 'has been handed to the rider',
  OUT_FOR_DELIVERY: 'is out for delivery',
  DELIVERED: 'was delivered',
  CANCELLED: 'was cancelled',
  REFUNDED: 'was cancelled and refunded'
};
const CANNOT_CANCEL_FROM: OrderStatus[] = ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY']; // orderRouter.ts

const statusLine = (o: Order) => `Order #${o.orderNumber} from ${o.restaurantName} ${STATUS_WORDS[o.status] || 'is open'}.`;
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';
const rs = (rupees: number) => formatPaise(toPaise(Number(rupees) || 0));
const NO_ORDER = 'We cannot see an order on this account.';
const OTHER = 'Tell us what happened and a person will reply here.';
const STAFF_ACCOUNT =
  'You can ask to close your account from Help. An admin completes it once everything owed is settled; until then you can still sign in to see your money.';
const KYC_WORDS = {
  ACTIVE: 'are approved',
  PENDING_APPROVAL: 'are being checked by Quick Bites',
  SUSPENDED: 'are on hold: the account is suspended',
  REJECTED: 'were not accepted; upload them again from Documents'
} as const;

function arrival(order: Order): string {
  const eta = estimateArrival(order);
  if (eta.minutesRemaining === null) return '';
  const minutes = Math.max(1, Math.round(eta.minutesRemaining));
  return eta.basis === 'RIDER_EN_ROUTE' && eta.distanceKm !== null
    ? ` Your rider is ${eta.distanceKm.toFixed(1)} km away, arriving in about ${minutes} min.`
    : ` It should reach you in about ${minutes} min.`;
}

async function refundLine(asker: Asker, order: Order | null): Promise<string | null> {
  const cases = (await refundRepository.listByUser(asker.user.id)).filter(r => !order || r.orderId === order.id);
  const r = cases[0];
  if (!r) return null;
  const amount = r.approvedAmount ?? r.requestedAmount;
  const head = r.duplicatePaymentId
    ? `We found a second payment of ${rs(amount)} on order #${r.orderNumber}`
    : `Your refund request for order #${r.orderNumber} (${rs(r.requestedAmount)})`;
  switch (r.status) {
    case 'REQUESTED':
      return `${head} was received; a person will review it.`;
    case 'PROCESSING':
      return `${head} is being reviewed now.`;
    case 'APPROVED':
      return `${head} was approved for ${rs(amount)}; the money is being sent back the way you paid.`;
    case 'REFUNDED':
      return `${head}: ${rs(amount)} was sent back on ${day(r.resolvedAt || r.updatedAt)}. UPI usually arrives within a day; cards take three to seven working days.`;
    case 'REJECTED':
      return `${head} was not approved${r.decisionNote ? `: ${r.decisionNote}` : '.'}`;
  }
  return null;
}

function duesLine(ownerType: 'RESTAURANT' | 'RIDER', ownerId: string, name: string, prefix: string): string {
  const due = duesFor(ownerType, ownerId, name);
  const lines = [
    due.outstandingPaise > 0
      ? `${prefix}${formatPaise(due.outstandingPaise)} owed, ${formatPaise(due.payablePaise)} of it can be sent now.`
      : `${prefix}Nothing is owed right now.`
  ];
  for (const b of due.blockers) {
    if (b.code === 'NO_ACCOUNT') lines.push('We have no verified bank or UPI account to pay into yet.');
    else if (b.code !== 'NOTHING_OWED') lines.push(b.reason);
  }
  const last = listPayouts({ ownerId }).filter(p => p.state === 'PAID' && p.ownerType === ownerType)
    .sort((a, b) => String(b.executedAt).localeCompare(String(a.executedAt)))[0];
  if (last) lines.push(`Last payment: ${formatPaise(last.amountPaise)} on ${day(last.executedAt)}.`);
  return lines.join(' ');
}

/** The fixed answer to one topic for this person, from live data. */
export async function answerFor(topicId: string, asker: Asker, order: Order | null): Promise<string> {
  const { audience } = asker;
  if (topicId === 'OTHER') return OTHER;

  if (audience === 'customer') {
    switch (topicId) {
      case 'ORDER_LATE':
        if (!order) return NO_ORDER;
        return DONE.includes(order.status)
          ? `${statusLine(order)} If something did not reach you, choose "Item missing or wrong" or Talk to us.`
          : statusLine(order) + arrival(order);
      case 'ITEM_MISSING': {
        const how =
          'Open the order and report the problem: pick what was missing or wrong and add a photo if you can. ' +
          'A person checks it, only what was wrong is refunded, and you are told the outcome and the reason.';
        if (!order) return how;
        if (order.status !== 'DELIVERED') return `${statusLine(order)} You can report a problem once it is delivered.`;
        const open = await refundLine(asker, order);
        return open ? `You already reported a problem on this order. ${open}` : how;
      }
      case 'REFUND_STATUS':
        return (await refundLine(asker, order)) ||
          'You have no refund requests. If something was wrong with an order, choose "Item missing or wrong".';
      case 'PAYMENT': {
        const dup = (await refundRepository.listByUser(asker.user.id)).find(r => r.duplicatePaymentId);
        return [
          order?.status === 'PAYMENT_PENDING' ? statusLine(order) : '',
          'If money left your account but no order appears, your bank is holding it and releases it, usually within five working days.',
          'If you were charged twice for one order, the second payment is sent back automatically.',
          dup ? await refundLine(asker, null) : ''
        ].filter(Boolean).join(' ');
      }
      case 'CHANGE_ADDRESS':
        if (order && !DONE.includes(order.status) && !CANNOT_CANCEL_FROM.includes(order.status)) {
          return `The address cannot be changed once an order is placed. You can still cancel order #${order.orderNumber} and order again to the right address.`;
        }
        return 'The address cannot be changed once an order is placed. If the rider has your food, Talk to us and a person will help.';
      case 'CANCEL':
        if (!order) return NO_ORDER;
        if (DONE.includes(order.status)) return `${statusLine(order)} There is nothing to cancel.`;
        if (CANNOT_CANCEL_FROM.includes(order.status)) {
          return `Your food is already on its way, so order #${order.orderNumber} can no longer be cancelled in the app. Talk to us if something is wrong.`;
        }
        return ['PAYMENT_PENDING', 'ORDER_PLACED'].includes(order.status)
          ? `You can cancel order #${order.orderNumber} from its screen. Before the kitchen accepts, the refund is full.`
          : `You can cancel order #${order.orderNumber} from its screen. The kitchen has started, so a cancellation charge may apply; it is shown before you confirm, and the rest is refunded in full.`;
      case 'ACCOUNT':
        return 'Your name, email and phone are in Profile. You can delete your account from Profile at once; past orders stay on record without your details.';
    }
  }

  if (audience === 'partner') {
    const kitchens = asker.restaurants;
    switch (topicId) {
      case 'PAYOUTS':
        if (kitchens.length === 0) return 'We cannot find a kitchen on this account.';
        return kitchens.map(k => duesLine('RESTAURANT', k.id, k.name, `${k.name}: `)).join(' ');
      case 'MENU_CHANGES': {
        const mine = (Array.from(memoryStore.menuRequests.values()) as any[])
          .filter(m => kitchens.some(k => k.id === m.restaurantId));
        const waiting = mine.filter(m => m.status === 'PENDING').length;
        const decided = mine.filter(m => m.status !== 'PENDING')
          .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))[0];
        return [
          'Quick Bites checks every menu change before customers see it.',
          `Waiting for a decision: ${waiting}.`,
          decided
            ? `Last decision: "${decided.payload?.name}" was ${decided.status === 'APPROVED' ? 'approved' : `not approved${decided.rejectionReason ? `: ${decided.rejectionReason}` : ''}`}.`
            : ''
        ].filter(Boolean).join(' ');
      }
      case 'ORDERS': {
        if (order) return statusLine(order);
        const waiting = (Array.from(memoryStore.orders.values()) as Order[])
          .filter(o => o.status === 'ORDER_PLACED' && kitchens.some(k => k.id === o.restaurantId)).length;
        return `${waiting} order${waiting === 1 ? ' is' : 's are'} waiting for you to accept. Open Live orders to accept or reject them.`;
      }
      case 'DOCUMENTS':
        if (kitchens.length === 0) return 'We cannot find a kitchen on this account.';
        return kitchens.map(k => `${k.name}: your documents ${KYC_WORDS[k.kycStatus] || 'are being checked by Quick Bites'}.`).join(' ');
      case 'ACCOUNT':
        return STAFF_ACCOUNT;
    }
  }

  if (audience === 'rider') {
    const rider = asker.riderId ? await riderRepository.findById(asker.riderId) : null;
    if (!rider) return 'We cannot find a rider profile on this account.';
    switch (topicId) {
      case 'PAYOUTS':
        return duesLine('RIDER', rider.id, rider.fullName, '');
      case 'CASH_DEPOSIT': {
        const cash = cashStanding(rider.id);
        return [
          `You are carrying ${formatPaise(cash.cashInHandPaise)} of Quick Bites cash.`,
          cash.message || '',
          cash.pendingDeposit ? `Your deposit of ${formatPaise(cash.pendingDeposit.declaredPaise)} is waiting to be counted.` : ''
        ].filter(Boolean).join(' ');
      }
      case 'TRIP_ISSUE':
        return `${order ? statusLine(order) : 'You have no trip right now.'} If you are in danger or had an accident, press SOS on the trip screen.`;
      case 'DOCUMENTS':
        return `Your documents ${KYC_WORDS[rider.kycStatus] || 'are being checked by Quick Bites'}.`;
      case 'ACCOUNT':
        return STAFF_ACCOUNT;
    }
  }
  return OTHER;
}

/** The chat so far, rebuilt from the topics the person chose, for a ticket. */
export async function helpChatFor(topicIds: string[], asker: Asker, order: Order | null) {
  const chat = [];
  for (const id of topicIds) {
    const topic = TOPICS[asker.audience].find(t => t.id === id);
    if (!topic) throw new AppError('One of those help topics is not in this app.', 400, 'UNKNOWN_TOPIC');
    chat.push({ topic: id, question: topic.label, answer: await answerFor(id, asker, order) });
  }
  return chat;
}
