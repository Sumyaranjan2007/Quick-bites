import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, G } from 'react-native-svg';
import { tokens } from '../theme/tokens';
import { Bike } from 'lucide-react-native';

const c = tokens.colors;

export interface Coords {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in metres. */
export function distanceMetres(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

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
  destination: Coords | null;
  updatedAt?: string | null;
  riderName?: string | null;
}

/**
 * Shows the rider closing on the delivery address using their real reported
 * position. This is a relative proximity view, not a street map — drawing real
 * streets needs a Maps provider key, and a decorative fake map would misrepresent
 * where the rider actually is.
 */
export const LiveRiderMap: React.FC<Props> = ({ rider, destination, updatedAt, riderName }) => {
  const W = 300;
  const H = 150;

  if (!rider || !destination) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          {rider
            ? 'Waiting for the delivery address position.'
            : 'Live location starts once your rider picks the order up.'}
        </Text>
      </View>
    );
  }

  const metres = distanceMetres(rider, destination);

  // Normalise the rider's offset from the destination into the drawing area,
  // clamped so a distant rider still renders at the edge rather than off-canvas.
  const scale = Math.max(metres, 120);
  const dx = ((rider.longitude - destination.longitude) / (scale / 111000)) || 0;
  const dy = ((rider.latitude - destination.latitude) / (scale / 111000)) || 0;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  const destX = W * 0.78;
  const destY = H * 0.5;
  const riderX = destX + clamp(dx) * (W * 0.3);
  const riderY = destY - clamp(dy) * (H * 0.3);

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Route between rider and destination */}
        <Line
          x1={riderX}
          y1={riderY}
          x2={destX}
          y2={destY}
          stroke={c.accent[500]}
          strokeWidth={2.5}
          strokeDasharray="6 5"
          strokeLinecap="round"
        />

        {/* Destination */}
        <G>
          <Circle cx={destX} cy={destY} r={16} fill={c.primary[50]} />
          <Path
            d={`M ${destX} ${destY - 8} l 7 7 v 8 h -14 v -8 z`}
            fill={c.primary[500]}
          />
        </G>

        {/* Rider */}
        <G>
          <Circle cx={riderX} cy={riderY} r={17} fill={c.accent[500]} opacity={0.25} />
          <Circle cx={riderX} cy={riderY} r={10} fill={c.accent[500]} />
          <Circle cx={riderX} cy={riderY} r={4} fill="#FFFFFF" />
        </G>
      </Svg>

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
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: {
    height: 92,
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
