/**
 * Taking a photo and getting it to the server small enough to arrive.
 *
 * Phone cameras produce several megabytes; the API accepts a 1 MB body. Every
 * image is therefore resized and re-encoded before it is turned into a data
 * URI, so an upload either fits or fails locally with something the rider can
 * act on — rather than being cut off mid-request by the server.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export type PhotoSource = 'camera' | 'library';

interface PhotoOptions {
  /** Longest edge after resizing. Documents need detail; avatars do not. */
  maxWidth: number;
  quality: number;
  square?: boolean;
}

const PROFILE: PhotoOptions = { maxWidth: 640, quality: 0.65, square: true };
const DOCUMENT: PhotoOptions = { maxWidth: 1280, quality: 0.6 };

async function ensurePermission(source: PhotoSource): Promise<boolean> {
  const result =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (result.granted) return true;

  Alert.alert(
    source === 'camera' ? 'Camera access needed' : 'Photo access needed',
    source === 'camera'
      ? 'Quick Bites needs the camera to photograph your documents and profile picture. Enable it in Settings.'
      : 'Quick Bites needs access to your photos to upload a picture you already took. Enable it in Settings.'
  );
  return false;
}

async function pickAndCompress(source: PhotoSource, options: PhotoOptions): Promise<string | null> {
  if (!(await ensurePermission(source))) return null;

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: options.square ? [1, 1] : [4, 3],
    quality: 1
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (result.canceled || !result.assets?.length) return null;

  const manipulated = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: options.maxWidth } }],
    { compress: options.quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    Alert.alert('Could not read that photo', 'Please try taking it again.');
    return null;
  }

  const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
  if (dataUri.length > 690_000) {
    Alert.alert('Photo too large', 'That image is unusually large. Try taking a new photo instead.');
    return null;
  }
  return dataUri;
}

export function captureProfilePhoto(source: PhotoSource): Promise<string | null> {
  return pickAndCompress(source, PROFILE);
}

export function captureDocumentPhoto(source: PhotoSource): Promise<string | null> {
  return pickAndCompress(source, DOCUMENT);
}

/** Asks whether to use the camera or the gallery, then returns the data URI. */
export function choosePhoto(
  title: string,
  kind: 'profile' | 'document'
): Promise<string | null> {
  const capture = kind === 'profile' ? captureProfilePhoto : captureDocumentPhoto;
  return new Promise(resolve => {
    Alert.alert(title, 'Where should the photo come from?', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Take photo', onPress: () => capture('camera').then(resolve) },
      { text: 'Choose from gallery', onPress: () => capture('library').then(resolve) }
    ]);
  });
}
