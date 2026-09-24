/**
 * Rider bonuses, and where they were going instead.
 *
 * -------------------------------------------------------------------------
 * EVERY INCENTIVE EVER EARNED WAS UNPAID
 * -------------------------------------------------------------------------
 * `evaluateIncentives` marked a target as achieved, wrote a row into
 * `riderIncentives` with a `paidAt`, and credited `walletRepository` — the
 * customer wallet. Nothing in `modules/payments` reads the wallet. No payout run
 * has ever looked at it. It cannot be spent anywhere in the product.
 *
 * Meanwhile the rider's Earnings and Incentives screens read the same row and
 * showed the bonus as PAID, with a date.
 *
 * So the platform promised a bonus, recorded that it had settled it, told the
 * rider so, and moved no money at all. It is the same defect as a refund shown
 * with a green tick over money that has not moved, and worse in one respect: a
 * refunded customer eventually notices and complains, whereas a rider comparing a
 * bonus against a bank statement concludes the platform is cheating them.
 *
 * -------------------------------------------------------------------------
 * A BONUS IS MONEY OWED, NOT MONEY SENT
 * -------------------------------------------------------------------------
 * DEBIT  EXPENSE_RIDER_INCENTIVE  - the platform's cost, which it chose.
 * CREDIT RIDER_PAYABLE:riderId    - and the rider is owed it.
 *
 * Payable rather than paid, because awarding a bonus is not a bank transfer. It
 * joins what the rider is owed and goes out with their next payout, through the
 * same rails, the same maker-checker rule and the same verified account as every
 * other rupee they earn. Crediting a bank directly from here would be a second
 * payout path with none of those controls.
 */
import { ledger, accountFor } from './ledger.ts';
import { toPaise, formatPaise } from './money.ts';
import { memoryStore } from '../../db/client.ts';

/** What makes one award unique: the incentive row's own key. */
export function incentiveKeyFor(awardKey: string): string {
  return `incentive:${awardKey}`;
}

/** Whether this award has been booked as owed. */
export function incentivePosted(awardKey: string): boolean {
  return ledger.hasTransaction(incentiveKeyFor(awardKey));
}

/**
 * Records that a rider has earned a bonus.
 *
 * NEVER THROWS. The award row is written by the caller before this runs, and a
 * rider must not be denied a bonus they have hit the target for because of a
 * bookkeeping failure. A failure is logged under its own event name so it is
 * findable, and `backfillIncentiveAwards` will pick it up.
 */
export function postIncentiveAward(input: {
  awardKey: string;
  riderId: string;
  title: string;
  rewardRupees: number;
}): void {
  try {
    const amountPaise = toPaise(Number(input.rewardRupees) || 0);
    if (amountPaise <= 0 || !input.riderId) return;

    ledger.post({
      event: 'RIDER_INCENTIVE_AWARDED',
      postings: [
        { account: 'EXPENSE_RIDER_INCENTIVE', direction: 'DEBIT', amountPaise },
        { account: accountFor('RIDER_PAYABLE', input.riderId), direction: 'CREDIT', amountPaise }
      ],
      idempotencyKey: incentiveKeyFor(input.awardKey),
      actorUserId: 'system',
      narration: `${formatPaise(amountPaise)} incentive earned: ${input.title}`
    });
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'INCENTIVE_NOT_BOOKED',
        awardKey: input.awardKey,
        riderId: input.riderId,
        message: err?.message || String(err)
      })
    );
  }
}

/**
 * Books every award that was marked paid and never entered the books.
 *
 * -------------------------------------------------------------------------
 * AND THIS IS NOT REWRITING HISTORY
 * -------------------------------------------------------------------------
 * The ledger is append-only and nothing here touches an existing entry. What it
 * does is record a debt that already exists: these riders were told a bonus had
 * been settled, and it never was. Leaving them out would mean the only riders ever
 * paid an incentive are the ones who earn one after today, and everybody who hit a
 * target before it would be quietly written off — by the very fix that admits the
 * money was owed.
 *
 * Idempotent, so it is safe at boot and safe to run again.
 */
export function backfillIncentiveAwards(): { posted: number; skipped: number } {
  let posted = 0;
  let skipped = 0;

  for (const award of memoryStore.riderIncentives.values() as Iterable<any>) {
    const awardKey = String(award?.id || '');
    if (!awardKey || !award?.riderId) {
      skipped += 1;
      continue;
    }
    if (incentivePosted(awardKey)) {
      skipped += 1;
      continue;
    }
    postIncentiveAward({
      awardKey,
      riderId: award.riderId,
      title: String(award.code || 'incentive'),
      rewardRupees: Number(award.reward) || 0
    });
    if (incentivePosted(awardKey)) posted += 1;
    else skipped += 1;
  }

  if (posted > 0) {
    console.log(
      JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'INCENTIVES_BACKFILLED',
        posted,
        message: 'Bonuses riders had been told were paid are now recorded as owed.'
      })
    );
  }

  return { posted, skipped };
}
