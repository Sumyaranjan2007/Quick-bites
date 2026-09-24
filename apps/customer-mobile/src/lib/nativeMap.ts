/**
 * The map, behind one seam, so the provider can be changed without touching a
 * single screen.
 *
 * This file used to load `react-native-maps` and hand callers its components
 * directly, which meant every map screen knew it was drawing a Google map:
 * `PROVIDER_GOOGLE`, `<Marker>`, `<Polyline>`, a `region` prop. Swapping
 * provider therefore meant rewriting four screens, and the next swap would
 * mean rewriting them again.
 *
 * So the components exported here are provider-neutral - a canvas, a pin, a
 * route - and Mapbox lives behind them. A future change is this file and
 * nothing else.
 *
 * TWO WAYS THE MAP CAN BE UNAVAILABLE, and they fail differently:
 *
 * NO TOKEN. The config plugin writes the Mapbox token into the build and
 * records on `extra` whether it found one. A build without one renders an
 * empty canvas and no error anywhere, which looks exactly like a slow network.
 * Asking `extra` turns that into a question with an answer.
 *
 * NO NATIVE MODULE. `@rnmapbox/maps` is native code. In Expo Go, in a build
 * made before the dependency existed, or in a test runner, the import throws.
 * A throw at the top of the tracking screen would take out the screen a
 * customer opens when they are already anxious about where their food is.
 *
 * Neither is fatal. Every map in this app falls back to the drawn
 * OpenStreetMap view it used before, which needs no token and no native code.
 *
 * `require` rather than `import`, deliberately: a static import is hoisted and
 * evaluated before the surrounding code, so it cannot be guarded - the throw
 * would happen while this module was still loading and take the bundle with it.
 */
import React from 'react';
import Constants from 'expo-constants';
import { boundsFor, FIT_PADDING } from './mapFit';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** True when the build carries a Mapbox token. Written by the config plugin. */
export const mapsKeyPresent: boolean = Boolean(
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.mapboxConfigured
);

const mapboxToken = String(
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.mapboxAccessToken || ''
);

/**
 * The brand style, shared by all four apps.
 *
 * One URL in one place: four apps referencing four styles is a brand
 * inconsistency nobody notices until a screenshot goes somewhere public. It
 * falls back to Mapbox's own streets style rather than failing, because a map
 * in the wrong colours is better than no map.
 */
export const MAP_STYLE_URL = String(
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.mapboxStyleUrl ||
    'mapbox://styles/mapbox/streets-v12'
);

function loadMapbox(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@rnmapbox/maps');
    const lib = mod?.default ?? mod;
    // A resolved module with no MapView is a broken install rather than an
    // absent one, and rendering it would throw somewhere far less obvious.
    if (!lib?.MapView) return null;
    if (mapboxToken) lib.setAccessToken(mapboxToken);
    return lib;
  } catch {
    return null;
  }
}

const Mapbox = loadMapbox();

/** The native map library, or null when this build cannot draw one. */
export const Maps = Mapbox;

/**
 * The single question every map component should ask.
 *
 * Both halves matter: a token with no native module still cannot draw, and a
 * native module with no token draws an empty canvas - which is worse than the
 * fallback, because it looks like the feature is working and merely broken.
 */
export const canRenderNativeMap: boolean = mapsKeyPresent && Mapbox !== null;

/** Why not, in words, for the hidden diagnostics screen. Never shown to a customer. */
export function nativeMapUnavailableReason(): string | null {
  if (canRenderNativeMap) return null;
  if (!mapsKeyPresent && Mapbox === null) {
    return 'No Mapbox token in this build, and the native map module is not linked.';
  }
  if (!mapsKeyPresent) return 'This build carries no Mapbox access token.';
  return 'The native map module is not linked into this build.';
}

/* -------------------------------------------------------------------------- */
/*  Coordinate order                                                          */
/* -------------------------------------------------------------------------- */

/*
 * THE ONE PLACE THE TWO COORDINATE ORDERS MEET.
 *
 * Mapbox orders coordinates [longitude, latitude]. react-native-maps used
 * {latitude, longitude}, and so does every screen, every API response and
 * every stored address in this project.
 *
 * Getting it backwards does not raise an error anywhere. A Bengaluru address
 * transposed becomes a point in the Indian Ocean, and the map, the distance
 * and the delivery fee are all computed from it perfectly happily. The symptom
 * is a wrong fee or a map centred at sea, and it reads as a data problem
 * rather than an axis order - which is why it is worth two named functions
 * instead of an inline array literal repeated in four places.
 *
 * Named for the direction they convert, not for what they take. `toMapbox` and
 * `fromMapbox` cannot be used the wrong way round without the name saying so
 * at the call site.
 */
export function toMapbox(p: LatLng): [number, number] {
  return [p.longitude, p.latitude];
}

export function fromMapbox(c: unknown): LatLng | null {
  // Guarded rather than trusted: this reads a value out of a native event,
  // and a malformed one must leave the pin where it is rather than move it to
  // [NaN, NaN] - which renders as the map jumping to the middle of nowhere.
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lon, lat] = c;
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { latitude: lat, longitude: lon };
}

/* -------------------------------------------------------------------------- */
/*  Provider-neutral components                                               */
/* -------------------------------------------------------------------------- */

export interface MapCanvasProps {
  /** Where the map is looking. */
  centre: LatLng;
  /**
   * Metres across, roughly. Callers think in "how much ground do I want to
   * see", not in zoom levels - a zoom level is a property of the tile scheme
   * and would leak the provider straight back through this seam.
   */
  spanMetres?: number;
  /**
   * Points that must ALL be visible. Given two or more, the camera fits a box
   * around them and `centre`/`spanMetres` are ignored.
   *
   * This is the fix for the owner's "when its too far it shows outside and it
   * dosnt fit in the box". A span in metres cannot be turned into a correct zoom
   * without knowing how wide and how tall the map is, and `zoomForSpan` knew
   * neither — see `mapFit.ts` for the four compounding errors. Mapbox's own
   * bounds fitting knows the viewport, the aspect ratio and the latitude,
   * because it is the thing doing the drawing.
   *
   * `centre` and `spanMetres` stay for callers that genuinely want a fixed view
   * rather than a fit, such as the address picker.
   */
  fit?: LatLng[];
  children?: React.ReactNode;
  style?: any;
  /** Fired when the user stops moving the map, with the new centre. */
  onSettle?: (centre: LatLng) => void;
  scrollEnabled?: boolean;
  /** Follows the device position. Used by the rider's own trip map. */
  showUserLocation?: boolean;
}

/**
 * Metres across -> Mapbox zoom level.
 *
 * Zoom is logarithmic in metres-per-pixel, so this is a log rather than a
 * table: a table would need an entry for every span any caller ever wanted and
 * would quietly round to the nearest one it had.
 *
 * Clamped at both ends. Past 20 a phone renders blank tiles, and below 1 the
 * whole world is a smear - neither is a view anyone asked for, and both look
 * like a broken map rather than a bad argument.
 */
function zoomForSpan(spanMetres: number): number {
  const safeSpan = Math.max(50, spanMetres);
  const zoom = Math.log2(40075016.686 / safeSpan);
  return Math.min(20, Math.max(1, zoom));
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  centre,
  spanMetres = 1200,
  fit,
  children,
  style,
  onSettle,
  scrollEnabled = true,
  showUserLocation = false
}) => {
  if (!Mapbox) return null;
  const { MapView, Camera, UserLocation } = Mapbox;

  /*
   * A box if there is one, a centre if there is not.
   *
   * `boundsFor` returns null for a single point AND for a zero-area box — two
   * coordinates that are the same, which is what a rider standing at the
   * customer's door looks like. Mapbox given a zero-area bounds zooms to its
   * maximum and renders blank grey, and blank is the one thing a tracking map
   * must never be. So that case falls through to the centre-and-span path with
   * its floor span, which is a sensible close-up view of one place.
   */
  const box = fit ? boundsFor(fit) : null;
  const cameraProps: any = box
    ? {
        bounds: {
          ne: toMapbox(box.ne),
          sw: toMapbox(box.sw),
          paddingTop: FIT_PADDING.top,
          paddingBottom: FIT_PADDING.bottom,
          paddingLeft: FIT_PADDING.left,
          paddingRight: FIT_PADDING.right
        },
        animationDuration: 350
      }
    : {
        centerCoordinate: toMapbox(fit && fit.length === 1 ? fit[0] : centre),
        zoomLevel: zoomForSpan(spanMetres),
        animationDuration: 350
      };

  return React.createElement(
    MapView,
    {
      style,
      styleURL: MAP_STYLE_URL,
      scaleBarEnabled: false,
      // The Mapbox wordmark and attribution must stay visible - it is a
      // condition of the terms, not a design choice.
      logoEnabled: true,
      attributionEnabled: true,
      scrollEnabled,
      zoomEnabled: scrollEnabled,
      rotateEnabled: false,
      pitchEnabled: false,
      onMapIdle: onSettle
        ? (state: any) => {
            const point = fromMapbox(state?.properties?.center);
            if (point) onSettle(point);
          }
        : undefined
    },
    React.createElement(Camera, cameraProps),
    showUserLocation && UserLocation ? React.createElement(UserLocation, { key: 'me' }) : null,
    children
  );
};

export interface MapPinProps {
  id: string;
  at: LatLng;
  children?: React.ReactNode;
}

/** A marker at a point. `children` is the marker's own view, if it has one. */
export const MapPin: React.FC<MapPinProps> = ({ id, at, children }) => {
  if (!Mapbox) return null;
  const { MarkerView } = Mapbox;
  return React.createElement(
    MarkerView,
    { id, coordinate: toMapbox(at), allowOverlap: true },
    children
  );
};

export interface MapRouteProps {
  id: string;
  points: LatLng[];
  colour: string;
  width?: number;
}

/**
 * A line through a list of points.
 *
 * Mapbox draws lines as a GeoJSON source with a layer over it rather than as a
 * single component, which is more capable and more verbose. Callers should not
 * have to know that, so the GeoJSON is assembled here.
 */
export const MapRoute: React.FC<MapRouteProps> = ({ id, points, colour, width = 4 }) => {
  if (!Mapbox || points.length < 2) return null;
  const { ShapeSource, LineLayer } = Mapbox;

  const shape = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map(toMapbox)
    }
  };

  return React.createElement(
    ShapeSource,
    { id: `${id}-source`, shape },
    React.createElement(LineLayer, {
      id: `${id}-line`,
      style: { lineColor: colour, lineWidth: width, lineCap: 'round', lineJoin: 'round' }
    })
  );
};
