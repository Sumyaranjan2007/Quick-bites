/**
 * What we promise a partner or a rider about when their money arrives — in one
 * place, derived from the rates, in the words they read.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A SENTENCE
 * -------------------------------------------------------------------------
 * This promise was written out by hand in four places: two policy documents and
 * the statement screen of each app. Three of them said the run was DAILY while
 * the configured cadence was weekly, and they said it to the two groups of
 * people with the most at stake in the answer. A rider planning around money
 * arriving tomorrow, told so by our own app, is not making a mistake — we are.
 *
 * The policy module had already solved this for its own text with `runCadence`.
 * The apps had not, because they had no way to ask. So the words now come from
 * here, the statement carries them to both apps, and there is exactly one
 * function that can be wrong.
 *
 * -------------------------------------------------------------------------
 * AND WHY THE WINDOW IS NOT "WEEKLY"
 * -------------------------------------------------------------------------
 * "Payments run weekly" is true and it is not the answer to the question being
 * asked. A partner wants to know how long after a delivery the money lands, and
 * an order delivered the day after a run waits the hold period AND the whole
 * cadence before it is even drafted. With a one-day hold and a weekly run the
 * ceiling is eight days, not seven — and then the transfer itself takes a
 * working day or two, which is the bank's leg rather than ours but is not
 * something the person waiting can be expected to separate.
 *
 * So the window is computed rather than asserted: hold + cadence + the transfer,
 * rounded up to whole weeks, which is what somebody actually plans around.
 */
import { getActiveRates } from './pricingConfig.ts';
import type { PayeeOwnerType } from '@quick-bites/shared-types';

/**
 * How long a transfer takes to land once it has been sent.
 *
 * Not a rate, because it is not ours to set — it is what NEFT and IMPS do. It is
 * named once rather than typed into prose so that the sentence and the
 * arithmetic below it cannot describe different numbers of days.
 */
const BANK_TRANSFER_WORKING_DAYS = 2;

/**
 * How often payouts run, in the words a partner reads.
 *
 * Derived from the rate rather than written out, because this is a PROMISE. It
 * said "daily" in four places while the cadence was being changed to weekly, and
 * a policy describing a different system from the one running is the document a
 * partner quotes back at you in a dispute.
 */
export function runCadence(days: number): string {
  const n = Math.max(1, Math.round(Number(days) || 1));
  if (n === 1) return 'daily';
  if (n === 7) return 'weekly';
  if (n === 14) return 'every fortnight';
  return `every ${n} days`;
}

/** "the same day" / "one day" / "3 days" — the hold, in prose. */
export function holdPhrase(days: number): string {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (n === 0) return 'the same day';
  if (n === 1) return 'one day';
  return `${n} days`;
}

export interface PayoutWindow {
  /** The hold in force for this kind of payee. */
  holdDays: number;
  /** How many days between runs. */
  cadenceDays: number;
  /**
   * Worst case from delivery to the money being drafted: an order that misses a
   * run by a day waits the hold AND the full cadence.
   */
  longestDraftDays: number;
  /** The same figure with the bank's leg added, rounded up to whole weeks. */
  outerWeeks: number;
}

export function payoutWindow(ownerType: PayeeOwnerType): PayoutWindow {
  const rates = getActiveRates();
  const holdDays = Math.max(
    0,
    Math.round(Number(ownerType === 'RESTAURANT' ? rates.partnerHoldDays : rates.riderHoldDays) || 0)
  );
  const cadenceDays = Math.max(1, Math.round(Number(rates.payoutCadenceDays) || 1));
  const longestDraftDays = holdDays + cadenceDays;
  return {
    holdDays,
    cadenceDays,
    longestDraftDays,
    outerWeeks: Math.max(1, Math.ceil((longestDraftDays + BANK_TRANSFER_WORKING_DAYS) / 7))
  };
}

const WEEK_WORD = ['', 'a week', 'two weeks', 'three weeks', 'four weeks'];

/** "two weeks" for small numbers, "6 weeks" beyond the ones with names. */
function weeks(n: number): string {
  return WEEK_WORD[n] || `${n} weeks`;
}

/**
 * The one sentence both apps and both policies use for "when does it arrive".
 *
 * Stated as the person waiting experiences it — from the delivery to the money
 * being in the account — because that is the span they are counting, and every
 * version of this that quoted only the cadence was read as a promise about that
 * span and then broken by it.
 */
export function arrivalSentence(ownerType: PayeeOwnerType): string {
  const w = payoutWindow(ownerType);
  const event = ownerType === 'RESTAURANT' ? 'an order is delivered' : 'a trip is completed';
  const becomes =
    w.holdDays === 0
      ? `Money is payable as soon as ${event}`
      : `Money becomes payable ${holdPhrase(w.holdDays)} after ${event}`;
  return (
    `${becomes}, and payments run ${runCadence(w.cadenceDays)}, so the longest anything waits before it is sent ` +
    `is ${w.longestDraftDays} days. Allow up to ${weeks(w.outerWeeks)} from the delivery to the money being in ` +
    `your account, because the transfer itself takes a working day or two at the bank's end.`
  );
}

/**
 * The sentence that replaces the "Ask to be paid" button.
 *
 * The button is gone from both apps, so the screens must not keep implying that
 * there is something to do. This says the opposite of what the button implied
 * and it says it in the same place the button was, because somebody who believed
 * they had to ask will otherwise read the empty space as the feature being
 * broken rather than unnecessary.
 */
export function noRequestNeededSentence(ownerType: PayeeOwnerType): string {
  const w = payoutWindow(ownerType);
  return (
    `There is nothing to ask for. Everything owed is paid automatically on the ${runCadence(w.cadenceDays)} run — ` +
    `no request, no approval, and nothing you can do to make it arrive sooner or risk by not asking.`
  );
}

/** Both sentences, which is what a statement carries to an app. */
export function payoutPromise(ownerType: PayeeOwnerType): {
  arrival: string;
  noRequestNeeded: string;
  window: PayoutWindow;
} {
  return {
    arrival: arrivalSentence(ownerType),
    noRequestNeeded: noRequestNeededSentence(ownerType),
    window: payoutWindow(ownerType)
  };
}
