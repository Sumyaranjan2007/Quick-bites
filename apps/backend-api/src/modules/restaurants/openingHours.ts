/**
 * When a kitchen is open, and what that means when nobody is there to say.
 *
 * Before this, "open" was a single boolean a partner toggled by hand. That is
 * fine until somebody forgets, and then a kitchen that closed at eleven is still
 * accepting orders at two in the morning — the customer pays, waits, and is
 * refunded a meal they wanted. The most common complaint a food platform gets
 * is not a bad dish; it is an order accepted by a restaurant that was shut.
 *
 * So opening hours are declared, the platform closes the kitchen when they end,
 * and the partner keeps the manual toggle as an override. Declared hours are
 * what a customer sees; the toggle is what the kitchen actually does right now.
 * Both matter, and neither alone is enough.
 *
 * The types themselves live in `@quick-bites/shared-types`, because the apps
 * render and submit them. Only the arithmetic is here.
 */

import { DAYS_OF_WEEK, type DayOfWeek, type OpeningHours, type ServingWindow } from '@quick-bites/shared-types';

export type { DayOfWeek, OpeningHours, ServingWindow };
export { DAYS_OF_WEEK };

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Windows may not start before this many minutes past midnight, or end after. */
const MINUTES_IN_DAY = 24 * 60;

/** A kitchen open past midnight closes at 23:59 and reopens; see `crossesMidnight`. */
export const MAX_WINDOWS_PER_DAY = 3;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "HH:MM" to minutes from midnight, or null if it is not a time.
 *
 * Returns null rather than throwing or coercing, because the caller is a
 * validator that wants to name the bad field, and `parseInt('9pm')` returning 9
 * is how a kitchen ends up declared open at nine in the morning.
 */
export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes from midnight back to "HH:MM", for the apps to render. */
export function formatTimeOfDay(minutes: number): string {
  const safe = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A window whose end is at or before its start runs past midnight.
 *
 * 22:00–02:00 is a real and common kitchen. It is stored as written rather than
 * split across two days, because splitting it makes "what are Friday's hours"
 * unanswerable without also reading Saturday.
 */
export function crossesMidnight(window: ServingWindow): boolean {
  return window.closesAt <= window.opensAt;
}

export interface HoursValidationResult {
  ok: boolean;
  errors: string[];
  /** Present only when `ok`. Normalised: sorted, with each day's windows in order. */
  value?: OpeningHours;
}

interface RawWindow {
  opensAt?: unknown;
  closesAt?: unknown;
}

/**
 * Validates and normalises hours as they arrive from an app.
 *
 * Refuses rather than repairs. A kitchen whose hours were silently "fixed" by
 * the server is a kitchen whose partner believes something untrue about when
 * they are open, and they find out from a customer.
 */
export function validateOpeningHours(input: unknown): HoursValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Opening hours must be an object.'] };
  }

  const raw = input as { week?: unknown; timezone?: unknown };
  const timezone =
    typeof raw.timezone === 'string' && raw.timezone.trim().length > 0
      ? raw.timezone.trim()
      : DEFAULT_TIMEZONE;

  if (raw.week === null || typeof raw.week !== 'object' || Array.isArray(raw.week)) {
    return { ok: false, errors: ['Opening hours must carry a `week`.'] };
  }

  const week: Partial<Record<DayOfWeek, ServingWindow[]>> = {};
  const rawWeek = raw.week as Record<string, unknown>;

  for (const key of Object.keys(rawWeek)) {
    if (!(DAYS_OF_WEEK as readonly string[]).includes(key)) {
      errors.push(`"${key}" is not a day of the week.`);
      continue;
    }
    const day = key as DayOfWeek;
    const value = rawWeek[key];

    if (!Array.isArray(value)) {
      errors.push(`${day}: expected a list of serving windows.`);
      continue;
    }
    if (value.length > MAX_WINDOWS_PER_DAY) {
      errors.push(`${day}: at most ${MAX_WINDOWS_PER_DAY} serving windows in a day.`);
      continue;
    }

    const windows: ServingWindow[] = [];
    let dayFailed = false;

    for (const entry of value as RawWindow[]) {
      const opensAt = parseTimeOfDay(entry?.opensAt);
      const closesAt = parseTimeOfDay(entry?.closesAt);

      if (opensAt === null || closesAt === null) {
        errors.push(`${day}: times must be written as HH:MM on a 24-hour clock.`);
        dayFailed = true;
        break;
      }
      if (opensAt === closesAt) {
        errors.push(`${day}: a window that opens and closes at ${formatTimeOfDay(opensAt)} is not a window.`);
        dayFailed = true;
        break;
      }
      windows.push({ opensAt, closesAt });
    }

    if (dayFailed) continue;

    // Sorted before the overlap check, so the check only ever compares
    // neighbours. Unsorted input is accepted and put in order; that is
    // presentation, not meaning, so normalising it misleads nobody.
    windows.sort((a, b) => a.opensAt - b.opensAt);

    let overlaps = false;
    for (let i = 0; i < windows.length; i += 1) {
      const current = windows[i]!;
      const next = windows[i + 1];

      // A window running past midnight ends after every later window on the
      // same day starts, so it can only be the last one declared.
      if (crossesMidnight(current) && i !== windows.length - 1) {
        overlaps = true;
        break;
      }
      if (next && current.closesAt > next.opensAt) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      errors.push(`${day}: serving windows overlap.`);
      continue;
    }

    week[day] = windows;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: { week, timezone } };
}

/**
 * Whether declared hours say this kitchen is serving at `at`.
 *
 * Returns null when hours have never been declared — which is NOT "closed". A
 * caller that treats null as closed shuts every restaurant onboarded before
 * opening hours existed, which is the whole platform.
 */
export function isWithinOpeningHours(hours: OpeningHours | undefined, at: Date): boolean | null {
  if (!hours || Object.keys(hours.week).length === 0) return null;

  const minutes = at.getHours() * 60 + at.getMinutes();
  const todayIndex = (at.getDay() + 6) % 7; // JS weeks start on Sunday; ours on Monday.
  const today = DAYS_OF_WEEK[todayIndex]!;
  const yesterday = DAYS_OF_WEEK[(todayIndex + 6) % 7]!;

  for (const window of hours.week[today] ?? []) {
    if (crossesMidnight(window)) {
      if (minutes >= window.opensAt) return true;
    } else if (minutes >= window.opensAt && minutes < window.closesAt) {
      return true;
    }
  }

  // The tail of last night's late window. A kitchen open 22:00–02:00 on Friday
  // is open at 01:00 on Saturday, and asking only about Saturday misses it.
  for (const window of hours.week[yesterday] ?? []) {
    if (crossesMidnight(window) && minutes < window.closesAt) return true;
  }

  return false;
}

/**
 * Is this kitchen taking orders right now?
 *
 * The one question the rest of the platform should ask, because the answer has
 * three inputs and getting their precedence wrong is how a customer orders from
 * a kitchen with nobody in it.
 *
 *   1. The manual switch wins when it is OFF. A partner who has gone offline
 *      has said something about right now that no schedule can overrule — the
 *      fryer broke, the chef went home, they have run out of rice.
 *   2. An unexpired override wins next. That is the partner saying "I know we
 *      are past our hours, we are serving anyway": a late night, a private
 *      booking, an hour of delivery after the counter shuts.
 *   3. Then the declared hours, which are the reason this exists. The most
 *      common complaint a food platform gets is not a bad dish; it is an order
 *      accepted by a restaurant that was shut, because somebody forgot to press
 *      the button. The schedule closes them.
 *   4. And a kitchen that has never declared hours behaves exactly as it always
 *      did — the switch is the whole answer. Reading "no hours" as "closed"
 *      would shut every restaurant onboarded before today, which is all of them.
 */
export function isKitchenServing(
  restaurant: {
    isOpen?: boolean;
    openingHours?: OpeningHours;
    forceOpenUntil?: string;
  },
  at: Date = new Date()
): boolean {
  if (restaurant.isOpen === false) return false;

  if (restaurant.forceOpenUntil) {
    const until = new Date(restaurant.forceOpenUntil).getTime();
    // An expired override is ignored rather than honoured, which is the whole
    // point of storing an expiry instead of a flag.
    if (Number.isFinite(until) && until > at.getTime()) return true;
  }

  const within = isWithinOpeningHours(restaurant.openingHours, at);
  if (within === null) return true;
  return within;
}

/**
 * When this kitchen next opens, as "HH:MM", or null if it cannot be said.
 *
 * Shown to a customer instead of a bare "Closed", because "Closed" invites
 * them to try again in five minutes and "Opens at 18:00" does not.
 */
export function nextOpensAt(
  hours: OpeningHours | undefined,
  at: Date = new Date()
): string | null {
  if (!hours || Object.keys(hours.week).length === 0) return null;

  const minutes = at.getHours() * 60 + at.getMinutes();
  const todayIndex = (at.getDay() + 6) % 7;

  // Today first, then the following week. Seven days rather than six, so a
  // kitchen open only on one day still gets an answer.
  for (let offset = 0; offset < 8; offset += 1) {
    const day = DAYS_OF_WEEK[(todayIndex + offset) % 7]!;
    const windows = [...(hours.week[day] ?? [])].sort((a, b) => a.opensAt - b.opensAt);
    for (const window of windows) {
      if (offset > 0 || window.opensAt > minutes) return formatTimeOfDay(window.opensAt);
    }
  }
  return null;
}

/**
 * The next moment the schedule would close this kitchen, as a real timestamp.
 *
 * Used when a partner taps Online outside their declared hours. The owner was
 * explicit about what should happen: "if he wants to go online he'll just
 * click online and from the time he'll be online", and the schedule should
 * only ever take them OFF shift, never refuse to put them on.
 *
 * So a manual Online is honoured until the schedule's next closing time, and
 * then lapses — which is exactly the behaviour the override already has, so
 * the toggle simply sets one rather than a second mechanism being invented.
 *
 * Returns null when hours were never declared, because then there is nothing
 * to lapse at and the manual switch is already the whole answer.
 */
export function nextClosesAt(hours: OpeningHours | undefined, at: Date = new Date()): Date | null {
  if (!hours || Object.keys(hours.week).length === 0) return null;

  const minutesNow = at.getHours() * 60 + at.getMinutes();
  const todayIndex = (at.getDay() + 6) % 7;

  for (let offset = 0; offset < 8; offset += 1) {
    const day = DAYS_OF_WEEK[(todayIndex + offset) % 7]!;
    const windows = [...(hours.week[day] ?? [])].sort((a, b) => a.opensAt - b.opensAt);

    for (const window of windows) {
      // A window running past midnight closes on the FOLLOWING day, which is
      // why this counts days rather than adding minutes to today.
      const closesDayOffset = crossesMidnight(window) ? offset + 1 : offset;
      if (closesDayOffset > offset || window.closesAt > minutesNow || offset > 0) {
        const when = new Date(at);
        when.setDate(when.getDate() + closesDayOffset);
        when.setHours(Math.floor(window.closesAt / 60), window.closesAt % 60, 0, 0);
        if (when.getTime() > at.getTime()) return when;
      }
    }
  }
  return null;
}
