/**
 * Saves an invoice PDF from the Partner website (/partner): the browser's own
 * download. The phone build uses invoice.ts.
 */
import { invoiceRequest } from './partnerApi';

export async function downloadInvoice(range: { from?: string; to?: string; orderId?: string }): Promise<string> {
  const { url, headers } = invoiceRequest(range);
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
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'QuickBites-invoice.pdf';
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return `${name} is in your Downloads folder.`;
}
