/**
 * Settlements that were marked paid before the ledger knew about them.
 *
 * -------------------------------------------------------------------------
 * MONEY THAT LEFT THE BANK WITH NO RECORD THAT IT DID
 * -------------------------------------------------------------------------
 * The Settlements screen let an administrator draft a restaurant settlement and mark
 * it PAID. That wrote the settlement record and an audit line and posted NOTHING to
 * the ledger — so `PARTNER_PAYABLE` was untouched and `PLATFORM_BANK` never saw the
 * money leave.
 *
 * Two consequences, and the second is the expensive one. The books overstate the
 * bank by every settlement ever paid this way. And `duesFor` still shows that money
 * as owed, so the Pay screen will pay the same partner again — which became a live
 * double payment the moment the payable calculation was fixed.
 *
 * -------------------------------------------------------------------------
 * WHY POSTING THEM IS NOT REWRITING HISTORY
 * -------------------------------------------------------------------------
 * Nothing here alters an existing entry. Each of these transfers really happened:
 * an administrator pressed the button, a bank transfer was made, and the settlement
 * record carries its reference. What was missing was the bookkeeping. Writing it down
 * now is the difference between books that are behind and books that are wrong.
 *
 * A payable that goes NEGATIVE as a result is the honest answer, not a bug to
 * smooth over. It means that partner was paid more than the ledger says they earned
 * — which is exactly what happens when a settlement is computed by a different
 * formula that ignores packaging and uses a different TDS base. A negative payable
 * nets off their next run, which is the correction mechanism the platform already
 * uses for refund clawbacks.
 *
 * Idempotent, keyed on the settlement, so it is safe at boot and safe to run again.
 */
import { ledger, accountFor } from './ledger.ts';
import { toPaise, formatPaise } from './money.ts';
import { memoryStore } from '../../db/client.ts';

export function legacySettlementKeyFor(settlementId: string): string {
  return `legacy_settlement:${settlementId}`;
}

/** Whether this already-paid settlement has been written into the books. */
export function legacySettlementPosted(settlementId: string): boolean {
  return ledger.hasTransaction(legacySettlementKeyFor(settlementId));
}

/**
 * Posts every PAID settlement the ledger has never seen.
 *
 * Returns the count and total, which the Pay screen surfaces: a partner whose payable
 * suddenly drops, or goes negative, deserves an explanation on the screen rather than
 * in a log nobody reads.
 */
export function backfillLegacySettlements(): {
  posted: number;
  skipped: number;
  totalPaise: number;
} {
  let posted = 0;
  let skipped = 0;
  let totalPaise = 0;

  for (const settlement of memoryStore.restaurantSettlements.values() as Iterable<any>) {
    const id = String(settlement?.id || '');
    if (!id || settlement?.status !== 'PAID' || !settlement?.restaurantId) {
      skipped += 1;
      continue;
    }

    /*
     * A settlement drafted AFTER this was fixed already has a payout behind it, and
     * that payout posted its own entry. Posting again would double-count the very
     * thing this exists to stop.
     */
    if (settlement.payoutId) {
      skipped += 1;
      continue;
    }

    if (legacySettlementPosted(id)) {
      skipped += 1;
      continue;
    }

    const amountPaise = toPaise(Number(settlement.netAmount) || 0);
    if (amountPaise <= 0) {
      skipped += 1;
      continue;
    }

    try {
      ledger.post({
        event: 'PAYOUT_SENT',
        postings: [
          {
            account: accountFor('PARTNER_PAYABLE', settlement.restaurantId),
            direction: 'DEBIT',
            amountPaise
          },
          { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise }
        ],
        idempotencyKey: legacySettlementKeyFor(id),
        actorUserId: 'system:legacy-settlement',
        narration:
          `${formatPaise(amountPaise)} paid to ${settlement.restaurantName || settlement.restaurantId} ` +
          `on the Settlements screen before this was recorded in the books` +
          (settlement.reference ? ` (${settlement.reference})` : '')
      });
      posted += 1;
      totalPaise += amountPaise;
    } catch {
      skipped += 1;
    }
  }

  if (posted > 0) {
    console.log(
      JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        event: 'LEGACY_SETTLEMENTS_BACKFILLED',
        posted,
        totalPaise,
        message:
          'Settlements marked paid before the ledger recorded them are now in the books. ' +
          'Any partner whose payable is now negative was paid more than they had earned.'
      })
    );
  }

  return { posted, skipped, totalPaise };
}

/**
 * Partners the backfill has left with a negative payable, for the Pay screen.
 *
 * Surfaced rather than logged: a figure that looks wrong needs its explanation on
 * the screen where somebody sees it, not in a log they will never open.
 */
export function overpaidPartners(): Array<{ restaurantId: string; overpaidPaise: number }> {
  const out: Array<{ restaurantId: string; overpaidPaise: number }> = [];
  for (const row of ledger.balancesByKind('PARTNER_PAYABLE')) {
    if (row.balancePaise < 0 && row.partyId) {
      out.push({ restaurantId: row.partyId, overpaidPaise: -row.balancePaise });
    }
  }
  return out;
}
