/**
 * The map, behind one seam, so the provider can change without touching a
 * screen (screens use only `canRenderNativeMap`, `MapCanvas`, `MapPin`,
 * `MapRoute`).
 *
 * Google Maps through `react-native-maps` (owner, 17 Oct 2026; master plan C2),
 * replacing Mapbox. Android always draws Google with react-native-maps; iPhone
 * asks for `PROVIDER_GOOGLE`, which needs the iOS key.
 *
 * TWO WAYS THE MAP CAN BE UNAVAILABLE, and neither is fatal:
 *  - NO KEY: `app.config.js` records on `extra` whether the build carries one.
 *    A Google map without a key draws a grey grid, which looks like a slow
 *    network; asking `extra` turns that into an answer.
 *  - NO NATIVE MODULE (a test runner, an older build): `require` throws, and
 *    every map falls back to the drawn view it used before.
 * `require`, not `import`, so that throw can be caught.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';

export interface LatLng {
  latitude: number;
  longitude: number;
}

const extra = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;

/** True when this build carries a Google Maps key for this platform (written by app.config.js). */
export const mapsKeyPresent: boolean = Boolean(Platform.OS === 'ios' ? extra.googleMapsIos : extra.googleMapsAndroid);

function loadMaps(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-maps');
    return mod?.default ? mod : null;
  } catch {
    return null;
  }
}

const RNMaps = loadMaps();

/** The one question every map component asks: a key AND the native module. */
export const canRenderNativeMap: boolean = mapsKeyPresent && RNMaps !== null;

/** A real point: finite, and not the 0,0 an unset coordinate defaults to. */
const plottable = (p?: LatLng | null): p is LatLng =>
  !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0);

/** "Metres across" (how callers think) -> a region the map understands. */
function regionFor(centre: LatLng, spanMetres: number) {
  const metres = Math.max(50, spanMetres);
  const latitudeDelta = metres / 111_320;
  const longitudeDelta = metres / (111_320 * Math.max(0.2, Math.cos((centre.latitude * Math.PI) / 180)));
  return { latitude: centre.latitude, longitude: centre.longitude, latitudeDelta, longitudeDelta };
}

const keyOf = (points: LatLng[]) => points.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join('|');
const EDGE = { top: 60, right: 60, bottom: 60, left: 60 };

export interface MapCanvasProps {
  /** Where the map is looking. */
  centre: LatLng;
  /** Metres across, roughly; ignored when `fit` has two or more points. */
  spanMetres?: number;
  /** Points that must ALL be visible (kitchen, rider, door): the camera fits them. */
  fit?: LatLng[];
  children?: React.ReactNode;
  style?: any;
  /** Fired when the user stops moving the map, with the new centre. */
  onSettle?: (centre: LatLng) => void;
  scrollEnabled?: boolean;
  /** The device's own position (the rider's trip map). */
  showUserLocation?: boolean;
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
  const ref = useRef<any>(null);
  const points = (fit || []).filter(plottable);
  const target = points.length === 1 ? points[0] : centre;
  const fitKey = keyOf(points);
  const targetKey = keyOf([target]);

  const frame = () => {
    if (points.length >= 2) ref.current?.fitToCoordinates(points, { edgePadding: EDGE, animated: true });
    else if (plottable(target)) ref.current?.animateToRegion(regionFor(target, spanMetres), 350);
  };
  // Re-framed only when the points really move (5 decimals, about a metre), so a
  // settle that reports the same centre back cannot start a loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(frame, [fitKey, targetKey, spanMetres]);

  if (!RNMaps) return null;
  const MapView = RNMaps.default;
  return React.createElement(
    View,
    { style },
    React.createElement(
      MapView,
      {
        ref,
        provider: RNMaps.PROVIDER_GOOGLE,
        style: StyleSheet.absoluteFill,
        initialRegion: regionFor(plottable(target) ? target : centre, spanMetres),
        onMapReady: frame,
        scrollEnabled,
        zoomEnabled: scrollEnabled,
        rotateEnabled: false,
        pitchEnabled: false,
        toolbarEnabled: false,
        showsUserLocation: showUserLocation,
        showsMyLocationButton: false,
        onRegionChangeComplete: onSettle
          ? (region: any) => {
              const point = { latitude: Number(region?.latitude), longitude: Number(region?.longitude) };
              if (plottable(point)) onSettle(point);
            }
          : undefined
      },
      children
    )
  );
};

export interface MapPinProps {
  id: string;
  at: LatLng;
  children?: React.ReactNode;
}

/** A marker at a point. `children` is the marker's own view, if it has one. */
export const MapPin: React.FC<MapPinProps> = ({ id, at, children }) => {
  if (!RNMaps || !plottable(at)) return null;
  return React.createElement(RNMaps.Marker, { identifier: id, coordinate: at, anchor: { x: 0.5, y: 0.5 } }, children);
};

export interface MapMovingPinProps {
  id: string;
  at: LatLng;
  /** Heading in degrees (0 = north); the marker turns with the road. */
  rotation?: number;
  /** How long the glide to a new point takes: about the time between two fixes. */
  glideMs?: number;
  children?: React.ReactNode;
}

/**
 * A marker that GLIDES from its last point to each new one (master plan D5),
 * instead of jumping: react-native-maps' AnimatedRegion, the documented way on
 * both Android and iPhone. Flat, so it turns with the map like a vehicle seen
 * from above.
 */
export const MapMovingPin: React.FC<MapMovingPinProps> = ({ id, at, rotation = 0, glideMs = 3800, children }) => {
  const region = useRef<any>(null);
  const ok = Boolean(RNMaps) && plottable(at);
  if (ok && !region.current) {
    region.current = new RNMaps.AnimatedRegion({ latitude: at.latitude, longitude: at.longitude, latitudeDelta: 0, longitudeDelta: 0 });
  }
  useEffect(() => {
    if (!ok || !region.current) return;
    region.current.timing({ latitude: at.latitude, longitude: at.longitude, duration: glideMs, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, at.latitude, at.longitude]);
  if (!ok) return null;
  return React.createElement(
    RNMaps.MarkerAnimated,
    { identifier: id, coordinate: region.current, anchor: { x: 0.5, y: 0.5 }, flat: true, rotation },
    children
  );
};

export interface MapRouteProps {
  id: string;
  points: LatLng[];
  colour: string;
  width?: number;
}

/** A line through a list of points. */
export const MapRoute: React.FC<MapRouteProps> = ({ points, colour, width = 4 }) => {
  const line = points.filter(plottable);
  if (!RNMaps || line.length < 2) return null;
  return React.createElement(RNMaps.Polyline, {
    coordinates: line,
    strokeColor: colour,
    strokeWidth: width,
    lineCap: 'round',
    lineJoin: 'round'
  });
};
