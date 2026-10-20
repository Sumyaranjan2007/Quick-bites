/**
 * Saves an invoice PDF from the Partner website (/partner): the browser's own
 * download. The phone build uses invoice.ts.
 */
import { invoiceRequest, kitchenTicketRequest } from './partnerApi';

/**
 * The kitchen ticket prints from this page (round 5 C): the server's HTML ticket, its page exactly the ticket's size,
 * in a hidden frame and the browser's Print. The PDF in a new tab went through the PDF viewer, which shrank the ticket
 * to the printer's default page and fed the whole page out of a receipt printer.
 */
export async function openKitchenTicket(orderId: string, width: 80 | 58): Promise<string> {
  const { url, headers } = kitchenTicketRequest(orderId, width, 'html');
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => null) : null;
    throw new Error(body?.error?.message || 'Could not reach Quick Bites. Check your connection and try again.');
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000); // print() returns at once in some browsers; the dialog still needs the frame
  };
  frame.srcdoc = await res.text();
  document.body.appendChild(frame);
  return 'Choose the kitchen printer in the print window. First time: set Margins to None and Scale to 100.';
}

export async function downloadInvoice(
  range: { from?: string; to?: string; orderId?: string },
  each = false
): Promise<string> {
  const { url, headers } = invoiceRequest(range, each);
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error('Could not reach Quick Bites. Check your connection and try again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || 'The invoice could not be made. Try again in a moment.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || (each ? 'QuickBites-invoices.zip' : 'QuickBites-invoice.pdf');
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return `${name} is in your Downloads folder.`;
}
