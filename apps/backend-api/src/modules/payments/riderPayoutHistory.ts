/**
 * Every payment a rider has been sent, whichever system sent it.
 *
 * Two kinds of record share `memoryStore.payouts`:
 *
 *   - the retired rider payouts (`riderId`, `netAmount`, `status`), drafted by
 *     the old Settlements screen before the ledger existed, and
 *   - ledger payouts (`ownerType: 'RIDER'`, `ownerId`, `amountPaise`, `state`),
 *     which is what the Pay screen writes today.
 *
 * `payoutRepository` only knows the first kind. So once payments moved to Pay,
 * the rider's settlement screen and the admin rider profile said "Total paid
 * to you Rs 0.00" and "Pending Rs 30.00" for a rider who had just been paid
 * Rs 30 (QA v9, 26 Sep). Every reader of a rider's payment history goes through
 * here, and gets both kinds in the shape the installed apps already render.
 */
import { memoryStore } from '../../db/client.ts';
import { listPayouts } from './payouts.ts';
import { toRupees } from './money.ts';
import type { RiderPayout } from '@quick-bites/shared-types';

const STATUS: Record<string, string> = {
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'FAILED',
  DRAFT: 'PENDING',
  AWAITING_APPROVAL: 'PENDING',
  APPROVED: 'PENDING'
};

export interface RiderPaymentRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  tripsCompleted: number;
  tripEarnings: number;
  incentives: number;
  bonuses: number;
  deductions: number;
  netAmount: number;
  status: string;
  createdAt: string;
  paidAt?: string;
  reference?: string;
  note?: string;
}

/** Newest first. Legacy rows are returned as stored; ledger payouts are mapped. */
export function riderPaymentHistory(riderId: string): RiderPaymentRow[] {
  const legacy = (Array.from(memoryStore.payouts.values()) as any[]).filter(
    p => p && p.riderId === riderId && typeof p.amountPaise !== 'number'
  ) as unknown as RiderPayout[];

  const ledger = listPayouts({ ownerId: riderId })
    .filter(p => p.ownerType === 'RIDER')
    .map(p => {
      // Which trips the payment covered, read off the ledger entries it names.
      const covered = new Set(p.coversLedgerIds);
      const orderIds = new Set<string>();
      let tripPaise = 0;
      let otherPaise = 0;
      for (const entry of memoryStore.ledgerEntries.values() as Iterable<any>) {
        if (!covered.has(entry.id)) continue;
        const signed = entry.direction === 'CREDIT' ? entry.amountPaise : -entry.amountPaise;
        if (entry.orderId) {
          orderIds.add(entry.orderId);
          tripPaise += signed;
        } else {
          otherPaise += signed;
        }
      }
      const row: RiderPaymentRow = {
        id: p.id,
        periodStart: p.draftedAt,
        periodEnd: p.executedAt || p.draftedAt,
        tripsCompleted: orderIds.size,
        tripEarnings: toRupees(Math.max(0, tripPaise)),
        // Bonuses and corrections are posted without an order; shown together.
        incentives: toRupees(Math.max(0, otherPaise)),
        bonuses: 0,
        deductions: toRupees(Math.max(0, -otherPaise)),
        netAmount: toRupees(p.amountPaise),
        status: STATUS[p.state] || 'PROCESSING',
        createdAt: p.draftedAt,
        ...(p.state === 'PAID' && p.executedAt ? { paidAt: p.executedAt } : {}),
        ...(p.reference ? { reference: p.reference } : {}),
        ...(p.note ? { note: p.note } : {})
      };
      return row;
    });

  return [...(legacy as unknown as RiderPaymentRow[]), ...ledger].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

/** Everything actually sent to this rider, in rupees, from both kinds of record. */
export function riderPaidTotal(riderId: string): number {
  const paise = riderPaymentHistory(riderId)
    .filter(r => r.status === 'PAID')
    .reduce((t, r) => t + Math.round((Number(r.netAmount) || 0) * 100), 0);
  return toRupees(paise);
}
