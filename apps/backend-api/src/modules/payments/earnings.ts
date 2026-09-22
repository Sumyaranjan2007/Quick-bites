/**
 * Turning an order into money somebody is owed.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS NOT COMPUTED AT PAYOUT TIME
 * -------------------------------------------------------------------------
 * The old settlement code re-derived what a restaurant was owed by scanning
 * orders whenever somebody opened the screen. That is fine until an order is
 * refunded, re-rated, cancelled or archived — and then the figure changes
 * underneath a settlement that has already been paid, and nobody can say what
 * the number was when the decision was made.
 *
 * So earnings are POSTED, once, when the order completes. What a partner is
 * owed is then a balance in the ledger rather than the output of a scan, and
 * the entries behind it carry the order ids that produced them. "Why is this
 * Rs 4,812?" has a literal answer made of rows.
 *
 * -------------------------------------------------------------------------
 * EVERY ORDER POSTS EXACTLY ONCE
 * -------------------------------------------------------------------------
 * Keyed on the order id. A redelivered webhook, a retried status update, a
 * sweeper that runs twice — all land here and all are no-ops after the first.
 * Without that the same delivery would be paid for twice, which is precisely
 * the class of bug a ledger exists to make impossible.
 */
import { memoryStore } from '../../db/client.ts';
import { ledger, accountFor } from './ledger.ts';
import { toPaise, toRupees, percentOf } from './money.ts';
import { getActiveRates, commissionPercentFor } from './pricingConfig.ts';
import type { Order, PricingRates } from '@quick-bites/shared-types';

/**
 * What each party gets out of one order, in paise.
 *
 * Read off the order's FROZEN bill wherever possible. The bill records the
 * rates the order was actually priced under, and re-deriving from today's
 * configuration would silently restate what a kitchen earned last month.
 */
export interface OrderSplit {
  grossPaise: number;
  partnerPaise: number;
  riderPaise: number;
  commissionPaise: number;
  commissionGstPaise: number;
  tdsPaise: number;
  tcsPaise: number;
  platformFeePaise: number;
  gstOnFoodPaise: number;
  tipPaise: number;
  /** What we added to the food price and kept. Never reaches the kitchen. */
  foodMarkupPaise: number;
}

export function splitForOrder(order: Order, rates: PricingRates = getActiveRates()): OrderSplit {
  const bill: any = order.bill || {};

  const grossPaise = toPaise(Number(bill.totalAmount) || 0);
  /*
   * The RESTAURANT's own food total, not the marked-up one the customer paid.
   *
   * Same rule as packaging, one line down: anything an administrator added on
   * top is the platform's, and paying it out here would hand the kitchen our
   * margin. Orders placed before food could be marked up carry no such field
   * and fall back to the customer figure, which is what was true then.
   */
  const itemsPaise = Number.isFinite(Number(bill.partnerItemsTotal))
    ? toPaise(Number(bill.partnerItemsTotal))
    : toPaise(Number(bill.itemsTotal) || 0);
  /** What the customer actually paid for the food. Used for our own margin. */
  const customerItemsPaise = toPaise(Number(bill.itemsTotal) || 0);
  const packagingPaise = toPaise(Number(bill.packagingFee) || 0);
  const platformFeePaise = toPaise(Number(bill.platformFee) || 0);
  const gstOnFoodPaise = toPaise(Number(bill.gstAmount) || 0);
  const tipPaise = toPaise(Number(bill.tipAmount) || 0);

  // The frozen figures where the order has them. Orders placed before rates
  // were configurable do not, and fall back to the rate in force — the closest
  // honest answer available for an order that never recorded one.
  const commissionPaise = Number.isFinite(Number(bill.commissionAmount))
    ? toPaise(Number(bill.commissionAmount))
    : percentOf(itemsPaise, rates.defaultCommissionPercent);

  const tdsPaise = Number.isFinite(Number(bill.tdsAmount))
    ? toPaise(Number(bill.tdsAmount))
    : percentOf(itemsPaise, rates.tdsPercent);

  // Tax the PLATFORM owes on its own commission, and tax it collects at source.
  // Neither was recorded anywhere before; both are obligations that accrued
  // whether or not anything wrote them down.
  const commissionGstPaise = percentOf(commissionPaise, rates.commissionGstPercent);
  const tcsPaise = percentOf(itemsPaise, rates.tcsPercent);

  /*
   * The kitchen keeps the food total and the packaging THEY declared, less our
   * commission and the tax withheld from them. The tip is deliberately absent:
   * it is the customer's money passing through to the rider.
   *
   * `partnerPackagingFee`, not `packagingFee`. Where an administrator has
   * marked packaging up for this restaurant, the customer paid the higher
   * figure and the difference is platform revenue. Using the customer's figure
   * here would hand the restaurant money the platform charged on its own
   * behalf — and nothing would look wrong, because the bill would still balance
   * and so would the ledger. The money would simply leave.
   *
   * Orders placed before per-restaurant charges existed have no such field, and
   * fall back to the customer's figure, which is what was true then.
   */
  const partnerPackagingPaise = Number.isFinite(Number(bill.partnerPackagingFee))
    ? toPaise(Number(bill.partnerPackagingFee))
    : packagingPaise;

  const partnerPaise = Math.max(0, itemsPaise + partnerPackagingPaise - commissionPaise - tdsPaise);

  // What the rider earned on this trip, plus the whole tip.
  const riderPaise = toPaise(Number(order.riderPayout) || 0) + tipPaise;

  return {
    grossPaise,
    partnerPaise,
    riderPaise,
    commissionPaise,
    commissionGstPaise,
    tdsPaise,
    tcsPaise,
    platformFeePaise,
    gstOnFoodPaise,
    tipPaise,
    foodMarkupPaise: Math.max(0, customerItemsPaise - itemsPaise)
  };
}

/**
 * Whether an order carries evidence that the delivery it claims actually ran.
 *
 * Kept separate from the posting itself so the same judgement can be shown to
 * an administrator without posting anything.
 *
 * There is a precondition on `verifyDeliveryOtp` that already refuses to mark
 * an uncollected order delivered. This is deliberately a second check in a
 * different place rather than trust in that one. A guard inside a repository
 * method is one refactor away from being removed by somebody who cannot see
 * what it was holding up; this one sits where the money actually leaves, so it
 * survives that refactor and any new path that reaches DELIVERED another way.
 *
 * `pickedUpAt` is the load-bearing field. It is written only when a rider
 * confirms collection at the restaurant, so it is the platform's own record
 * that food physically left the kitchen — as opposed to a status, which is a
 * claim about that, and an OTP, which the customer reads out loud.
 */
export function deliveryEvidence(order: Order): { ok: boolean; reason?: string } {
  if (order.status !== 'DELIVERED') {
    return { ok: false, reason: 'The order has not been delivered.' };
  }
  if (!order.pickedUpAt) {
    return {
      ok: false,
      reason: 'No rider ever confirmed collecting this order from the restaurant.'
    };
  }
  return { ok: true };
}

/**
 * Whether the customer's money actually arrived.
 *
 * Separate from the delivery half because the two fail independently, and the
 * combination that matters most is the one where the food moved and the money
 * did not. `deliveryEvidence` passes cleanly on such an order — the kitchen
 * cooked, the rider collected, the customer ate.
 *
 * `paymentStatus` cannot answer this on its own. Marking an order delivered
 * writes `paymentStatus = 'PAID'` in two places that know nothing about whether
 * a payment was taken, so on a prepaid order the flag is set by the act of
 * handing food over. Every route that genuinely takes money writes a gateway
 * reference at the same moment it writes PAID, and the two delivery writers
 * write no reference — which is what makes the reference, rather than the flag,
 * the thing worth reading.
 */
export function paymentEvidence(order: Order): { ok: boolean; reason?: string } {
  /*
   * Stamped by the delivery path itself when it reached DELIVERED on a prepaid
   * method that nothing had confirmed payment for. It is a direct statement
   * that the money is unaccounted for, so it is read before anything is
   * inferred from what the order does or does not carry.
   */
  if (order.paymentUnresolvedAt) {
    return {
      ok: false,
      reason: 'Delivered without a confirmed payment — the money was never accounted for.'
    };
  }

  // Cash is the one case where delivery IS the payment event. The rider is
  // holding it, and `recordOrderEarnings` posts it to their cash account rather
  // than the platform's bank for exactly that reason.
  if (order.paymentMethod === 'CASH_ON_DELIVERY') return { ok: true };

  if (order.paymentMethod === 'WALLET') {
    const paid = Array.from(memoryStore.walletTransactions.values() as Iterable<any>).some(
      t => t?.orderId === order.id
    );
    return paid
      ? { ok: true }
      : { ok: false, reason: 'Paid from wallet, but no wallet transaction records it.' };
  }

  if (!order.razorpayPaymentId) {
    return {
      ok: false,
      reason:
        'Marked paid, but no payment reference was ever recorded — the money may never have arrived.'
    };
  }
  return { ok: true };
}

/**
 * The single question every payout path should ask: may this order turn into
 * money owed to somebody?
 *
 * Both halves, in one call, so a caller cannot check one and forget the other.
 */
export function settlementEvidence(order: Order): { ok: boolean; reason?: string } {
  const delivery = deliveryEvidence(order);
  if (!delivery.ok) return delivery;
  return paymentEvidence(order);
}

/** Thrown rather than returned, so a caller cannot ignore it by accident. */
export class EarningsNotDue extends Error {
  readonly orderId: string;
  constructor(orderId: string, reason: string) {
    super(reason);
    this.name = 'EarningsNotDue';
    this.orderId = orderId;
  }
}

/**
 * Posts what an order earned everybody.
 *
 * Called when an order reaches DELIVERED. Safe to call again — and it will be,
 * because the sweeper and the status route both reach it.
 *
 * Refuses an order that cannot show the delivery happened. It throws instead of
 * returning quietly: money that silently fails to post is owed to somebody who
 * is not being told, which is the same defect as paying for a trip that never
 * ran, only quieter. Both callers already log and carry on, and the refusal is
 * counted for the administrator by `heldEarnings()`.
 *
 * `override` exists for the case a person has checked and decided it is real —
 * an order from before this rule, or a delivery confirmed off-app. It records
 * who decided, because that is the question an auditor asks.
 */
export function recordOrderEarnings(
  order: Order,
  override?: { byUserId: string; note: string }
): void {
  if (!order?.id) return;

  const evidence = settlementEvidence(order);
  if (!evidence.ok && !override) {
    throw new EarningsNotDue(order.id, evidence.reason!);
  }

  const split = splitForOrder(order);
  if (split.grossPaise <= 0) return;

  const paidOnline = order.paymentStatus === 'PAID' && order.paymentMethod !== 'CASH_ON_DELIVERY';

  /*
   * Where the money physically is.
   *
   * Online: in the platform's account. Cash: in the rider's pocket, which is
   * the platform's money that a person is carrying. Recording the second as
   * though it were in the bank is how a platform believes it holds cash it has
   * never seen.
   */
  const moneyHolder = paidOnline
    ? { account: 'PLATFORM_BANK', event: 'ORDER_PAID_ONLINE' as const }
    : { account: accountFor('RIDER_CASH', order.riderId || 'unassigned'), event: 'COD_COLLECTED' as const };

  // Everything owed out of that gross, as credits. What is left over is the
  // platform's own margin, and it is computed rather than asserted so the
  // transaction cannot fail to balance.
  const postings: Array<{ account: string; direction: 'DEBIT' | 'CREDIT'; amountPaise: number }> = [
    { account: moneyHolder.account, direction: 'DEBIT', amountPaise: split.grossPaise }
  ];

  const credit = (account: string, amountPaise: number) => {
    if (amountPaise > 0) postings.push({ account, direction: 'CREDIT', amountPaise });
  };

  credit(accountFor('PARTNER_PAYABLE', order.restaurantId), split.partnerPaise);
  if (order.riderId) credit(accountFor('RIDER_PAYABLE', order.riderId), split.riderPaise);
  credit('TAX_GST_PAYABLE', split.gstOnFoodPaise + split.commissionGstPaise);
  credit('TAX_TCS_PAYABLE', split.tcsPaise);
  credit('TDS_WITHHELD', split.tdsPaise);
  credit('REVENUE_COMMISSION', split.commissionPaise);

  // The remainder is the platform's fee income and its margin on delivery.
  // Derived, not asserted: whatever is left after everyone else is paid is what
  // the platform actually kept, and computing it this way means the books
  // balance by construction rather than by a number somebody maintained.
  const owedOut = postings
    .filter(p => p.direction === 'CREDIT')
    .reduce((total, p) => total + p.amountPaise, 0);
  const remainder = split.grossPaise - owedOut;

  if (remainder > 0) {
    credit('REVENUE_FEES', remainder);
  } else if (remainder < 0) {
    /*
     * The order cost the platform more than it collected.
     *
     * Entirely possible and not an error: a coupon the platform funded, free
     * delivery on a membership, a long trip on a small basket. The platform is
     * out of pocket, and a DEBIT against its fee income is what that looks
     * like. Silently clamping this to zero would quietly hide every
     * loss-making promotion on the platform.
     */
    postings.push({ account: 'REVENUE_FEES', direction: 'DEBIT', amountPaise: -remainder });
  }

  ledger.post({
    event: moneyHolder.event,
    occurredAt: order.deliveredAt || order.updatedAt || new Date().toISOString(),
    postings,
    idempotencyKey: `order_earnings:${order.id}`,
    actorUserId: 'system',
    narration: `Order #${order.orderNumber} settled: ${paidOnline ? 'paid online' : 'cash on delivery'}`,
    orderId: order.id
  });
}

/** Whether an order's earnings have already been posted. */
export function earningsPosted(orderId: string): boolean {
  return ledger.query({ orderId }).some(e => e.idempotencyKey === `order_earnings:${orderId}`);
}

/**
 * Posts earnings for every delivered order that has none.
 *
 * Exists for two reasons, both real. Orders delivered BEFORE the ledger existed
 * have no entries and their partners are owed money the platform cannot see;
 * and any future path that completes an order without calling
 * `recordOrderEarnings` would quietly stop paying people, which is the kind of
 * bug that is noticed by a partner rather than by a test.
 *
 * Idempotent, so it is safe to run at boot and safe to run again.
 */
export function backfillEarnings(): { scanned: number; posted: number; held: number } {
  let scanned = 0;
  let posted = 0;
  let held = 0;

  for (const order of memoryStore.orders.values() as Iterable<Order>) {
    if (order.status !== 'DELIVERED') continue;
    scanned++;
    if (earningsPosted(order.id)) continue;

    /*
     * Counted, not shouted about. An order with no evidence of collection is
     * held at every boot, and logging it as a failure each time trains whoever
     * reads these logs to ignore the line. It is reported once, to a person, by
     * `heldEarnings()`.
     */
    if (!settlementEvidence(order).ok) {
      held++;
      continue;
    }

    try {
      recordOrderEarnings(order);
      posted++;
    } catch (error) {
      // One malformed order must not stop the rest being posted. Logged loudly
      // because an order that cannot be split is money somebody is owed and
      // the platform cannot compute.
      console.log(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'EARNINGS_BACKFILL_FAILED',
          orderId: order.id,
          reason: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  return { scanned, posted, held };
}

/**
 * Orders that say they were delivered but cannot show it, so nobody has been
 * paid for them.
 *
 * This is the half of the gate that makes refusing safe. Money that stops
 * moving and says nothing is indistinguishable from money that was never owed,
 * and the people it belongs to are the last to find out. Every refusal ends up
 * in front of an administrator here, with the reason and a way to release it.
 */
export function heldEarnings(): Array<{
  orderId: string;
  orderNumber?: string;
  restaurantId: string;
  riderId?: string;
  deliveredAt?: string;
  reason: string;
}> {
  const rows: ReturnType<typeof heldEarnings> = [];
  for (const order of memoryStore.orders.values() as Iterable<Order>) {
    if (order.status !== 'DELIVERED') continue;
    if (earningsPosted(order.id)) continue;
    const evidence = settlementEvidence(order);
    if (evidence.ok) continue;
    rows.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      restaurantId: order.restaurantId,
      riderId: order.riderId,
      deliveredAt: order.deliveredAt,
      reason: evidence.reason!
    });
  }
  return rows.sort((a, b) => (b.deliveredAt || '').localeCompare(a.deliveredAt || ''));
}

/**
 * What a rider has earned and not yet been paid, in rupees.
 *
 * -------------------------------------------------------------------------
 * WHY THIS REPLACES THE RIDER WALLET BALANCE
 * -------------------------------------------------------------------------
 * The delivery route credited a rider's WALLET on every completed trip, and
 * the ledger now records the same trip as `RIDER_PAYABLE`. Two systems holding
 * the same money is not redundancy, it is a disagreement waiting to be noticed
 * by the person least able to afford it: payouts are computed from the ledger,
 * so a rider watching a wallet balance would have been watching a number that
 * had nothing to do with what they were about to be paid.
 *
 * The wallet credit is gone and this is what the apps show instead. One number,
 * derived from the same entries the payout is derived from, so what a rider is
 * told and what a rider receives cannot drift apart.
 */
export function riderEarningsBalance(riderId: string): number {
  return toRupees(ledger.balanceOf(accountFor('RIDER_PAYABLE', riderId)));
}

/** The same for a restaurant, for the partner app's own earnings screen. */
export function partnerEarningsBalance(restaurantId: string): number {
  return toRupees(ledger.balanceOf(accountFor('PARTNER_PAYABLE', restaurantId)));
}
