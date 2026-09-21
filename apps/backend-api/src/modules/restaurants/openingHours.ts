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

/** Minutes a window actually covers, counting the wrap past midnight. */
export function windowLengthMinutes(window: ServingWindow): number {
  return crossesMidnight(window)
    ? MINUTES_IN_DAY - window.opensAt + window.closesAt
    : window.closesAt - window.opensAt;
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
