import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { tokens } from '../theme/tokens';

const c = tokens.colors;

/**
 * Our delivery bike seen from above (master plan D5): a maroon scooter with an
 * amber delivery box, pointing north (the map turns it to the rider's heading).
 * Drawn here, not taken from any other app. Faded while the position is old.
 */
export const BikeMarker: React.FC<{ stale?: boolean }> = ({ stale }) => (
  <View style={[styles.wrap, stale && { opacity: 0.55 }]}>
    <Svg width={40} height={40} viewBox="0 0 40 40">
      <Circle cx="20" cy="20" r="19" fill="#FFFFFF" opacity={0.95} />
      {/* front wheel and handlebar */}
      <Rect x="18" y="5" width="4" height="7" rx="2" fill="#2B1D1D" />
      <Path d="M13 12.5h14" stroke={c.primary[600]} strokeWidth={2.4} strokeLinecap="round" />
      {/* body */}
      <Path d="M15.5 13h9l1.5 11h-12z" fill={c.primary[600]} />
      {/* rider's helmet */}
      <Circle cx="20" cy="18" r="3.6" fill={c.accent[500]} stroke="#FFFFFF" strokeWidth={1.2} />
      {/* delivery box */}
      <Rect x="13.5" y="24" width="13" height="9" rx="2" fill={c.accent[500]} stroke={c.primary[600]} strokeWidth={1.4} />
      {/* rear wheel */}
      <Rect x="18" y="33" width="4" height="4" rx="1.5" fill="#2B1D1D" />
    </Svg>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    width: 40,
    height: 40,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    borderRadius: 20
  }
});
