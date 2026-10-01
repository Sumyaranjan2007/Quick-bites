/**
 * Full bank account numbers, encrypted, for paying by hand (owner, 2 Oct 2026).
 *
 * This platform used to keep only the last four digits, because bank accounts
 * were to be paid through RazorpayX, which holds the number itself. The owner
 * also pays by hand from their own bank, and nobody can send money to "ending
 * 4321". So the number a partner types is now kept — encrypted, and NOT on the
 * account record:
 *
 *   - It lives in its own table, keyed by account id. Account records are sent
 *     to apps whole in several places; a field on them would one day leak
 *     through a spread. This table is read by exactly one function.
 *   - AES-256-GCM, with a key derived from PAYEE_ACCOUNT_KEY (or, if that is not
 *     set, the server's JWT secret). The database alone does not reveal it.
 *   - Revealed only on an administrator's Pay screen, through one route that
 *     needs payout permission and writes an audit entry every time.
 *
 * A platform reset deletes the table with the accounts.
 */
import crypto from 'node:crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { config } from '../../config/env.ts';

export const ACCOUNT_NUMBERS_KEY = 'payee-account-numbers';

function key(): Buffer {
  const secret = process.env.PAYEE_ACCOUNT_KEY || config.JWT_SECRET;
  return crypto.createHash('sha256').update(`quick-bites:payee-account:${secret}`).digest();
}

function table(): Record<string, string> {
  return (memoryStore.meta.get(ACCOUNT_NUMBERS_KEY) as Record<string, string>) || {};
}

export function storeAccountNumber(accountId: string, accountNumber: string): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  memoryStore.meta.set(ACCOUNT_NUMBERS_KEY, { ...table(), [accountId]: sealed });
  triggerAutoSave();
}

/** The full number, or null when it was filed before numbers were kept. */
export function revealAccountNumber(accountId: string): string | null {
  const sealed = table()[accountId];
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    // The key changed since it was stored. Treated as not kept: the partner
    // re-enters it, rather than anybody being shown garbage to pay into.
    return null;
  }
}

export function hasAccountNumber(accountId: string): boolean {
  return Boolean(table()[accountId]);
}
