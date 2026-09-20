/**
 * Taking a photo and getting it to the server small enough to arrive.
 *
 * Two kinds of photo, with different requirements. A DISH is displayed large
 * and needs to look appetising. A DOCUMENT needs to be READ — a reviewer has
 * to make out a fourteen-digit licence number and an expiry date — so it is
 * resized wider and compressed less, and is never cropped to a fixed aspect,
 * because a licence that has had its corners trimmed to fit a 4:3 frame is a
 * licence that gets rejected.
 *
 * The same shape as the customer app's avatar helper, with one difference that
 * matters: a dish photo is displayed large — across a menu row and on the
 * restaurant card on someone's home screen — so it is resized to a wider edge
 * than an avatar, which is never shown above 64px.
 *
 * The server accepts a 1 MB body, and base64 adds about a third. Every image is
 * therefore resized and re-encoded here BEFORE it becomes a data URI, so an
 * oversized photo fails locally with something the partner can act on rather
 * than being cut off mid-request and arriving as a validation error about a
 * field they did not think they were filling in.
 *
 * Re-encoded on the device rather than uploaded raw and processed server side
 * because a kitchen's phone is usually on mobile data: a 4 MB camera photo is
 * worth avoiding sending at all, not worth sending and then shrinking.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export type PhotoSource = 'camera' | 'library';
export type PhotoKind = 'dish' | 'document';

/**
 * Longest edge after resizing.
 *
 * 720px covers a full-width card on a phone without being a photograph anybody
 * would print, and lands inside the 200,000-character ceiling below with room
 * to spare on a busy image. Larger buys nothing a customer can see and costs
 * every one of them the download.
 */
const MAX_WIDTH = 720;
const QUALITY = 0.55;
/**
 * The server's own ceiling for this field, matched exactly.
 *
 * Both the partner menu-request route and the admin catalogue routes cap
 * `imageUrl` at 200,000 characters. Sending more would be rejected there, and a
 * rejection after a photo has been taken and uploaded is a worse experience
 * than a resize that quietly fits.
 */
const MAX_DATA_URI_CHARS = 200_000;

async function ensurePermission(source: PhotoSource, kind: PhotoKind = 'dish'): Promise<boolean> {
  const result =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (result.granted) return true;

  // Named, because "allow photo access" with no reason attached is what people
  // refuse. A partner who is halfway through verification needs to be told the
  // refusal is what is stopping their documents going in.
  const subject = kind === 'document' ? 'your documents' : 'a dish';
  Alert.alert(
    source === 'camera' ? 'Camera access is off' : 'Photo access is off',
    source === 'camera'
      ? `Turn on camera access in Settings to photograph ${subject}.`
      : `Turn on photo access in Settings to choose a picture of ${subject}.`
  );
  return false;
}

/**
 * Returns a data URI for the chosen photo, or null if the partner backed out.
 *
 * Null for a cancellation and a thrown error for a genuine failure, so a caller
 * can tell "changed their mind" from "that did not work" — they need different
 * words on screen.
 */
export async function pickDishPhoto(source: PhotoSource): Promise<string | null> {
  if (!(await ensurePermission(source, 'dish'))) return null;

  const picker =
    source === 'camera'
      ? ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          // 4:3 rather than square: food is photographed on plates, and a
          // square crop cuts the edge off most of them.
          allowsEditing: true,
          aspect: [4, 3],
          quality: 1
        })
      : ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 1
        });

  const result = await picker;
  if (result.canceled || !result.assets?.length) return null;

  const manipulated = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    throw new Error('That photo could not be read. Try another one.');
  }

  const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
  if (dataUri.length > MAX_DATA_URI_CHARS) {
    // Reached by a photo that is mostly detail rather than mostly size — a
    // busy thali resists JPEG compression. Said plainly rather than letting the
    // request fail at the server with a message about a body limit.
    throw new Error('That photo is too detailed to upload. Try a simpler shot or a plainer background.');
  }

  return dataUri;
}

/**
 * A document, photographed to be read rather than admired.
 *
 * 1280px and a lighter compression than a dish: the reviewer is looking for
 * small printed characters, and the artefacts that are invisible on a plate of
 * biryani are exactly what turns a 6 into an 8 on a licence. Matched to the
 * delivery app's document helper, which reviewers already work from.
 *
 * The ceiling is the upload route's own, so an oversized photo fails here —
 * on the device, with something the partner can do about it — rather than
 * being cut off by the server's 1 MB body limit and coming back as a
 * validation error about a field they did not think they were filling in.
 */
const DOCUMENT_MAX_WIDTH = 1280;
const DOCUMENT_QUALITY = 0.6;
const DOCUMENT_MAX_CHARS = 690_000;

/** Returns a data URI for the chosen document photo, or null if they backed out. */
export async function pickDocumentPhoto(source: PhotoSource): Promise<string | null> {
  if (!(await ensurePermission(source, 'document'))) return null;

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    // No aspect and no forced crop. A licence, a PAN card and a bank statement
    // are three different shapes, and cropping any of them to fit loses the
    // corner the reviewer needs.
    allowsEditing: false,
    quality: 1
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return null;

  const manipulated = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: DOCUMENT_MAX_WIDTH } }],
    { compress: DOCUMENT_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    throw new Error('That photo could not be read. Try taking it again.');
  }

  const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
  if (dataUri.length > DOCUMENT_MAX_CHARS) {
    throw new Error('That photo is too large to upload. Take a new one from inside the app.');
  }
  return dataUri;
}

/**
 * Asks where the photo should come from, then returns it.
 *
 * Both sources are offered for a reason: a partner has often already
 * photographed their FSSAI licence, and being made to photograph it again
 * because the app only opens the camera is how a document never gets sent.
 */
export function chooseDocumentPhoto(label: string): Promise<string | null> {
  // Rejects rather than swallowing: "that photo is too large" has to reach the
  // screen, or the partner taps Add and nothing at all appears to happen.
  return new Promise((resolve, reject) => {
    Alert.alert(label, 'Where should the photo come from?', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      {
        text: 'Take a photo',
        onPress: () => pickDocumentPhoto('camera').then(resolve, reject)
      },
      {
        text: 'Choose from gallery',
        onPress: () => pickDocumentPhoto('library').then(resolve, reject)
      }
    ]);
  });
}
