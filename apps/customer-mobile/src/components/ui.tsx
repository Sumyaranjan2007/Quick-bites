import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { tokens } from '../theme/tokens';
import { PressableScale } from './PressableScale';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

const c = tokens.colors;

/* ---------------------------------- Card --------------------------------- */

export const Card: React.FC<{ children: React.ReactNode; style?: ViewStyle; padded?: boolean }> = ({
  children,
  style,
  padded = true
}) => <View style={[s.card, padded && { padding: tokens.spacing[4] }, style]}>{children}</View>;

/* ------------------------------ KeyboardLift ------------------------------ */

/**
 * Wraps a bottom sheet that has a text field, so the iPhone keyboard pushes the
 * sheet up instead of covering the field. Android resizes the window for the
 * keyboard itself, so there this is a plain full-size View and nothing changes.
 */
export const KeyboardLift: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {children}
  </KeyboardAvoidingView>
);

/* --------------------------------- Section -------------------------------- */

export const SectionHeader: React.FC<{ title: string; action?: string; onAction?: () => void }> = ({
  title,
  action,
  onAction
}) => (
  <View style={s.sectionHeader}>
    <Text style={s.sectionTitle}>{title}</Text>
    {action ? (
      <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.sectionAction}>{action}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

/* ---------------------------------- Chip ---------------------------------- */

export const Chip: React.FC<{
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
}> = ({ label, active, onPress, icon }) => (
  <TouchableOpacity
    style={[s.chip, active && s.chipActive]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    {icon}
    <Text style={[s.chipText, active && s.chipTextActive, icon ? { marginLeft: 6 } : null]}>{label}</Text>
  </TouchableOpacity>
);

/* --------------------------------- Badges --------------------------------- */

/** The small square veg / non-veg marker used across Indian food apps. */
export const DietMark: React.FC<{ isVeg: boolean; size?: number }> = ({ isVeg, size = 14 }) => (
  <View
    style={[
      s.dietMark,
      {
        width: size,
        height: size,
        borderColor: isVeg ? c.dietary.veg : c.dietary.nonveg
      }
    ]}
  >
    <View
      style={{
        width: size * 0.5,
        height: size * 0.5,
        borderRadius: isVeg ? size : 0,
        backgroundColor: isVeg ? c.dietary.veg : c.dietary.nonveg
      }}
    />
  </View>
);

/**
 * A restaurant nobody has rated yet says "New" rather than "★ 0.0", which
 * reads as a terrible score, not an absent one.
 */
export const RatingBadge: React.FC<{ value: number; count?: number; compact?: boolean }> = ({
  value,
  count,
  compact
}) => (
  <View style={s.ratingRow}>
    <View style={s.ratingBadge}>
      {count ? (
        <>
          <Text style={s.ratingStar}>★</Text>
          <Text style={s.ratingValue}>{value.toFixed(1)}</Text>
        </>
      ) : (
        <Text style={s.ratingValue}>New</Text>
      )}
    </View>
    {!compact && count ? (
      <Text style={s.ratingCount}>
        ({count >= 1000 ? `${(count / 1000).toFixed(1)}K+` : count})
      </Text>
    ) : null}
  </View>
);

export const Pill: React.FC<{
  label: string;
  tone?: 'veg' | 'nonveg' | 'gold' | 'neutral' | 'accent';
  style?: ViewStyle;
}> = ({ label, tone = 'neutral', style }) => {
  const map = {
    veg: { bg: c.dietary.vegBg, fg: c.dietary.veg },
    nonveg: { bg: c.dietary.nonvegBg, fg: c.dietary.nonveg },
    gold: { bg: c.dietary.goldBg, fg: c.dietary.gold },
    accent: { bg: c.accent[50], fg: c.accent[600] },
    neutral: { bg: c.surface.sunken, fg: c.text.secondary }
  }[tone];
  return (
    <View style={[s.pill, { backgroundColor: map.bg }, style]}>
      <Text style={[s.pillText, { color: map.fg }]}>{label}</Text>
    </View>
  );
};

/* --------------------------------- Button --------------------------------- */

export const Button: React.FC<{
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'accent' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
  disabled?: boolean;
  loading?: boolean;
  left?: React.ReactNode;
  style?: ViewStyle;
}> = ({ label, onPress, variant = 'primary', size = 'md', full, disabled, loading, left, style }) => {
  const tone = {
    primary: { bg: c.primary[600], fg: c.text.inverse, border: 'transparent' },
    accent: { bg: c.accent[500], fg: c.text.onAccent, border: 'transparent' },
    outline: { bg: 'transparent', fg: c.primary[600], border: c.border.medium },
    ghost: { bg: c.surface.sunken, fg: c.text.primary, border: 'transparent' }
  }[variant];

  const dims = {
    sm: { h: 36, px: 14, fs: tokens.font.size.sm },
    md: { h: 46, px: 18, fs: tokens.font.size.base },
    lg: { h: 54, px: 22, fs: tokens.font.size.md }
  }[size];

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        s.button,
        {
          backgroundColor: tone.bg,
          borderColor: tone.border,
          borderWidth: variant === 'outline' ? 1 : 0,
          height: dims.h,
          paddingHorizontal: dims.px,
          opacity: disabled || loading ? 0.55 : 1,
          alignSelf: full ? 'stretch' : 'flex-start'
        },
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone.fg} size="small" />
      ) : (
        <>
          {left}
          <Text style={[s.buttonText, { color: tone.fg, fontFamily: tokens.font.family, fontSize: dims.fs }, left ? { marginLeft: 8 } : null]}>
            {label}
          </Text>
        </>
      )}
    </PressableScale>
  );
};

/* ------------------------------- State views ------------------------------ */

export const EmptyState: React.FC<{
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}> = ({ title, subtitle, action, onAction, icon }) => (
  <View style={s.stateBox}>
    {icon}
    <Text style={s.stateTitle}>{title}</Text>
    {subtitle ? <Text style={s.stateSubtitle}>{subtitle}</Text> : null}
    {action && onAction ? <Button label={action} onPress={onAction} variant="outline" size="sm" style={{ marginTop: 14 }} /> : null}
  </View>
);

export const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={s.stateBox}>
    <ActivityIndicator color={c.primary[500]} />
    <Text style={[s.stateSubtitle, { marginTop: 10 }]}>{label}</Text>
  </View>
);

/** Skeleton block for photo-heavy lists, so first paint isn't an empty page. */
export const Skeleton: React.FC<{ height: number; radius?: number; style?: ViewStyle }> = ({
  height,
  radius = tokens.radii.lg,
  style
}) => {
  // A soft pulse while loading (design/motion "skeleton"); still when the phone asks for less motion.
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  React.useEffect(() => {
    if (reduce) return;
    opacity.value = withRepeat(withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduce, opacity]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ height, borderRadius: radius, backgroundColor: c.surface.sunken }, style, pulse]} />;
};

const s = StyleSheet.create({
  fill: { flex: 1 },
  card: {
    backgroundColor: c.surface.card,
    borderRadius: tokens.radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    ...tokens.shadow.card
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacing[3]
  },
  sectionTitle: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    letterSpacing: -0.3
  },
  sectionAction: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: c.text.secondary
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: tokens.radii.full,
    backgroundColor: c.surface.card,
    borderWidth: 1,
    borderColor: c.border.medium
  },
  chipActive: { backgroundColor: c.primary[600], borderColor: c.primary[600] },
  chipText: { fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold, color: c.text.secondary },
  chipTextActive: { color: c.text.inverse },
  dietMark: {
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center'
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.rating.base,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6
  },
  ratingStar: { color: c.rating.text, fontFamily: tokens.font.family, fontSize: 10, marginRight: 3 },
  ratingValue: { color: c.rating.text, fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold },
  ratingCount: { color: c.text.muted, fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, marginLeft: 6 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  pillText: { fontFamily: tokens.font.family, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.bold, letterSpacing: 0.2 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radii.md
  },
  buttonText: { fontWeight: tokens.font.weight.bold, letterSpacing: 0.1 },
  stateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  stateTitle: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.bold,
    color: c.text.primary,
    marginTop: 10,
    textAlign: 'center'
  },
  stateSubtitle: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.sm,
    color: c.text.secondary,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 19
  }
});
