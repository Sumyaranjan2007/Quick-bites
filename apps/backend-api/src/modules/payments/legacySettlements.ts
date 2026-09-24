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
 * as owed, so the Pay screen will pay the same partner again.
 *
 * -------------------------------------------------------------------------
 * WHY IT WRITES A PAYOUT AND NOT JUST A LEDGER ENTRY
 * -------------------------------------------------------------------------
 * The first version of this posted a bare DEBIT to the payable and stopped there. It
 * looked right and it was not, under any real hold period.
 *
 * `duesFor` buckets entries by `occurredAt`: released if older than the hold, held if
 * newer. A debit stamped NOW lands in the held bucket while the credits it clears sit
 * in the released one — so `outstanding` fell to zero while `payable now` stayed at
 * the full amount, and the Pay screen went on offering money that had already been
 * paid. The double payment was displaced rather than removed.
 *
 * The first check written for it passed, because its fixture set the hold period to
 * zero. A hold of zero collapses both buckets into one and hides every date-bucketing
 * defect there is, which makes it the wrong setting for any check about what is
 * payable now.
 *
 * So instead each legacy settlement gets a real PAYOUT record: state PAID, rail
 * MANUAL_BANK, its reference, and `coversLedgerIds` naming the exact credits it paid.
 * That relies on no dates at all — `duesFor` excludes covered credits outright — and
 * it uses the mechanism already there rather than a second one beside it. Three things
 * fall out for free: the payout's own debit is skipped by the payable calculation, a
 * legacy settlement becomes indistinguishable from a proper one on every screen, and
 * it appears in the Sent list where the owner can see what was paid and when.
 *
 * -------------------------------------------------------------------------
 * AND IT IS NOT REWRITING HISTORY
 * -------------------------------------------------------------------------
 * Nothing here alters an existing entry. Each of these transfers really happened: an
 * administrator pressed the button, a transfer was made, and the record carries its
 * reference. What was missing was the bookkeeping, and writing it down now is the
 * difference between books that are behind and books that are wrong.
 *
 * A payable that goes NEGATIVE as a result is the honest answer. It means that partner
 * was paid more than the ledger says they earned, which is what happens when a
 * settlement is computed by a formula that ignores packaging and uses a different TDS
 * base. It nets off their next run, exactly as a refund clawback does.
 */
import { ledger, accountFor } from './ledger.ts';
import { toPaise, formatPaise } from './money.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import type { PayeeOwnerType } from '@quick-bites/shared-types';

export function legacySettlementKeyFor(settlementId: string): string {
  return `legacy_settlement:${settlementId}`;
}

/** Whether this already-paid settlement has been written into the books. */
export function legacySettlementPosted(settlementId: string): boolean {
  return ledger.hasTransaction(legacySettlementKeyFor(settlementId));
}

/**
 * The ledger credits this settlement actually paid for.
 *
 * Found through the orders it stamped, which is the precise link: the draft route
 * writes `order.settlementId` in the same step that it creates the settlement.
 *
 * A record with no stamped orders falls back to the OLDEST uncovered credits up to
 * its amount. That is a choice rather than a fact, and it is the right way round:
 * covering the oldest matches how the settlement was drafted — everything outstanding
 * at the time — and covering nothing would leave the double payment in place, which
 * is the failure this exists to remove.
 */
function creditsPaidBy(settlement: any, amountPaise: number): string[] {
  const account = accountFor('PARTNER_PAYABLE', settlement.restaurantId);
  const entries = ledger
    .query({ account })
    .filter(e => e.direction === 'CREDIT')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const alreadyCovered = new Set<string>();
  for (const payout of memoryStore.payouts.values() as Iterable<any>) {
    if (payout?.state === 'FAILED' || payout?.state === 'CANCELLED') continue;
    for (const id of payout?.coversLedgerIds || []) alreadyCovered.add(id);
  }

  const stampedOrders = new Set<string>();
  for (const order of memoryStore.orders.values() as Iterable<any>) {
    if (order?.settlementId === settlement.id) stampedOrders.add(order.id);
  }

  const byStamp = entries.filter(
    e => !alreadyCovered.has(e.id) && e.orderId && stampedOrders.has(e.orderId)
  );
  if (byStamp.length > 0) return byStamp.map(e => e.id);

  const picked: string[] = [];
  let running = 0;
  for (const entry of entries) {
    if (alreadyCovered.has(entry.id)) continue;
    if (running >= amountPaise) break;
    picked.push(entry.id);
    running += entry.amountPaise;
  }
  return picked;
}

/**
 * Posts every PAID settlement the ledger has never seen, as a payout.
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
     * A settlement paid AFTER this was fixed already has a payout behind it, and that
     * payout posted its own entry. Posting again would double-count the very thing
     * this exists to stop.
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

    /*
     * When it was actually paid, so the entry sits in the period it belongs to rather
     * than today. It does not decide whether the money is payable any more — the
     * payout's `coversLedgerIds` does that — but a ledger dated by when a backfill ran
     * makes every period report wrong.
     */
    const paidAt =
      settlement.paidAt || settlement.updatedAt || settlement.createdAt || new Date().toISOString();

    const payoutId = `pay_legacy_${id}`;
    const coversLedgerIds = creditsPaidBy(settlement, amountPaise);

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
        payoutId,
        occurredAt: paidAt,
        narration:
          `${formatPaise(amountPaise)} paid to ${settlement.restaurantName || settlement.restaurantId} ` +
          'on the Settlements screen before this was recorded in the books' +
          (settlement.reference ? ` (${settlement.reference})` : '')
      });

      /*
       * The payout record itself, so what happened is visible where payments are
       * listed rather than only in the ledger. Written directly rather than through
       * `draftPayout`, which would recompute the amount from today's payable — the
       * amount here is what actually left the bank, months ago.
       *
       * And deliberately NO payee notification. Telling a partner "you have been paid"
       * about a transfer from last quarter would be a message about nothing they can
       * act on, arriving as though it were news.
       */
      memoryStore.payouts.set(payoutId, {
        id: payoutId,
        ownerType: 'RESTAURANT' as PayeeOwnerType,
        ownerId: settlement.restaurantId,
        ownerName: settlement.restaurantName || settlement.restaurantId,
        amountPaise,
        state: 'PAID',
        rail: 'MANUAL_BANK',
        coversLedgerIds,
        idempotencyKey: legacySettlementKeyFor(id),
        reference: settlement.reference,
        settlementId: id,
        draftedByUserId: 'system:legacy-settlement',
        draftedAt: paidAt,
        executedByUserId: 'system:legacy-settlement',
        executedAt: paidAt,
        note: 'Recorded from a settlement that was marked paid before the ledger tracked it.'
      } as any);

      /*
       * The link back, for anybody reading the record.
       *
       * NOT what makes this idempotent — the ledger key above does that, and a mutation
       * removing this stamp correctly changes nothing. It is here so a settlement and
       * the payout that paid it can be found from either end.
       */
      settlement.payoutId = payoutId;
      memoryStore.restaurantSettlements.set(id, settlement);

      posted += 1;
      totalPaise += amountPaise;
    } catch {
      skipped += 1;
    }
  }

  if (posted > 0) {
    triggerAutoSave();
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
