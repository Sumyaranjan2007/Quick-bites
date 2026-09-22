import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { t } from '../theme';
import { canRenderNativeMap, MapCanvas, MapPin, MapRoute } from '../lib/nativeMap';

/**
 * Straight-line metres between two points, for choosing how much ground the
 * map should show.
 *
 * Deliberately not a road distance. This picks a zoom level, and a network
 * call that can fail has no business deciding whether a map renders - the
 * same reasoning the server uses when it falls back to a straight line with a
 * road factor rather than failing an order.
 */
function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Point {
  latitude: number;
  longitude: number;
}

interface Props {
  /** Where the rider is, from the same watcher that feeds telemetry. */
  rider: Point | null;
  /** The stop this leg is heading to: the kitchen before pickup, the door after. */
  destination: Point | null;
  /** What to call the destination on the map. */
  destinationLabel: string;
  /** Whether the rider has the food yet, which is what decides the leg. */
  carryingFood: boolean;
}

/**
 * The leg the rider is on, drawn on a real map.
 *
 * The trip screen already had two addresses, two sets of coordinates and two
 * Navigate buttons, and no picture of any of it. Coordinates printed as
 * "12.93382, 77.61246" tell a rider nothing they can ride by — the number is
 * there for support to read back, not for the person on the bike — so working
 * out whether the drop was ahead of them or behind them meant leaving the app
 * for Google Maps and losing the order controls to do it.
 *
 * This is deliberately NOT turn-by-turn navigation. Riders already have a
 * navigation app they know, they have it mounted where they can see it, and it
 * has their traffic and their voice. Reimplementing that badly inside an order
 * screen would be worse than the handoff. What this answers is the question the
 * order screen should answer by itself: which way is the next stop, and how far
 * has it got to go. The Navigate buttons still hand off for the riding.
 *
 * Falls back to the coordinate text that was already there when the build has
 * no map — see `lib/nativeMap.ts`.
 */
export const TripMap: React.FC<Props> = ({ rider, destination, destinationLabel, carryingFood }) => {
  const ref = useRef<any>(null);

  /**
   * Nothing touches the camera until the map exists and has been measured.
   *
   * `fitToCoordinates` becomes `newLatLngBounds`, which throws — and takes the
   * process with it — when the map has zero size:
   *
   *   Error using newLatLngBounds(LatLngBounds, int): Map size can't be 0.
   *
   * It crashed the partner app on a real device before this guard existed. A
   * map inside a scrolling screen is measured a frame or two after it mounts,
   * so this is the ordinary case rather than a rare one.
   */
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [mapReady, setMapReady] = useState(false);
  const canDriveCamera = mapReady && mapSize.width > 0 && mapSize.height > 0;

  /*
   * The camera is arithmetic now, not an imperative call after two readiness
   * flags. `fitToCoordinates` threw on a map of zero size and took the process
   * with it, so it had to wait for the map to report ready AND for a measured
   * layout; a centre and a span need neither, and the crash goes with them.
   */

  if (!destination) return null;

  if (!canRenderNativeMap) {
    return (
      <View style={s.fallback}>
        <Text style={s.fallbackText}>
          {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
        </Text>
        <Text style={s.fallbackHint}>Tap Navigate to open this in your maps app.</Text>
      </View>
    );
  }

  // Both points in frame when we have both, otherwise a close view of the
  // destination. 1.6x the gap keeps neither marker against an edge.
  const centre = rider
    ? {
        latitude: (rider.latitude + destination.latitude) / 2,
        longitude: (rider.longitude + destination.longitude) / 2
      }
    : destination;
  const spanMetres = rider ? Math.max(500, metresBetween(rider, destination) * 1.6) : 1600;

  return (
    <View style={s.frame}>
      <MapCanvas
        style={StyleSheet.absoluteFill}
        centre={centre}
        spanMetres={spanMetres}
        // The rider's own position is drawn by the OS dot rather than a marker
        // of ours: it carries the accuracy circle and the heading arrow, both
        // of which matter on a bike and neither of which a plain pin has.
        showUserLocation
        // Scroll is off because this map lives inside a scrolling screen. A
        // pannable map in a ScrollView steals every vertical drag that starts
        // on it, so the rider cannot scroll past it to reach the buttons below.
        scrollEnabled={false}
      >
        {rider && (
          <MapRoute id="trip" points={[rider, destination]} colour={t.color.brand} width={3} />
        )}
        <MapPin id="destination" at={destination}>
          <View
            style={[s.pin, { backgroundColor: carryingFood ? t.color.go : t.color.money }]}
          />
        </MapPin>
      </MapCanvas>
      <View style={s.tag}>
        <Text style={s.tagText}>{carryingFood ? 'To the customer' : 'To the kitchen'}</Text>
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  // Mapbox takes a child view for a marker rather than a `pinColor`. A dot
  // with a white ring stays readable over dark tiles at this size, where a
  // stock teardrop would not.
  pin: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF' },
  frame: {
    height: 170,
    borderRadius: t.radius.md,
    overflow: 'hidden',
    marginBottom: t.space[4],
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface
  },
  tag: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: t.color.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color.border
  },
  tagText: { color: t.color.text, fontSize: 12, fontWeight: '700' },
  fallback: {
    padding: t.space[3],
    borderRadius: t.radius.md,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    marginBottom: t.space[4],
    gap: 4
  },
  fallbackText: { color: t.color.text, fontSize: 13, fontWeight: '700' },
  fallbackHint: { color: t.color.textMuted, fontSize: 12 }
});
