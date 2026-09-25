import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';

/** Shared pieces, so every partner screen looks like the same product. */

export const Card: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

export const SectionHeading: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({
  title,
  sub,
  right
}) => (
  <View style={styles.sectionRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!sub && <Text style={styles.sectionSub}>{sub}</Text>}
    </View>
    {right}
  </View>
);

export const Pill: React.FC<{ label: string; tone?: 'brand' | 'success' | 'danger' | 'warning' | 'muted' }> = ({
  label,
  tone = 'muted'
}) => {
  const tones = {
    brand: { bg: c.brandSoft, fg: c.brand },
    success: { bg: c.successSoft, fg: c.success },
    danger: { bg: c.dangerSoft, fg: c.dangerText },
    warning: { bg: c.warningSoft, fg: '#7A4A00' },
    muted: { bg: c.border, fg: c.textSoft }
  } as const;
  const t = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
};

export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: any;
}> = ({ label, onPress, variant = 'primary', disabled, busy, style }) => (
  <TouchableOpacity
    style={[
      styles.button,
      variant === 'primary' && styles.buttonPrimary,
      variant === 'ghost' && styles.buttonGhost,
      variant === 'danger' && styles.buttonDanger,
      (disabled || busy) && styles.buttonDisabled,
      style
    ]}
    onPress={onPress}
    disabled={disabled || busy}
    activeOpacity={0.85}
  >
    {busy ? (
      <ActivityIndicator color={variant === 'ghost' ? c.brand : '#FFFFFF'} />
    ) : (
      <Text style={[styles.buttonText, variant === 'ghost' && { color: c.brand }]}>{label}</Text>
    )}
  </TouchableOpacity>
);

export const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  autoCapitalize?: any;
  multiline?: boolean;
  hint?: string;
  error?: string | null;
}> = ({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, multiline, hint, error }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.inputMultiline, !!error && styles.inputError]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      multiline={multiline}
    />
    {!!error && <Text style={styles.fieldError}>{error}</Text>}
    {!error && !!hint && <Text style={styles.fieldHint}>{hint}</Text>}
  </View>
);

/**
 * A password field with a reveal control.
 *
 * Typing a password blind on a phone keyboard is where most failed sign-ins come
 * from, so the eye is here rather than being an extra the screens each invent.
 */
export const PasswordField: React.FC<{
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  textContentType?: any;
}> = ({ label, value, onChangeText, placeholder, hint, error, textContentType }) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.passwordWrap, !!error && styles.inputError]}>
        <TextInput
          style={styles.passwordInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={textContentType}
        />
        <TouchableOpacity
          onPress={() => setVisible(v => !v)}
          style={styles.eyeBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={18} color={c.textMuted} /> : <Eye size={18} color={c.textMuted} />}
        </TouchableOpacity>
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
};

export const EmptyState: React.FC<{ title: string; body: string; action?: React.ReactNode }> = ({
  title,
  body,
  action
}) => (
  <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyBody}>{body}</Text>
    {!!action && <View style={{ marginTop: spacing.lg }}>{action}</View>}
  </View>
);

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <View style={styles.errorNote}>
    <Text style={styles.errorNoteText}>{message}</Text>
    {!!onRetry && (
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.errorNoteRetry}>Retry</Text>
      </TouchableOpacity>
    )}
  </View>
);

export const Metric: React.FC<{ label: string; value: string; sub?: string; tone?: 'brand' | 'plain' }> = ({
  label,
  value,
  sub,
  tone = 'plain'
}) => (
  <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={[styles.metricValue, tone === 'brand' && { color: c.brand }]}>{value}</Text>
    {!!sub && <Text style={styles.metricSub}>{sub}</Text>}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: spacing.md
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  sectionSub: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  button: { height: 50, borderRadius: radii.md, justifyContent: 'center', alignItems: 'center' },
  buttonPrimary: { backgroundColor: c.brand },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
  buttonDanger: { backgroundColor: c.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  field: { marginBottom: spacing.lg },
  fieldLabel: { fontSize: 13, color: c.textSoft, marginBottom: spacing.sm, fontWeight: '700' },
  input: {
    backgroundColor: c.bg,
    borderRadius: radii.md,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    color: c.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: c.border
  },
  inputMultiline: { paddingTop: spacing.md, textAlignVertical: 'top', minHeight: 96 },
  inputError: { borderColor: c.danger },
  fieldError: { color: c.danger, fontSize: 12, marginTop: 6 },
  fieldHint: { color: c.textMuted, fontSize: 12, marginTop: 6 },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingRight: spacing.md
  },
  passwordInput: { flex: 1, height: 50, paddingHorizontal: spacing.lg, color: c.text, fontSize: 15 },
  eyeBtn: { padding: 6 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 6, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
  errorNote: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  errorNoteText: { color: c.dangerText, fontSize: 13, flex: 1, lineHeight: 18 },
  errorNoteRetry: { color: c.brand, fontSize: 13, fontWeight: '800' },
  metric: { flex: 1, minWidth: 140 },
  metricLabel: { fontSize: 11, color: c.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { fontSize: 22, fontWeight: '800', color: c.text, marginTop: 4 },
  metricSub: { fontSize: 12, color: c.textMuted, marginTop: 2 }
});
