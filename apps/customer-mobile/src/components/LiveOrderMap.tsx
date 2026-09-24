import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Linking, TouchableOpacity, Platform } from 'react-native';
import Svg, { Circle, Line, Path, G, Rect } from 'react-native-svg';
import { tokens } from '../theme/tokens';
import { Bike, Store } from 'lucide-react-native';
import { canRenderNativeMap, MapCanvas, MapPin, MapRoute } from '../lib/nativeMap';
import { distanceMetres, project, fitZoom } from '../lib/mapFit';

const c = tokens.colors;

export interface Coords {
  latitude: number;
  longitude: number;
}

const TILE = 256;

/**
 * Street tiles come from OpenStreetMap, which needs no API key — Google Maps and
 * Mapbox both require an account with billing enabled before they will serve a
 * single tile.
 *
 * OSM's tile policy covers light use like this. A production launch should point
 * TILE_URL at your own tile server or a paid provider; attribution below is
 * required by the ODbL licence either way.
 */
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/*
 * `distanceMetres`, `project` and `fitZoom` used to be defined here.
 *
 * They now live in `lib/mapFit.ts`, which imports nothing — no React, no Mapbox,
 * no Expo — so the gate can load it and actually check the arithmetic. This file
 * cannot be loaded by a test runner, which is why the fitting maths went
 * unchecked long enough for the native map to be wrong at distance for as long
 * as it has been.
 *
 * Re-exported because other screens import `distanceMetres` from here.
 */
export { distanceMetres };

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function freshness(iso?: string | null): string {
  if (!iso) return 'awaiting signal';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)} min ago`;
}

interface Props {
  rider: Coords | null;
  /** Where the food is being cooked. Shown until the rider collects it. */
  restaurant: Coords | null;
  destination: Coords | null;
  /**
   * THE PHASE SWITCH, and deliberately not the order's status.
   *
   * This platform runs two tracks: what the FOOD is doing and what the RIDER is
   * doing. They are different things, and keying a screen on the food's status
   * is the coupling that produced the "everything marks itself done" bug. So the
   * map asks the one question it actually cares about — has the rider got it? —
   * and `pickedUpAt` is the field that answers it, on both sides: the server
   * withholds the rider's position on the same key.
   */
  pickedUpAt?: string | null;
  updatedAt?: string | null;
  riderName?: string | null;
  restaurantName?: string | null;
}

/**
 * Distance and freshness, under whichever map drew above it.
 *
 * Extracted so the real map and the drawn fallback cannot drift apart: the
 * numbers under the map are the part a customer actually reads, and having two
 * copies of them would eventually mean two answers.
 */
const MapLegend: React.FC<{
  metres: number;
  carrying: boolean;
  updatedAt?: string | null;
  riderName?: string | null;
  restaurantName?: string | null;
}> = ({ metres, carrying, updatedAt, riderName, restaurantName }) => (
  <View style={styles.legend}>
    <View style={styles.legendLeft}>
      {carrying ? <Bike size={15} color={c.accent[600]} /> : <Store size={15} color={c.primary[600]} />}
      {/*
        NAMED AS A STRAIGHT LINE, because that is what it is.
        A straight line and a road distance differ by roughly the 1.3 factor
        this deployment is configured with, so a screen reading "2.1 km" beside
        a delivery fee computed from 2.7 km is a support ticket. Saying which
        kind of kilometre this is costs three words.
      */}
      <Text style={styles.distance}>
        {formatDistance(metres)} {carrying ? 'away' : 'from you, in a straight line'}
      </Text>
    </View>
    <Text style={styles.freshness}>
      {carrying
        ? `${riderName ? `${riderName} · ` : ''}${freshness(updatedAt)}`
        : restaurantName || 'Being cooked'}
    </Text>
  </View>
);

/**
 * The real map, when this build can draw one.
 *
 * The camera follows the rider rather than being re-rendered at a new region:
 * `animateCamera` moves the existing view, where changing `region` as a prop
 * re-anchors the map and makes it blink through a reload on every position
 * update — which arrive every few seconds, so the difference is the whole
 * experience of the screen.
 *
 * The marker still jumps between fixes rather than gliding. Interpolating a
 * marker between two GPS readings needs `AnimatedRegion` and belongs with the
 * rest of the live-tracking work in Stage 4; the camera easing here is most of
 * what makes it read as movement in the meantime.
 */
const NativeOrderMap: React.FC<{ origin: Coords; destination: Coords; carrying: boolean }> = ({
  origin,
  destination,
  carrying
}) => {
  /*
   * THE CAMERA FITS A BOX NOW, AND THIS IS THE OWNER'S BUG.
   *
   * It used to pick a centre and a span in metres, and `zoomForSpan` turned that
   * into a zoom with `log2(circumference / span)` — the zoom at which the span
   * fills ONE 256-PIXEL TILE. This map is about 320x190, so the answer was wrong
   * by the viewport ratio, wrong again by the aspect ratio, wrong again by
   * cos(latitude), and padded by a guessed 1.6. All four errors grow with
   * distance, which is exactly what was reported: "when its too far it shows
   * outside and it dosnt fit in the box".
   *
   * `fit` hands both points to Mapbox and lets it frame them. It knows how big
   * the map is, which is the one thing the old arithmetic could never know.
   */
  const points = [origin, destination];
  const centre = {
    latitude: (origin.latitude + destination.latitude) / 2,
    longitude: (origin.longitude + destination.longitude) / 2
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MapCanvas
        style={StyleSheet.absoluteFill}
        /* Used only when the two points are the same place — a rider at the
           door — because a zero-area box makes Mapbox zoom to maximum and
           render blank grey. See `boundsFor`. */
        centre={centre}
        spanMetres={400}
        fit={points}
        scrollEnabled={false}
      >
        <MapRoute id="order-route" points={points} colour={c.primary[500]} width={3} />
        <MapPin id="destination" at={destination}>
          <View style={[styles.pin, { backgroundColor: c.primary[500] }]} />
        </MapPin>
        <MapPin id="origin" at={origin}>
          <View
            style={[styles.pin, { backgroundColor: carrying ? c.accent[500] : c.primary[600] }]}
          />
        </MapPin>
      </MapCanvas>
    </View>
  );
};

/**
 * The order on a map, in whichever of its two phases it is in.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS NOT CALLED LiveRiderMap ANY MORE
 * -------------------------------------------------------------------------
 * Because it now draws a map with no rider in it. The owner asked that a
 * customer see the restaurant, and how far away it is, from the moment the
 * partner accepts — rather than a line of text saying live location starts
 * later. A name that lies is cheap to fix on the day it starts lying; this
 * project has already lost twenty minutes to a file called `RatesScreen.tsx`
 * behind a section called Inflation.
 *
 * PHASE A, from acceptance: the customer and the RESTAURANT.
 * PHASE B, from collection: the customer and the RIDER, live.
 *
 * The switch is `pickedUpAt` and not the order's status — see the prop.
 */
export const LiveOrderMap: React.FC<Props> = ({
  rider,
  restaurant,
  destination,
  pickedUpAt,
  updatedAt,
  riderName,
  restaurantName
}) => {
  const W = 320;
  const H = 190;

  /*
   * Carrying needs BOTH the timestamp and a position.
   *
   * `pickedUpAt` alone would switch to phase B and then have nothing to draw,
   * blanking a map that was working a second earlier — the rider's first ping
   * can arrive a few seconds after collection. Falling back to the restaurant
   * for those seconds shows something true rather than nothing.
   */
  const carrying = Boolean(pickedUpAt && rider);
  const origin = carrying ? rider : restaurant;

  if (!origin || !destination) {
    // Deliberately the same height as the map it stands in for. It used to be
    // 92px against a 190px map, so the page grew by ~100px the moment a rider
    // position arrived and the list jumped under the reader's thumb.
    return (
      <View style={[styles.placeholder, { height: H }]}>
        <Text style={styles.placeholderText}>
          {!destination
            ? 'Waiting for the delivery address position.'
            : 'The map appears once the restaurant accepts your order.'}
        </Text>
      </View>
    );
  }

  const metres = distanceMetres(origin, destination);

  if (canRenderNativeMap) {
    return (
      <View>
        <View style={[styles.mapFrame, { height: H }]}>
          <NativeOrderMap origin={origin} destination={destination} carrying={carrying} />
        </View>
        <MapLegend
          metres={metres}
          carrying={carrying}
          updatedAt={updatedAt}
          riderName={riderName}
          restaurantName={restaurantName}
        />
      </View>
    );
  }

  /*
   * The drawn fallback, which has always fitted correctly because `fitZoom`
   * takes a width and a height. That is why the native bug survived: anybody
   * testing on a machine without the native module saw the right behaviour.
   *
   * It now uses the shared `fitZoom` in `mapFit.ts` rather than its own copy, so
   * the two maps cannot start disagreeing about what fits.
   */
  const z = fitZoom([origin, destination], W, H);

  const pr = project(origin.latitude, origin.longitude, z);
  const pd = project(destination.latitude, destination.longitude, z);

  // Centre the viewport between the two points.
  const centreX = (pr.x + pd.x) / 2;
  const centreY = (pr.y + pd.y) / 2;
  const originX = centreX - W / 2;
  const originY = centreY - H / 2;

  // Tiles covering the viewport, with one row/column of bleed.
  const firstTileX = Math.floor(originX / TILE);
  const firstTileY = Math.floor(originY / TILE);
  const lastTileX = Math.floor((originX + W) / TILE);
  const lastTileY = Math.floor((originY + H) / TILE);

  // A calm street-like ground, aligned to the tile grid so it drifts with the
  // rider rather than sitting still behind a moving marker.
  const gridLines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  const STEP = 34;
  const offsetX = ((originX % STEP) + STEP) % STEP;
  const offsetY = ((originY % STEP) + STEP) % STEP;
  for (let i = 0, x = -offsetX; x <= W; x += STEP, i++) {
    gridLines.push({ x1: x, y1: 0, x2: x, y2: H, major: i % 3 === 0 });
  }
  for (let i = 0, y = -offsetY; y <= H; y += STEP, i++) {
    gridLines.push({ x1: 0, y1: y, x2: W, y2: y, major: i % 3 === 0 });
  }

  const riderX = pr.x - originX;
  const riderY = pr.y - originY;
  const destX = pd.x - originX;
  const destY = pd.y - originY;

  return (
    <View>
      <View style={[styles.mapFrame, { height: H }]}>
        <Svg width={W} height={H} style={StyleSheet.absoluteFill} viewBox={`0 0 ${W} ${H}`}>
          {/* A drawn ground rather than borrowed imagery. OpenStreetMap's tile
              policy does not permit an app to pull tiles anonymously, and it
              enforces that by answering with a grey "access blocked" picture at
              HTTP 200 - which no error handler can catch and which looked, to a
              customer, exactly like a broken app. Street imagery needs a keyed
              provider; the rider's position, the destination and the distance
              between them are the information, and they are ours to draw. */}
          <Rect x={0} y={0} width={W} height={H} fill={c.surface.subtle} />
          {gridLines.map((g, i) => (
            <Line
              key={`g${i}`}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke={c.border.subtle}
              strokeWidth={g.major ? 2 : 1}
              opacity={g.major ? 0.9 : 0.55}
            />
          ))}
          <Line
            x1={riderX}
            y1={riderY}
            x2={destX}
            y2={destY}
            stroke={c.primary[500]}
            strokeWidth={3}
            strokeDasharray="7 6"
            strokeLinecap="round"
            opacity={0.85}
          />

          {/* Destination */}
          <G>
            <Circle cx={destX} cy={destY} r={13} fill="#FFFFFF" opacity={0.95} />
            <Path d={`M ${destX} ${destY - 7} l 6 6 v 7 h -12 v -7 z`} fill={c.primary[500]} />
          </G>

          {/* Rider */}
          <G>
            <Circle cx={riderX} cy={riderY} r={16} fill={c.accent[500]} opacity={0.3} />
            <Circle cx={riderX} cy={riderY} r={9} fill={c.accent[500]} stroke="#FFFFFF" strokeWidth={2.5} />
          </G>
        </Svg>

        <View style={styles.attribution}>
          {/* Was "Live position · Harohalli" — a place name hardcoded into a
              component that is shown to every customer in every city. */}
          <Text style={styles.attributionText}>Approximate position</Text>
        </View>
      </View>

      <MapLegend
        metres={metres}
        carrying={carrying}
        updatedAt={updatedAt}
        riderName={riderName}
        restaurantName={restaurantName}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  /*
   * The marker's own view.
   *
   * react-native-maps drew a stock teardrop from a `pinColor` prop; Mapbox
   * takes a child view instead, which is more work and more control. A plain
   * dot reads better at this size than a pin: at 190px tall with two markers
   * often close together, two teardrops overlap into something unreadable,
   * and the white ring is what keeps the dot visible over dark map tiles.
   */
  pin: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: '#FFFFFF' },
  mapFrame: {
    width: '100%',
    borderRadius: tokens.radii.md,
    overflow: 'hidden',
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  attribution: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopLeftRadius: 6
  },
  attributionText: { fontSize: 9, color: c.text.secondary },
  placeholder: {
    borderRadius: tokens.radii.md,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20
  },
  placeholderText: {
    fontSize: tokens.font.size.sm,
    color: c.text.muted,
    textAlign: 'center',
    lineHeight: 19
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10
  },
  legendLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  distance: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary
  },
  freshness: { fontSize: tokens.font.size.xs, color: c.text.muted }
});
