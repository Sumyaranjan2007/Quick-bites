/**
 * Statements — showing somebody exactly why they are being paid what they are
 * being paid.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS A CONTROL AND NOT A REPORT
 * -------------------------------------------------------------------------
 * A partner who cannot see the arithmetic has only two options when a figure
 * looks wrong: accept it, or accuse us. Both are bad. A statement that names
 * every deduction, at the rate that was actually frozen onto that order, turns
 * a dispute into a conversation about one line — and, far more often, ends it
 * before it starts because the partner finds the answer themselves.
 *
 * It also cuts the other way, which is the point the owner made: they raise a
 * request, and we see exactly what they earned and why. Paying "what they
 * deserve" is only possible if what they deserve is derivable, line by line,
 * from something neither side can edit.
 *
 * -------------------------------------------------------------------------
 * THE LEDGER IS THE SOURCE, THE ORDER IS THE EXPLANATION
 * -------------------------------------------------------------------------
 * Every figure that adds up to the total comes from ledger entries — the same
 * rows a payout covers, so a statement and a payment can never disagree. The
 * order is consulted only to break one ledger entry into the lines that
 * produced it, and if the two ever disagree the ledger wins and the
 * discrepancy is shown rather than hidden.
 *
 * That is deliberate. A statement that silently prefers the prettier number is
 * worse than no statement: it hides the one thing worth knowing.
 */
import type { LedgerEntry, Order, PayeeOwnerType } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';
import { ledger, accountFor } from './ledger.ts';
import { splitForOrder } from './earnings.ts';
import { getActiveRates } from './pricingConfig.ts';
import { toRupees, toPaise } from './money.ts';
import { listPayouts } from './payouts.ts';
import { arrivalSentence, noRequestNeededSentence } from './payoutPromise.ts';

/** One named figure on a statement. Positive adds, negative deducts. */
export interface StatementLine {
  label: string;
  amountPaise: number;
  /** Shown beside the label, e.g. the commission percentage actually applied. */
  detail?: string;
}

export interface OrderStatement {
  orderId: string;
  orderNumber: string;
  occurredAt: string;
  /** The breakdown. Sums to `netPaise` unless the ledger disagrees. */
  lines: StatementLine[];
  /** What the LEDGER says this order added to their balance. Authoritative. */
  netPaise: number;
  /**
   * Set when the lines do not sum to the ledger figure.
   *
   * Almost always an order placed before a rate existed, whose bill therefore
   * never froze one. Shown rather than smoothed over.
   */
  unexplainedPaise: number;
  /** The payout that covered it, once one has. */
  settledByPayoutId?: string;
  /** False while it is inside the hold period. */
  released: boolean;
}

export interface Statement {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  period: { from: string; to: string };
  summary: {
    ordersCount: number;
    earnedPaise: number;
    deductionsPaise: number;
    adjustmentsPaise: number;
    paidPaise: number;
    payablePaise: number;
    heldPaise: number;
    outstandingPaise: number;
  };
  orders: OrderStatement[];
  /** Everything that is not attributable to a single order. */
  adjustments: Array<{
    id: string;
    occurredAt: string;
    event: string;
    narration: string;
    amountPaise: number;
  }>;
  payouts: Array<{
    id: string;
    amountPaise: number;
    state: string;
    rail: string;
    reference?: string;
    executedAt?: string;
  }>;
  /** The hold in force, so "why is this not payable yet" answers itself. */
  holdDays: number;
  /**
   * What we promise about arrival, in words, from the one function that derives
   * them from the rates.
   *
   * The apps used to write this sentence themselves and both said the run was
   * DAILY while the configured cadence was weekly. An app cannot read the
   * pricing config, so the only way it can tell the truth is to be told it.
   */
  payoutPromise: {
    arrival: string;
    noRequestNeeded: string;
  };
}

const signed = (entry: LedgerEntry) =>
  entry.direction === 'CREDIT' ? entry.amountPaise : -entry.amountPaise;

/**
 * The one entry per order that the per-order lines already explain.
 *
 * Matched on the idempotency key rather than on the event, because the event
 * differs by how the customer paid — `ORDER_PAID_ONLINE` for a card,
 * `COD_COLLECTED` for cash — while the key is the same either way. Matching on
 * the event was the first version of this, and it silently listed a cash
 * order's earning twice: once as its lines, and again as a "correction".
 */
const isEarningEntry = (entry: LedgerEntry) => entry.idempotencyKey.startsWith('order_earnings:');

/**
 * The lines behind one order, for a partner.
 *
 * The commission percentage shown is the one FROZEN onto the bill, not
 * today's. A statement that re-derives a historical figure from a current rate
 * is a statement that changes after the fact, which is exactly the thing a
 * partner is entitled not to have happen.
 */
function partnerLines(order: Order): StatementLine[] {
  const bill: any = order.bill || {};
  const split = splitForOrder(order);
  const rates = getActiveRates();

  /*
   * The KITCHEN's own food and packaging, never the customer's.
   *
   * These lines read `itemsTotal` and `packagingFee`, which are what the
   * CUSTOMER paid after the platform's markup. So the Statement printed a
   * "Food total" the kitchen never priced, the marked-up difference was left as
   * an unexplained gap under the net, and any partner could read our markup off
   * their own statement. Orders from before the markup carry no partner figure,
   * and the customer's figure was the kitchen's then.
   */
  const partnerItems = Number(bill.partnerItemsTotal);
  const partnerPackaging = Number(bill.partnerPackagingFee);
  const itemsPaise = toPaise(Number.isFinite(partnerItems) ? partnerItems : Number(bill.itemsTotal) || 0);
  const packagingPaise = toPaise(
    Number.isFinite(partnerPackaging) ? partnerPackaging : Number(bill.packagingFee) || 0
  );
  const gstSharePaise = toPaise(Number(bill.commissionGstToPartner) || 0);

  const frozenPercent = Number(bill.commissionPercent);
  const percentShown = Number.isFinite(frozenPercent) ? frozenPercent : rates.defaultCommissionPercent;
  const percentIsFrozen = Number.isFinite(frozenPercent);

  const lines: StatementLine[] = [
    { label: 'Food total', amountPaise: itemsPaise }
  ];

  if (packagingPaise > 0) {
    lines.push({ label: 'Packaging', amountPaise: packagingPaise });
  }

  lines.push({
    label: 'Our commission',
    amountPaise: -split.commissionPaise,
    detail: percentIsFrozen
      ? `${percentShown}% of the food total, the rate on this order`
      : `${percentShown}% — this order predates per-order rates, so today's is shown`
  });

  if (gstSharePaise > 0) {
    lines.push({
      label: 'GST on our commission',
      amountPaise: -gstSharePaise,
      detail: 'Your share of the GST charged on the commission'
    });
  }

  if (split.tdsPaise > 0) {
    lines.push({
      label: 'TDS withheld',
      amountPaise: -split.tdsPaise,
      detail: `${rates.tdsPercent}% under section 194-O. Paid to the tax authority on your PAN, not kept by us`
    });
  }

  return lines;
}

/** The lines behind one order, for a rider. */
function riderLines(order: Order): StatementLine[] {
  const split = splitForOrder(order);
  const tripPaise = toPaise(Number(order.riderPayout) || 0);

  const lines: StatementLine[] = [{ label: 'Trip earning', amountPaise: tripPaise }];

  if (split.tipPaise > 0) {
    lines.push({
      label: 'Tip',
      amountPaise: split.tipPaise,
      detail: 'Paid across in full. We take no commission on a tip'
    });
  }

  return lines;
}

/**
 * A statement for one payee over a window.
 *
 * `from` and `to` are ISO timestamps. The default window is the last 30 days,
 * which is the one a partner checking a settlement actually wants; a longer
 * one is available but is not what a screen should open on.
 */
export function statementFor(
  ownerType: PayeeOwnerType,
  ownerId: string,
  ownerName: string,
  options: { from?: string; to?: string } = {}
): Statement {
  const to = options.to || new Date().toISOString();
  const from = options.from || new Date(Date.now() - 30 * 86_400_000).toISOString();

  const rates = getActiveRates();
  const holdDays = ownerType === 'RESTAURANT' ? rates.partnerHoldDays : rates.riderHoldDays;
  const releasedBefore = new Date(Date.now() - holdDays * 86_400_000).toISOString();

  const kind = ownerType === 'RESTAURANT' ? 'PARTNER_PAYABLE' : 'RIDER_PAYABLE';
  const account = accountFor(kind as any, ownerId);
  const entries = ledger.query({ account, from, to });

  // Which payout, if any, covers a given ledger entry. Built once: a partner
  // with six months of orders would otherwise rescan every payout per row.
  const payouts = listPayouts({ ownerId }).filter(p => p.ownerType === ownerType);
  const coveredBy = new Map<string, string>();
  for (const payout of payouts) {
    if (payout.state === 'FAILED' || payout.state === 'CANCELLED') continue;
    for (const id of payout.coversLedgerIds) coveredBy.set(id, payout.id);
  }

  /*
   * Ledger entries grouped by order.
   *
   * An order can have more than one entry against the same payee — the
   * earning, and later a refund adjustment that claws part of it back. They
   * belong on one line of the statement, not two, because the partner's
   * question is "what did I get for order 4471", not "list the events".
   */
  const byOrder = new Map<string, LedgerEntry[]>();
  const loose: LedgerEntry[] = [];

  for (const entry of entries) {
    if (entry.orderId) {
      const list = byOrder.get(entry.orderId);
      if (list) list.push(entry);
      else byOrder.set(entry.orderId, [entry]);
    } else {
      loose.push(entry);
    }
  }

  const orders: OrderStatement[] = [];
  let earnedPaise = 0;
  let deductionsPaise = 0;

  for (const [orderId, orderEntries] of byOrder) {
    const order = memoryStore.orders.get(orderId) as Order | undefined;
    const netPaise = orderEntries.reduce((total, e) => total + signed(e), 0);

    // Newest first within the order, and the order's own date is the earliest
    // thing that happened on it.
    const occurredAt = orderEntries
      .map(e => e.occurredAt)
      .sort()[0] as string;

    let lines: StatementLine[] = [];
    if (order) {
      lines = ownerType === 'RESTAURANT' ? partnerLines(order) : riderLines(order);
    } else {
      // The order has been purged but the money is still owed. One honest line
      // beats a blank breakdown, and the total is the ledger's either way.
      const earning = orderEntries.find(isEarningEntry);
      if (earning) {
        lines = [
          {
            label: 'Earnings for this order',
            amountPaise: signed(earning),
            detail: earning.narration
          }
        ];
      }
    }

    // Refund adjustments and corrections are their own lines, named as the
    // ledger named them. A partner who lost money to a refund is owed the
    // reason, not a smaller number.
    for (const entry of orderEntries) {
      if (isEarningEntry(entry)) continue;
      lines.push({
        label:
          entry.event === 'REFUND_TO_SOURCE' || entry.event === 'REFUND_BY_LINK'
            ? 'Refund adjustment'
            : entry.event === 'SETTLEMENT_ADJUSTMENT'
            ? 'Adjustment'
            : 'Correction',
        amountPaise: signed(entry),
        detail: entry.narration
      });
    }

    const explained = lines.reduce((total, l) => total + l.amountPaise, 0);

    for (const line of lines) {
      if (line.amountPaise >= 0) earnedPaise += line.amountPaise;
      else deductionsPaise += -line.amountPaise;
    }

    const released = orderEntries.every(e => e.occurredAt <= releasedBefore);
    const payoutId = orderEntries.map(e => coveredBy.get(e.id)).find(Boolean);

    orders.push({
      orderId,
      orderNumber: order?.orderNumber || orderId,
      occurredAt,
      lines,
      netPaise,
      unexplainedPaise: netPaise - explained,
      ...(payoutId ? { settledByPayoutId: payoutId } : {}),
      released
    });
  }

  orders.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const adjustments = loose.map(entry => ({
    id: entry.id,
    occurredAt: entry.occurredAt,
    event: entry.event,
    narration: entry.narration,
    amountPaise: signed(entry)
  }));
  const adjustmentsPaise = adjustments.reduce((total, a) => total + a.amountPaise, 0);

  /*
   * Payable, held and paid.
   *
   * These are computed over the payee's WHOLE history, not the window, and
   * that is not an oversight. "You are owed ₹4,200" has to be true; narrowing
   * it to the last thirty days would show a partner a smaller figure than
   * their balance and there would be no way to tell which one was real.
   */
  const allEntries = ledger.query({ account });
  let payablePaise = 0;
  let heldPaise = 0;
  for (const entry of allEntries) {
    if (coveredBy.has(entry.id)) continue;
    if (entry.occurredAt <= releasedBefore) payablePaise += signed(entry);
    else heldPaise += signed(entry);
  }

  const paidPaise = payouts
    .filter(p => p.state === 'PAID')
    .reduce((total, p) => total + p.amountPaise, 0);

  return {
    ownerType,
    ownerId,
    ownerName,
    period: { from, to },
    summary: {
      ordersCount: orders.length,
      earnedPaise,
      deductionsPaise,
      adjustmentsPaise,
      paidPaise,
      payablePaise: Math.max(0, payablePaise),
      heldPaise: Math.max(0, heldPaise),
      outstandingPaise: Math.max(0, payablePaise) + Math.max(0, heldPaise)
    },
    orders,
    adjustments,
    payouts: payouts.slice(0, 30).map(p => ({
      id: p.id,
      amountPaise: p.amountPaise,
      state: p.state,
      rail: p.rail,
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.executedAt ? { executedAt: p.executedAt } : {})
    })),
    holdDays,
    payoutPromise: {
      arrival: arrivalSentence(ownerType),
      noRequestNeeded: noRequestNeededSentence(ownerType)
    }
  };
}

/** The same statement with every paise figure also given in rupees, for a UI. */
export function statementView(statement: Statement) {
  return {
    ...statement,
    summary: {
      ...statement.summary,
      earned: toRupees(statement.summary.earnedPaise),
      deductions: toRupees(statement.summary.deductionsPaise),
      adjustments: toRupees(statement.summary.adjustmentsPaise),
      paid: toRupees(statement.summary.paidPaise),
      payable: toRupees(statement.summary.payablePaise),
      held: toRupees(statement.summary.heldPaise),
      outstanding: toRupees(statement.summary.outstandingPaise)
    },
    orders: statement.orders.map(order => ({
      ...order,
      net: toRupees(order.netPaise),
      unexplained: toRupees(order.unexplainedPaise),
      lines: order.lines.map(line => ({ ...line, amount: toRupees(line.amountPaise) }))
    })),
    adjustments: statement.adjustments.map(a => ({ ...a, amount: toRupees(a.amountPaise) })),
    payouts: statement.payouts.map(p => ({ ...p, amount: toRupees(p.amountPaise) }))
  };
}
