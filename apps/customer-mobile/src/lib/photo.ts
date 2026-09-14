/**
 * Choosing a profile photo and getting it to the server small enough to arrive.
 *
 * Phone cameras produce several megabytes; the API accepts a much smaller body.
 * Every image is therefore resized and re-encoded before it becomes a data URI,
 * so an upload either fits or fails locally with something the customer can act
 * on — rather than being cut off mid-request by the server.
 *
 * The same approach the rider app uses for its profile picture, which is where
 * the size ceiling below was established.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export type PhotoSource = 'camera' | 'library';

/** Longest edge after resizing. An avatar is shown at 64px at most. */
const MAX_WIDTH = 640;
const QUALITY = 0.65;
/** Comfortably under the server's cap, with room for base64's 33% overhead. */
const MAX_DATA_URI_CHARS = 690_000;

async function ensurePermission(source: PhotoSource): Promise<boolean> {
  const result =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (result.granted) return true;

  Alert.alert(
    source === 'camera' ? 'Camera access needed' : 'Photo access needed',
    source === 'camera'
      ? 'Quick Bites needs the camera to take your profile picture. Enable it in Settings.'
      : 'Quick Bites needs access to your photos to use one you already took. Enable it in Settings.'
  );
  return false;
}

async function pickAndCompress(source: PhotoSource): Promise<string | null> {
  if (!(await ensurePermission(source))) return null;

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (result.canceled || !result.assets?.length) return null;

  const manipulated = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    Alert.alert('Could not read that photo', 'Please try choosing it again.');
    return null;
  }

  const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
  if (dataUri.length > MAX_DATA_URI_CHARS) {
    Alert.alert('Photo too large', 'That image is unusually large. Try a different one.');
    return null;
  }
  return dataUri;
}

/** Asks whether to use the camera or the gallery, then returns the data URI. */
export function chooseProfilePhoto(): Promise<string | null> {
  return new Promise(resolve => {
    Alert.alert('Profile photo', 'Where should the photo come from?', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Take photo', onPress: () => pickAndCompress('camera').then(resolve) },
      { text: 'Choose from gallery', onPress: () => pickAndCompress('library').then(resolve) }
    ]);
  });
}
