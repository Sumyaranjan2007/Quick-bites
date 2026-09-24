/**
 * The job that goes looking for money that has gone wrong.
 *
 * Everything else in this module is called by a person doing something. This is
 * the part that runs when nobody is looking, and it exists because the failures
 * that matter most are the silent ones: a payout whose outcome we never learnt,
 * a rider quietly accumulating cash and never coming in, books that stopped
 * balancing three days ago.
 *
 * None of those announce themselves. Each is invisible from any single order
 * and obvious from the whole set, which is exactly what a sweep is for.
 *
 * -------------------------------------------------------------------------
 * IT NEVER RETRIES A PAYMENT BLIND
 * -------------------------------------------------------------------------
 * An UNCERTAIN payout is one where the request left and the answer did not come
 * back. It may have paid. Sending it again is how somebody is paid twice, and
 * the second payment is far harder to recover than the first was to send.
 *
 * So this asks the GATEWAY what happened, using the reference we generated
 * before the call, and records what it is told. It resolves an UNCERTAIN payout
 * to PAID or FAILED. It never sends anything.
 *
 * -------------------------------------------------------------------------
 * AND IT RAISES RATHER THAN FIXES
 * -------------------------------------------------------------------------
 * Cash ageing and a ledger imbalance are both alerts, not repairs. A job that
 * silently corrected an imbalance would be a job that could hide the cause of
 * one. The books balancing because something rebalanced them is not the same
 * fact as the books balancing.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { emitOpsAlert } from '../../sockets/socketServer.ts';
import { notifyAdminsPaymentsHealth } from '../../notifications/adminNotifier.ts';
import { ledger } from './ledger.ts';
import { cashAgeing } from './cashDeposits.ts';
import { listPayouts, type PayoutRecord } from './payouts.ts';
import { razorpayXAdapter, isRazorpayXConfigured } from './razorpayXAdapter.ts';
import { getActiveRates } from './pricingConfig.ts';
import { formatPaise, toPaise } from './money.ts';

/** How long a rider may hold our cash before it is somebody's problem. */
const CASH_AGEING_DAYS = 3;

export interface HealthReport {
  checkedAt: string;
  uncertainPayouts: {
    checked: number;
    resolvedPaid: number;
    resolvedFailed: number;
    stillUnknown: number;
  };
  cash: {
    ridersHolding: number;
    totalPaise: number;
    overCeiling: number;
    staleRiders: Array<{ riderId: string; riderName: string; cashInHandPaise: number; lastDepositAt: string | null }>;
  };
  ledger: {
    balanced: boolean;
    entryCount: number;
    unbalancedTransactions: number;
    duplicateKeys: number;
    fractionalAmounts: number;
  };
  alerts: string[];
}

/* ------------------------------------------------------------------ *
 *  PAYOUTS WHOSE OUTCOME WE NEVER LEARNT                              *
 * ------------------------------------------------------------------ */

/**
 * How the sweep asks the gateway what happened to a payout.
 *
 * Injectable, and not for tidiness. The branches below are the most dangerous
 * code in this file — calling a payout PAID when it was not leaves somebody
 * unpaid with the books saying otherwise, and calling it FAILED when it did pay
 * gets them paid twice. A mutation run showed every one of those branches was
 * unreachable in a test: without gateway credentials the function returned
 * UNKNOWN on its first line and never got there, so a mutant that returned PAID
 * for "no record found" survived cleanly.
 *
 * A seam is the difference between those branches being asserted and merely
 * being written.
 */
export type PayoutLookup = (referenceId: string) => Promise<Array<{ id?: string; status?: string }>>;

const liveLookup: PayoutLookup = referenceId => razorpayXAdapter.findPayoutsByReference(referenceId);

async function resolveUncertain(
  payout: PayoutRecord,
  lookup: PayoutLookup | null
): Promise<'PAID' | 'FAILED' | 'UNKNOWN'> {
  if (!lookup) return 'UNKNOWN';

  try {
    /*
     * Found by OUR reference, not by a payout id we may never have received.
     *
     * That is the whole reason the reference is generated before the call
     * rather than taken from the response: a request that times out leaves us
     * with no id at all, and an UNCERTAIN payout is by definition one where
     * that happened.
     */
    const found = await lookup(payout.id);
    if (!found || found.length === 0) {
      // Nothing there at all. Either it never arrived, or the gateway is not
      // answering. Both are UNKNOWN — "no record" is not the same as "did not
      // happen", and treating it as the latter is how a paid payout is resent.
      return 'UNKNOWN';
    }

    const live = found[0];
    const status = String(live?.status || '').toLowerCase();

    if (status === 'processed' || status === 'processing' || status === 'queued') return 'PAID';
    if (status === 'reversed' || status === 'cancelled' || status === 'rejected' || status === 'failed') {
      return 'FAILED';
    }
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/* ------------------------------------------------------------------ *
 *  THE SWEEP                                                          *
 * ------------------------------------------------------------------ */

export async function runPaymentsHealthCheck(
  options: { lookup?: PayoutLookup } = {}
): Promise<HealthReport> {
  const alerts: string[] = [];

  // No gateway configured and no stub supplied means there is no authority to
  // ask, so nothing can be resolved. That is the correct answer, not a
  // degraded one.
  const lookup = options.lookup || (isRazorpayXConfigured() ? liveLookup : null);

  /* ---- Payouts in limbo ---- */

  const uncertain = listPayouts({ state: 'UNCERTAIN' });
  let resolvedPaid = 0;
  let resolvedFailed = 0;
  let stillUnknown = 0;

  for (const payout of uncertain) {
    const outcome = await resolveUncertain(payout, lookup);

    if (outcome === 'PAID') {
      /*
       * It did go out. The ledger entry was NOT written when the payout was
       * marked uncertain — deliberately, because writing it then would have
       * recorded money leaving that might never have left. It is written now.
       *
       * The idempotency key is the same one the normal path uses, so if the
       * original call did in fact complete and post its entry, this is refused
       * by the ledger rather than double-counted.
       */
      try {
        ledger.post({
          event: 'PAYOUT_SENT',
          postings: [
            {
              account:
                (payout.ownerType === 'RESTAURANT' ? 'PARTNER_PAYABLE:' : 'RIDER_PAYABLE:') + payout.ownerId,
              direction: 'DEBIT',
              amountPaise: payout.amountPaise
            },
            { account: 'PLATFORM_BANK', direction: 'CREDIT', amountPaise: payout.amountPaise }
          ],
          idempotencyKey: `payout_sent:${payout.id}`,
          actorUserId: 'system:payments-health',
          narration:
            `${formatPaise(payout.amountPaise)} to ${payout.ownerName} — confirmed by reconciliation ` +
            'after an unknown outcome',
          payoutId: payout.id
        });
      } catch {
        /* Already posted. Which is the good case. */
      }

      payout.state = 'PAID';
      memoryStore.payouts.set(payout.id, payout);
      resolvedPaid += 1;
      alerts.push(
        `Payout ${payout.id} to ${payout.ownerName} was in doubt and has been confirmed as sent.`
      );
    } else if (outcome === 'FAILED') {
      payout.state = 'FAILED';
      payout.failureReason = 'The gateway reports this payout did not complete. Its earnings are payable again.';
      memoryStore.payouts.set(payout.id, payout);
      resolvedFailed += 1;
      alerts.push(
        `Payout ${payout.id} to ${payout.ownerName} did not go through. ` +
          `${formatPaise(payout.amountPaise)} is owed again and will be picked up by the next run.`
      );
    } else {
      stillUnknown += 1;
    }
  }

  if (uncertain.length > 0) triggerAutoSave();

  if (stillUnknown > 0) {
    alerts.push(
      `${stillUnknown} payout${stillUnknown === 1 ? '' : 's'} still have an unknown outcome. ` +
        'They are NOT being retried. Check them against the gateway by hand before sending anything again.'
    );
  }

  /* ---- Cash that has been out too long ---- */

  const ageing = cashAgeing();
  const cutoff = new Date(Date.now() - CASH_AGEING_DAYS * 86_400_000).toISOString();
  const rates = getActiveRates();
  const ceilingPaise = toPaise(rates.codCashCeiling);

  const stale = ageing.filter(row => !row.lastDepositAt || row.lastDepositAt < cutoff);
  const overCeiling = ageing.filter(row => row.cashInHandPaise >= ceilingPaise);
  const totalPaise = ageing.reduce((total, row) => total + row.cashInHandPaise, 0);

  for (const row of stale) {
    alerts.push(
      `${row.riderName} has been holding ${formatPaise(row.cashInHandPaise)} of our cash ` +
        `${row.lastDepositAt ? `since their last deposit` : 'and has never deposited'}. ` +
        'Chase it before it grows.'
    );
  }

  /* ---- The books ---- */

  const audit = ledger.audit();
  if (!audit.balanced) {
    /*
     * The loudest thing this job can say, and it says it every run until it is
     * fixed rather than once.
     *
     * Nothing here attempts a correction. An imbalance means an assumption
     * somewhere is wrong, and a job that quietly rebalanced the books would
     * destroy the only evidence of which one.
     */
    alerts.push(
      `THE LEDGER DOES NOT BALANCE. ${audit.unbalancedTransactions.length} transaction(s) are one-sided. ` +
        'Stop sending payouts and investigate. Nothing has been corrected automatically.'
    );
  }
  if (audit.duplicateKeys.length > 0) {
    alerts.push(`${audit.duplicateKeys.length} duplicate idempotency key(s) in the ledger. Money may be double-counted.`);
  }
  if (audit.fractionalAmounts.length > 0) {
    alerts.push(`${audit.fractionalAmounts.length} ledger entries hold a fraction of a paise.`);
  }

  const report: HealthReport = {
    checkedAt: new Date().toISOString(),
    uncertainPayouts: { checked: uncertain.length, resolvedPaid, resolvedFailed, stillUnknown },
    cash: {
      ridersHolding: ageing.length,
      totalPaise,
      overCeiling: overCeiling.length,
      staleRiders: stale.map(row => ({
        riderId: row.riderId,
        riderName: row.riderName,
        cashInHandPaise: row.cashInHandPaise,
        lastDepositAt: row.lastDepositAt
      }))
    },
    ledger: {
      balanced: audit.balanced,
      entryCount: audit.entryCount,
      unbalancedTransactions: audit.unbalancedTransactions.length,
      duplicateKeys: audit.duplicateKeys.length,
      fractionalAmounts: audit.fractionalAmounts.length
    },
    alerts
  };

  console.log(
    JSON.stringify({
      level: alerts.length > 0 ? 'WARN' : 'INFO',
      timestamp: report.checkedAt,
      event: 'PAYMENTS_HEALTH_CHECK',
      uncertainResolved: resolvedPaid + resolvedFailed,
      stillUnknown,
      cashOutstandingPaise: totalPaise,
      ridersOverdue: stale.length,
      ledgerBalanced: audit.balanced
    })
  );

  // Operations sees these as they happen rather than when somebody remembers to
  // open a screen. A ledger imbalance found on Saturday must not wait for
  // Monday.
  for (const alert of alerts) {
    try {
      emitOpsAlert({ kind: 'PAYMENTS_HEALTH', detail: alert, raisedAt: report.checkedAt });
    } catch {
      /* Alerting must never be the reason the sweep fails. */
    }
  }

  /*
   * AND ONE PUSH FOR THE WHOLE SWEEP.
   *
   * One per alert would make a single bad state a burst — an unbalanced ledger
   * brings its duplicate keys and the uncertain payouts that caused both — and a
   * burst is how a channel gets muted. The channel that gets muted is the one
   * carrying the SOS.
   *
   * WHICH ONE IS WORST IS DECIDED HERE, not in the notifier. This function knows:
   * an imbalance is "the loudest thing this job can say" and the comment above
   * that push says so. A notifier ranking these strings by keyword would be wrong
   * the first time somebody reworded one.
   */
  if (alerts.length > 0) {
    const worst = audit.balanced
      ? alerts[0]
      : alerts.find(a => a.startsWith('THE LEDGER DOES NOT BALANCE')) || alerts[0];
    void notifyAdminsPaymentsHealth({ alerts, worst });
  } else {
    // Cleared. Told so it can forget, and announce a recurrence as news.
    void notifyAdminsPaymentsHealth({ alerts: [], worst: '' });
  }

  return report;
}

/* ------------------------------------------------------------------ *
 *  THE SCHEDULE                                                       *
 * ------------------------------------------------------------------ */

let timer: NodeJS.Timeout | null = null;

/** Every fifteen minutes. Frequent enough to matter, rare enough to be free. */
const INTERVAL_MS = 15 * 60 * 1000;

export function startPaymentsHealthCheck(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runPaymentsHealthCheck().catch(err => {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'PAYMENTS_HEALTH_CHECK_FAILED',
          message: err?.message || String(err)
        })
      );
    });
  }, INTERVAL_MS);

  // Not held open on the event loop: a sweep is never a reason a process cannot
  // shut down, and an unref'd timer is why the test suites can exit.
  timer.unref?.();
}

export function stopPaymentsHealthCheck(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
