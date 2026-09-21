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
}

export function splitForOrder(order: Order, rates: PricingRates = getActiveRates()): OrderSplit {
  const bill: any = order.bill || {};

  const grossPaise = toPaise(Number(bill.totalAmount) || 0);
  const itemsPaise = toPaise(Number(bill.itemsTotal) || 0);
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

  // The kitchen keeps the food total and the packaging it paid for, less our
  // commission and the tax withheld from them. The tip is deliberately absent:
  // it is the customer's money passing through to the rider.
  const partnerPaise = Math.max(0, itemsPaise + packagingPaise - commissionPaise - tdsPaise);

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
    tipPaise
  };
}

/**
 * Posts what an order earned everybody.
 *
 * Called when an order reaches DELIVERED. Safe to call again — and it will be,
 * because the sweeper and the status route both reach it.
 */
export function recordOrderEarnings(order: Order): void {
  if (!order?.id) return;

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
export function backfillEarnings(): { scanned: number; posted: number } {
  let scanned = 0;
  let posted = 0;

  for (const order of memoryStore.orders.values() as Iterable<Order>) {
    if (order.status !== 'DELIVERED') continue;
    scanned++;
    if (earningsPosted(order.id)) continue;
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

  return { scanned, posted };
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
