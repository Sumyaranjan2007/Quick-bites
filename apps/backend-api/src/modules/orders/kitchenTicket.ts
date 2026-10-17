/**
 * The kitchen ticket (master plan B10, #2): what to cook, how many, for which
 * order, printed on the kitchen's receipt roll after Accept.
 *
 * NO MONEY ON IT, and nothing private: no price or total, no payment method, no
 * phone, address or delivery code (spec `design/screens/partner-kitchen-ticket.md`).
 * The ticket lies on a counter riders and staff walk past.
 *
 * One page as long as the order: the lines are laid out first, then drawn on a
 * page exactly that tall, because a receipt printer cuts at the end of a page.
 *
 * seniordev: text-only header (no logo image) and no QR code. The order number
 * is printed big instead; add the QR when a kitchen actually scans tickets.
 */
import type { Order } from '@quick-bites/shared-types';
import { SimplePdf } from '../../utils/simplePdf.ts';

export type TicketWidth = 80 | 58;

const PT_PER_MM = 72 / 25.4;
const SIZES = {
  80: { marginMm: 4, body: 10, item: 12, number: 26, title: 12 },
  58: { marginMm: 3, body: 9, item: 11, number: 22, title: 11 }
} as const;

type Row =
  | { text: string; size: number; bold?: boolean; align?: 'left' | 'center'; indent?: number }
  | { rule: true };

const time = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });

export function renderKitchenTicket(order: Order, widthMm: TicketWidth = 80): Buffer {
  const s = SIZES[widthMm];
  const width = widthMm * PT_PER_MM;
  const margin = s.marginMm * PT_PER_MM;
  const inner = width - 2 * margin;
  const measure = new SimplePdf(width); // for text widths only
  const rows: Row[] = [];
  const add = (text: string, size: number, opts: { bold?: boolean; align?: 'left' | 'center'; indent?: number } = {}) => {
    for (const line of measure.wrap(text, inner - (opts.indent || 0), size, opts.bold)) rows.push({ text: line, size, ...opts });
  };
  const rule = () => rows.push({ rule: true });
  const items = order.items || [];
  const placed = order.createdAt || new Date().toISOString();

  add('QUICK BITES', s.body, { bold: true, align: 'center' });
  add(String(order.restaurantName || '').toUpperCase(), s.title, { bold: true, align: 'center' });
  rule();
  add(order.orderNumber, s.number, { bold: true, align: 'center' });
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') add('CANCELLED', s.number - 4, { bold: true, align: 'center' });
  add(`Delivery · Placed ${time(placed, { hour: 'numeric', minute: '2-digit' })}`, s.body, { align: 'center' });
  add(time(placed, { day: 'numeric', month: 'short', year: 'numeric' }), s.body, { align: 'center' });
  rule();
  add(`Customer: ${String(order.customerName || '').trim().split(/\s+/)[0] || 'Customer'}`, s.body);
  rule();
  const indent = measure.textWidth('00 x  ', s.item, true);
  for (const item of items) {
    add(`${item.quantity} x ${item.name}`, s.item, { bold: true });
    // Names were frozen on the order at checkout (dishOptions.ts), so a later menu edit cannot change the ticket.
    for (const option of (item.selectedOptions || []) as Array<{ optionName?: string }>) {
      if (option.optionName) add(`• ${option.optionName}`, s.body, { indent });
    }
  }
  rule();
  add(`Items: ${items.reduce((n, i) => n + (Number(i.quantity) || 0), 0)}`, s.body, { bold: true });
  if (order.pickupCode) {
    rule();
    add(`Pickup code ${order.pickupCode.split('').join(' ')}`, s.item + 4, { bold: true, align: 'center' });
  }
  add('Not a bill · No prices on this ticket', 8, { align: 'center' });

  // Lay out, then draw on a page exactly as tall as the ticket.
  const heightOf = (r: Row) => ('rule' in r ? 8 : r.size * 1.35);
  const height = rows.reduce((h, r) => h + heightOf(r), 2 * margin);
  const pdf = new SimplePdf(width, height);
  let y = margin;
  for (const r of rows) {
    if ('rule' in r) pdf.line(margin, y + 4, width - margin, y + 4, [0, 0, 0], 0.75);
    else if (r.align === 'center') pdf.text(r.text, width / 2, y + r.size, { size: r.size, bold: r.bold, color: [0, 0, 0], align: 'center' });
    else pdf.text(r.text, margin + (r.indent || 0), y + r.size, { size: r.size, bold: r.bold, color: [0, 0, 0] });
    y += heightOf(r);
  }
  return pdf.toBuffer();
}
