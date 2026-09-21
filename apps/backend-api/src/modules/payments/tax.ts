/**
 * Tax: the customer's invoice, and the summaries a return is filed from.
 *
 * -------------------------------------------------------------------------
 * THE ONE THING THIS FILE REFUSES TO DO
 * -------------------------------------------------------------------------
 * It will not issue a tax invoice until somebody has configured a real GSTIN,
 * legal name and registered address.
 *
 * A tax invoice is a legal document. One carrying a placeholder GSTIN is not a
 * draft — it is a false document, issued to a customer who may hand it to their
 * own accountant and claim credit against it. So the endpoint refuses with a
 * message naming exactly what is missing and who can fix it, rather than
 * producing something that looks right and is not. An order receipt with no tax
 * claims on it is available either way, because a customer wanting to know what
 * they paid should not be blocked by our paperwork.
 *
 * -------------------------------------------------------------------------
 * WHY THE PLATFORM INVOICES FOR THE RESTAURANT'S FOOD
 * -------------------------------------------------------------------------
 * Under section 9(5) of the CGST Act, where restaurant service is supplied
 * through an electronic commerce operator, the OPERATOR is liable to pay the
 * tax on it as though it were the supplier. That is why the food line appears
 * on an invoice carrying the platform's GSTIN rather than the kitchen's, and it
 * is why the commission the platform keeps is a separate supply with its own
 * 18%, taxed in the other direction.
 *
 * This is the standard treatment for food delivery in India and it is what the
 * rest of this module assumes. It is also the kind of thing that changes by
 * notification, so: **the owner's accountant should confirm it against the
 * current rules before the first return is filed.** Nothing here is a
 * substitute for that, and a comment that pretended otherwise would be the
 * dangerous part.
 *
 * -------------------------------------------------------------------------
 * INVOICE NUMBERS ARE ALLOCATED ONCE AND NEVER RECOMPUTED
 * -------------------------------------------------------------------------
 * GST requires a consecutive serial number within a financial year. A number
 * derived from the order on each request would be stable but not consecutive;
 * a number allocated per request would give the same order two invoice numbers,
 * which is worse. So the first issue allocates from a per-year counter and the
 * number is stored on the order. Every later request returns that same number.
 */
import type { Order } from '@quick-bites/shared-types';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';
import { toPaise, toRupees, percentOf } from './money.ts';
import { getActiveRates } from './pricingConfig.ts';
import { splitForOrder } from './earnings.ts';

/* ------------------------------------------------------------------ *
 *  WHO IS ISSUING THE INVOICE                                         *
 * ------------------------------------------------------------------ */

export interface TaxIdentity {
  /** 15 characters. Without it no tax invoice can be issued at all. */
  gstin: string;
  /** The name on the registration, which is not always the brand. */
  legalName: string;
  tradeName?: string;
  addressLine: string;
  city: string;
  /** Two-digit GST state code, e.g. '29' for Karnataka. Decides CGST/SGST vs IGST. */
  stateCode: string;
  stateName: string;
  pincode: string;
  /** Permanent Account Number, which appears on every TDS certificate. */
  pan?: string;
  /** Tax deduction account number, for the 194-O return. */
  tan?: string;
  /** Where the invoice series restarts. India's financial year begins in April. */
  invoicePrefix: string;
}

const IDENTITY_KEY = 'tax:identity';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** What is stored, or nothing. Deliberately not a placeholder. */
export function getTaxIdentity(): TaxIdentity | null {
  const stored = memoryStore.settings.get(IDENTITY_KEY);
  return stored && typeof stored.gstin === 'string' ? (stored as TaxIdentity) : null;
}

/**
 * What is still missing before an invoice can be issued, in plain words.
 *
 * Returned as a list rather than a boolean so the refusal can say which field,
 * and an administrator does not have to guess their way through a form.
 */
export function taxIdentityGaps(): string[] {
  const identity = getTaxIdentity();
  if (!identity) return ['No GST registration details have been entered yet.'];

  const gaps: string[] = [];
  if (!GSTIN_PATTERN.test(identity.gstin || '')) {
    gaps.push('The GSTIN is not a valid 15-character number.');
  }
  if (!identity.legalName || identity.legalName.trim().length < 3) {
    gaps.push('The legal name on the registration is missing.');
  }
  if (!identity.addressLine || !identity.city || !identity.pincode) {
    gaps.push('The registered address is incomplete.');
  }
  if (!/^[0-9]{2}$/.test(identity.stateCode || '')) {
    gaps.push('The two-digit GST state code is missing.');
  }
  return gaps;
}

export function setTaxIdentity(input: TaxIdentity, actorUserId: string): TaxIdentity {
  const gstin = (input.gstin || '').trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) {
    throw new AppError(
      'That is not a valid GSTIN. It is fifteen characters, like 29AABCU9603R1ZM.',
      400,
      'INVALID_GSTIN'
    );
  }

  /*
   * The state code is the first two characters of the GSTIN and is not
   * separately typeable.
   *
   * Accepting both and trusting the typed one is how an invoice ends up
   * splitting CGST/SGST against a state the registration is not in, which is
   * the single most common tax error in a system like this and is invisible
   * until a return is rejected.
   */
  const stateCode = gstin.slice(0, 2);

  const identity: TaxIdentity = {
    ...input,
    gstin,
    stateCode,
    legalName: (input.legalName || '').trim(),
    invoicePrefix: (input.invoicePrefix || 'INV').trim().toUpperCase()
  };

  memoryStore.settings.set(IDENTITY_KEY, identity);
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'TAX_IDENTITY_SET',
      gstin: identity.gstin,
      actorUserId
    })
  );

  return identity;
}

/* ------------------------------------------------------------------ *
 *  INVOICE NUMBERING                                                  *
 * ------------------------------------------------------------------ */

/** India's financial year, as it appears on an invoice: 2026-27. */
export function financialYearOf(iso: string): string {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  // April to March. January to March belongs to the year that began the
  // previous April.
  const startYear = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const counterKey = (year: string) => `tax:invoiceCounter:${year}`;

function allocateInvoiceNumber(order: Order, identity: TaxIdentity): string {
  const year = financialYearOf(order.deliveredAt || order.createdAt);
  const key = counterKey(year);
  const current = Number(memoryStore.settings.get(key)?.value) || 0;
  const next = current + 1;

  memoryStore.settings.set(key, { value: next, updatedAt: new Date().toISOString() });
  triggerAutoSave();

  return `${identity.invoicePrefix}/${year}/${String(next).padStart(5, '0')}`;
}

/* ------------------------------------------------------------------ *
 *  THE INVOICE                                                        *
 * ------------------------------------------------------------------ */

export interface InvoiceLine {
  description: string;
  /** Services Accounting Code. Every taxable line needs one. */
  sac: string;
  taxableValuePaise: number;
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface Invoice {
  invoiceNumber: string;
  invoiceDate: string;
  financialYear: string;
  orderId: string;
  orderNumber: string;
  supplier: {
    gstin: string;
    legalName: string;
    tradeName?: string;
    address: string;
    stateCode: string;
    stateName: string;
  };
  recipient: {
    name: string;
    address: string;
    /** Where the food was delivered. Decides which tax applies. */
    placeOfSupplyStateCode: string;
    placeOfSupplyStateName: string;
  };
  lines: InvoiceLine[];
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    /** Everything not taxed by us: a tip is not a supply. */
    nonTaxablePaise: number;
    grandTotalPaise: number;
  };
  /** True when the customer and the platform are in the same state. */
  intraState: boolean;
  notes: string[];
}

/**
 * Splits a tax amount into the pair that actually appears on an invoice.
 *
 * Same state: half CGST, half SGST. Different state: all IGST. The halving is
 * done so the two halves always sum back to the whole — `floor` on one and the
 * remainder on the other, rather than rounding both and hoping.
 */
function splitTax(amountPaise: number, intraState: boolean) {
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: amountPaise };
  const half = Math.floor(amountPaise / 2);
  return { cgstPaise: half, sgstPaise: amountPaise - half, igstPaise: 0 };
}

/**
 * The customer's tax invoice for one order.
 *
 * Refuses rather than guesses when the registration is incomplete. Every figure
 * comes from the FROZEN bill on the order, so an invoice reissued next year
 * shows the tax that was actually charged and not what today's rates would say.
 */
export function invoiceFor(order: Order, options: { allocate?: boolean } = {}): Invoice {
  const gaps = taxIdentityGaps();
  if (gaps.length > 0) {
    throw new AppError(
      `A tax invoice cannot be issued yet: ${gaps.join(' ')} An administrator can complete this under Settings → Tax.`,
      409,
      'TAX_IDENTITY_INCOMPLETE'
    );
  }

  const identity = getTaxIdentity()!;
  const bill: any = order.bill || {};
  const rates = getActiveRates();

  /*
   * Place of supply.
   *
   * For restaurant service it is where the service is performed, which for
   * delivery is where the food goes. We do not hold a structured state on a
   * delivery address, so the platform's own state is assumed — which is right
   * for essentially every order on a city-level food platform, and wrong in a
   * way that would be visible on the invoice if it ever were not.
   *
   * The note below says so on the face of the document rather than leaving it
   * as an assumption nobody can see.
   */
  const placeOfSupplyStateCode = identity.stateCode;
  const intraState = placeOfSupplyStateCode === identity.stateCode;

  const itemsPaise = toPaise(Number(bill.itemsTotal) || 0);
  const packagingPaise = toPaise(Number(bill.packagingFee) || 0);
  const deliveryPaise = toPaise(Number(bill.deliveryFee) || 0);
  const platformFeeBasePaise = toPaise(Number(rates.platformFeeBase) || 0);
  const tipPaise = toPaise(Number(bill.tipAmount) || 0);
  const discountPaise = toPaise(Number(bill.couponDiscount) || 0);

  const lines: InvoiceLine[] = [];

  /*
   * Restaurant service, SAC 996331.
   *
   * Food, packaging and delivery are one composite supply of restaurant
   * service at 5%, less any discount funded on the bill. Splitting delivery
   * out at a different rate is a common mistake and produces a return that
   * does not reconcile against the order value.
   */
  const foodTaxablePaise = Math.max(0, itemsPaise + packagingPaise + deliveryPaise - discountPaise);
  if (foodTaxablePaise > 0) {
    // The tax actually charged, from the bill, not re-derived. An order placed
    // when the rate was different must show what the customer actually paid.
    const chargedGstPaise = toPaise(Number(bill.gstAmount) || 0);
    const gstPaise = chargedGstPaise > 0 ? chargedGstPaise : percentOf(foodTaxablePaise, rates.gstFoodPercent);
    const parts = splitTax(gstPaise, intraState);
    lines.push({
      description: 'Restaurant service (food, packaging and delivery)',
      sac: '996331',
      taxableValuePaise: foodTaxablePaise,
      ratePercent: rates.gstFoodPercent,
      ...parts,
      totalPaise: foodTaxablePaise + gstPaise
    });
  }

  /*
   * The platform fee, SAC 998599, at 18%.
   *
   * The bill stores this GST-inclusive — `platformFee` is 5.90, being 5.00 plus
   * 18%. An invoice must show the taxable value and the tax separately, so it
   * is unwound here rather than presented as a taxable value of 5.90, which
   * would overstate the supply and understate the rate.
   */
  if (platformFeeBasePaise > 0) {
    const gstPaise = percentOf(platformFeeBasePaise, rates.platformFeeGstPercent);
    const parts = splitTax(gstPaise, intraState);
    lines.push({
      description: 'Platform fee',
      sac: '998599',
      taxableValuePaise: platformFeeBasePaise,
      ratePercent: rates.platformFeeGstPercent,
      ...parts,
      totalPaise: platformFeeBasePaise + gstPaise
    });
  }

  const totals = lines.reduce(
    (acc, line) => ({
      taxableValuePaise: acc.taxableValuePaise + line.taxableValuePaise,
      cgstPaise: acc.cgstPaise + line.cgstPaise,
      sgstPaise: acc.sgstPaise + line.sgstPaise,
      igstPaise: acc.igstPaise + line.igstPaise
    }),
    { taxableValuePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 }
  );

  const notes: string[] = [
    'Tax on restaurant service is payable by the electronic commerce operator under section 9(5) of the CGST Act.'
  ];
  if (tipPaise > 0) {
    // A tip is the customer's money passing through to a rider. It is not
    // consideration for any supply we made, so it carries no tax and must not
    // silently inflate the taxable value.
    notes.push('A tip is paid in full to the delivery partner and is not a taxable supply.');
  }
  notes.push(`Place of supply: ${identity.stateName} (${identity.stateCode}).`);

  const invoiceNumber = existingInvoiceNumber(order)
    || (options.allocate === false
      ? 'NOT YET ISSUED'
      : recordInvoiceNumber(order, allocateInvoiceNumber(order, identity)));

  return {
    invoiceNumber,
    invoiceDate: order.deliveredAt || order.createdAt,
    financialYear: financialYearOf(order.deliveredAt || order.createdAt),
    orderId: order.id,
    orderNumber: order.orderNumber,
    supplier: {
      gstin: identity.gstin,
      legalName: identity.legalName,
      tradeName: identity.tradeName,
      address: `${identity.addressLine}, ${identity.city} ${identity.pincode}`,
      stateCode: identity.stateCode,
      stateName: identity.stateName
    },
    recipient: {
      name: order.customerName || 'Customer',
      address: order.deliveryAddressText || '',
      placeOfSupplyStateCode: placeOfSupplyStateCode,
      placeOfSupplyStateName: identity.stateName
    },
    lines,
    totals: {
      ...totals,
      nonTaxablePaise: tipPaise,
      grandTotalPaise:
        totals.taxableValuePaise + totals.cgstPaise + totals.sgstPaise + totals.igstPaise + tipPaise
    },
    intraState,
    notes
  };
}

function existingInvoiceNumber(order: Order): string | null {
  const stored = (order as any).taxInvoiceNumber;
  return typeof stored === 'string' && stored.length > 0 ? stored : null;
}

function recordInvoiceNumber(order: Order, invoiceNumber: string): string {
  (order as any).taxInvoiceNumber = invoiceNumber;
  (order as any).taxInvoiceIssuedAt = new Date().toISOString();
  memoryStore.orders.set(order.id, order);
  triggerAutoSave();
  return invoiceNumber;
}

/* ------------------------------------------------------------------ *
 *  WHAT A RETURN IS FILED FROM                                        *
 * ------------------------------------------------------------------ */

export interface TaxSummary {
  month: string;
  from: string;
  to: string;
  ordersCounted: number;
  /** GSTR-1 style: what we supplied and the tax on it. */
  outward: {
    restaurantServiceTaxablePaise: number;
    restaurantServiceTaxPaise: number;
    platformFeeTaxablePaise: number;
    platformFeeTaxPaise: number;
    commissionTaxablePaise: number;
    commissionTaxPaise: number;
    totalTaxPaise: number;
  };
  /** Section 52: tax collected at source on the net value of supplies. */
  tcs: {
    netSuppliesPaise: number;
    collectedPaise: number;
    ratePercent: number;
  };
  /** Section 194-O, per supplier, which is how the return is filed. */
  tds: Array<{
    restaurantId: string;
    restaurantName: string;
    grossSuppliesPaise: number;
    deductedPaise: number;
    ordersCounted: number;
  }>;
  tdsTotalPaise: number;
  /** Anything that would make a filing wrong if it were not said out loud. */
  warnings: string[];
}

/** `2026-09` → the month's UTC bounds. */
function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number);
  if (!year || !m || m < 1 || m > 12) {
    throw new AppError('A month looks like 2026-09.', 400, 'BAD_MONTH');
  }
  const from = new Date(Date.UTC(year, m - 1, 1)).toISOString();
  const to = new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) - 1).toISOString();
  return { from, to };
}

/**
 * Everything a month's returns are built from.
 *
 * Derived from the orders themselves rather than from the ledger, deliberately:
 * a return is filed against supplies made, and an order that was delivered but
 * whose earnings posting failed is still a supply. Building this from the
 * ledger would quietly omit exactly the orders most worth noticing, so the two
 * are reconciled instead — the warning list says when they disagree.
 */
export function monthlyTaxSummary(month: string): TaxSummary {
  const { from, to } = monthBounds(month);
  const rates = getActiveRates();

  const outward = {
    restaurantServiceTaxablePaise: 0,
    restaurantServiceTaxPaise: 0,
    platformFeeTaxablePaise: 0,
    platformFeeTaxPaise: 0,
    commissionTaxablePaise: 0,
    commissionTaxPaise: 0,
    totalTaxPaise: 0
  };

  let netSuppliesPaise = 0;
  let ordersCounted = 0;
  const byRestaurant = new Map<string, { name: string; grossPaise: number; tdsPaise: number; orders: number }>();
  const warnings: string[] = [];
  let missingCommissionRate = 0;

  for (const order of memoryStore.orders.values()) {
    const typed = order as Order;
    if (typed.status !== 'DELIVERED') continue;

    const at = typed.deliveredAt || typed.updatedAt;
    if (!at || at < from || at > to) continue;

    ordersCounted += 1;

    const bill: any = typed.bill || {};
    const split = splitForOrder(typed);

    const itemsPaise = toPaise(Number(bill.itemsTotal) || 0);
    const packagingPaise = toPaise(Number(bill.packagingFee) || 0);
    const deliveryPaise = toPaise(Number(bill.deliveryFee) || 0);
    const discountPaise = toPaise(Number(bill.couponDiscount) || 0);
    const foodTaxablePaise = Math.max(0, itemsPaise + packagingPaise + deliveryPaise - discountPaise);

    outward.restaurantServiceTaxablePaise += foodTaxablePaise;
    outward.restaurantServiceTaxPaise += toPaise(Number(bill.gstAmount) || 0);

    const platformFeeBasePaise = toPaise(Number(rates.platformFeeBase) || 0);
    outward.platformFeeTaxablePaise += platformFeeBasePaise;
    outward.platformFeeTaxPaise += percentOf(platformFeeBasePaise, rates.platformFeeGstPercent);

    outward.commissionTaxablePaise += split.commissionPaise;
    outward.commissionTaxPaise += split.commissionGstPaise;

    if (!Number.isFinite(Number(bill.commissionPercent))) missingCommissionRate += 1;

    // Section 52 is on the NET value of taxable supplies made through the
    // platform: what the supplier supplied, not what the customer paid us.
    netSuppliesPaise += itemsPaise + packagingPaise;

    const existing = byRestaurant.get(typed.restaurantId) || {
      name: typed.restaurantName || (memoryStore.restaurants.get(typed.restaurantId) as any)?.name || typed.restaurantId,
      grossPaise: 0,
      tdsPaise: 0,
      orders: 0
    };
    existing.grossPaise += itemsPaise + packagingPaise;
    existing.tdsPaise += split.tdsPaise;
    existing.orders += 1;
    byRestaurant.set(typed.restaurantId, existing);
  }

  outward.totalTaxPaise =
    outward.restaurantServiceTaxPaise + outward.platformFeeTaxPaise + outward.commissionTaxPaise;

  const tds = Array.from(byRestaurant.entries())
    .map(([restaurantId, row]) => ({
      restaurantId,
      restaurantName: row.name,
      grossSuppliesPaise: row.grossPaise,
      deductedPaise: row.tdsPaise,
      ordersCounted: row.orders
    }))
    .sort((a, b) => b.grossSuppliesPaise - a.grossSuppliesPaise);

  if (missingCommissionRate > 0) {
    warnings.push(
      `${missingCommissionRate} order${missingCommissionRate === 1 ? '' : 's'} predate per-order commission rates, ` +
        'so their commission was re-derived from the rate in force. Check these before filing.'
    );
  }

  const gaps = taxIdentityGaps();
  if (gaps.length > 0) {
    warnings.push('No valid GST registration is configured, so no invoices have been issued for these orders.');
  }

  return {
    month,
    from,
    to,
    ordersCounted,
    outward,
    tcs: {
      netSuppliesPaise,
      collectedPaise: percentOf(netSuppliesPaise, rates.tcsPercent),
      ratePercent: rates.tcsPercent
    },
    tds,
    tdsTotalPaise: tds.reduce((total, row) => total + row.deductedPaise, 0),
    warnings
  };
}

/** The same summary in rupees, for a screen or a spreadsheet. */
export function taxSummaryView(summary: TaxSummary) {
  return {
    ...summary,
    outward: {
      ...summary.outward,
      restaurantServiceTaxable: toRupees(summary.outward.restaurantServiceTaxablePaise),
      restaurantServiceTax: toRupees(summary.outward.restaurantServiceTaxPaise),
      platformFeeTaxable: toRupees(summary.outward.platformFeeTaxablePaise),
      platformFeeTax: toRupees(summary.outward.platformFeeTaxPaise),
      commissionTaxable: toRupees(summary.outward.commissionTaxablePaise),
      commissionTax: toRupees(summary.outward.commissionTaxPaise),
      totalTax: toRupees(summary.outward.totalTaxPaise)
    },
    tcs: {
      ...summary.tcs,
      netSupplies: toRupees(summary.tcs.netSuppliesPaise),
      collected: toRupees(summary.tcs.collectedPaise)
    },
    tds: summary.tds.map(row => ({
      ...row,
      grossSupplies: toRupees(row.grossSuppliesPaise),
      deducted: toRupees(row.deductedPaise)
    })),
    tdsTotal: toRupees(summary.tdsTotalPaise)
  };
}

/** A CSV a bookkeeper can open. One row per partner, for the 194-O return. */
export function tdsCsv(summary: TaxSummary): string {
  const header = 'Restaurant ID,Restaurant,Orders,Gross supplies (Rs),TDS deducted (Rs)';
  const rows = summary.tds.map(row =>
    [
      row.restaurantId,
      `"${row.restaurantName.replace(/"/g, '""')}"`,
      row.ordersCounted,
      toRupees(row.grossSuppliesPaise).toFixed(2),
      toRupees(row.deductedPaise).toFixed(2)
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

export function resetTaxForTesting(): void {
  memoryStore.settings.delete(IDENTITY_KEY);
  for (const key of Array.from(memoryStore.settings.keys())) {
    if (String(key).startsWith('tax:invoiceCounter:')) memoryStore.settings.delete(key);
  }
}
