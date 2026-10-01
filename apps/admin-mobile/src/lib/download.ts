/**
 * Saving a document to the phone (owner, 1 Oct 2026).
 *
 * Administrators verify KYC documents, refund photos and profile pictures, and
 * could only look at them on screen. "Download" now saves the file into a
 * folder the administrator chooses ONCE (usually Downloads) through Android's
 * own folder picker, so it can be zoomed, forwarded or kept as evidence.
 *
 * The files are mostly data URIs (base64 inside the record); a link is fetched
 * first. The name says what the file is and whose, e.g.
 * `Bangalore-Biryani-House_FSSAI_2026-10-01.jpg`.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { documentFileName } from './fileName';

export { documentFileName };

const FOLDER_KEY = 'download-folder-uri';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

async function asBase64(source: string): Promise<{ base64: string; mime: string }> {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(source);
  if (match) {
    const mime = match[1].toLowerCase();
    const body = match[3];
    return { base64: match[2] ? body : globalThis.btoa(decodeURIComponent(body)), mime };
  }
  if (/^https?:\/\//i.test(source)) {
    const target = `${FileSystem.cacheDirectory}download-${Date.now()}`;
    const result = await FileSystem.downloadAsync(source, target);
    const mime = (result.headers?.['Content-Type'] || result.headers?.['content-type'] || 'image/jpeg').split(';')[0].toLowerCase();
    const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    return { base64, mime };
  }
  throw new Error('This document is not stored in a form that can be saved.');
}

async function folderUri(forceAsk = false): Promise<string> {
  const SAF = FileSystem.StorageAccessFramework;
  if (!forceAsk) {
    const saved = await AsyncStorage.getItem(FOLDER_KEY).catch(() => null);
    if (saved) return saved;
  }
  const initial = SAF.getUriForDirectoryInRoot('Download');
  const permission = await SAF.requestDirectoryPermissionsAsync(initial);
  if (!permission.granted) throw new Error('No folder was chosen, so nothing was saved.');
  await AsyncStorage.setItem(FOLDER_KEY, permission.directoryUri).catch(() => undefined);
  return permission.directoryUri;
}

/**
 * Saves `source` (a data URI or a link) as `name`. Returns where it went, in
 * words. Throws an Error with a readable message.
 */
export async function saveDocument(source: string, name: string): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('Saving files is available on Android.');
  const { base64, mime } = await asBase64(source);
  const SAF = FileSystem.StorageAccessFramework;
  let dir = await folderUri();
  let fileUri: string;
  try {
    fileUri = await SAF.createFileAsync(dir, name, mime);
  } catch {
    // The saved folder was removed, or its permission revoked: ask again once.
    dir = await folderUri(true);
    fileUri = await SAF.createFileAsync(dir, name, mime);
  }
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return `${name}.${EXT[mime] || 'file'}`;
}
