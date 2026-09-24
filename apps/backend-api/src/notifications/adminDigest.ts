/**
 * How the day is going, twice a day.
 *
 * -------------------------------------------------------------------------
 * WHY A SUMMARY AND NOT MORE ALERTS
 * -------------------------------------------------------------------------
 * Everything else this module's neighbours send is a PROBLEM: something is wrong
 * and somebody must act. That is the right shape for a problem and the wrong shape
 * for "forty-one orders went out today", which needs no action and would teach the
 * owner to swipe a channel that also carries an SOS.
 *
 * So it is one message, twice, with no action attached. Good news exists too, and
 * a platform that only ever speaks up when something is broken is one nobody wants
 * to hear from.
 *
 * -------------------------------------------------------------------------
 * TWICE, AT FIXED TIMES, AND SURVIVING A RESTART
 * -------------------------------------------------------------------------
 * The naive version is `setInterval(twelve hours)`, and it is wrong in a way that
 * is invisible: the phase depends on when the process last started, so a deploy at
 * 3am moves the afternoon summary to 3pm and the evening one to 3am. A restart
 * loop sends a summary every time it restarts.
 *
 * Instead there are two SLOTS a day at fixed IST times, and the last slot sent is
 * recorded. The job wakes often, works out which slot the clock is in, and sends
 * only if that slot has not been sent. A restart cannot resend one, a process that
 * was down through a slot sends it late rather than not at all, and the phase does
 * not depend on uptime.
 *
 * IST because that is where the business is. A summary of "today" that rolls over
 * at UTC midnight splits an Indian evening's trading across two days, which makes
 * both numbers wrong and neither obviously so.
 */
import { memoryStore, triggerAutoSave } from '../db/client.ts';
import { istDayKey } from '../modules/admin/analytics.ts';
import { notifyAdmins } from './adminNotifier.ts';
import { ADMIN_CHANNEL } from './adminNotifier.ts';

const IST_OFFSET_MINUTES = 330;

/** Hour of the IST day each summary covers up to. */
const SLOTS = [
  { key: 'MIDDAY', hour: 15, label: 'so far today' },
  { key: 'EVENING', hour: 23, label: 'today' }
] as const;

export type DigestSlotKey = (typeof SLOTS)[number]['key'];

export interface DigestCounts {
  placed: number;
  delivered: number;
  cancelled: number;
  newRestaurants: number;
  newRiders: number;
}

/** The IST hour, 0-23, at an instant. */
function istHour(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).getUTCHours();
}

/**
 * Which summary is due at this instant, or null.
 *
 * The LAST slot whose hour has passed, so a job that was down at 15:00 and wakes
 * at 16:00 still sends the midday one. Exported so a check can ask the question at
 * an arbitrary clock time instead of waiting for one.
 */
export function slotDueAt(at: Date): { key: DigestSlotKey; label: string; dayKey: string } | null {
  const hour = istHour(at);
  const passed = SLOTS.filter(slot => hour >= slot.hour);
  if (passed.length === 0) return null;
  const slot = passed[passed.length - 1];
  return { key: slot.key, label: slot.label, dayKey: istDayKey(at) };
}

function sentKeyFor(dayKey: string, slot: DigestSlotKey): string {
  return `admin_digest:${dayKey}:${slot}`;
}

/**
 * What happened today, in IST.
 *
 * Counted from the stores rather than from a running tally, because a tally is a
 * second source of truth that drifts — and a summary that disagrees with the
 * dashboard is worse than no summary, since one of them is now untrustworthy and
 * nobody knows which.
 */
export function digestCounts(at: Date = new Date()): DigestCounts {
  const today = istDayKey(at);
  const counts: DigestCounts = {
    placed: 0,
    delivered: 0,
    cancelled: 0,
    newRestaurants: 0,
    newRiders: 0
  };

  for (const order of memoryStore.orders.values() as Iterable<any>) {
    if (order?.createdAt && istDayKey(order.createdAt) === today) counts.placed += 1;
    if (order?.deliveredAt && istDayKey(order.deliveredAt) === today) counts.delivered += 1;
    if (order?.cancelledAt && istDayKey(order.cancelledAt) === today) counts.cancelled += 1;
  }

  for (const restaurant of memoryStore.restaurants.values() as Iterable<any>) {
    if (restaurant?.createdAt && istDayKey(restaurant.createdAt) === today) counts.newRestaurants += 1;
  }
  for (const rider of memoryStore.riders.values() as Iterable<any>) {
    if (rider?.createdAt && istDayKey(rider.createdAt) === today) counts.newRiders += 1;
  }

  return counts;
}

/** The summary as a sentence, or null when there is genuinely nothing to say. */
export function digestBody(counts: DigestCounts, label: string): string | null {
  /*
   * NOTHING HAPPENED IS NOT WORTH A NOTIFICATION.
   *
   * A quiet Tuesday morning produces zeros across the board, and "0 orders" twice
   * a day every day is how somebody learns to ignore this. Sign-ups alone are
   * worth saying; a day with no activity at all is not.
   */
  const anything =
    counts.placed > 0 ||
    counts.delivered > 0 ||
    counts.cancelled > 0 ||
    counts.newRestaurants > 0 ||
    counts.newRiders > 0;
  if (!anything) return null;

  const parts: string[] = [];
  parts.push(`${counts.placed} order${counts.placed === 1 ? '' : 's'} placed`);
  parts.push(`${counts.delivered} delivered`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);

  const signups: string[] = [];
  if (counts.newRestaurants > 0) {
    signups.push(`${counts.newRestaurants} new restaurant${counts.newRestaurants === 1 ? '' : 's'}`);
  }
  if (counts.newRiders > 0) {
    signups.push(`${counts.newRiders} new rider${counts.newRiders === 1 ? '' : 's'}`);
  }

  const activity = `${parts.join(', ')} ${label}.`;
  return signups.length > 0 ? `${activity} ${signups.join(' and ')} signed up.` : activity;
}

/**
 * Sends the summary if one is due and has not been sent.
 *
 * Returns what it did, so the job and a check can both tell the difference between
 * "sent it" and "there was nothing due" — two outcomes that look identical from
 * the outside and mean opposite things.
 */
export async function sendDigestIfDue(
  at: Date = new Date()
): Promise<{ sent: boolean; reason: string; recipients: string[] }> {
  const slot = slotDueAt(at);
  if (!slot) return { sent: false, reason: 'no slot has passed yet today', recipients: [] };

  const sentKey = sentKeyFor(slot.dayKey, slot.key);
  if (memoryStore.settings.get(sentKey)) {
    return { sent: false, reason: 'already sent for this slot', recipients: [] };
  }

  const counts = digestCounts(at);
  const body = digestBody(counts, slot.label);

  /*
   * Recorded as sent even when there was nothing to say. Otherwise every wake-up
   * on a quiet day re-counts the same zeros and re-decides not to send, which
   * works — until somebody places one order at 23:59 and gets a summary that reads
   * as the whole day.
   */
  /*
   * SAVED, not just written.
   *
   * `memoryStore` is Maps: a write survives exactly as long as the process. This
   * marker's ENTIRE PURPOSE is to survive a restart — it is what stops a deploy
   * re-sending a summary that has already gone out. Without the save it worked
   * until the first restart and then did the one thing the slot design exists to
   * prevent, which nothing would have reported.
   */
  memoryStore.settings.set(sentKey, { sentAt: at.toISOString(), hadContent: Boolean(body) });
  triggerAutoSave();

  if (!body) return { sent: false, reason: 'nothing happened today', recipients: [] };

  const recipients = await notifyAdmins({
    permission: 'analytics.dashboard.view',
    title: slot.key === 'MIDDAY' ? 'How today is going' : 'Today at Quick Bites',
    body,
    channel: ADMIN_CHANNEL.ATTENTION,
    open: 'orders',
    subject: sentKey,
    type: 'ADMIN_DAILY_DIGEST',
    category: 'DIGEST'
  });

  return { sent: true, reason: 'sent', recipients };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Wakes every ten minutes and sends whichever summary is due. */
export function startAdminDigest(): void {
  if (timer) return;
  timer = setInterval(() => {
    void sendDigestIfDue().catch(err => {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'ADMIN_DIGEST_FAILED',
          message: err?.message || String(err)
        })
      );
    });
  }, 10 * 60_000);

  // Never a reason a process cannot shut down, and why the suites can exit.
  timer.unref?.();
}

export function stopAdminDigest(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Only used by tests, which need a clean slate. */
export function resetDigestForTesting(): void {
  for (const key of Array.from(memoryStore.settings.keys())) {
    if (String(key).startsWith('admin_digest:')) memoryStore.settings.delete(key);
  }
}
