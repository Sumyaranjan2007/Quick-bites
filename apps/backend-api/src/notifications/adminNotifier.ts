/**
 * Telling an administrator that something needs them.
 *
 * The owner asked to "get notification of everything so it will make everything
 * more smoother". This is that, with one deliberate departure from the literal
 * reading, explained below because it is the whole design.
 *
 * -------------------------------------------------------------------------
 * WHY NOT A PUSH PER ORDER
 * -------------------------------------------------------------------------
 * Taken literally, "everything" is several hundred notifications on a busy day.
 * The owner mutes the app within a week — and then a rider's SOS arrives into a
 * muted app and nobody sees it. The feature would destroy its own most important
 * case while doing exactly what was asked.
 *
 * So every event that needs a PERSON fires always, and the volume events are
 * available as a digest that is off until switched on. The literal version is
 * still reachable by anyone who wants it; it is just not the default that trains
 * somebody to swipe admin notifications away.
 *
 * -------------------------------------------------------------------------
 * TARGETED BY PERMISSION, NEVER "ALL ADMINS"
 * -------------------------------------------------------------------------
 * Every event names the permission that lets you ACT on it, and reaches only the
 * staff who hold it. A support administrator who keeps getting payout alerts
 * they cannot do anything about learns that admin notifications are noise, and
 * the next one they dismiss is the one that mattered.
 *
 * The owner is a super admin and holds every permission, so the owner receives
 * everything. That is the literal request, implemented in the way that keeps
 * working once there is more than one person on the team.
 *
 * -------------------------------------------------------------------------
 * AND NOTHING HERE CAN FAIL AN ACTION
 * -------------------------------------------------------------------------
 * A bank account must submit and an SOS must raise whether or not anybody can be
 * told. Every function returns void, swallows its own errors, and is called
 * without being awaited for anything the caller depends on.
 */
import { userRepository } from '../db/repositories/userRepository.ts';
import { resolveAccess } from '../modules/admin/permissions.ts';
import type { AdminPermission } from '@quick-bites/shared-types';
import { fcmDispatcher } from './fcmDispatcher.ts';

/**
 * The channel ids, spelled exactly as the ADMIN app creates them.
 *
 * On Android 8 and above a message naming a channel the app never created is
 * DROPPED — not downgraded to a quiet notification, dropped. That is the §8.1
 * defect, where the server said `new_orders`, the rider app created
 * `new-orders`, the partner app created `kitchen-orders`, and the alarm built to
 * wake a kitchen had been addressed to a channel that existed on no phone.
 *
 * So these two strings and the two in `admin-mobile/src/lib/adminChannels.ts`
 * are one contract expressed twice, and a test compares them by reading that
 * file rather than by comparing a constant with itself.
 */
export const ADMIN_CHANNEL = {
  /** MAX importance, sound, wakes the phone. An SOS and a failed payout. */
  URGENT: 'admin-urgent',
  /** DEFAULT importance: it appears, it does not wake anybody. */
  ATTENTION: 'admin-attention'
} as const;

/**
 * Which admin section a notification opens.
 *
 * These are the keys `admin-mobile/App.tsx` already uses for its sections. A
 * notification that opens the dashboard makes the reader hunt for whatever it
 * was about, which is worse than not sending one — they now have to look anyway,
 * and they were told to.
 */
type NavKey =
  | 'payees'
  | 'documents'
  | 'refunds'
  | 'support'
  | 'payouts'
  | 'catalog'
  | 'profileChanges'
  | 'orders'
  | 'deliveries'
  | 'finance';

interface AdminEvent {
  /**
   * The permission that lets somebody ACT on this.
   *
   * Typed as AdminPermission rather than string, so a permission that does not
   * exist is a compile error rather than a notification that silently reaches
   * nobody. A typo here would have been invisible: the recipient list would come
   * back empty and everything would look like it worked.
   */
  permission: AdminPermission;
  title: string;
  body: string;
  channel: string;
  /** Where tapping it lands. */
  open: NavKey;
  /**
   * What this is about, for deduplication. An account edited three times is one
   * thing needing one look, not three notifications.
   */
  subject: string;
  /** Machine-readable event name, carried in the payload. */
  type: string;
  /**
   * Skip the ten-minute per-subject suppression.
   *
   * For callers that do their own, BETTER, suppression — and there is exactly one:
   * the payments-health push, which fires only when the SET of findings changes
   * and has no time window at all.
   *
   * Without this the two mechanisms overlap and the weaker one silently wins. A
   * problem that cleared and came back inside ten minutes was swallowed as a
   * duplicate, which is the worst of the three possible behaviours: the first
   * occurrence was announced, so the silence reads as "it never came back".
   *
   * Found by a check, not by reading. Do not add a second caller without a
   * suppression rule at least as strong.
   */
  skipTimeDedupe?: boolean;
}

/* ------------------------------------------------------------------ *
 *  WHO HOLDS A PERMISSION                                            *
 * ------------------------------------------------------------------ */

/**
 * Every staff account that can act on this, by user id.
 *
 * `resolveAccess` is the same function the console's own routes authorise
 * against, so a notification cannot reach somebody who would then be refused
 * the screen it opens. Deriving the audience a second way is how those two
 * drift apart.
 */
async function recipientsFor(permission: AdminPermission): Promise<string[]> {
  const users = await userRepository.list();
  const out: string[] = [];
  for (const user of users) {
    /*
     * `isBlocked`, not `isActive`. The first version of this line guessed
     * `isActive === false` and the compiler refused it — there is no such field.
     * A blocked account is how this platform disables somebody (see
     * `middlewares/auth.ts:141`), and it is not on `UserProfile` either, which is
     * why it is read defensively rather than declared.
     *
     * Someone blocked yesterday should not still be getting told a rider has
     * pressed SOS: they cannot sign in to act on it, and a notification nobody
     * can act on is the thing this module exists to avoid.
     */
    if ((user as { isBlocked?: boolean }).isBlocked) continue;

    const access = resolveAccess(user as any);
    // A role switched off is the other way a person loses the ability to act.
    if (access.roleDisabled) continue;
    if (access.permissions.includes(permission)) out.push(user.id);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  NOT TWICE FOR ONE THING                                           *
 * ------------------------------------------------------------------ */

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const recentlySent = new Map<string, number>();

/**
 * Whether this exact thing has already been announced.
 *
 * §8C.6: a bank account edited three times in five minutes is one account
 * waiting for one look. Keyed on the event and its SUBJECT rather than on a
 * count, because a count-driven notifier fires every time anything else in the
 * count moves and cannot say which one did.
 *
 * In memory rather than in the store, deliberately: this is suppression state,
 * not data. The cost of a restart is at worst one repeated notification, and the
 * cost of persisting it would be a migration and a row nobody can interpret.
 */
function alreadyAnnounced(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recentlySent) {
    if (now - at > DEDUPE_WINDOW_MS) recentlySent.delete(k);
  }
  const seen = recentlySent.get(key);
  if (seen !== undefined && now - seen <= DEDUPE_WINDOW_MS) return true;
  recentlySent.set(key, now);
  return false;
}

/** Test seam: the window is real time, so a suite must be able to clear it. */
export function resetAdminNotificationDedupeForTesting(): void {
  recentlySent.clear();
}

/* ------------------------------------------------------------------ *
 *  SENDING                                                           *
 * ------------------------------------------------------------------ */

/**
 * The one path every admin notification takes.
 *
 * Returns the user ids it addressed, which is what a test asserts on — proving
 * somebody was notified passes just as well when the notification went to
 * everybody, and going to everybody is the failure this whole module exists to
 * avoid.
 */
export async function notifyAdmins(event: AdminEvent): Promise<string[]> {
  try {
    if (!event.skipTimeDedupe && alreadyAnnounced(`${event.type}:${event.subject}`)) return [];

    const recipients = await recipientsFor(event.permission);
    for (const userId of recipients) {
      await fcmDispatcher.sendPushNotification({
        userId,
        title: event.title,
        body: event.body,
        androidChannelId: event.channel,
        data: {
          type: event.type,
          open: event.open,
          subject: event.subject
        }
      });
    }
    return recipients;
  } catch (err: any) {
    /*
     * Swallowed on purpose. A bank account must submit and an SOS must raise
     * whether or not anybody can be told, and this function is the one place
     * that can go wrong without the caller being able to do anything about it.
     */
    console.error(
      JSON.stringify({
        level: 'ERROR',
        event: 'ADMIN_NOTIFY_FAILED',
        adminEvent: event.type,
        subject: event.subject,
        message: err?.message
      })
    );
    return [];
  }
}

/* ------------------------------------------------------------------ *
 *  THE URGENT ONE                                                    *
 * ------------------------------------------------------------------ */

/**
 * A rider has pressed SOS.
 *
 * THE REASON THIS FEATURE IS WORTH BUILDING. Every other event here costs money
 * if it is late. This one costs something else, and it is the only notification
 * on the platform where the phone should ring at 3am.
 *
 * No money in it and no location in the body: a lock screen is readable by
 * anybody standing near it, and where a rider is in trouble is not something to
 * print there. The alert itself has the coordinates.
 */
export function notifyAdminsSosRaised(input: {
  alertId: string;
  riderName: string;
  riderPhone?: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'support.tickets.manage',
    title: 'SOS — a rider needs help',
    body: `${input.riderName} has raised an emergency alert. Open it now.`,
    channel: ADMIN_CHANNEL.URGENT,
    open: 'support',
    subject: input.alertId,
    type: 'ADMIN_SOS_RAISED'
  });
}

/**
 * A payout failed at the gateway.
 *
 * Urgent because money has left a queue and not arrived, and the person it was
 * for is waiting without knowing. The amount is included: everybody who can
 * receive this holds `finance.payouts.manage` and would see it on the screen
 * this opens.
 */
export function notifyAdminsPayoutFailed(input: {
  payoutId: string;
  payeeName: string;
  amountLabel: string;
  reason: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'finance.payouts.manage',
    title: 'A payout failed',
    body: `${input.amountLabel} to ${input.payeeName} did not go through. ${input.reason}`,
    channel: ADMIN_CHANNEL.URGENT,
    open: 'payouts',
    subject: input.payoutId,
    type: 'ADMIN_PAYOUT_FAILED'
  });
}

/* ------------------------------------------------------------------ *
 *  THE ONES THAT NEED A PERSON, BUT NOT TONIGHT                      *
 * ------------------------------------------------------------------ */

/**
 * Somebody has filed a bank account and cannot be paid until it is applied.
 *
 * No account number and no last four digits. Everybody receiving this holds
 * `finance.payouts.manage` and will see them on the screen it opens, but a lock
 * screen is not that screen.
 */
export function notifyAdminsBankAccountFiled(input: {
  accountId: string;
  ownerName: string;
  ownerKind: 'restaurant' | 'rider';
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'finance.payouts.manage',
    title: 'A bank account is waiting',
    body: `${input.ownerName} has filed an account. Nothing can be paid to this ${input.ownerKind} until it is applied.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'payees',
    subject: input.accountId,
    type: 'ADMIN_BANK_ACCOUNT_FILED'
  });
}

/** A KYC document is waiting for review, and somebody cannot work until it is. */
export function notifyAdminsKycSubmitted(input: {
  documentId: string;
  ownerName: string;
  documentLabel: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'documents.review',
    title: 'A document needs checking',
    body: `${input.ownerName} has uploaded their ${input.documentLabel}.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'documents',
    subject: input.documentId,
    type: 'ADMIN_KYC_SUBMITTED'
  });
}

/**
 * A refund has been asked for.
 *
 * The amount is in it: only `finance.refunds.manage` receives this, and knowing
 * whether it is Rs 40 or Rs 4,000 is what decides whether it waits until
 * morning.
 */
export function notifyAdminsRefundRaised(input: {
  requestId: string;
  orderNumber: string;
  amountLabel: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'finance.refunds.manage',
    title: 'A refund was requested',
    body: `${input.amountLabel} on order #${input.orderNumber}.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'refunds',
    subject: input.requestId,
    type: 'ADMIN_REFUND_RAISED'
  });
}

/** Somebody has asked for help and is waiting for a person. */
export function notifyAdminsSupportTicketOpened(input: {
  ticketId: string;
  subjectLine: string;
  raisedBy: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'support.tickets.manage',
    title: 'A new support ticket',
    body: `${input.raisedBy}: ${input.subjectLine}`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'support',
    subject: input.ticketId,
    type: 'ADMIN_SUPPORT_TICKET'
  });
}

/**
 * A rider has declared cash they are bringing in.
 *
 * Their balance does not come down until it is counted, and cash orders stop
 * being offered to them at the ceiling — so a declaration nobody confirms is a
 * rider who cannot work.
 */
export function notifyAdminsCashDeclared(input: {
  depositId: string;
  riderName: string;
  amountLabel: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'finance.payouts.manage',
    title: 'Cash is coming in',
    body: `${input.riderName} is bringing ${input.amountLabel} to the office.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'payouts',
    subject: input.depositId,
    type: 'ADMIN_CASH_DECLARED'
  });
}

/** A partner wants to change their menu and cannot do it themselves. */
export function notifyAdminsMenuRequestRaised(input: {
  requestId: string;
  restaurantName: string;
  what: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'catalog.menus.review',
    title: 'A menu change is waiting',
    body: `${input.restaurantName}: ${input.what}`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'catalog',
    subject: input.requestId,
    type: 'ADMIN_MENU_REQUEST'
  });
}

/* ------------------------------------------------------------------ *
 *  THE PROBLEMS THE PLATFORM DETECTS BY ITSELF                       *
 * ------------------------------------------------------------------ */

/*
 * Everything above is somebody ASKING for something — a document, a refund, a
 * bank account. What follows is the platform noticing that something has gone
 * WRONG on its own, and it is the half the owner meant by "main is solving
 * problems".
 *
 * All of it was already detected. Every one of these went out through
 * `emitOpsAlert` — a socket event to a console that happens to be open — so a
 * problem found at 9pm on a Saturday waited for somebody to open a laptop.
 *
 * The socket stays. It is what makes an open console update live. This is the
 * second path, for a phone.
 */

/**
 * Cooked food and nobody to carry it.
 *
 * URGENT, and it is the only operational alert that earns that: the food is
 * going cold, the customer is watching a tracker, and every minute is a minute
 * the platform could have spent phoning a rider.
 *
 * Since W1.2 this fires only once the search has been WIDENED to exhaustion, so
 * it now means "everybody who could take this has been asked and none of them
 * took it" rather than "we asked six people once". That is the difference between
 * an alert somebody can act on and one they learn to ignore.
 */
export function notifyAdminsNoRiderFound(input: {
  orderId: string;
  orderNumber: string;
  restaurantName?: string;
  waitingMinutes: number;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'orders.deliveries.manage',
    title: 'No rider for a cooked order',
    body: `#${input.orderNumber}${input.restaurantName ? ` at ${input.restaurantName}` : ''} has waited ${input.waitingMinutes} minutes. Every available rider has been asked.`,
    channel: ADMIN_CHANNEL.URGENT,
    open: 'deliveries',
    /*
     * PER ORDER, deliberately. Two stuck orders are two problems with two
     * different fixes — a different restaurant, a different rider to phone — and
     * collapsing them would hide the second one.
     */
    subject: input.orderId,
    type: 'ADMIN_NO_RIDER_FOUND'
  });
}

/** A rider accepted a trip and never turned up; it has gone back on offer. */
export function notifyAdminsRiderNoShow(input: {
  orderId: string;
  orderNumber: string;
  riderName?: string;
  waitingMinutes: number;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'orders.deliveries.manage',
    /*
     * NOT urgent, and the distinction is worth stating: the platform has already
     * recovered — the trip was taken back and returned to the pool, so riders are
     * being asked again. Somebody should know it happened; nobody needs to be
     * woken for it.
     */
    title: 'A rider did not collect',
    body: `${input.riderName || 'A rider'} held #${input.orderNumber} for ${input.waitingMinutes} minutes without collecting it. It is back on offer.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'deliveries',
    subject: input.orderId,
    type: 'ADMIN_RIDER_NO_SHOW'
  });
}

/** A kitchen never answered, so the order was cancelled and the customer refunded. */
export function notifyAdminsOrderAutoCancelled(input: {
  orderId: string;
  orderNumber: string;
  restaurantName?: string;
  waitedMinutes: number;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'orders.deliveries.manage',
    title: 'An order was cancelled automatically',
    body: `${input.restaurantName || 'A restaurant'} did not accept #${input.orderNumber} within ${input.waitedMinutes} minutes. The customer has been refunded.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'orders',
    subject: input.orderId,
    type: 'ADMIN_ORDER_AUTO_CANCELLED'
  });
}

/** Marked delivered a long way from the delivery address. */
export function notifyAdminsDeliveryLocationMismatch(input: {
  orderId: string;
  orderNumber: string;
  distanceMetres: number;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'orders.deliveries.manage',
    title: 'Delivered from the wrong place',
    body: `#${input.orderNumber} was marked delivered ${input.distanceMetres} m from the address.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'deliveries',
    subject: input.orderId,
    type: 'ADMIN_DELIVERY_LOCATION_MISMATCH'
  });
}

/** A payment was taken at the gateway and the webhook never arrived. */
export function notifyAdminsPaymentRecovered(input: {
  orderId: string;
  orderNumber: string;
  minutesLate: number;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'finance.payments.view',
    title: 'A payment arrived late',
    body: `#${input.orderNumber} was paid ${input.minutesLate} minutes before we heard about it. One lost message is a curiosity; several is an incident.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'finance',
    subject: input.orderId,
    type: 'ADMIN_PAYMENT_RECOVERED'
  });
}

/* ------------------------------------------------------------------ *
 *  THE BOOKS, AS ONE MESSAGE                                          *
 * ------------------------------------------------------------------ */

/**
 * The set of health alerts the last push described, or null before the first.
 *
 * Not a timestamp and not a count — the SET. See below.
 */
let lastHealthFingerprint: string | null = null;

/** Test seam: the fingerprint is process state, so a suite must be able to clear it. */
export function resetPaymentsHealthNotificationForTesting(): void {
  lastHealthFingerprint = null;
}

/**
 * One push for the whole of the payments health sweep.
 *
 * -------------------------------------------------------------------------
 * ONE MESSAGE, NOT ONE PER ALERT
 * -------------------------------------------------------------------------
 * A single bad state produces several alerts at once — an unbalanced ledger, the
 * duplicate keys behind it, and the uncertain payouts that caused both. Pushing
 * each would make one bad morning a burst of six notifications, which is exactly
 * how a channel gets muted, and the channel that gets muted is the one carrying
 * the SOS.
 *
 * So: one push, titled with the worst of them, the count in the body, and the
 * detail on the screen it opens.
 *
 * -------------------------------------------------------------------------
 * AND ONLY WHEN THE SET CHANGES
 * -------------------------------------------------------------------------
 * The sweep runs every fifteen minutes and an unresolved problem is still there
 * next time. Notifying again because nothing has changed trains the reader to
 * swipe it away — and a reader who swipes these by reflex is worse off than one
 * who was never notified, because now they are practised at it.
 *
 * Keyed on the set of alert lines rather than their number: two alerts becoming
 * two DIFFERENT alerts is news, and a count would miss it.
 *
 * The fingerprint is cleared when the alerts clear, so the same problem coming
 * BACK is announced again. Remembering it forever would silence a recurrence,
 * which is a different and worse failure than a repeat.
 *
 * `worst` is chosen by the caller, not guessed from the text here. The health
 * check knows which of its findings is the loudest — it says so in its own
 * comments — and a notifier ranking prose by keyword would get it wrong the first
 * time somebody reworded an alert.
 */
export async function notifyAdminsPaymentsHealth(input: {
  alerts: string[];
  worst: string;
}): Promise<string[]> {
  const alerts = (input.alerts || []).filter(a => typeof a === 'string' && a.trim().length > 0);

  if (alerts.length === 0) {
    // Resolved. Forget it, so a recurrence is news again.
    lastHealthFingerprint = null;
    return [];
  }

  const fingerprint = [...alerts].sort().join(' || ');
  if (fingerprint === lastHealthFingerprint) return [];
  lastHealthFingerprint = fingerprint;

  const others = alerts.length - 1;
  return notifyAdmins({
    permission: 'finance.payouts.manage',
    title: alerts.length === 1 ? 'The books need you' : `The books need you (${alerts.length})`,
    body: others > 0 ? `${input.worst} And ${others} more.` : input.worst,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'finance',
    /*
     * The fingerprint IS the subject, so the ordinary per-subject dedup cannot
     * suppress a genuinely new set — and the change check above is what stops a
     * repeat. Using a fixed subject would have made the 10-minute window the rule
     * instead, and the sweep is every 15 minutes.
     */
    subject: fingerprint,
    type: 'ADMIN_PAYMENTS_HEALTH',
    /*
     * This function's own suppression is stronger than the ten-minute window —
     * set-based and unbounded in time — and the two overlapping let the weaker one
     * win: a problem that cleared and came back inside ten minutes was swallowed.
     * A check caught it.
     */
    skipTimeDedupe: true
  });
}

/** A partner has edited their own details and is waiting for approval. */
export function notifyAdminsProfileEditRaised(input: {
  editId: string;
  restaurantName: string;
}): Promise<string[]> {
  return notifyAdmins({
    permission: 'catalog.restaurants.approve',
    title: 'A profile change is waiting',
    body: `${input.restaurantName} has changed their details.`,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'profileChanges',
    subject: input.editId,
    type: 'ADMIN_PROFILE_EDIT'
  });
}
