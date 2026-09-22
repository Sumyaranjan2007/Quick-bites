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
  children,
  style,
  onSettle,
  scrollEnabled = true,
  showUserLocation = false
}) => {
  if (!Mapbox) return null;
  const { MapView, Camera, UserLocation } = Mapbox;

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
            const c = state?.properties?.center;
            if (Array.isArray(c) && c.length === 2) {
              // Mapbox orders coordinates [longitude, latitude]; every caller
              // here thinks in {latitude, longitude}. Converting at the seam
              // rather than in four screens is the whole point of the seam -
              // a transposed pair puts a customer's front door in the sea and
              // looks like a data problem rather than an axis order.
              onSettle({ latitude: c[1], longitude: c[0] });
            }
          }
        : undefined
    },
    React.createElement(Camera, {
      centerCoordinate: [centre.longitude, centre.latitude],
      zoomLevel: zoomForSpan(spanMetres),
      animationDuration: 350
    }),
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
    { id, coordinate: [at.longitude, at.latitude], allowOverlap: true },
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
      coordinates: points.map(p => [p.longitude, p.latitude])
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
