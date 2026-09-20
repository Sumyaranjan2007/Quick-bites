import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { t } from '../theme';
import { Maps, canRenderNativeMap } from '../lib/nativeMap';

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

  // Declared before the early returns below: hooks cannot be called
  // conditionally, and a `return null` above a `useEffect` changes the hook
  // count between renders, which React treats as a fatal error rather than a
  // warning.
  useEffect(() => {
    if (!rider || !destination) return;
    ref.current?.fitToCoordinates?.([rider, destination], {
      edgePadding: { top: 56, right: 56, bottom: 56, left: 56 },
      animated: true
    });
  }, [rider?.latitude, rider?.longitude, destination?.latitude, destination?.longitude]);

  if (!destination) return null;

  if (!canRenderNativeMap || !Maps?.default) {
    return (
      <View style={s.fallback}>
        <Text style={s.fallbackText}>
          {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
        </Text>
        <Text style={s.fallbackHint}>Tap Navigate to open this in your maps app.</Text>
      </View>
    );
  }

  const MapView = Maps.default;
  const { Marker, Polyline, PROVIDER_GOOGLE } = Maps;

  return (
    <View style={s.frame}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{
          latitude: destination.latitude,
          longitude: destination.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02
        }}
        // The rider's own position is drawn by the OS blue dot rather than by a
        // marker of ours: it carries the accuracy circle and the heading arrow,
        // both of which matter on a bike and neither of which a plain pin has.
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        // Scroll is off because this map lives inside a scrolling screen. A
        // pannable map in a ScrollView steals every vertical drag that starts
        // on it, so the rider cannot scroll past it to reach the buttons below.
        scrollEnabled={false}
        zoomEnabled={false}
      >
        <Marker
          coordinate={destination}
          title={destinationLabel}
          pinColor={carryingFood ? t.color.go : t.color.money}
        />
        {rider && (
          <Polyline
            coordinates={[rider, destination]}
            strokeColor={t.color.brand}
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        )}
      </MapView>
      <View style={s.tag}>
        <Text style={s.tagText}>{carryingFood ? 'To the customer' : 'To the kitchen'}</Text>
      </View>
    </View>
  );
};

const s = StyleSheet.create({
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
