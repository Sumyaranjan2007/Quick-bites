/**
 * The FULL invoice of one order, for Quick Bites staff only (owner, 19 Oct 2026):
 * what the customer paid, line by line, and how that money was divided between
 * the kitchen, the rider, the government and Quick Bites.
 *
 * It computes no money of its own: every share comes from `splitForOrder` and
 * `contributionPaise`, the functions the ledger and the margin reports use, so
 * the invoice cannot disagree with the books. The parts are printed with their
 * sum, and the sum must equal what the customer paid.
 *
 * Partners never get this file: they download a receipt of their own share
 * (statementPdf.ts, "receipt").
 */
import type { Response } from 'express';
import type { Order } from '@quick-bites/shared-types';
import { AppError } from '../../utils/AppError.ts';
import { SimplePdf, type Rgb } from '../../utils/simplePdf.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { businessIdentity } from '../platform/businessIdentity.ts';
import { splitForOrder } from './earnings.ts';
import { contributionPaise } from './orderMargin.ts';
import { toPaise } from './money.ts';
import { calculateTripPayout } from '../riders/tripPayout.ts';

const MAROON: Rgb = [100, 28, 50];
const MUTED: Rgb = [120, 108, 98];
const GREEN: Rgb = [30, 122, 76];
const LEFT = 42;
const RIGHT = 553;

const money = (paise: number) => {
  const sign = paise < 0 ? '-' : '';
  return `${sign}Rs ${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : '-';
const PAY: Record<string, string> = { CASH_ON_DELIVERY: 'Cash on delivery', RAZORPAY_SANDBOX: 'Online (Razorpay)', WALLET: 'Wallet', SPLIT: 'Split' };

/** The money lines, in paise, from the bill and the shared split. Exported for the check. */
export function orderInvoiceLines(order: Order) {
  const bill: any = order.bill || {};
  const p = (v: unknown) => toPaise(Number(v) || 0);
  const s = splitForOrder(order);
  const paid = [
    ['Food (customer prices)', p(bill.itemsTotal)],
    ['GST on food (5%)', p(bill.gstAmount)],
    ['Packaging', p(bill.packagingFee)],
    ['Delivery fee', p(bill.deliveryFee)],
    ['Platform fee', p(bill.platformFee)],
    ...(Number(bill.extraCharge) ? [[bill.extraChargeLabel || 'Other charge', p(bill.extraCharge)]] : []),
    ...(Number(bill.couponDiscount) ? [[`Coupon${order.couponCode ? ` ${order.couponCode}` : ''}`, -p(bill.couponDiscount)]] : []),
    ...(Number(bill.tipAmount) ? [['Tip for the rider', p(bill.tipAmount)]] : [])
  ] as Array<[string, number]>;
  // The same trip pay `contributionPaise` uses: recorded at delivery, expected before.
  const recorded = Number.isFinite(Number(order.riderPayout));
  const tripPay = recorded
    ? s.riderPaise - s.tipPaise
    : toPaise(calculateTripPayout({ distanceKm: order.distanceKm, bill: order.bill as any }));
  const quickBites = contributionPaise(order);
  const pickupPaise = recorded ? toPaise(Number(order.riderPickupPay) || 0) : 0;
  const divided = [
    ['Kitchen (after commission and tax withheld)', s.partnerPaise],
    [recorded ? 'Rider trip pay' : 'Rider trip pay (expected; fixed at delivery)', tripPay - pickupPaise],
    // Pickup pay on its own line, so its cost to Quick Bites is visible (Tester R3-15).
    ...(pickupPaise ? [[`Rider pickup pay (${Number(order.riderPickupKm).toFixed(2)} km to the kitchen, paid by Quick Bites)`, pickupPaise]] : []),
    ...(s.tipPaise ? [['Rider tip (100% to the rider)', s.tipPaise]] : []),
    ['GST on food (Quick Bites pays it to the government)', s.gstOnFoodPaise],
    ['GST on commission', s.commissionGstPaise],
    ...(s.tdsPaise ? [['TDS withheld from the kitchen', s.tdsPaise]] : []),
    ...(s.tcsPaise ? [['TCS', s.tcsPaise]] : []),
    ['Quick Bites keeps', quickBites]
  ] as Array<[string, number]>;
  return {
    paid,
    totalPaid: s.grossPaise,
    divided,
    dividedSum: divided.reduce((t, [, v]) => t + v, 0),
    detail: {
      commission: s.commissionPaise,
      commissionPercent: Number(bill.commissionPercent) || undefined,
      kitchenFood: Number.isFinite(Number(bill.partnerItemsTotal)) ? p(bill.partnerItemsTotal) : p(bill.itemsTotal),
      foodMarkup: s.foodMarkupPaise
    }
  };
}

export function renderOrderInvoicePdf(order: Order): Buffer {
  const pdf = new SimplePdf();
  const us = businessIdentity();
  const lines = orderInvoiceLines(order);
  let y = 0;

  pdf.rect(0, 0, pdf.width, 90, MAROON);
  pdf.text(us.tradingName || 'Quick Bites', LEFT, 40, { size: 22, bold: true, color: [255, 255, 255] });
  pdf.text('Full order invoice - internal, for Quick Bites staff', LEFT, 62, { size: 10, color: [255, 228, 200] });
  pdf.text(order.orderNumber, RIGHT, 40, { size: 12, bold: true, color: [255, 255, 255], align: 'right' });
  pdf.text(String(order.status).replace(/_/g, ' '), RIGHT, 58, { size: 9, color: [255, 228, 200], align: 'right' });

  y = 118;
  const row = (label: string, value: string, opts: { bold?: boolean; color?: Rgb; size?: number } = {}) => {
    pdf.text(label, LEFT, y, { size: opts.size || 10, bold: opts.bold, color: opts.color });
    pdf.text(value, RIGHT, y, { size: opts.size || 10, bold: opts.bold, color: opts.color, align: 'right' });
    y += (opts.size || 10) + 6;
  };
  const heading = (text: string) => {
    y += 8;
    pdf.text(text, LEFT, y, { size: 8, bold: true, color: MUTED });
    y += 6;
    pdf.line(LEFT, y, RIGHT, y);
    y += 14;
  };

  heading('ORDER');
  row('Kitchen', order.restaurantName || order.restaurantId);
  row('Customer', String(order.customerName || 'Customer').split(/\s+/)[0]);
  row('Rider', order.riderName || 'Not assigned');
  row('Placed', when(order.createdAt));
  if (order.deliveredAt) row('Delivered', when(order.deliveredAt));
  row('Payment', `${PAY[order.paymentMethod as string] || order.paymentMethod} - ${order.paymentStatus}`);
  if (order.distanceKm) row('Road distance', `${Number(order.distanceKm).toFixed(1)} km`);

  heading('DISHES (CUSTOMER PRICES)');
  for (const item of order.items || []) {
    const options = (item.selectedOptions || []).map((o: any) => o.optionName).filter(Boolean).join(', ');
    row(`${item.quantity} x ${item.name}${options ? ` (${options})` : ''}`, money(toPaise(Number(item.totalPrice) || 0)));
  }

  heading('WHAT THE CUSTOMER PAID');
  for (const [label, value] of lines.paid) row(label, money(value));
  row('Total paid', money(lines.totalPaid), { bold: true, size: 11 });

  heading('HOW THE MONEY WAS DIVIDED');
  for (const [label, value] of lines.divided) {
    // A loss is not good news: printed in maroon, not green (R3-15).
    row(label, money(value), label === 'Quick Bites keeps' ? { bold: true, color: value < 0 ? MAROON : GREEN } : {});
  }
  row('Total', money(lines.dividedSum), { bold: true, size: 11 });
  y += 4;
  const d = lines.detail;
  for (const note of [
    `Kitchen's food price ${money(d.kitchenFood)}; commission ${money(d.commission)}${d.commissionPercent ? ` (${d.commissionPercent}%)` : ''}.`,
    ...(d.foodMarkup ? [`Food markup kept by Quick Bites (inside "Quick Bites keeps"): ${money(d.foodMarkup)}.`] : []),
    'Figures come from the same split the books use; the parts add up to what the customer paid.'
  ]) {
    for (const line of pdf.wrap(note, RIGHT - LEFT, 8)) {
      pdf.text(line, LEFT, y, { size: 8, color: MUTED });
      y += 11;
    }
  }
  return pdf.toBuffer();
}

/** GET /api/admin/orders/:id/invoice.pdf */
export async function sendOrderInvoicePdf(res: Response, orderId: string): Promise<void> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="QuickBites-full-invoice-${order.orderNumber}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderOrderInvoicePdf(order));
}
