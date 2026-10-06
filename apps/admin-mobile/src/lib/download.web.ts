/**
 * Saving a document from the Admin web console (/admin): the browser's own
 * download. The phone build (download.ts) writes through Android's storage
 * framework, which does not exist in a browser.
 */
import { documentFileName } from './fileName';

export { documentFileName };

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/zip': 'zip'
};

export async function saveDocument(source: string, name: string, headers?: Record<string, string>): Promise<string> {
  let blob: Blob;
  try {
    const res = await fetch(source, headers ? { headers } : undefined);
    if (!res.ok) throw new Error(String(res.status));
    blob = await res.blob();
  } catch {
    throw new Error('The file could not be fetched. Check the internet connection and try again.');
  }
  const file = `${name}.${EXT[blob.type.split(';')[0].toLowerCase()] || 'file'}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${file} is in your Downloads folder.`;
}
