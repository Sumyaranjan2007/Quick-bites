/**
 * Money, as integers.
 *
 * The rest of this platform carries money as rupees in a JavaScript number and
 * rounds at every step — `Math.round(x * 100) / 100` appears eighteen times in
 * the pricing engine alone. For displaying a bill that is fine. For books that
 * must sum to zero it is not: 0.1 + 0.2 is not 0.3, and a ledger whose entries
 * are floats will eventually fail to balance by a paisa for reasons nobody can
 * reconstruct.
 *
 * So everything the ledger touches is an integer count of paise, and this
 * module is the only place rupees and paise are converted. Nothing else is
 * allowed to multiply money by 100.
 *
 * The bill the customer sees is unchanged. This is about what we record, not
 * what we charge.
 */
import { AppError } from '../../utils/AppError.ts';

/** The largest amount this platform will handle in one movement: Rs 1 crore. */
const MAX_PAISE = 1_000_000_000;

/**
 * Rupees to paise.
 *
 * Rounds to the nearest paisa rather than truncating: truncation is a
 * systematic bias, and a bias applied to every order is money that ends up
 * somewhere.
 *
 * The correction is RELATIVE, not absolute, and that distinction is the whole
 * of this function. `1.005 * 100` is 100.49999999999999 in binary floating
 * point and `2.675 * 100` is 267.49999999999997 — both a hair under a boundary
 * they should be sitting exactly on, and both would round down. Adding a flat
 * `Number.EPSILON` does not rescue either, because EPSILON is the gap between
 * 1 and the next representable number and is far too small at the scale of a
 * few hundred. Scaling by `1 + EPSILON` grows the correction with the value,
 * which is what the error itself does.
 *
 * The sign is taken off first and put back afterwards, so this rounds half away
 * from zero in both directions. `Math.round(-100.5)` is -100, which would make
 * a correction and the entry it reverses differ by a paisa.
 */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new AppError('An amount must be a number.', 500, 'INVALID_AMOUNT');
  }
  const sign = rupees < 0 ? -1 : 1;
  const scaled = Math.abs(rupees) * 100;
  const paise = sign * Math.round(scaled * (1 + Number.EPSILON));
  if (Math.abs(paise) > MAX_PAISE) {
    throw new AppError('That amount is outside the range this platform handles.', 400, 'AMOUNT_OUT_OF_RANGE');
  }
  return paise;
}

/** Paise back to rupees, for display and for the existing float-based code. */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * A percentage of an amount, in paise, rounded to the nearest paisa.
 *
 * Used for commission, GST, TDS and TCS. Kept here rather than written out at
 * each call site so that every tax on the platform rounds the same way — two
 * different roundings of the same rate is how a settlement ends up a paisa away
 * from the invoice.
 */
export function percentOf(paise: number, percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new AppError('A rate must be a number.', 500, 'INVALID_RATE');
  }
  return Math.round((paise * percent) / 100);
}

/** Formats paise for a human: `12345` becomes `Rs 123.45`. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  return `${sign}Rs ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Refuses anything that is not a whole, positive number of paise.
 *
 * Called on every posting before it reaches the ledger. A fractional paisa
 * means a float leaked in somewhere upstream, and the useful moment to find
 * that out is now rather than during a month-end reconciliation.
 */
export function assertWholePaise(value: number, what = 'amount'): number {
  if (!Number.isInteger(value)) {
    throw new AppError(
      `A ledger ${what} must be a whole number of paise, received ${value}.`,
      500,
      'FRACTIONAL_PAISE'
    );
  }
  if (value <= 0) {
    throw new AppError(
      `A ledger ${what} must be positive. Direction carries the sign, not the amount.`,
      500,
      'NON_POSITIVE_AMOUNT'
    );
  }
  if (value > MAX_PAISE) {
    throw new AppError('That amount is outside the range this platform handles.', 400, 'AMOUNT_OUT_OF_RANGE');
  }
  return value;
}
