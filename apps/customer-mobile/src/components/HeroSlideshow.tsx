import React, { useEffect, useState } from 'react';
import { Image as RNImage, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;
const SLIDE_MS = 5000;

/**
 * The sign-in screen's top (master plan D2): real photographs of food from OUR
 * partner kitchens (the public restaurant list), cross-fading slowly with a gentle
 * zoom, fading into the form below. No stock photo. Until photos arrive, or if
 * there are none, our brand colour and logo stand in. Still under reduce motion.
 */
export const HeroSlideshow: React.FC<{
  apiUrl: string;
  height: number;
  logo: ImageSourcePropType;
  tagline: string;
  onTouchEnd?: () => void;
}> = ({ apiUrl, height, logo, tagline, onTouchEnd }) => {
  const [photos, setPhotos] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();
  const zoom = useSharedValue(1);

  useEffect(() => {
    let alive = true;
    apiFetch(`${apiUrl}/restaurants`)
      .then(r => r.json())
      .then(data => {
        const all: string[] = (data?.data?.restaurants || [])
          .flatMap((r: any) => (Array.isArray(r.photos) && r.photos.length ? r.photos.slice(0, 1) : r.bannerUrl ? [r.bannerUrl] : []))
          .filter((u: unknown) => typeof u === 'string' && /^https?:|^data:image\//.test(u as string));
        if (alive) setPhotos(all.slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  useEffect(() => {
    if (photos.length < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % photos.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [photos.length]);

  useEffect(() => {
    if (reduce) return;
    zoom.value = withRepeat(withTiming(1.06, { duration: 6000, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduce, zoom]);
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));

  return (
    <View style={[styles.hero, { height }]} onTouchEnd={onTouchEnd}>
      {photos.length > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
          <Image source={{ uri: photos[index] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={600} cachePolicy="memory-disk" />
        </Animated.View>
      ) : null}
      {/* Dark fade from the photo into the cream form, so the type stays readable. */}
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.primary[700]} stopOpacity={photos.length ? 0.15 : 1} />
            <Stop offset="0.6" stopColor={c.primary[700]} stopOpacity={photos.length ? 0.45 : 1} />
            <Stop offset="1" stopColor={c.primary[900]} stopOpacity={photos.length ? 0.92 : 1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#fade)" />
      </Svg>
      <View style={styles.brand}>
        <View style={styles.logoFrame}>
          <RNImage source={logo} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.name}>Quick Bites</Text>
        <Text style={styles.tag}>{tagline}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', backgroundColor: c.primary[700], justifyContent: 'flex-end' },
  brand: { alignItems: 'center', paddingBottom: 28 },
  logoFrame: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  logo: { width: 46, height: 46 },
  name: { fontFamily: tokens.font.family, fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  tag: { fontFamily: tokens.font.family, fontSize: 14, color: '#FFE4C8', marginTop: 4 }
});
