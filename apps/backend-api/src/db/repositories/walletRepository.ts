/**
 * Customer wallets, and the journal that proves the balances.
 *
 * Money in a `balance` field that is assigned to directly is money nobody can
 * audit. If that number is ever wrong — a double credit from a retried refund,
 * a debit applied twice by two concurrent checkouts — there is no way to find
 * out when it went wrong, by how much, or because of what, because the only
 * record of the correct value was overwritten by the incorrect one.
 *
 * So every movement writes an immutable entry, and each entry carries the
 * balance it produced. The stored balance stays (reading it is a Map lookup
 * rather than a replay of a year of history) but it is now a cache of the
 * journal rather than the truth, and `auditBalance` can say at any moment
 * whether the cache still agrees with what actually happened.
 *
 * Three defects this rewrite fixes, all of which were reachable from live code
 * paths:
 *
 *   - Neither credit nor debit validated the amount. `credit(userId, -500)`
 *     subtracted five hundred rupees while skipping the insufficient-funds
 *     check entirely, because that check lives in `debit`. A refund service
 *     passing a negative by mistake could drive a wallet below zero.
 *   - The balance was rounded to paise; the amount recorded in the journal was
 *     not. Credit 10.005 and the balance moved by 10.01 while the history said
 *     10.005, so the two drifted apart by construction, permanently, with every
 *     entry.
 *   - `Date.now()` plus six random characters is fine until two entries land in
 *     the same millisecond with the same suffix, at which point the Map key
 *     collides and one of the two movements is silently discarded. Money that
 *     vanishes without an error is the worst failure mode available here.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { Wallet, WalletTransaction } from '@quick-bites/shared-types';

/** Rupees, to the paise. Applied to every amount before it is used or stored. */
function toPaiseRounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertUsableAmount(amount: number, operation: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`Wallet ${operation} needs a number, received ${String(amount)}.`);
  }
  const rounded = toPaiseRounded(amount);
  if (rounded <= 0) {
    // Rejected rather than flipped into the opposite operation. A credit of a
    // negative amount is always a bug at the call site, and turning it into a
    // debit would hide that bug behind a movement that looked deliberate.
    throw new Error(`Wallet ${operation} must be a positive amount, received ${rounded}.`);
  }
  return rounded;
}

export class WalletRepository {
  async getByUserId(userId: string): Promise<Wallet> {
    let wallet = memoryStore.wallets.get(userId);
    if (!wallet) {
      wallet = {
        id: `wlt_${userId}`,
        userId,
        balance: 0.0,
        currency: 'INR',
        updatedAt: new Date().toISOString()
      };
      memoryStore.wallets.set(userId, wallet);
      triggerAutoSave();
    }
    return wallet;
  }

  /**
   * Writes one journal entry and moves the cached balance to match it.
   *
   * Both halves happen here so there is no call path that can do one without
   * the other. The entry is written after the balance is computed and carries
   * that balance, which is what makes an audit possible later.
   */
  private async post(
    userId: string,
    type: 'CREDIT' | 'DEBIT',
    amount: number,
    description: string,
    orderId?: string
  ): Promise<Wallet> {
    const wallet = await this.getByUserId(userId);
    const delta = type === 'CREDIT' ? amount : -amount;
    const nextBalance = toPaiseRounded(wallet.balance + delta);

    // Checked against the computed balance rather than by comparing the amount
    // to the current one, so a rounding step cannot let a wallet end at -0.01.
    if (nextBalance < 0) {
      throw new Error(
        `Insufficient wallet balance: available Rs ${wallet.balance.toFixed(2)}, requested Rs ${amount.toFixed(2)}`
      );
    }

    const now = new Date().toISOString();
    wallet.balance = nextBalance;
    wallet.updatedAt = now;
    memoryStore.wallets.set(userId, wallet);

    const entry: WalletTransaction = {
      // randomUUID rather than a timestamp and six random characters: a
      // collision here overwrites a movement of money and reports success.
      id: `tx_${crypto.randomUUID()}`,
      walletId: wallet.id,
      orderId,
      amount,
      type,
      description,
      createdAt: now,
      balanceAfter: nextBalance
    };
    memoryStore.walletTransactions.set(entry.id, entry);
    triggerAutoSave();

    return wallet;
  }

  async credit(userId: string, amount: number, description: string, orderId?: string): Promise<Wallet> {
    return this.post(userId, 'CREDIT', assertUsableAmount(amount, 'credit'), description, orderId);
  }

  async debit(userId: string, amount: number, description: string, orderId?: string): Promise<Wallet> {
    return this.post(userId, 'DEBIT', assertUsableAmount(amount, 'debit'), description, orderId);
  }

  async getTransactions(walletId: string): Promise<WalletTransaction[]> {
    const list: WalletTransaction[] = [];
    for (const tx of memoryStore.walletTransactions.values()) {
      if (tx.walletId === walletId) list.push(tx);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Replays a wallet's journal and reports whether the stored balance matches.
   *
   * This is the point of the journal. A balance that cannot be re-derived is a
   * balance nobody can defend when a customer says their money is missing, and
   * the only way to know whether it can be re-derived is to try.
   *
   * Entries are replayed oldest-first, which is the opposite of the order
   * `getTransactions` returns them in — that one is sorted for a screen.
   */
  async auditBalance(userId: string): Promise<{
    walletId: string;
    storedBalance: number;
    replayedBalance: number;
    entries: number;
    /** Stored minus replayed. Zero is the only acceptable value. */
    discrepancy: number;
    /** The id of the earliest entry whose own running total no longer replays. */
    firstDivergentEntry: string | null;
    /** False when the balance has acquired a fraction of a paise. */
    wholePaise: boolean;
    balanced: boolean;
  }> {
    const wallet = await this.getByUserId(userId);
    const entries = (await this.getTransactions(wallet.id)).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let replayed = 0;
    // The first entry whose recorded running balance disagrees with the replay.
    //
    // Comparing only the final totals is not enough: the replay and the stored
    // balance are computed by the same arithmetic, so a defect in that
    // arithmetic moves both together and the two agree while both are wrong.
    // `balanceAfter` was written at the time the entry was posted, by whatever
    // the code did THEN, which is the independent witness.
    let firstDivergentEntry: string | null = null;

    for (const entry of entries) {
      replayed = toPaiseRounded(replayed + (entry.type === 'CREDIT' ? entry.amount : -entry.amount));
      if (
        firstDivergentEntry === null &&
        typeof entry.balanceAfter === 'number' &&
        Math.abs(entry.balanceAfter - replayed) >= 0.005
      ) {
        firstDivergentEntry = entry.id;
      }
    }

    // NOT rounded. Rounding the difference is how a drift of a fraction of a
    // paise per entry hides: two thousand entries each off by 0.002 is four
    // rupees that never appears, because every individual comparison rounds to
    // zero. The raw difference is compared against half a paise instead.
    const discrepancy = wallet.balance - replayed;

    // A balance that is not a whole number of paise cannot be paid out and
    // cannot be printed on a statement, so it is wrong whatever it agrees with.
    // Checked separately because a stored balance and a replay computed by the
    // same broken arithmetic agree with each other perfectly.
    const wholePaise = Math.abs(wallet.balance * 100 - Math.round(wallet.balance * 100)) < 1e-6;

    return {
      walletId: wallet.id,
      storedBalance: wallet.balance,
      replayedBalance: replayed,
      entries: entries.length,
      discrepancy: toPaiseRounded(discrepancy),
      firstDivergentEntry,
      wholePaise,
      balanced: Math.abs(discrepancy) < 0.005 && firstDivergentEntry === null && wholePaise
    };
  }

  /**
   * Every wallet whose stored balance no longer matches its journal.
   *
   * Returns the discrepancies rather than correcting them. An automatic
   * correction would erase the evidence of whatever caused the divergence, and
   * the cause is the thing worth finding — a wallet that is wrong once is a
   * mistake, and a wallet that goes wrong again after being silently fixed is a
   * bug nobody knew was still there.
   */
  async auditAllBalances(): Promise<
    Array<{ userId: string; storedBalance: number; replayedBalance: number; discrepancy: number }>
  > {
    const problems: Array<{
      userId: string;
      storedBalance: number;
      replayedBalance: number;
      discrepancy: number;
    }> = [];

    for (const wallet of memoryStore.wallets.values() as Iterable<Wallet>) {
      const audit = await this.auditBalance(wallet.userId);
      if (!audit.balanced) {
        problems.push({
          userId: wallet.userId,
          storedBalance: audit.storedBalance,
          replayedBalance: audit.replayedBalance,
          discrepancy: audit.discrepancy
        });
      }
    }

    return problems;
  }
}

export const walletRepository = new WalletRepository();
