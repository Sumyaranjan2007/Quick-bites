import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Linking, TouchableOpacity, Platform } from 'react-native';
import Svg, { Circle, Line, Path, G, Rect } from 'react-native-svg';
import { tokens } from '../theme/tokens';
import { Bike } from 'lucide-react-native';
import { Maps, canRenderNativeMap } from '../lib/nativeMap';

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

/** Great-circle distance in metres. */
export function distanceMetres(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Web-mercator world pixel coordinates at a given zoom. */
function project(lat: number, lon: number, z: number) {
  const n = TILE * Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Largest zoom at which both points still fit inside the viewport. */
function fitZoom(a: Coords, b: Coords, w: number, h: number): number {
  for (let z = 17; z >= 11; z--) {
    const pa = project(a.latitude, a.longitude, z);
    const pb = project(b.latitude, b.longitude, z);
    if (Math.abs(pa.x - pb.x) < w * 0.6 && Math.abs(pa.y - pb.y) < h * 0.6) return z;
  }
  return 11;
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
  destination: Coords | null;
  updatedAt?: string | null;
  riderName?: string | null;
}

/**
 * Distance and freshness, under whichever map drew above it.
 *
 * Extracted so the real map and the drawn fallback cannot drift apart: the
 * numbers under the map are the part a customer actually reads, and having two
 * copies of them would eventually mean two answers.
 */
const MapLegend: React.FC<{ metres: number; updatedAt?: string | null; riderName?: string | null }> = ({
  metres,
  updatedAt,
  riderName
}) => (
  <View style={styles.legend}>
    <View style={styles.legendLeft}>
      <Bike size={15} color={c.accent[600]} />
      <Text style={styles.distance}>{formatDistance(metres)} away</Text>
    </View>
    <Text style={styles.freshness}>
      {riderName ? `${riderName} · ` : ''}
      {freshness(updatedAt)}
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
const NativeRiderMap: React.FC<{ rider: Coords; destination: Coords }> = ({ rider, destination }) => {
  const MapView = Maps!.default;
  const { Marker, Polyline, PROVIDER_GOOGLE } = Maps!;
  const ref = useRef<any>(null);

  useEffect(() => {
    // Both points kept in frame: a map centred on the rider alone tells you
    // where they are and not whether they are getting closer.
    ref.current?.fitToCoordinates?.([rider, destination], {
      edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
      animated: true
    });
  }, [rider.latitude, rider.longitude, destination.latitude, destination.longitude]);

  return (
    <MapView
      ref={ref}
      style={StyleSheet.absoluteFill}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={{
        latitude: (rider.latitude + destination.latitude) / 2,
        longitude: (rider.longitude + destination.longitude) / 2,
        latitudeDelta: Math.max(0.01, Math.abs(rider.latitude - destination.latitude) * 2.5),
        longitudeDelta: Math.max(0.01, Math.abs(rider.longitude - destination.longitude) * 2.5)
      }}
      pointerEvents="none"
      toolbarEnabled={false}
      showsMyLocationButton={false}
    >
      <Marker coordinate={destination} title="Delivery address" pinColor={c.primary[500]} />
      <Marker coordinate={rider} title="Your rider" pinColor={c.accent[500]} />
      <Polyline coordinates={[rider, destination]} strokeColor={c.primary[500]} strokeWidth={3} />
    </MapView>
  );
};

export const LiveRiderMap: React.FC<Props> = ({ rider, destination, updatedAt, riderName }) => {
  const W = 320;
  const H = 190;

  if (!rider || !destination) {
    // Deliberately the same height as the map it stands in for. It used to be
    // 92px against a 190px map, so the page grew by ~100px the moment a rider
    // position arrived and the list jumped under the reader's thumb.
    return (
      <View style={[styles.placeholder, { height: H }]}>
        <Text style={styles.placeholderText}>
          {rider
            ? 'Waiting for the delivery address position.'
            : 'Live location starts once your rider picks the order up.'}
        </Text>
      </View>
    );
  }

  const metres = distanceMetres(rider, destination);

  if (canRenderNativeMap && Maps?.default) {
    return (
      <View>
        <View style={[styles.mapFrame, { height: H }]}>
          <NativeRiderMap rider={rider} destination={destination} />
        </View>
        <MapLegend metres={metres} updatedAt={updatedAt} riderName={riderName} />
      </View>
    );
  }

  const z = fitZoom(rider, destination, W, H);

  const pr = project(rider.latitude, rider.longitude, z);
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

      <MapLegend metres={metres} updatedAt={updatedAt} riderName={riderName} />
    </View>
  );
};

const styles = StyleSheet.create({
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
