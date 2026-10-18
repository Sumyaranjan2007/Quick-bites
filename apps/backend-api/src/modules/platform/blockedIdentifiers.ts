/**
 * Who may never open an account again (owner Q1, 18 Oct 2026: "Block").
 *
 * A blocked account keeps its email and phone, so those cannot sign up again
 * anyway. What this adds: the same person under a new address (a Gmail with
 * dots or a +tag, the same number written differently) and the same business
 * under new contact details (its FSSAI licence, GSTIN, a rider's driving
 * licence). Each is stored only as a hash of its canonical form (review D6:
 * hashing the raw value is beaten by formatting).
 *
 * One record in the settings store, so no new collection: hash → who and when.
 * Unblocking removes that account's entries.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { normalizeIndianPhone } from '../../utils/phone.ts';
import { AppError } from '../../utils/AppError.ts';

export type IdentifierKind = 'email' | 'phone' | 'fssai' | 'gstin' | 'license';
type Entry = { kind: IdentifierKind; userId: string; at: string };
const KEY = 'blockedIdentifiers';

/** The one form every spelling of the same identifier reduces to. */
export function canonical(kind: IdentifierKind, raw: string | undefined | null): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (kind === 'phone') return normalizeIndianPhone(value);
  if (kind === 'email') {
    const [local = '', domain = ''] = value.toLowerCase().split('@');
    if (!domain) return '';
    const base = local.split('+')[0];
    // Gmail ignores dots and anything after "+"; the same inbox, the same person.
    const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
    return `${gmail ? base.replace(/\./g, '') : base}@${gmail ? 'gmail.com' : domain}`;
  }
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const hashOf = (kind: IdentifierKind, raw: string | undefined | null): string | null => {
  const c = canonical(kind, raw);
  return c ? crypto.createHash('sha256').update(`${kind}:${c}`).digest('hex') : null;
};
const table = (): Record<string, Entry> => (memoryStore.settings.get(KEY) as Record<string, Entry>) || {};

/** Bans every identifier of this account: its email, phone, its kitchens' licences, its rider licence. */
export function banAccount(userId: string): number {
  const user: any = memoryStore.users.get(userId);
  if (!user) return 0;
  const found: Array<[IdentifierKind, string | undefined]> = [
    ['email', user.email],
    ['phone', user.phone]
  ];
  for (const r of memoryStore.restaurants.values() as Iterable<any>) {
    if (r.ownerId !== userId) continue;
    found.push(['fssai', r.fssaiLicenseNumber], ['gstin', r.gstin], ['phone', r.phone]);
  }
  for (const rider of memoryStore.riders.values() as Iterable<any>) {
    if (rider.userId === userId) found.push(['license', rider.licenseNumber], ['phone', rider.phone]);
  }
  const next = { ...table() };
  const at = new Date().toISOString();
  let added = 0;
  for (const [kind, raw] of found) {
    const h = hashOf(kind, raw);
    // Phone addresses on Quick Bites' own placeholder domain are not a person's.
    if (!h || (kind === 'email' && String(raw).endsWith('@phone.quickbite.app'))) continue;
    if (!next[h]) added++;
    next[h] = { kind, userId, at };
  }
  memoryStore.settings.set(KEY, next);
  triggerAutoSave();
  return added;
}

/** Unblocking: this account's identifiers may be used again. */
export function unbanAccount(userId: string): void {
  const next = Object.fromEntries(Object.entries(table()).filter(([, e]) => e.userId !== userId));
  memoryStore.settings.set(KEY, next);
  triggerAutoSave();
}

/**
 * Refuses a new account (or a new identifier on one) that matches a blocked
 * account. One answer whatever matched, so the form does not say which.
 * `exceptUserId`: the blocked account itself is refused elsewhere (it is blocked).
 */
export function assertNotBanned(identifiers: Partial<Record<IdentifierKind, string | undefined | null>>, exceptUserId?: string): void {
  const banned = table();
  for (const [kind, raw] of Object.entries(identifiers) as Array<[IdentifierKind, string]>) {
    const h = hashOf(kind, raw);
    const entry = h ? banned[h] : undefined;
    if (entry && entry.userId !== exceptUserId) {
      throw new AppError('This account cannot be created. Contact Quick Bites support.', 403, 'IDENTITY_BLOCKED');
    }
  }
}
