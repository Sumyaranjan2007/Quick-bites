/**
 * Saving a document to the phone (owner, 1 Oct 2026).
 *
 * Administrators verify KYC documents, refund photos and profile pictures, and
 * could only look at them on screen. "Download" now saves a photo straight to
 * the phone's gallery, in a "Quick Bites" album, so it can be zoomed, forwarded
 * or kept as evidence. One tap, nothing to choose.
 *
 * It first saved through Android's folder picker, offering Downloads — which
 * Android refuses ("Can't use this folder"), leaving the administrator to make
 * a sub-folder by hand before anything saved (QA v12). Anything that is not a
 * photo still goes through the picker, the only way to save other files.
 *
 * The files are mostly data URIs (base64 inside the record); a link is fetched
 * first. The name says what the file is and whose, e.g.
 * `Bangalore-Biryani-House_FSSAI_2026-10-01.jpg`.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
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
    let result: FileSystem.FileSystemDownloadResult;
    try {
      result = await FileSystem.downloadAsync(source, target);
    } catch {
      throw new Error('The file could not be fetched. Check the internet connection and try again.');
    }
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
      throw new Error(`The file is no longer where it was stored (error ${result.status}). Ask the sender for it again.`);
    }
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
 * Saves `source` (a data URI or a link) as `name`. Returns a sentence saying
 * where it went. Throws an Error with a readable message.
 */
export async function saveDocument(source: string, name: string): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('Saving files is available on Android.');
  const { base64, mime } = await asBase64(source);
  if (mime.startsWith('image/')) return saveToGallery(base64, mime, name);
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
  return `${name}.${EXT[mime] || 'file'} is in the folder you chose.`;
}

const ALBUM = 'Quick Bites';

async function saveToGallery(base64: string, mime: string, name: string): Promise<string> {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) {
    throw new Error('Allow Quick Bites Operations to save photos, then tap Download again.');
  }
  const file = `${FileSystem.cacheDirectory}${name}.${EXT[mime] || 'jpg'}`;
  await FileSystem.writeAsStringAsync(file, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const asset = await MediaLibrary.createAssetAsync(file);
    const album = await MediaLibrary.getAlbumAsync(ALBUM).catch(() => null);
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false).catch(() => undefined);
    else await MediaLibrary.createAlbumAsync(ALBUM, asset, false).catch(() => undefined);
  } finally {
    await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
  }
  return `${name}.${EXT[mime] || 'jpg'} is in your gallery, in the ${ALBUM} album.`;
}
