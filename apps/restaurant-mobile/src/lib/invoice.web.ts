/**
 * Saves an invoice PDF from the Partner website (/partner): the browser's own
 * download. The phone build uses invoice.ts.
 */
import { invoiceRequest, kitchenTicketRequest } from './partnerApi';

/** The kitchen ticket opens in a new tab, where the browser's Print sends it to the kitchen printer. */
export async function openKitchenTicket(orderId: string, width: 80 | 58): Promise<string> {
  const { url, headers } = kitchenTicketRequest(orderId, width);
  const tab = window.open('', '_blank'); // opened now, inside the tap, so pop-up blockers allow it
  const res = await fetch(url, { headers }).catch(() => null);
  if (!res || !res.ok) {
    tab?.close();
    const body = res ? await res.json().catch(() => null) : null;
    throw new Error(body?.error?.message || 'Could not reach Quick Bites. Check your connection and try again.');
  }
  const href = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = href;
  else window.location.assign(href);
  return 'The ticket is open in a new tab: press Print there.';
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
