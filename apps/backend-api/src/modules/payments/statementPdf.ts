/**
 * The downloadable earnings invoice: what a restaurant (or rider) was paid for,
 * order by order, with a summary — as a PDF.
 *
 * Every figure comes from `statementFor`, the same function behind the
 * Statement screen in the Partner app and the admin's view of a payee. A PDF
 * that disagreed with the screen beside it would be the worst outcome here,
 * so this file only lays the statement out; it computes no money of its own
 * beyond adding up the statement's own lines.
 *
 * Dishes are listed at the RESTAURANT's prices (the kitchen's view of the
 * order), never the customer's marked-up ones.
 */
import type { Response } from 'express';
import type { Order, PayeeOwnerType } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { AppError } from '../../utils/AppError.ts';
import { SimplePdf, type Rgb } from '../../utils/simplePdf.ts';
import { zip } from '../../utils/simpleZip.ts';
import { shapeOrderForViewer } from '../orders/contactVisibility.ts';
import { businessIdentity, formattedAddress } from '../platform/businessIdentity.ts';
import { statementFor, type Statement, type OrderStatement } from './statements.ts';

export interface InvoicePayee {
  name: string;
  ownerType: 'RESTAURANT' | 'RIDER';
  address?: string;
  fssai?: string;
  gstin?: string;
}

const MAROON: Rgb = [100, 28, 50];
const INK: Rgb = [23, 19, 19];
const SOFT: Rgb = [92, 80, 72];
const MUTED: Rgb = [120, 108, 98];
const GREEN: Rgb = [30, 122, 76];
const AMBER_BG: Rgb = [255, 243, 204];
const CREAM: Rgb = [253, 248, 240];

const LEFT = 42;
const RIGHT = 553;
const BOTTOM = 790;

const money = (paise: number) => {
  const sign = paise < 0 ? '-' : '';
  return `${sign}Rs ${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  });
const ymd = (iso: string) => new Date(iso).toISOString().slice(0, 10).replace(/-/g, '');

/** "All orders" is asked for as everything since 1970; it is printed as what it means. */
const isAllTime = (statement: Statement) => new Date(statement.period.from).getUTCFullYear() < 2000;

/** The file name the download is saved under. */
export function invoiceFileName(statement: Statement, orderNumber?: string): string {
  return orderNumber
    ? `QuickBites-invoice-${orderNumber}.pdf`
    : `QuickBites-earnings-${isAllTime(statement) ? 'all' : ymd(statement.period.from)}-to-${ymd(statement.period.to)}.pdf`;
}

function orderStatus(o: OrderStatement): { text: string; color: Rgb } {
  if (o.settledByPayoutId) return { text: 'Paid to you', color: GREEN };
  return o.released ? { text: 'Due to you', color: MAROON } : { text: 'Held', color: MUTED };
}

export function renderStatementPdf(
  statement: Statement,
  payee: InvoicePayee,
  options: { orderId?: string; issuedAt?: string } = {}
): Buffer {
  const pdf = new SimplePdf();
  const us = businessIdentity();
  const issuedAt = options.issuedAt || new Date().toISOString();
  const orders = options.orderId ? statement.orders.filter(o => o.orderId === options.orderId) : statement.orders;
  const single = Boolean(options.orderId);
  let y = 0;

  const ensure = (needed: number) => {
    if (y + needed <= BOTTOM) return;
    pdf.addPage();
    y = 48;
  };

  // ---- Header band --------------------------------------------------------
  pdf.rect(0, 0, pdf.width, 96, MAROON);
  pdf.text(us.tradingName || 'Quick Bites', LEFT, 42, { size: 22, bold: true, color: [255, 255, 255] });
  pdf.text(single ? 'Order invoice' : 'Earnings invoice and order statement', LEFT, 64, {
    size: 11,
    color: [255, 228, 200]
  });
  const number = single
    ? `QB-INV-${String(orders[0]?.orderNumber || options.orderId).replace(/^QB-/, '')}`
    : `QB-ST-${statement.ownerId.slice(-6).toUpperCase()}-${isAllTime(statement) ? 'ALL' : ymd(statement.period.from)}-${ymd(statement.period.to)}`;
  pdf.text(number, RIGHT, 42, { size: 10, bold: true, color: [255, 255, 255], align: 'right' });
  pdf.text(`Issued ${day(issuedAt)}`, RIGHT, 58, { size: 9, color: [255, 228, 200], align: 'right' });
  if (!single) {
    const span = isAllTime(statement)
      ? `All orders to ${day(statement.period.to)}`
      : `${day(statement.period.from)} to ${day(statement.period.to)}`;
    pdf.text(span, RIGHT, 72, {
      size: 9,
      color: [255, 228, 200],
      align: 'right'
    });
  }

  // ---- Parties ------------------------------------------------------------
  y = 126;
  pdf.text(payee.ownerType === 'RESTAURANT' ? 'RESTAURANT' : 'DELIVERY PARTNER', LEFT, y, { size: 8, bold: true, color: MUTED });
  pdf.text('FROM', 320, y, { size: 8, bold: true, color: MUTED });
  y += 15;
  pdf.text(payee.name, LEFT, y, { size: 12, bold: true });
  pdf.text(us.legalName, 320, y, { size: 12, bold: true });
  let left = y;
  let right = y;
  for (const line of [
    ...(payee.address ? pdf.wrap(payee.address, 250, 9) : []),
    ...(payee.fssai ? [`FSSAI ${payee.fssai}`] : []),
    ...(payee.gstin ? [`GSTIN ${payee.gstin}`] : [])
  ]) {
    left += 13;
    pdf.text(line, LEFT, left, { size: 9, color: SOFT });
  }
  for (const line of [
    ...pdf.wrap(formattedAddress(us), 230, 9),
    `Udyam ${us.udyamNumber}`,
    ...(us.gstin ? [`GSTIN ${us.gstin}`] : []),
    `${us.contactEmail} · +91 ${us.contactPhone}`
  ]) {
    right += 13;
    pdf.text(line, 320, right, { size: 9, color: SOFT });
  }
  y = Math.max(left, right) + 26;

  // ---- Summary ------------------------------------------------------------
  // The statement's own lines, added up by name, so the summary is the sum of
  // the orders below it and nothing else.
  const totals = new Map<string, number>();
  let unexplained = 0;
  let net = 0;
  // GST the customer paid on the food. Quick Bites collected it and keeps it to
  // pay; it is never in the kitchen's payout, but their accountant needs it.
  const gstOnFood = (o: OrderStatement) =>
    payee.ownerType === 'RESTAURANT'
      ? Math.round((Number((memoryStore.orders.get(o.orderId) as any)?.bill?.gstAmount) || 0) * 100)
      : 0;
  const gstTotal = orders.reduce((t, o) => t + gstOnFood(o), 0);
  for (const o of orders) {
    for (const l of o.lines) totals.set(l.label, (totals.get(l.label) || 0) + l.amountPaise);
    unexplained += o.unexplainedPaise;
    net += o.netPaise;
  }
  const adjustments = single ? 0 : statement.adjustments.reduce((t, a) => t + a.amountPaise, 0);
  net += adjustments;
  const paidInPeriod = single
    ? 0
    : statement.payouts
        .filter(p => p.state === 'PAID' && p.executedAt && p.executedAt >= statement.period.from && p.executedAt <= statement.period.to)
        .reduce((t, p) => t + p.amountPaise, 0);

  const rows: Array<[string, number, boolean?]> = [...totals.entries()].map(([label, paise]) => [label, paise]);
  if (unexplained) rows.push(['Not itemised (orders older than per-order rates)', unexplained]);
  if (adjustments) rows.push(['Other adjustments', adjustments]);

  const boxTop = y;
  const boxHeight = 44 + rows.length * 17 + 22 + (single ? 0 : 37);
  pdf.rect(LEFT, boxTop, RIGHT - LEFT, boxHeight, CREAM);
  y += 22;
  pdf.text('Summary', LEFT + 14, y, { size: 12, bold: true, color: MAROON });
  pdf.text(`${orders.length} order${orders.length === 1 ? '' : 's'}`, RIGHT - 14, y, { size: 10, color: SOFT, align: 'right' });
  y += 20;
  for (const [label, paise] of rows) {
    pdf.text(label, LEFT + 14, y, { size: 10, color: INK });
    pdf.text(money(paise), RIGHT - 14, y, { size: 10, color: paise < 0 ? SOFT : INK, align: 'right' });
    y += 17;
  }
  pdf.line(LEFT + 14, y - 8, RIGHT - 14, y - 8, [214, 196, 176]);
  y += 8;
  pdf.text(single ? 'You receive for this order' : 'You earned in this period', LEFT + 14, y, { size: 11, bold: true });
  pdf.text(money(net), RIGHT - 14, y, { size: 13, bold: true, color: MAROON, align: 'right' });
  if (!single) {
    y += 20;
    pdf.text('Paid to you in this period', LEFT + 14, y, { size: 10, color: SOFT });
    pdf.text(money(paidInPeriod), RIGHT - 14, y, { size: 10, color: GREEN, align: 'right' });
    y += 17;
    pdf.text(`Still to be paid to you, all orders, as of ${day(issuedAt)}`, LEFT + 14, y, { size: 10, color: SOFT });
    pdf.text(money(statement.summary.outstandingPaise), RIGHT - 14, y, { size: 10, bold: true, align: 'right' });
  }
  y = boxTop + boxHeight + 28;
  if (gstTotal > 0 && !single) {
    pdf.text(
      `For your records: ${money(gstTotal)} GST on the food was collected from customers by Quick Bites. It is not part of your earnings.`,
      LEFT,
      y - 12,
      { size: 8, color: MUTED }
    );
    y += 6;
  }

  // ---- Orders -------------------------------------------------------------
  if (!single) {
    ensure(40);
    pdf.text('Orders', LEFT, y, { size: 13, bold: true, color: MAROON });
    y += 10;
  }
  if (orders.length === 0) {
    y += 18;
    pdf.text('No orders were delivered in this period.', LEFT, y, { size: 10, color: SOFT });
  }

  for (const o of orders) {
    const order = memoryStore.orders.get(o.orderId) as Order | undefined;
    const items: any[] =
      payee.ownerType === 'RESTAURANT' && order
        ? ((shapeOrderForViewer(order, 'restaurant') as any).items || [])
        : [];
    const linesHeight = o.lines.reduce((t, l) => t + (l.detail ? 26 : 15), 0);
    ensure(70 + items.length * 14 + linesHeight);

    y += 18;
    pdf.rect(LEFT, y - 12, RIGHT - LEFT, 20, AMBER_BG);
    pdf.text(`#${o.orderNumber}`, LEFT + 8, y + 2, { size: 10.5, bold: true });
    pdf.text(dateTime((order as any)?.deliveredAt || o.occurredAt), LEFT + 110, y + 2, { size: 9, color: SOFT });
    const status = orderStatus(o);
    pdf.text(status.text, RIGHT - 8, y + 2, { size: 9, bold: true, color: status.color, align: 'right' });
    y += 22;

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const name = `${qty} x ${item.name}`;
      pdf.text(pdf.wrap(name, 330, 9.5)[0], LEFT + 8, y, { size: 9.5 });
      pdf.text(money(Math.round((Number(item.totalPrice) || 0) * 100)), RIGHT - 8, y, { size: 9.5, color: SOFT, align: 'right' });
      y += 14;
    }
    if (items.length) {
      pdf.line(LEFT + 8, y - 6, RIGHT - 8, y - 6);
      y += 6;
    }

    for (const l of o.lines) {
      pdf.text(l.label, LEFT + 8, y, { size: 9.5, color: INK });
      pdf.text(money(l.amountPaise), RIGHT - 8, y, { size: 9.5, color: l.amountPaise < 0 ? SOFT : INK, align: 'right' });
      if (l.detail) {
        y += 11;
        pdf.text(pdf.wrap(l.detail, 400, 7.5)[0], LEFT + 8, y, { size: 7.5, color: MUTED });
      }
      y += 15;
    }
    if (o.unexplainedPaise) {
      pdf.text('Not itemised', LEFT + 8, y, { size: 9.5, color: SOFT });
      pdf.text(money(o.unexplainedPaise), RIGHT - 8, y, { size: 9.5, color: SOFT, align: 'right' });
      y += 15;
    }
    pdf.text('You receive', LEFT + 8, y, { size: 10, bold: true });
    pdf.text(money(o.netPaise), RIGHT - 8, y, { size: 10.5, bold: true, color: MAROON, align: 'right' });
    const gst = gstOnFood(o);
    if (gst > 0) {
      y += 13;
      pdf.text(
        `For your records: GST on this food, ${money(gst)}, was collected from the customer by Quick Bites and is not part of your payout.`,
        LEFT + 8,
        y,
        { size: 7.5, color: MUTED }
      );
    }
    y += 8;
  }

  // ---- Adjustments and payouts (period only) ------------------------------
  if (!single && statement.adjustments.length) {
    ensure(50);
    y += 28;
    pdf.text('Other adjustments', LEFT, y, { size: 13, bold: true, color: MAROON });
    y += 6;
    for (const a of statement.adjustments) {
      ensure(30);
      y += 16;
      pdf.text(`${day(a.occurredAt)} · ${pdf.wrap(a.narration, 360, 9.5)[0]}`, LEFT, y, { size: 9.5 });
      pdf.text(money(a.amountPaise), RIGHT, y, { size: 9.5, align: 'right' });
    }
  }
  if (!single) {
    const paid = statement.payouts.filter(
      p => p.executedAt && p.executedAt >= statement.period.from && p.executedAt <= statement.period.to
    );
    if (paid.length) {
      ensure(50);
      y += 28;
      pdf.text('Payments to you in this period', LEFT, y, { size: 13, bold: true, color: MAROON });
      y += 6;
      for (const p of paid) {
        ensure(30);
        y += 16;
        const ref = p.reference ? ` · ref ${p.reference}` : '';
        pdf.text(`${day(p.executedAt!)} · ${p.rail.replace(/_/g, ' ').toLowerCase()}${ref} · ${p.state.toLowerCase()}`, LEFT, y, {
          size: 9.5
        });
        pdf.text(money(p.amountPaise), RIGHT, y, { size: 9.5, color: p.state === 'PAID' ? GREEN : SOFT, align: 'right' });
      }
    }
  }

  // ---- Footer on every page -----------------------------------------------
  const pages = pdf.pageCount;
  for (let i = 0; i < pages; i++) {
    pdf.onPage(i, () => {
      pdf.line(LEFT, 806, RIGHT, 806);
      pdf.text(
        'What you earned through Quick Bites, from our records. Not a GST tax invoice. Questions: ' + us.contactEmail,
        LEFT,
        820,
        { size: 7.5, color: MUTED }
      );
      pdf.text(`Page ${i + 1} of ${pages}`, RIGHT, 820, { size: 7.5, color: MUTED, align: 'right' });
    });
  }

  return pdf.toBuffer();
}

async function payeeFor(ownerType: PayeeOwnerType, ownerId: string, ownerName: string): Promise<InvoicePayee> {
  const restaurant = ownerType === 'RESTAURANT' ? await restaurantRepository.findById(ownerId) : null;
  return {
    name: ownerName,
    ownerType: ownerType === 'RESTAURANT' ? 'RESTAURANT' : 'RIDER',
    ...(restaurant
      ? {
          address: [restaurant.addressLine, restaurant.city, restaurant.pincode].filter(Boolean).join(', '),
          fssai: restaurant.fssaiLicenseNumber,
          gstin: restaurant.gstin
        }
      : {})
  };
}

/**
 * Builds and sends the PDF for one payee: a period (default the last 30 days),
 * or one order. Used by the partner's own download and by the admin's.
 *
 * A single order is looked up across ALL of the payee's history, and only in
 * their own ledger account — so an order id from someone else's kitchen is
 * simply not found.
 */
export async function sendStatementPdf(
  res: Response,
  ownerType: PayeeOwnerType,
  ownerId: string,
  ownerName: string,
  range: { from?: string; to?: string; orderId?: string }
): Promise<void> {
  const statement = statementFor(
    ownerType,
    ownerId,
    ownerName,
    range.orderId ? { from: new Date(0).toISOString() } : { from: range.from, to: range.to }
  );
  const order = range.orderId ? statement.orders.find(o => o.orderId === range.orderId) : undefined;
  if (range.orderId && !order) {
    throw new AppError('There are no earnings for that order on this account yet.', 404, 'NO_EARNINGS_FOR_ORDER');
  }

  const body = renderStatementPdf(statement, await payeeFor(ownerType, ownerId, ownerName), { orderId: range.orderId });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceFileName(statement, order?.orderNumber)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
}

/**
 * Every order in the period as its OWN invoice PDF, plus the period summary,
 * in one ZIP — so a restaurant can file each order separately for its accounts
 * and tax records. The same statement, the same renderer, so each file matches
 * the single-order download exactly.
 */
export async function sendInvoiceZip(
  res: Response,
  ownerType: PayeeOwnerType,
  ownerId: string,
  ownerName: string,
  range: { from?: string; to?: string }
): Promise<void> {
  const statement = statementFor(ownerType, ownerId, ownerName, range);
  const payee = await payeeFor(ownerType, ownerId, ownerName);
  const issuedAt = new Date().toISOString();
  const summaryName = invoiceFileName(statement).replace('QuickBites-earnings-', 'QuickBites-summary-');
  const archive = zip([
    { name: summaryName, data: renderStatementPdf(statement, payee, { issuedAt }) },
    ...statement.orders.map(o => ({
      name: invoiceFileName(statement, o.orderNumber),
      data: renderStatementPdf(statement, payee, { orderId: o.orderId, issuedAt })
    }))
  ]);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoiceFileName(statement).replace('QuickBites-earnings-', 'QuickBites-invoices-').replace(/\.pdf$/, '.zip')}"`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(archive);
}
