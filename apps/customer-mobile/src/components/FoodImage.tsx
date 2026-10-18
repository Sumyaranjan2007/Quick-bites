import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { tokens } from '../theme/tokens';

const c = tokens.colors;

/**
 * Every food photo in the app (master plan D1): cached on the phone, fades in,
 * cropped to fill its frame. A missing or broken photo shows our own drawn plate
 * (a dish, in the veg green or non-veg red), never an empty box and never a
 * stock photo of food the kitchen does not serve.
 */
export const FoodImage: React.FC<{
  uri?: string | null;
  style?: StyleProp<ViewStyle>;
  isVeg?: boolean;
}> = ({ uri, style, isVeg }) => {
  const [broken, setBroken] = useState(false);
  if (!uri || broken) return <PlateArt style={style} isVeg={isVeg} />;
  return (
    <Image
      source={{ uri }}
      style={[styles.fill, style as any]}
      contentFit="cover"
      transition={250}
      cachePolicy="memory-disk"
      onError={() => setBroken(true)}
    />
  );
};

/** A plate seen from above with a cloche handle: our own art, tinted by diet. */
export const PlateArt: React.FC<{ style?: StyleProp<ViewStyle>; isVeg?: boolean }> = ({ style, isVeg }) => {
  const tint = isVeg === undefined ? c.primary[300] : isVeg ? c.dietary.veg : c.dietary.nonveg;
  return (
    <View style={[styles.fill, styles.art, style]}>
      <Svg width="60%" height="60%" viewBox="0 0 64 64">
        <Circle cx="32" cy="32" r="27" fill="#FFFFFF" opacity={0.9} />
        <Circle cx="32" cy="32" r="19" fill="none" stroke={tint} strokeWidth={2.5} opacity={0.55} />
        <Path d="M20 36c0-7 5.4-12 12-12s12 5 12 12z" fill={tint} opacity={0.85} />
        <Path d="M17 37h30" stroke={tint} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx="32" cy="22" r="2.2" fill={tint} />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { overflow: 'hidden' },
  art: { backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }
});
