/**
 * Saves an invoice PDF on the phone: downloaded with the partner's sign-in,
 * then written into a folder they choose once (Android's file picker; the
 * choice is remembered). The web build uses invoice.web.ts instead.
 */
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { invoiceRequest } from './partnerApi';

const FOLDER_KEY = 'invoice-folder-uri';

async function folder(forceAsk = false): Promise<string> {
  const SAF = FileSystem.StorageAccessFramework;
  if (!forceAsk) {
    const saved = await AsyncStorage.getItem(FOLDER_KEY).catch(() => null);
    if (saved) return saved;
  }
  const permission = await SAF.requestDirectoryPermissionsAsync(SAF.getUriForDirectoryInRoot('Download'));
  if (!permission.granted) throw new Error('No folder was chosen, so the invoice was not saved.');
  await AsyncStorage.setItem(FOLDER_KEY, permission.directoryUri).catch(() => undefined);
  return permission.directoryUri;
}

export async function downloadInvoice(range: { from?: string; to?: string; orderId?: string }): Promise<string> {
  const { url, headers } = invoiceRequest(range);
  const temp = `${FileSystem.cacheDirectory}invoice-${Date.now()}.pdf`;
  let result: FileSystem.FileSystemDownloadResult;
  try {
    result = await FileSystem.downloadAsync(url, temp, { headers });
  } catch {
    throw new Error('Could not reach Quick Bites. Check your connection and try again.');
  }
  if (result.status !== 200) {
    // The server explains itself in JSON, e.g. "no earnings for that order yet".
    const body = await FileSystem.readAsStringAsync(result.uri).catch(() => '');
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    let message = 'The invoice could not be made. Try again in a moment.';
    try {
      message = JSON.parse(body)?.error?.message || message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }

  const disposition = result.headers?.['Content-Disposition'] || result.headers?.['content-disposition'] || '';
  const name = (/filename="([^"]+)\.pdf"/.exec(disposition)?.[1] || 'QuickBites-invoice').replace(/[^\w.-]/g, '_');
  const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
  await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);

  const SAF = FileSystem.StorageAccessFramework;
  let dir = await folder();
  let file: string;
  try {
    file = await SAF.createFileAsync(dir, name, 'application/pdf');
  } catch {
    // The remembered folder was removed or its permission revoked: ask again.
    dir = await folder(true);
    file = await SAF.createFileAsync(dir, name, 'application/pdf');
  }
  await FileSystem.writeAsStringAsync(file, base64, { encoding: FileSystem.EncodingType.Base64 });
  return `${name}.pdf is in the folder you chose.`;
}
