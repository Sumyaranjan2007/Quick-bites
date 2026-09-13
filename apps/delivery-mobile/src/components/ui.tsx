import React from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle
} from 'react-native';
import { Star } from 'lucide-react-native';
import { t } from '../theme';
import { initialsOf } from '../lib/format';

/* ---------------------------------- Card --------------------------------- */

export const Card: React.FC<{ children: React.ReactNode; style?: ViewStyle; tone?: 'default' | 'raised' }> = ({
  children,
  style,
  tone = 'default'
}) => (
  <View
    style={[
      s.card,
      tone === 'raised' && { backgroundColor: t.color.surfaceRaised, borderColor: t.color.borderStrong },
      style
    ]}
  >
    {children}
  </View>
);

/* -------------------------------- Headings -------------------------------- */

export const SectionTitle: React.FC<{ children: string; action?: string; onAction?: () => void; style?: ViewStyle }> = ({
  children,
  action,
  onAction,
  style
}) => (
  <View style={[s.sectionRow, style]}>
    <Text style={s.sectionTitle}>{children}</Text>
    {action ? (
      <TouchableOpacity onPress={onAction} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.sectionAction}>{action}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

/* --------------------------------- Button --------------------------------- */

export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'money';
  size?: 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}> = ({ label, onPress, variant = 'primary', size = 'md', icon, disabled, loading, style }) => {
  const palette: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: t.color.go, fg: '#04231A' },
    money: { bg: t.color.money, fg: '#3A2708' },
    secondary: { bg: t.color.surfaceRaised, fg: t.color.text, border: t.color.borderStrong },
    ghost: { bg: 'transparent', fg: t.color.textSecondary, border: t.color.border },
    danger: { bg: t.color.danger, fg: '#FFFFFF' }
  };
  const tone = palette[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        s.button,
        size === 'lg' && s.buttonLarge,
        { backgroundColor: tone.bg },
        tone.border ? { borderWidth: 1, borderColor: tone.border } : null,
        isDisabled && { opacity: 0.45 },
        style
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={tone.fg} size="small" />
      ) : (
        <>
          {icon}
          <Text
            style={[
              s.buttonLabel,
              size === 'lg' && { fontSize: t.font.size.md },
              { color: tone.fg },
              icon ? { marginLeft: 8 } : null
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

/* ---------------------------------- Pill ---------------------------------- */

export const Pill: React.FC<{
  label: string;
  tone?: 'go' | 'money' | 'danger' | 'neutral' | 'info';
  icon?: React.ReactNode;
  style?: ViewStyle;
}> = ({ label, tone = 'neutral', icon, style }) => {
  const map = {
    go: { bg: t.color.goSoft, fg: t.color.goText },
    money: { bg: t.color.moneySoft, fg: t.color.money },
    danger: { bg: t.color.dangerSoft, fg: t.color.danger },
    info: { bg: '#16294A', fg: t.color.info },
    neutral: { bg: t.color.surfaceRaised, fg: t.color.textSecondary }
  }[tone];

  return (
    <View style={[s.pill, { backgroundColor: map.bg }, style]}>
      {icon}
      <Text style={[s.pillText, { color: map.fg }, icon ? { marginLeft: 5 } : null]}>{label}</Text>
    </View>
  );
};

/* -------------------------------- StatTile -------------------------------- */

export const StatTile: React.FC<{
  label: string;
  value: string;
  caption?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'money' | 'go';
  onPress?: () => void;
  style?: ViewStyle;
}> = ({ label, value, caption, icon, tone = 'default', onPress, style }) => {
  const valueColor =
    tone === 'money' ? t.color.money : tone === 'go' ? t.color.goText : t.color.text;
  const body = (
    <View style={[s.statTile, style]}>
      <View style={s.statTileHead}>
        {icon}
        <Text style={[s.statLabel, icon ? { marginLeft: 6 } : null]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[s.statValue, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {caption ? <Text style={s.statCaption} numberOfLines={1}>{caption}</Text> : null}
    </View>
  );

  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={style}>
      {body}
    </TouchableOpacity>
  ) : (
    body
  );
};

/* ------------------------------- ProgressBar ------------------------------ */

export const ProgressBar: React.FC<{ value: number; max: number; tone?: string; height?: number }> = ({
  value,
  max,
  tone = t.color.go,
  height = 8
}) => {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <View style={[s.progressTrack, { height, borderRadius: height }]}>
      <View style={[s.progressFill, { width: `${pct * 100}%`, backgroundColor: tone, borderRadius: height }]} />
    </View>
  );
};

/* --------------------------------- Avatar --------------------------------- */

export const Avatar: React.FC<{ uri?: string; name?: string; size?: number; ring?: boolean }> = ({
  uri,
  name,
  size = 48,
  ring
}) => {
  const radius = size / 2;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: ring ? 2 : 0,
          borderColor: t.color.go
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: t.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? t.color.go : t.color.borderStrong
      }}
    >
      <Text style={{ color: t.color.text, fontWeight: t.font.weight.bold, fontSize: size * 0.34 }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
};

/* --------------------------------- Stars ---------------------------------- */

export const Stars: React.FC<{ value: number; size?: number }> = ({ value, size = 14 }) => (
  <View style={{ flexDirection: 'row' }}>
    {[1, 2, 3, 4, 5].map(index => (
      <Star
        key={index}
        size={size}
        color={t.color.money}
        fill={index <= Math.round(value) ? t.color.money : 'transparent'}
        strokeWidth={2}
        style={{ marginRight: 2 }}
      />
    ))}
  </View>
);

/* ------------------------------ Empty states ------------------------------ */

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
}> = ({ icon, title, message, action }) => (
  <View style={s.empty}>
    {icon ? <View style={s.emptyIcon}>{icon}</View> : null}
    <Text style={s.emptyTitle}>{title}</Text>
    <Text style={s.emptyMessage}>{message}</Text>
    {action ? <View style={{ marginTop: t.space[5], alignSelf: 'stretch' }}>{action}</View> : null}
  </View>
);

export const LoadingBlock: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={s.loading}>
    <ActivityIndicator color={t.color.go} />
    <Text style={s.loadingLabel}>{label}</Text>
  </View>
);

/* ------------------------------- Key/value -------------------------------- */

export const Row: React.FC<{ label: string; value?: string; valueStyle?: TextStyle; children?: React.ReactNode }> = ({
  label,
  value,
  valueStyle,
  children
}) => (
  <View style={s.row}>
    <Text style={s.rowLabel}>{label}</Text>
    {children ?? (
      <Text style={[s.rowValue, valueStyle]} numberOfLines={1}>
        {value || '—'}
      </Text>
    )}
  </View>
);

export const Divider: React.FC<{ style?: ViewStyle }> = ({ style }) => <View style={[s.divider, style]} />;

const s = StyleSheet.create({
  card: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space[4],
    ...t.shadow.card
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.space[3]
  },
  sectionTitle: {
    color: t.color.text,
    fontSize: t.font.size.md,
    fontWeight: t.font.weight.bold,
    letterSpacing: 0.2
  },
  sectionAction: { color: t.color.goText, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  button: {
    minHeight: 50,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: t.space[5]
  },
  buttonLarge: { minHeight: 58, borderRadius: t.radius.lg },
  buttonLabel: { fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.space[3],
    paddingVertical: 5,
    borderRadius: t.radius.full,
    alignSelf: 'flex-start'
  },
  pillText: { fontSize: t.font.size.xs, fontWeight: t.font.weight.bold, letterSpacing: 0.4 },
  statTile: {
    flex: 1,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space[3],
    minHeight: 92,
    justifyContent: 'space-between'
  },
  statTileHead: { flexDirection: 'row', alignItems: 'center' },
  statLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, fontWeight: t.font.weight.semibold, flex: 1 },
  statValue: { fontSize: t.font.size.xl, fontWeight: t.font.weight.extrabold, marginTop: t.space[2] },
  statCaption: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  progressTrack: { backgroundColor: t.color.surfaceSunken, overflow: 'hidden', width: '100%' },
  progressFill: { height: '100%' },
  empty: { alignItems: 'center', paddingVertical: t.space[10], paddingHorizontal: t.space[6] },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.space[4],
    borderWidth: 1,
    borderColor: t.color.border
  },
  emptyTitle: { color: t.color.text, fontSize: t.font.size.md, fontWeight: t.font.weight.bold, textAlign: 'center' },
  emptyMessage: {
    color: t.color.textMuted,
    fontSize: t.font.size.sm,
    textAlign: 'center',
    marginTop: t.space[2],
    lineHeight: 20
  },
  loading: { alignItems: 'center', paddingVertical: t.space[10] },
  loadingLabel: { color: t.color.textMuted, marginTop: t.space[3], fontSize: t.font.size.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: t.space[3]
  },
  rowLabel: { color: t.color.textMuted, fontSize: t.font.size.sm, marginRight: t.space[4] },
  rowValue: { color: t.color.text, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, flexShrink: 1 },
  divider: { height: 1, backgroundColor: t.color.border }
});
