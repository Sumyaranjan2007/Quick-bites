import { z } from 'zod';

/**
 * Indian mobile numbers, validated once so every entry point agrees.
 *
 * The account form accepted anything up to twenty characters, so a number could
 * be saved with eleven digits, with letters in it, or with a stray country code
 * that made it a different number from the one the rider would dial. A delivery
 * depends on someone being reachable, which makes this worth being strict about.
 *
 * A subscriber number is exactly ten digits and starts with 6-9; 0-5 are not
 * allocated to mobile services. A leading `0`, `+91` or `91` is a prefix people
 * genuinely type, so it is accepted and stripped rather than rejected, and the
 * stored value is always the bare ten digits.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalizeIndianPhone(raw: string): string {
  const digitsOnly = String(raw).replace(/[^\d]/g, '');
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly.slice(2);
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) return digitsOnly.slice(1);
  return digitsOnly;
}

export const PHONE_ERROR = 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';

/**
 * The zod field to use wherever a phone number is accepted.
 *
 * Transforms as well as validates, so a handler that passes the parsed value
 * straight to the repository stores the normalised number without having to
 * remember to normalise it.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizeIndianPhone)
  .refine(value => INDIAN_MOBILE.test(value), { message: PHONE_ERROR });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .transform(normalizeIndianPhone)
  .refine(value => value === '' || INDIAN_MOBILE.test(value), { message: PHONE_ERROR })
  .optional();
