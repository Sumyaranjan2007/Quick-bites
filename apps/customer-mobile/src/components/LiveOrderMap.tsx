import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, Linking, TouchableOpacity, Platform } from 'react-native';
import Svg, { Circle, Line, Path, G, Rect } from 'react-native-svg';
import { tokens } from '../theme/tokens';
import { Bike, Store, Home, X, LocateFixed, Maximize2 } from 'lucide-react-native';
import { Modal } from './Modal';
import { canRenderNativeMap, MapCanvas, MapPin, MapMovingPin, MapRoute } from '../lib/nativeMap';
import { BikeMarker } from './BikeMarker';
import { distanceMetres, project, fitZoom } from '../lib/mapFit';
import { decodePolyline } from '../lib/polyline';

/** The real map is tall, as in the leading apps; the drawn fallback keeps its old size. */
const NATIVE_H = 300;

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
  /**
   * The ROAD distance from the restaurant to the door, measured at checkout
   * (what the delivery fee was built from). Shown before pickup instead of a
   * straight line, so the customer reads the same kilometres they paid for.
   */
  roadKm?: number | null;
  /** The rider's heading, degrees from north: the bike turns with the road (D5). */
  riderBearing?: number | null;
  /** Google's encoded road line, kitchen to door (tracking API); a straight line without it. */
  routePolyline?: string | null;
  /** Minutes until the rider is at the door, while they carry the food (R3-26). */
  minutesAway?: number | null;
}

/** A position older than this shows as "updating…" (the server uses the same 30 s, B11). */
const STALE_MS = 30_000;
const isStale = (updatedAt?: string | null) => Boolean(updatedAt) && Date.now() - Date.parse(String(updatedAt)) > STALE_MS;

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
  roadKm?: number | null;
  updatedAt?: string | null;
  riderName?: string | null;
  restaurantName?: string | null;
  minutesAway?: number | null;
}> = ({ metres, carrying, updatedAt, riderName, restaurantName, roadKm, minutesAway }) => (
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
        {carrying
          ? `${formatDistance(metres)} away${minutesAway ? ` · ${minutesAway} min` : ''}`
          : roadKm && roadKm > 0
            ? `${roadKm.toFixed(1)} km from you by road`
            : `${formatDistance(metres)} from you, in a straight line`}
      </Text>
    </View>
    <Text style={styles.freshness}>
      {carrying
        ? `${riderName ? `${riderName} · ` : ''}${isStale(updatedAt) ? 'updating…' : freshness(updatedAt)}`
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
/**
 * The road still to ride: the kitchen-to-door line from the point nearest the rider.
 * A rider more than 150 m from every point has turned off it: a straight line from
 * them to the door until the server's re-drawn route arrives (round 3, item 7).
 * seniordev: nearest VERTEX, not nearest segment; Google's lines are dense enough.
 */
export function remainingRoad(road: Coords[], rider: Coords, door: Coords): Coords[] {
  if (road.length < 2) return [rider, door];
  let best = 0;
  let bestM = Infinity;
  road.forEach((p, i) => {
    const m = distanceMetres(p, rider);
    if (m < bestM) {
      bestM = m;
      best = i;
    }
  });
  return bestM > 150 ? [rider, door] : [rider, ...road.slice(best + 1)];
}

const NativeOrderMap: React.FC<{
  restaurant: Coords | null;
  rider: Coords | null;
  destination: Coords;
  carrying: boolean;
  bearing?: number | null;
  stale?: boolean;
  road: Coords[];
  /** Where the rider has been on this trip, drawn faint behind the bike. */
  trail?: Coords[];
  /** Full-screen map: the customer can pan and zoom; it follows the bike until they do. */
  interactive?: boolean;
  following?: boolean;
  onDrag?: () => void;
}> = ({ restaurant, rider, destination, carrying, bearing, stale, road, trail = [], interactive = false, following = true, onDrag }) => {
  /*
   * As the leading delivery apps draw it (owner, 19 Oct): the road from the
   * kitchen to the door, the kitchen and the home as labelled markers, and once
   * the food is collected the bike gliding along. The camera frames what matters
   * now: kitchen and home while cooking, the bike and home once it is on the way.
   */
  const line =
    carrying && rider
      ? remainingRoad(road, rider, destination)
      : road.length >= 2
        ? road
        : ([restaurant, destination].filter(Boolean) as Coords[]);
  const framed = (carrying && rider ? [rider, destination] : [restaurant ?? destination, destination]) as Coords[];
  const live = {
    latitude: (framed[0].latitude + destination.latitude) / 2,
    longitude: (framed[0].longitude + destination.longitude) / 2
  };
  // Once the customer moves the map it stays where they put it, until "Re-centre".
  const [held, setHeld] = useState(live);
  useEffect(() => {
    if (following) setHeld(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, live.latitude, live.longitude]);
  const centre = following ? live : held;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={interactive ? 'auto' : 'none'}>
      <MapCanvas
        style={StyleSheet.absoluteFill}
        centre={centre}
        spanMetres={400}
        fit={following ? framed : undefined}
        scrollEnabled={interactive}
        onDrag={onDrag}
      >
        {trail.length >= 2 ? <MapRoute id="trail" points={trail} colour="rgba(176,40,48,0.35)" width={5} /> : null}
        {/* A wide light casing under a darker line: reads as a road route on any background. */}
        <MapRoute id="route-casing" points={line} colour="rgba(255,255,255,0.9)" width={8} />
        <MapRoute id="route" points={line} colour={c.text.primary} width={4} />
        {restaurant ? (
          <MapPin id="kitchen" at={restaurant}>
            <View style={[styles.chip, { backgroundColor: c.primary[600] }]}>
              <Store size={14} color="#FFFFFF" />
            </View>
          </MapPin>
        ) : null}
        <MapPin id="home" at={destination}>
          <View style={[styles.chip, { backgroundColor: c.text.primary }]}>
            <Home size={14} color="#FFFFFF" />
          </View>
        </MapPin>
        {carrying && rider ? (
          <MapMovingPin id="rider" at={rider} rotation={bearing ?? 0}>
            <BikeMarker stale={stale} />
          </MapMovingPin>
        ) : null}
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
  restaurantName,
  roadKm,
  riderBearing,
  routePolyline,
  minutesAway
}) => {
  const W = 320;
  const H = 190;
  // Decoded once per line, not on every rider fix.
  const road = useMemo(() => (routePolyline ? decodePolyline(routePolyline) : []), [routePolyline]);

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
  // Where the rider has been since collecting the food, like a "Find My Device" trail.
  const [trail, setTrail] = useState<Coords[]>([]);
  useEffect(() => {
    if (!carrying || !rider) return;
    setTrail(prev => {
      const last = prev[prev.length - 1];
      return last && distanceMetres(last, rider) < 8 ? prev : [...prev, rider].slice(-400);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrying, rider?.latitude, rider?.longitude]);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);

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
    const mapProps = {
      restaurant,
      rider,
      destination,
      carrying,
      bearing: riderBearing,
      stale: carrying && isStale(updatedAt),
      road,
      trail
    };
    const legend = (
      <MapLegend
        metres={metres}
        carrying={carrying}
        updatedAt={updatedAt}
        riderName={riderName}
        restaurantName={restaurantName}
        roadKm={roadKm}
        minutesAway={minutesAway}
      />
    );
    return (
      <View>
        {/* Tap for the full-screen live map (round 3, item 7). */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            setFollowing(true);
            setExpanded(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Open the live map full screen"
        >
          <View style={[styles.mapFrame, { height: NATIVE_H }]}>
            <NativeOrderMap {...mapProps} />
            <View style={styles.expandHint}>
              <Maximize2 size={14} color={c.text.primary} />
            </View>
          </View>
        </TouchableOpacity>
        <Modal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)}>
          <View style={{ flex: 1, backgroundColor: c.surface.app }}>
            <View style={{ flex: 1 }}>
              <NativeOrderMap {...mapProps} interactive following={following} onDrag={() => setFollowing(false)} />
              <TouchableOpacity
                style={[styles.mapButton, { top: 16, left: 16 }]}
                onPress={() => setExpanded(false)}
                accessibilityRole="button"
                accessibilityLabel="Close the map"
              >
                <X size={20} color={c.text.primary} />
              </TouchableOpacity>
              {!following && (
                <TouchableOpacity style={[styles.mapButton, styles.recentre]} onPress={() => setFollowing(true)} accessibilityRole="button">
                  <LocateFixed size={18} color={c.text.primary} />
                  <Text style={styles.recentreText}>Re-centre</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ padding: 16 }}>{legend}</View>
          </View>
        </Modal>
        {legend}
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
        roadKm={roadKm}
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
  chip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }
  },
  expandHint: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  mapButton: {
    position: 'absolute',
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }
  },
  recentre: { bottom: 16, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  recentreText: { fontFamily: tokens.font.family, fontWeight: '700', color: c.text.primary },
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
  attributionText: { fontFamily: tokens.font.family, fontSize: 9, color: c.text.secondary },
  placeholder: {
    borderRadius: tokens.radii.md,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20
  },
  placeholderText: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.sm,
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
    fontFamily: tokens.font.family, fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary
  },
  freshness: { fontFamily: tokens.font.family, fontSize: tokens.font.size.xs, color: c.text.muted }
});
