import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, type ViewStyle } from 'react-native';

import { tokens } from '../theme/tokens';

const c = tokens.colors;

/**
 * What a customer actually sees of a restaurant.
 *
 * This replaced `<View style={{ backgroundColor: sunken }} />` — a grey
 * rectangle, on almost every card in the feed, because `bannerUrl` was
 * display-only and no screen in the partner app could ever set one.
 *
 * Three states, in order, decided by the server and rendered here:
 *
 *   photographs   the partner's own cover and gallery, then photographs of
 *                 their own food from their own menu
 *   slideshow     when there is more than one, they cross-fade slowly
 *   placeholder   the restaurant's initials on a colour derived from its id
 *
 * The placeholder is drawn rather than fetched, and it is deliberately not a
 * stock photograph. A picture of somebody else's biryani on a kitchen that
 * does not serve it is a small lie told at the exact moment a customer is
 * deciding where to spend money. Initials on a colour are obviously a
 * placeholder, and nobody is misled by them.
 */

export interface RestaurantPhotoProps {
  photos?: string[];
  placeholder?: { initials: string; colour: string };
  /** Fallback for older payloads that carry only the single cover field. */
  bannerUrl?: string;
  name?: string;
  style?: ViewStyle | ViewStyle[];
  /** Off in lists that scroll fast; on for the one hero the customer is reading. */
  animate?: boolean;
  radius?: number;
}

/** Slow enough to read as a photograph, not as a carousel demanding attention. */
const SLIDE_MS = 4200;
const FADE_MS = 600;

function initialsFrom(name?: string): string {
  const words = String(name || '')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export const RestaurantPhoto: React.FC<RestaurantPhotoProps> = ({
  photos,
  placeholder,
  bannerUrl,
  name,
  style,
  animate = false,
  radius
}) => {
  /*
   * A photograph that fails to load must not leave the card empty.
   *
   * Data URIs come from partner phones and can be truncated by a bad upload;
   * https URLs can 404 long after they were approved. Either way the answer is
   * to drop that one image and carry on, not to show a broken-image box — so
   * failures are remembered and the list is filtered by them.
   */
  const [broken, setBroken] = useState<Record<string, true>>({});

  const supplied = (photos && photos.length > 0 ? photos : bannerUrl ? [bannerUrl] : []).filter(
    uri => typeof uri === 'string' && uri.length > 0 && !broken[uri]
  );

  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  const count = supplied.length;

  useEffect(() => {
    // Only a real slideshow animates, and only where it was asked for. A feed
    // of twenty cross-fading cards is a feed nobody can read.
    if (!animate || count < 2) return;

    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => {
        setIndex(i => (i + 1) % count);
        Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      });
    }, SLIDE_MS);

    return () => clearInterval(timer);
  }, [animate, count, fade]);

  useEffect(() => {
    // The list can shrink when an image fails; without this the index can sit
    // past the end and nothing renders at all.
    if (index >= count) setIndex(0);
  }, [count, index]);

  const shape = [styles.base, radius !== undefined ? { borderRadius: radius } : null, style];

  if (count === 0) {
    const colour = placeholder?.colour || c.surface.sunken;
    const letters = placeholder?.initials || initialsFrom(name);
    return (
      <View style={[...shape, { backgroundColor: colour }, styles.centre]}>
        <Text style={styles.initials}>{letters}</Text>
      </View>
    );
  }

  const uri = supplied[Math.min(index, count - 1)]!;

  return (
    <View style={[...shape, styles.clip]}>
      <Animated.Image
        // Keyed on the uri so React replaces the element rather than reusing
        // one whose source changed mid-fade, which shows the new photograph at
        // the old one's opacity.
        key={uri}
        source={{ uri }}
        style={[styles.fill, animate && count > 1 ? { opacity: fade } : null]}
        resizeMode="cover"
        onError={() => setBroken(b => ({ ...b, [uri]: true }))}
      />

      {count > 1 && animate && (
        <View style={styles.dots}>
          {supplied.map((u, i) => (
            <View key={u} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { width: '100%', height: 172, backgroundColor: c.surface.sunken, overflow: 'hidden' },
  clip: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  initials: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 1.5,
    opacity: 0.92
  },
  dots: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)'
  },
  dotOn: { backgroundColor: '#FFFFFF' }
});

export default RestaurantPhoto;
