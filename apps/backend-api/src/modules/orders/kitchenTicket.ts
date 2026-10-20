/**
 * The kitchen ticket (master plan B10, #2): what to cook, how many, for which
 * order, printed on the kitchen's receipt roll after Accept.
 *
 * NO MONEY ON IT, and nothing private: no price or total, no payment method, no
 * phone, address or delivery code (spec `design/screens/partner-kitchen-ticket.md`).
 * The ticket lies on a counter riders and staff walk past.
 *
 * ONE LAYOUT, TWO OUTPUTS (owner, 21 Oct 2026, round 5 C): the lines below are drawn as a PDF (the phone app, through
 * Android's print screen) and as HTML (the Partner website). Both pages are exactly as long as the ticket, because a
 * receipt printer stops and cuts at the end of the page; the website used to print the PDF through the browser's PDF
 * viewer, which shrank it to the printer's default page and fed paper to that page's end. Sizes like a POS bill:
 * big, bold, monospace on the website.
 *
 * seniordev: text-only header (no logo image) and no QR code. The order number
 * is printed big instead; add the QR when a kitchen actually scans tickets.
 */
import type { Order } from '@quick-bites/shared-types';
import { SimplePdf } from '../../utils/simplePdf.ts';

export type TicketWidth = 80 | 58;

const PT_PER_MM = 72 / 25.4;
const SIZES = {
  80: { sideMm: 3, topMm: 3, bottomMm: 8, small: 11, body: 12, item: 14, head: 15, number: 26, code: 22 },
  58: { sideMm: 2, topMm: 2, bottomMm: 6, small: 9, body: 10, item: 12, head: 12, number: 20, code: 18 }
} as const;

type Line = { text: string; size: number; bold?: boolean; center?: boolean; indent?: boolean } | { rule: true };

const time = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('en-IN', { ...opts, timeZone: 'Asia/Kolkata' });

/** The ticket's lines, before wrapping: the same for the PDF and the HTML. */
function ticketLines(order: Order, w: TicketWidth): Line[] {
  const s = SIZES[w];
  const items = order.items || [];
  const placed = order.createdAt || new Date().toISOString();
  const lines: Line[] = [
    { text: 'QUICK BITES', size: s.small, bold: true, center: true },
    { text: String(order.restaurantName || '').toUpperCase(), size: s.head, bold: true, center: true },
    { rule: true },
    { text: order.orderNumber, size: s.number, bold: true, center: true }
  ];
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') lines.push({ text: 'CANCELLED', size: s.number - 6, bold: true, center: true });
  lines.push(
    { text: 'DELIVERY', size: s.item, bold: true, center: true },
    { text: `Placed ${time(placed, { hour: 'numeric', minute: '2-digit' })} · ${time(placed, { day: 'numeric', month: 'short', year: 'numeric' })}`, size: s.body, center: true },
    { rule: true },
    { text: `Customer: ${String(order.customerName || '').trim().split(/\s+/)[0] || 'Customer'}`, size: s.body, bold: true },
    { rule: true }
  );
  for (const item of items) {
    lines.push({ text: `${item.quantity} x ${item.name}`, size: s.item, bold: true });
    // Names were frozen on the order at checkout (dishOptions.ts), so a later menu edit cannot change the ticket.
    for (const option of (item.selectedOptions || []) as Array<{ optionName?: string }>) {
      if (option.optionName) lines.push({ text: `+ ${option.optionName}`, size: s.body, indent: true });
    }
  }
  lines.push({ rule: true }, { text: `Items: ${items.reduce((n, i) => n + (Number(i.quantity) || 0), 0)}`, size: s.item, bold: true });
  if (order.pickupCode) {
    lines.push({ rule: true }, { text: 'PICKUP CODE', size: s.small, bold: true, center: true }, { text: order.pickupCode.split('').join(' '), size: s.code, bold: true, center: true });
  }
  lines.push({ rule: true }, { text: 'Kitchen ticket · Not a bill · No prices', size: s.small, center: true });
  return lines;
}

const lineHeight = (size: number) => size * 1.3;
const RULE_PT = 9;

/** The PDF (phone app): Helvetica, wrapped to the roll, on a page exactly as tall as the ticket. */
export function renderKitchenTicket(order: Order, widthMm: TicketWidth = 80): Buffer {
  const s = SIZES[widthMm];
  const width = widthMm * PT_PER_MM;
  const side = s.sideMm * PT_PER_MM;
  const measure = new SimplePdf(width); // for text widths only
  const indentPt = measure.textWidth('00 x ', s.item, true);
  type Row = { text: string; size: number; bold?: boolean; center?: boolean; x: number } | { rule: true };
  const rows: Row[] = [];
  for (const l of ticketLines(order, widthMm)) {
    if ('rule' in l) {
      rows.push(l);
      continue;
    }
    const x = l.indent ? side + indentPt : side;
    for (const text of measure.wrap(l.text, width - side - x, l.size, l.bold)) rows.push({ ...l, text, x });
  }
  const top = s.topMm * PT_PER_MM;
  const height = rows.reduce((h, r) => h + ('rule' in r ? RULE_PT : lineHeight(r.size)), top + s.bottomMm * PT_PER_MM);
  const pdf = new SimplePdf(width, height);
  let y = top;
  for (const r of rows) {
    if ('rule' in r) {
      pdf.line(side, y + RULE_PT / 2, width - side, y + RULE_PT / 2, [0, 0, 0], 1);
      y += RULE_PT;
      continue;
    }
    pdf.text(r.text, r.center ? width / 2 : r.x, y + r.size, { size: r.size, bold: r.bold, color: [0, 0, 0], align: r.center ? 'center' : 'left' });
    y += lineHeight(r.size);
  }
  return pdf.toBuffer();
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Word-wraps for a monospace font: `columns` characters a line (a long word is cut). */
export function wrapMono(text: string, columns: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let piece = word; piece.length; piece = piece.slice(columns)) {
      const part = piece.slice(0, columns);
      if (!line) line = part;
      else if (line.length + 1 + part.length <= columns) line += ` ${part}`;
      else {
        out.push(line);
        line = part;
      }
      if (piece.length <= columns) break;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * The HTML (Partner website): bold monospace like a POS bill, wrapped here so the height is known, on a page of exactly
 * that size (`@page`), printed from the page so the receipt printer stops and cuts right after it.
 */
export function renderKitchenTicketHtml(order: Order, widthMm: TicketWidth = 80): string {
  const s = SIZES[widthMm];
  const innerPt = (widthMm - 2 * s.sideMm) * PT_PER_MM;
  const columns = (size: number) => Math.max(8, Math.floor(innerPt / (size * 0.6))); // Courier: 0.6 em a character
  let heightPt = 0;
  const html: string[] = [];
  for (const l of ticketLines(order, widthMm)) {
    if ('rule' in l) {
      html.push('<hr>');
      heightPt += RULE_PT;
      continue;
    }
    const indent = l.indent ? 5 : 0;
    for (const text of wrapMono(l.text, columns(l.size) - indent)) {
      const style = `font-size:${l.size}pt;line-height:${lineHeight(l.size)}pt;${l.bold ? 'font-weight:700;' : ''}${l.center ? 'text-align:center;' : ''}${indent ? `padding-left:${indent}ch;` : ''}`;
      html.push(`<div style="${style}">${escapeHtml(text) || '&nbsp;'}</div>`);
      heightPt += lineHeight(l.size);
    }
  }
  const heightMm = Math.ceil(s.topMm + s.bottomMm + heightPt / PT_PER_MM);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${escapeHtml(order.orderNumber)}</title><style>
@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${widthMm}mm; padding: ${s.topMm}mm ${s.sideMm}mm ${s.bottomMm}mm; box-sizing: border-box; color: #000;
  font-family: 'Courier New', Courier, monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
div { white-space: pre; overflow: hidden; }
hr { border: 0; border-top: 1.5px dashed #000; height: 0; margin: ${RULE_PT / 2 - 0.75}pt 0; }
</style></head><body>${html.join('')}</body></html>`;
}
