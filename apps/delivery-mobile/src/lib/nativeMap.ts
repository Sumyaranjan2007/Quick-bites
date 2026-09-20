/**
 * Whether this build can draw a real Google map, answered once, safely.
 *
 * Two separate things have to be true before `react-native-maps` can render,
 * and each fails in a way that is worth distinguishing:
 *
 * NO KEY. The `withGoogleMapsApiKey` config plugin writes the Maps key into the
 * manifest at build time and records on `extra` whether it found one. A build
 * made without a key renders a grey rectangle with a Google logo in the corner
 * and no error anywhere — the single most confusing failure this library has,
 * because it looks exactly like a slow network. Asking `extra` turns that into
 * a question with an answer.
 *
 * NO NATIVE MODULE. `react-native-maps` is native code. In Expo Go, in a build
 * made before the dependency was added, or in any JS-only context such as a
 * test runner, the import throws or resolves to something that throws on first
 * render. A crash at the top of a tracking screen would take out the screen a
 * customer opens when they are already anxious about where their food is.
 *
 * So the import is attempted inside a try/catch, once, at module load, and the
 * result is a value the callers can branch on. Neither failure is fatal: every
 * map in this app falls back to the drawn OpenStreetMap view it used before,
 * which needs no key and no native module.
 *
 * `require` rather than `import` on purpose. A static import is hoisted and
 * evaluated before any surrounding code, so it cannot be guarded — the throw
 * would happen while this module was still being loaded, and take the bundle
 * with it.
 */
import Constants from 'expo-constants';

/** True when the build carries a Maps key. Written by the config plugin. */
export const mapsKeyPresent: boolean = Boolean(
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.googleMapsConfigured
);

interface MapsModule {
  default: any;
  Marker: any;
  Polyline: any;
  PROVIDER_GOOGLE: any;
}

function loadMaps(): MapsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-maps');
    // A resolved module with no MapView export is a broken install rather than
    // an absent one, and rendering it would throw somewhere much less obvious.
    if (!mod?.default) return null;
    return mod as MapsModule;
  } catch {
    return null;
  }
}

const loaded = loadMaps();

/** The native map module, or null when this build cannot draw one. */
export const Maps = loaded;

/**
 * The single question every map component should ask.
 *
 * Both conditions matter: a key with no native module still cannot draw, and a
 * native module with no key draws a grey square, which is worse than the
 * fallback because it looks like the feature is working and merely broken.
 */
export const canRenderNativeMap: boolean = mapsKeyPresent && loaded !== null;

/**
 * Why not, in words, for the one place that should say so out loud.
 *
 * Used by the hidden diagnostics screen. Never shown to a customer — they get
 * the fallback map and no explanation, because from their side nothing is
 * wrong.
 */
export function nativeMapUnavailableReason(): string | null {
  if (canRenderNativeMap) return null;
  if (!mapsKeyPresent && loaded === null) return 'No Maps key in this build, and the native map module is not linked.';
  if (!mapsKeyPresent) return 'This build carries no Google Maps key.';
  return 'The native map module is not linked into this build.';
}
