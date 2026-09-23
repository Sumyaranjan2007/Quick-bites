/**
 * The ledger: double-entry bookkeeping for every rupee the platform touches.
 *
 * -------------------------------------------------------------------------
 * BALANCES ARE NOT STORED
 * -------------------------------------------------------------------------
 * There is no balance column anywhere in this module. A balance is derived by
 * replaying the entries that produced it, every time it is asked for.
 *
 * That is deliberate, and it is the difference between books that are probably
 * right and books somebody has actually checked. A stored balance and the
 * journal behind it can disagree — the wallet audit route exists precisely
 * because they did — and when they disagree there is no way to tell which one
 * lied. Derived balances cannot drift from their own evidence.
 *
 * -------------------------------------------------------------------------
 * EVERY MOVEMENT BALANCES
 * -------------------------------------------------------------------------
 * A transaction is refused unless its debits equal its credits to the paisa.
 * Money does not appear and does not vanish; it moves from one account to
 * another, and if a caller cannot say where it came from then the caller does
 * not yet understand the movement well enough to record it.
 *
 * -------------------------------------------------------------------------
 * NOTHING POSTS TWICE
 * -------------------------------------------------------------------------
 * Every transaction carries an idempotency key naming the real-world event it
 * records — `order_paid:ord_123`, `payout_sent:pay_9`. A second attempt with
 * the same key is a no-op that returns the original entries rather than an
 * error, because the caller retrying is usually a webhook Razorpay is redelivering
 * and it is not wrong to do so.
 *
 * -------------------------------------------------------------------------
 * NOTHING IS EVER EDITED
 * -------------------------------------------------------------------------
 * There is no update and no delete in this module. A mistake is corrected by
 * posting its reverse, which leaves both the error and the correction on the
 * record. Any other arrangement means the books can be quietly rewritten by
 * whoever last had access, which is the specific thing a ledger exists to
 * prevent.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { assertWholePaise, formatPaise } from './money.ts';
import type {
  LedgerAccountKind,
  LedgerEntry,
  LedgerTransaction
} from '@quick-bites/shared-types';

/** `PARTNER_PAYABLE:rst_12` → `{ kind: 'PARTNER_PAYABLE', partyId: 'rst_12' }`. */
export function parseAccount(account: string): { kind: LedgerAccountKind; partyId?: string } {
  const [kind, ...rest] = account.split(':');
  return { kind: kind as LedgerAccountKind, partyId: rest.length > 0 ? rest.join(':') : undefined };
}

export function accountFor(kind: LedgerAccountKind, partyId?: string): string {
  return partyId ? `${kind}:${partyId}` : kind;
}

/**
 * Which direction increases an account.
 *
 * Standard bookkeeping: what the platform HOLDS (its bank, money owed to it)
 * grows with a debit; what the platform OWES (a partner, a rider, the taxman)
 * and what it has EARNED grows with a credit.
 *
 * Needed because "balance" means opposite arithmetic for the two kinds, and
 * getting it backwards would report a rider we owe Rs 400 as being Rs 400 in
 * debt to us — a mistake that reads as plausible on a screen.
 */
const DEBIT_POSITIVE: ReadonlySet<LedgerAccountKind> = new Set<LedgerAccountKind>([
  'PLATFORM_BANK',
  'GATEWAY_RECEIVABLE',
  'RIDER_CASH',
  // Money in the office drawer is an ASSET, exactly like the bank and the
  // rider's pocket. Omitting it here made a positive holding report as a
  // negative balance, and the refusal message read "the office is holding
  // -Rs 434.90" -- which is the shape of a number nobody can act on.
  'PLATFORM_CASH',
  'TDS_WITHHELD',
  'REFUNDS_PAID'
]);

export function increasesWithDebit(account: string): boolean {
  return DEBIT_POSITIVE.has(parseAccount(account).kind);
}

function entriesArray(): LedgerEntry[] {
  return Array.from(memoryStore.ledgerEntries.values()) as LedgerEntry[];
}

/**
 * Whether a transaction with this key has already been recorded.
 *
 * A linear scan. At the volumes this platform runs at that is nothing, and the
 * alternative — a second index that must be kept in step with the entries — is
 * a thing that can be wrong. When it stops being nothing, the index belongs in
 * the repository layer alongside the rows it indexes, not here.
 */
function findByIdempotencyKey(key: string): LedgerEntry[] {
  return entriesArray().filter(e => e.idempotencyKey === key);
}

/**
 * Records one movement of money.
 *
 * Returns the entries written, or the entries that were already there if this
 * exact movement has been recorded before.
 */
export function post(transaction: LedgerTransaction): LedgerEntry[] {
  const { postings, idempotencyKey } = transaction;

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new AppError(
      'A ledger transaction must carry an idempotency key naming what it records.',
      500,
      'LEDGER_KEY_REQUIRED'
    );
  }

  const existing = findByIdempotencyKey(idempotencyKey);
  if (existing.length > 0) {
    // Not an error. A redelivered webhook, a retried request and a rider with a
    // bad connection tapping twice all land here, and all three are behaving
    // correctly. The money moved once; say so and hand back the proof.
    return existing.sort((a, b) => a.id.localeCompare(b.id));
  }

  if (!Array.isArray(postings) || postings.length < 2) {
    throw new AppError(
      'A ledger transaction needs at least two postings. Money comes from somewhere.',
      500,
      'LEDGER_INCOMPLETE'
    );
  }

  let debits = 0;
  let credits = 0;
  for (const posting of postings) {
    assertWholePaise(posting.amountPaise, 'posting');
    if (!posting.account || posting.account.trim().length === 0) {
      throw new AppError('A ledger posting must name an account.', 500, 'LEDGER_NO_ACCOUNT');
    }
    if (posting.direction === 'DEBIT') debits += posting.amountPaise;
    else if (posting.direction === 'CREDIT') credits += posting.amountPaise;
    else throw new AppError('A posting is either a DEBIT or a CREDIT.', 500, 'LEDGER_BAD_DIRECTION');
  }

  if (debits !== credits) {
    // The message carries both sides and the difference, because the useful
    // question when this fires is "which line did I forget", and that is
    // usually answerable from the size of the gap alone.
    throw new AppError(
      `Ledger transaction does not balance: debits ${formatPaise(debits)} against credits ` +
        `${formatPaise(credits)}, a difference of ${formatPaise(Math.abs(debits - credits))}.`,
      500,
      'LEDGER_UNBALANCED'
    );
  }

  const transactionId = `ltx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const occurredAt = transaction.occurredAt || new Date().toISOString();
  const createdAt = new Date().toISOString();

  const written: LedgerEntry[] = postings.map((posting, index) => {
    const entry: LedgerEntry = {
      id: `led_${transactionId.slice(4)}_${String(index).padStart(2, '0')}`,
      transactionId,
      occurredAt,
      event: transaction.event,
      account: posting.account,
      direction: posting.direction,
      amountPaise: posting.amountPaise,
      orderId: transaction.orderId,
      payoutId: transaction.payoutId,
      refundCaseId: transaction.refundCaseId,
      cashDepositId: transaction.cashDepositId,
      idempotencyKey,
      actorUserId: transaction.actorUserId || 'system',
      narration: transaction.narration,
      createdAt
    };
    memoryStore.ledgerEntries.set(entry.id, entry);
    return entry;
  });

  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: createdAt,
      event: 'LEDGER_POSTED',
      ledgerEvent: transaction.event,
      transactionId,
      amountPaise: debits,
      accounts: postings.map(p => `${p.direction === 'DEBIT' ? '+' : '-'}${p.account}`),
      orderId: transaction.orderId,
      actorUserId: transaction.actorUserId
    })
  );

  return written;
}

/**
 * What an account holds, in paise, by replaying every entry against it.
 *
 * Positive means what the account's kind means by positive: the platform's bank
 * holding money, or a partner being owed it.
 */
export function balanceOf(account: string): number {
  const debitPositive = increasesWithDebit(account);
  let total = 0;
  for (const entry of entriesArray()) {
    if (entry.account !== account) continue;
    const signed = entry.direction === 'DEBIT' ? entry.amountPaise : -entry.amountPaise;
    total += debitPositive ? signed : -signed;
  }
  return total;
}

/** Every account of one kind, with its balance. Skips accounts that net to zero. */
export function balancesByKind(kind: LedgerAccountKind): Array<{ account: string; partyId?: string; balancePaise: number }> {
  const accounts = new Set<string>();
  for (const entry of entriesArray()) {
    if (parseAccount(entry.account).kind === kind) accounts.add(entry.account);
  }
  return Array.from(accounts)
    .map(account => ({
      account,
      partyId: parseAccount(account).partyId,
      balancePaise: balanceOf(account)
    }))
    .filter(row => row.balancePaise !== 0)
    .sort((a, b) => b.balancePaise - a.balancePaise);
}

export interface LedgerQuery {
  account?: string;
  accountKind?: LedgerAccountKind;
  partyId?: string;
  orderId?: string;
  payoutId?: string;
  event?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** Entries matching a query, newest first. */
export function query(filter: LedgerQuery = {}): LedgerEntry[] {
  let rows = entriesArray();

  if (filter.account) rows = rows.filter(e => e.account === filter.account);
  if (filter.accountKind) rows = rows.filter(e => parseAccount(e.account).kind === filter.accountKind);
  if (filter.partyId) rows = rows.filter(e => parseAccount(e.account).partyId === filter.partyId);
  if (filter.orderId) rows = rows.filter(e => e.orderId === filter.orderId);
  if (filter.payoutId) rows = rows.filter(e => e.payoutId === filter.payoutId);
  if (filter.event) rows = rows.filter(e => e.event === filter.event);
  if (filter.from) rows = rows.filter(e => e.occurredAt >= filter.from!);
  if (filter.to) rows = rows.filter(e => e.occurredAt <= filter.to!);

  rows.sort((a, b) => (b.occurredAt === a.occurredAt ? b.id.localeCompare(a.id) : b.occurredAt.localeCompare(a.occurredAt)));
  return filter.limit ? rows.slice(0, filter.limit) : rows;
}

export interface LedgerAudit {
  checkedAt: string;
  entryCount: number;
  transactionCount: number;
  /** Every debit on the platform against every credit. Must be equal. */
  totalDebitPaise: number;
  totalCreditPaise: number;
  balanced: boolean;
  /** Transactions whose own postings do not balance. Expected to be empty. */
  unbalancedTransactions: Array<{ transactionId: string; event: string; debitPaise: number; creditPaise: number; differencePaise: number }>;
  /** Idempotency keys held by more than one transaction. Expected to be empty. */
  duplicateKeys: Array<{ idempotencyKey: string; transactionIds: string[] }>;
  /** Amounts that are not whole paise. Expected to be empty. */
  fractionalAmounts: Array<{ entryId: string; amountPaise: number }>;
}

/**
 * Re-derives everything and reports what disagrees.
 *
 * REPORTS. It does not repair. A silent correction would destroy the evidence
 * of whatever caused the divergence, which is the only thing here worth acting
 * on — the same reasoning as the wallet audit this replaces.
 *
 * An empty result is the expected answer and is the point: it turns "the books
 * are probably fine" into something somebody has verified today.
 */
export function audit(): LedgerAudit {
  const rows = entriesArray();

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;
  const byTransaction = new Map<string, { event: string; debit: number; credit: number }>();
  const byKey = new Map<string, Set<string>>();
  const fractionalAmounts: LedgerAudit['fractionalAmounts'] = [];

  for (const entry of rows) {
    if (!Number.isInteger(entry.amountPaise)) {
      fractionalAmounts.push({ entryId: entry.id, amountPaise: entry.amountPaise });
    }

    if (entry.direction === 'DEBIT') totalDebitPaise += entry.amountPaise;
    else totalCreditPaise += entry.amountPaise;

    const group = byTransaction.get(entry.transactionId) || { event: entry.event, debit: 0, credit: 0 };
    if (entry.direction === 'DEBIT') group.debit += entry.amountPaise;
    else group.credit += entry.amountPaise;
    byTransaction.set(entry.transactionId, group);

    const keyed = byKey.get(entry.idempotencyKey) || new Set<string>();
    keyed.add(entry.transactionId);
    byKey.set(entry.idempotencyKey, keyed);
  }

  const unbalancedTransactions: LedgerAudit['unbalancedTransactions'] = [];
  for (const [transactionId, group] of byTransaction) {
    if (group.debit !== group.credit) {
      unbalancedTransactions.push({
        transactionId,
        event: group.event,
        debitPaise: group.debit,
        creditPaise: group.credit,
        differencePaise: group.debit - group.credit
      });
    }
  }

  const duplicateKeys: LedgerAudit['duplicateKeys'] = [];
  for (const [idempotencyKey, transactionIds] of byKey) {
    if (transactionIds.size > 1) {
      duplicateKeys.push({ idempotencyKey, transactionIds: Array.from(transactionIds) });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    entryCount: rows.length,
    transactionCount: byTransaction.size,
    totalDebitPaise,
    totalCreditPaise,
    balanced:
      totalDebitPaise === totalCreditPaise &&
      unbalancedTransactions.length === 0 &&
      duplicateKeys.length === 0 &&
      fractionalAmounts.length === 0,
    unbalancedTransactions,
    duplicateKeys,
    fractionalAmounts
  };
}

/**
 * Reverses a transaction by posting its mirror.
 *
 * The original stays. Both movements are on the record, which is what an
 * auditor needs and what an edit would have destroyed.
 */
export function reverse(
  transactionId: string,
  actor: { userId: string },
  reason: string
): LedgerEntry[] {
  const original = entriesArray().filter(e => e.transactionId === transactionId);
  if (original.length === 0) {
    throw new AppError('No such ledger transaction.', 404, 'LEDGER_TRANSACTION_NOT_FOUND');
  }

  return post({
    event: 'CORRECTION',
    postings: original.map(e => ({
      account: e.account,
      direction: e.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
      amountPaise: e.amountPaise
    })),
    idempotencyKey: `reverse:${transactionId}`,
    actorUserId: actor.userId,
    narration: `Reversal of ${transactionId}: ${reason}`,
    orderId: original[0].orderId,
    payoutId: original[0].payoutId,
    refundCaseId: original[0].refundCaseId
  });
}

/** Only used by tests, which need a clean slate. */
export function resetLedgerForTesting(): void {
  memoryStore.ledgerEntries.clear();
}

export const ledger = {
  post,
  balanceOf,
  balancesByKind,
  query,
  audit,
  reverse,
  accountFor,
  parseAccount,
  increasesWithDebit
};
