import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Platform,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  type ViewStyle,
  type TextStyle
} from 'react-native';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { tokens, toneForStatus, humanise } from '../theme/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const c = tokens.colors;

/* --------------------------------- Screen --------------------------------- */

/**
 * The page frame every screen sits in.
 *
 * `SafeAreaView` only insets on iOS — on Android it renders as a plain View, so
 * the header drew underneath the status bar and the title collided with the
 * clock and the battery icon. The top inset is applied explicitly here from
 * `StatusBar.currentHeight`, and the bottom keeps content clear of the gesture
 * bar. Doing it in one component means no screen can forget it and drift back
 * under the system UI.
 *
 * Horizontal padding lives on the content, never on this frame, so a horizontally
 * scrolling rail can still bleed to both edges without the page itself scrolling
 * sideways.
 */
/**
 * The outermost frame of the console.
 *
 * Padded only at the top from `StatusBar.currentHeight`, which left the bottom
 * edge unreserved: on a three-button navigation phone Android's back, home and
 * recents keys sat on top of the console's own bottom row, and the last row of
 * every list was unreachable. Invisible on a gesture-navigation device, which
 * is why it survived.
 *
 * `useSafeAreaInsets` reports what the window manager actually says per edge and
 * re-renders when it changes — rotation, keyboard, or Android switching between
 * gesture and three-button navigation while the app is open.
 */
export const Screen: React.FC<{ children?: React.ReactNode; style?: ViewStyle }> = ({ children, style }) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        s.screen,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right
        },
        style
      ]}
    >
      <StatusBar barStyle="dark-content" backgroundColor={c.bg.base} translucent={false} />
      {children}
    </View>
  );
};

/* --------------------------------- Header --------------------------------- */

export const AppHeader: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}> = ({ title, subtitle, right, onBack }) => (
  <View style={s.header}>
    {onBack ? (
      <TouchableOpacity onPress={onBack} style={s.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={s.backChevron}>‹</Text>
      </TouchableOpacity>
    ) : null}
    {/* flexShrink lets a long title ellipsise instead of pushing the status
        pill off the right edge of the screen. */}
    <View style={s.headerText}>
      <Text style={s.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={s.headerSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
    {right ? <View style={s.headerRight}>{right}</View> : null}
  </View>
);

/* ------------------------------- Section rail ------------------------------ */

export interface RailItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
}

/**
 * The section switcher.
 *
 * The console has more sections than fit across a phone, and the previous fixed
 * row simply ran off the edge — the last tab was unreachable and clipped. A
 * horizontal ScrollView shows the overflow honestly and keeps the page itself
 * from scrolling sideways.
 */
export const SectionRail: React.FC<{
  items: RailItem[];
  active: string;
  onSelect: (key: string) => void;
  /**
   * 'group' renders the upper tier: the six groups, styled so the two rows
   * read as a hierarchy rather than as two equal strips of chips. Same
   * component rather than a second one, because two rails that drift apart in
   * appearance is how a two-tier nav starts looking like an accident.
   */
  variant?: 'section' | 'group';
}> = ({ items, active, onSelect, variant = 'section' }) => (
  <View style={[s.railWrap, variant === 'group' && s.railWrapGroup]}>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.railContent}
      keyboardShouldPersistTaps="handled"
    >
      {items.map(item => {
        const isActive = item.key === active;
        return (
          <TouchableOpacity
            key={item.key}
            style={[
              s.railItem,
              variant === 'group' && s.railItemGroup,
              isActive && (variant === 'group' ? s.railItemGroupActive : s.railItemActive)
            ]}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.8}
          >
            {item.icon}
            <Text
              style={[
                s.railLabel,
                variant === 'group' && s.railLabelGroup,
                isActive && s.railLabelActive
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.badge ? (
              <View style={s.railBadge}>
                <Text style={s.railBadgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  </View>
);

/* ---------------------------------- Card ---------------------------------- */

export const Card: React.FC<{
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  padded?: boolean;
}> = ({ children, style, onPress, padded = true }) => {
  const content = <View style={[s.card, padded && { padding: tokens.space[4] }, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {content}
    </TouchableOpacity>
  );
};

export const SectionTitle: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({
  title,
  subtitle,
  action
}) => (
  <View style={s.sectionTitleRow}>
    <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
      <Text style={s.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={s.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
    {action}
  </View>
);

/* -------------------------------- Stat tile -------------------------------- */

export const StatTile: React.FC<{
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'amber';
  onPress?: () => void;
  wide?: boolean;
}> = ({ label, value, hint, icon, tone = 'neutral', onPress, wide }) => {
  // The wash behind the icon and the colour of the figure are NOT the same
  // value, and treating them as one is what made the gold tiles unreadable:
  // #FFC928 is a fine 12%-opacity wash on white and about 1.7:1 as text on it,
  // which is a number you cannot read at a glance — on the one screen whose
  // entire job is numbers read at a glance.
  const wash =
    tone === 'amber'
      ? c.brand.amber
      : tone === 'success'
        ? c.state.success
        : tone === 'danger'
          ? c.state.danger
          : tone === 'warning'
            ? c.state.warning
            : tone === 'info'
              ? c.state.info
              : c.text.secondary;

  const accent = tone === 'amber' ? c.brand.amberText : wash;

  const body = (
    <View style={s.statTile}>
      <View style={s.statTop}>
        {icon ? <View style={[s.statIcon, { backgroundColor: `${wash}1F` }]}>{icon}</View> : null}
        <Text style={s.statLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <Text style={[s.statValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {hint ? (
        <Text style={s.statHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );

  // The width lives on the outer element, not the card. It used to be applied
  // only on the tappable branch, so a tile with no action stretched to the full
  // width of the grid and the row silently became a column.
  const width = wide ? ({ width: '100%' } as const) : s.statTouch;

  if (!onPress) return <View style={width}>{body}</View>;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={width}>
      {body}
    </TouchableOpacity>
  );
};

/* --------------------------------- Badge ---------------------------------- */

export const Badge: React.FC<{
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'amber';
  style?: ViewStyle;
}> = ({ label, tone, style }) => {
  const resolved = tone || toneForStatus(label);
  const map: Record<string, { bg: string; fg: string }> = {
    success: { bg: c.state.successBg, fg: c.state.success },
    warning: { bg: c.state.warningBg, fg: c.state.warning },
    danger: { bg: c.state.dangerBg, fg: c.state.danger },
    info: { bg: c.state.infoBg, fg: c.state.info },
    neutral: { bg: c.state.neutralBg, fg: c.state.neutral },
    amber: { bg: c.brand.amberSoft, fg: c.brand.amberText }
  };
  const palette = map[resolved] || map.neutral;
  return (
    <View style={[s.badge, { backgroundColor: palette.bg }, style]}>
      <Text style={[s.badgeText, { color: palette.fg }]} numberOfLines={1}>
        {/* Only a status token is reformatted. A role name like "Super Admin"
            is already written the way a person should read it, and running it
            through humanise turned it into "Super admin". */}
        {/^[A-Z0-9_]+$/.test(label) ? humanise(label) : label}
      </Text>
    </View>
  );
};

/* --------------------------------- Button --------------------------------- */

export const Button: React.FC<{
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}> = ({ label, onPress, variant = 'primary', size = 'md', disabled, loading, full, icon, style }) => {
  const palettes: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.brand.amber, fg: '#2A0710' },
    secondary: { bg: c.bg.card, fg: c.text.primary, border: c.border.medium },
    success: { bg: c.state.success, fg: '#06231A' },
    danger: { bg: c.state.dangerBg, fg: c.state.danger, border: '#5A2226' },
    ghost: { bg: 'transparent', fg: c.text.secondary }
  };
  const palette = palettes[variant];
  const heights = { sm: 36, md: 46, lg: 54 };

  return (
    <TouchableOpacity
      style={[
        s.button,
        {
          height: heights[size],
          backgroundColor: palette.bg,
          borderColor: palette.border || 'transparent',
          borderWidth: palette.border ? 1 : 0,
          opacity: disabled || loading ? 0.55 : 1
        },
        full && { flex: 1 },
        style
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              s.buttonText,
              { color: palette.fg, fontSize: size === 'sm' ? 13 : 15 },
              icon ? { marginLeft: 6 } : null
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

/* ---------------------------------- Field --------------------------------- */

export const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  hint?: string;
  error?: string;
}> = ({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, autoCapitalize, multiline, hint, error }) => (
  <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[s.input, multiline && s.inputMultiline, error ? { borderColor: c.state.danger } : null]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.text.muted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
    />
    {error ? <Text style={s.fieldError}>{error}</Text> : hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
  </View>
);

export const SearchBar: React.FC<{
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}> = ({ value, onChangeText, placeholder, onSubmit }) => (
  <View style={s.searchBar}>
    <Text style={s.searchIcon}>⌕</Text>
    <TextInput
      style={s.searchInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder || 'Search'}
      placeholderTextColor={c.text.muted}
      autoCapitalize="none"
      returnKeyType="search"
      onSubmitEditing={onSubmit}
    />
    {value ? (
      <TouchableOpacity onPress={() => onChangeText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={s.searchClear}>✕</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

/* --------------------------- Segmented control ---------------------------- */

export const Segmented: React.FC<{
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}> = ({ options, value, onChange }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.segmentScroll} contentContainerStyle={s.segmented}>
    {options.map(option => {
      const active = option.key === value;
      return (
        <TouchableOpacity
          key={option.key}
          style={[s.segment, active && s.segmentActive]}
          onPress={() => onChange(option.key)}
          activeOpacity={0.8}
        >
          <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>
            {option.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

/* --------------------------------- States --------------------------------- */

export const EmptyState: React.FC<{ title: string; message?: string; icon?: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  message,
  icon,
  action
}) => (
  <View style={s.emptyState}>
    {icon ? <View style={s.emptyIcon}>{icon}</View> : null}
    <Text style={s.emptyTitle}>{title}</Text>
    {message ? <Text style={s.emptyMessage}>{message}</Text> : null}
    {action ? <View style={{ marginTop: tokens.space[4] }}>{action}</View> : null}
  </View>
);

export const Loading: React.FC<{ label?: string }> = ({ label }) => (
  <View style={s.loading}>
    <ActivityIndicator color={c.brand.amber} />
    {label ? <Text style={s.loadingText}>{label}</Text> : null}
  </View>
);

/**
 * Shown where a screen would be if the account were allowed to see it.
 *
 * A blank page would read as a broken console. Naming the missing permission
 * turns "it doesn't work" into something an administrator can ask to be granted.
 */
export const NoAccess: React.FC<{ permission?: string }> = ({ permission }) => (
  <EmptyState
    title="Not available on your role"
    message={
      permission
        ? `This section needs the "${permission}" permission. Ask a Super Admin to add it to your role.`
        : 'Your admin role does not include this section.'
    }
  />
);

/* ----------------------------------- Row ---------------------------------- */

export const KeyValue: React.FC<{ label: string; value?: string | number | null; tone?: 'default' | 'strong' | 'money' }> = ({
  label,
  value,
  tone = 'default'
}) => (
  <View style={s.kvRow}>
    <Text style={s.kvLabel} numberOfLines={1}>
      {label}
    </Text>
    <Text
      style={[s.kvValue, tone === 'strong' && s.kvValueStrong, tone === 'money' && s.kvValueMoney]}
      numberOfLines={1}
    >
      {value === undefined || value === null || value === '' ? '—' : String(value)}
    </Text>
  </View>
);

export const Divider: React.FC<{ style?: ViewStyle }> = ({ style }) => <View style={[s.divider, style]} />;

/* ---------------------------------- Sheet --------------------------------- */

/** A bottom sheet, capped at 88% of the screen so it can never run off the top. */
export const Sheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ visible, onClose, title, subtitle, children, footer }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.sheetOverlay}
    >
      <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.sheetGrabber} />
        <View style={s.sheetHeader}>
          <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
            <Text style={s.sheetTitle} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={s.sheetSubtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.sheetClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={s.sheetBody}
          contentContainerStyle={{ paddingBottom: tokens.space[5] }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={s.sheetFooter}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  </Modal>
);

/* --------------------------------- Toggle --------------------------------- */

export const Toggle: React.FC<{ value: boolean; onChange: (next: boolean) => void; label?: string }> = ({
  value,
  onChange,
  label
}) => (
  <TouchableOpacity style={s.toggleRow} onPress={() => onChange(!value)} activeOpacity={0.8}>
    {label ? (
      <Text style={s.toggleLabel} numberOfLines={2}>
        {label}
      </Text>
    ) : null}
    <View style={[s.toggleTrack, value && s.toggleTrackOn]}>
      <View style={[s.toggleThumb, value && s.toggleThumbOn]} />
    </View>
  </TouchableOpacity>
);

export const CheckRow: React.FC<{
  checked: boolean;
  onToggle: () => void;
  title: string;
  description?: string;
}> = ({ checked, onToggle, title, description }) => (
  <TouchableOpacity style={s.checkRow} onPress={onToggle} activeOpacity={0.8}>
    <View style={[s.checkbox, checked && s.checkboxOn]}>{checked ? <Text style={s.checkMark}>✓</Text> : null}</View>
    <View style={{ flex: 1 }}>
      <Text style={s.checkTitle}>{title}</Text>
      {description ? <Text style={s.checkDescription}>{description}</Text> : null}
    </View>
  </TouchableOpacity>
);

/* -------------------------------- Sparkline ------------------------------- */

/**
 * The revenue trend.
 *
 * Drawn directly rather than pulled from a charting library: the app already
 * carries react-native-svg, and a fortnight of daily totals needs a path and two
 * gridlines, not a dependency.
 */
export const Sparkline: React.FC<{
  points: number[];
  labels?: string[];
  height?: number;
  width: number;
  color?: string;
}> = ({ points, labels, height = 120, width, color = tokens.colors.chart.line }) => {
  if (!points.length) return null;

  const padding = { top: 12, bottom: 18, left: 4, right: 4 };
  const chartHeight = height - padding.top - padding.bottom;
  const chartWidth = Math.max(1, width - padding.left - padding.right);
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;

  const coords = points.map((value, index) => {
    const x = padding.left + (index / Math.max(1, points.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - min) / span) * chartHeight;
    return { x, y };
  });

  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(padding.top + chartHeight).toFixed(
    1
  )} L${coords[0].x.toFixed(1)},${(padding.top + chartHeight).toFixed(1)} Z`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.28" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      <Line
        x1={padding.left}
        y1={padding.top + chartHeight}
        x2={width - padding.right}
        y2={padding.top + chartHeight}
        stroke={tokens.colors.chart.grid}
        strokeWidth={1}
      />
      <Line
        x1={padding.left}
        y1={padding.top}
        x2={width - padding.right}
        y2={padding.top}
        stroke={tokens.colors.chart.grid}
        strokeWidth={1}
        strokeDasharray="3 5"
      />
      <Path d={area} fill="url(#sparkFill)" />
      <Path d={line} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={3.5} fill={color} />
    </Svg>
  );
};

/** A labelled horizontal bar, for breakdowns that are shares of a whole. */
export const BarRow: React.FC<{ label: string; value: string; fraction: number; color?: string }> = ({
  label,
  value,
  fraction,
  color = tokens.colors.brand.amber
}) => (
  <View style={s.barRow}>
    <View style={s.barHeader}>
      <Text style={s.barLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={s.barValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
    <View style={s.barTrack}>
      <View
        style={[s.barFill, { width: `${Math.max(2, Math.min(100, fraction * 100))}%`, backgroundColor: color }]}
      />
    </View>
  </View>
);

/**
 * A failed load, said out loud. Renders nothing when nothing failed.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE ResourceState
 * -------------------------------------------------------------------------
 * `ResourceState` owns the whole rendering of a source and is the right answer for
 * a new screen. Fourteen sources across eleven existing screens were silent, and
 * those screens already work — their empty states, filters and merged views are
 * correct and in use. Rewriting all of them to hand rendering over to a component
 * would be a large change to working UI in order to fix one missing branch.
 *
 * So this is the one missing branch, in one line, with no restructuring: the error
 * becomes visible, and the screen keeps doing everything else it already does.
 *
 * It is always paired with suppressing the EMPTY state at the same site. Showing
 * "could not load" above "No restaurants yet" is better than silence and still
 * wrong: one of the two is a lie, and leaving both on screen makes the reader
 * choose which to believe.
 */
export const ResourceError: React.FC<{
  resource: { error: string | null; denied?: boolean; reload: () => Promise<void> | void };
  /** What could not be loaded, so a screen with several sources says which. */
  what?: string;
}> = ({ resource, what }) => {
  if (!resource.error) return null;
  return (
    <Card>
      <Text style={s.resourceErrorTitle}>
        {what ? `${what} could not be loaded` : 'This could not be loaded'}
      </Text>
      <Text style={s.resourceErrorBody}>{resource.error}</Text>
      <Text style={s.resourceErrorHint}>
        {resource.denied
          ? 'Your role does not include this.'
          : 'This is not the same as there being nothing here. Nothing has been lost.'}
      </Text>
      {!resource.denied && (
        <Button label="Try again" variant="secondary" onPress={() => void resource.reload()} />
      )}
    </Card>
  );
};

/**
 * The four states a loaded thing actually has, so they cannot be confused.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS REPLACES, IN FOURTEEN PLACES
 * -------------------------------------------------------------------------
 * `useResource` returns an `error` and renders nothing itself. There is no toast
 * and no global handler. So a screen that never reads `.error` turns a failed
 * request into `data === null`, and its own code renders that as an EMPTY LIST.
 *
 * Concretely, and this is the one the owner reported: if `/admin/rates/restaurants`
 * fails, the Inflation screen says "No restaurants yet". A 500 presented as good
 * news. That is worse than a crash — it needs no investigation, it provokes no
 * question, and the person reading it goes away satisfied that there is nothing
 * there.
 *
 * Fourteen sources across eleven screens did this. Writing the four branches by
 * hand in each is how they drifted apart in the first place, so they live here
 * once:
 *
 *   LOADING  — we are still asking.
 *   REFUSED  — this account may not see it. Different from a fault, and it names
 *              the permission so somebody can ask for it.
 *   FAILED   — we asked and could not get an answer. Says so, and offers a retry.
 *   EMPTY    — we asked, we got an answer, and the answer is genuinely nothing.
 *
 * FAILED and EMPTY are the two that were collapsed, and keeping them apart is the
 * whole purpose. "We could not reach the server" and "there is nothing here" look
 * identical on screen and mean opposite things.
 *
 * -------------------------------------------------------------------------
 * CHILDREN AS A FUNCTION, ON PURPOSE
 * -------------------------------------------------------------------------
 * The content receives `data` already narrowed to non-null. A component that took
 * plain children would leave every screen writing `resource.data!.rows`, and the
 * `!` is the assertion that was wrong in the first place.
 */
export const ResourceState = <T,>({
  resource,
  children,
  loadingLabel,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  isEmpty,
  permission
}: {
  resource: {
    data: T | null;
    loading: boolean;
    error: string | null;
    denied?: boolean;
    reload: () => Promise<void> | void;
  };
  children: (data: T) => React.ReactNode;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  /** Whether a successful answer is genuinely nothing. Absent means never empty. */
  isEmpty?: (data: T) => boolean;
  /** Named in the refusal, so somebody can ask for the right thing. */
  permission?: string;
}) => {
  /*
   * Loading only while there is nothing to show. A silent reload over content
   * that is already on screen must not blank it — an operator who pulls to refresh
   * and watches the page empty assumes they have lost their place.
   */
  if (resource.loading && resource.data === null) {
    return <Loading label={loadingLabel} />;
  }

  if (resource.denied) {
    return <NoAccess permission={permission} />;
  }

  if (resource.error) {
    return (
      <Card>
        <Text style={s.resourceErrorTitle}>This could not be loaded</Text>
        <Text style={s.resourceErrorBody}>{resource.error}</Text>
        {/*
          Said explicitly, because the wrong conclusion is the tempting one and it
          is the entire defect this component exists to remove.
        */}
        <Text style={s.resourceErrorHint}>
          This is not the same as there being nothing here. Nothing has been lost.
        </Text>
        <Button label="Try again" variant="secondary" onPress={() => void resource.reload()} />
      </Card>
    );
  }

  if (resource.data === null) {
    /*
     * Not loading, not refused, no error, and no data. It should not happen, and
     * saying so beats rendering an empty list — which is the exact lie this
     * component was built to stop telling.
     */
    return (
      <Card>
        <Text style={s.resourceErrorTitle}>Nothing came back</Text>
        <Text style={s.resourceErrorBody}>
          The server answered without any data. Pull down to ask again.
        </Text>
      </Card>
    );
  }

  if (isEmpty?.(resource.data)) {
    return (
      <EmptyState
        title={emptyTitle || 'Nothing here yet'}
        message={emptyMessage}
        icon={emptyIcon}
      />
    );
  }

  return <>{children(resource.data)}</>;
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg.base },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.space[5],
    paddingVertical: tokens.space[3],
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    backgroundColor: c.bg.base
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  headerSubtitle: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 2 },
  headerRight: { marginLeft: tokens.space[3], flexShrink: 0 },
  backButton: { paddingRight: tokens.space[3] },
  backChevron: { fontSize: 30, color: c.brand.maroon, lineHeight: 32 },

  railWrap: { borderBottomWidth: 1, borderBottomColor: c.border.subtle, backgroundColor: c.bg.raised },
  railContent: { paddingHorizontal: tokens.space[3], paddingVertical: tokens.space[2], gap: tokens.space[2] },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: tokens.space[3],
    paddingVertical: tokens.space[2],
    borderRadius: tokens.radius.pill,
    backgroundColor: 'transparent'
  },
  railItemActive: { backgroundColor: c.brand.amberSoft },
  // The group tier: no background fill, an underline on the active one. The
  // section tier keeps the filled chip, so at a glance the two rows are
  // obviously a heading and its contents rather than two sets of buttons.
  railWrapGroup: { borderBottomWidth: 0 },
  railItemGroup: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  railItemGroupActive: { borderBottomColor: c.brand.amberText, backgroundColor: 'transparent' },
  railLabelGroup: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold },
  railLabel: { fontSize: tokens.font.size.sm, color: c.text.secondary, fontWeight: tokens.font.weight.semibold },
  railLabelActive: { color: c.brand.amberText, fontWeight: tokens.font.weight.bold },
  railBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.state.danger,
    alignItems: 'center',
    justifyContent: 'center'
  },
  railBadgeText: { fontSize: 10, fontWeight: tokens.font.weight.heavy, color: '#2A0710' },

  card: {
    backgroundColor: c.bg.card,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: tokens.space[3]
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: tokens.space[3],
    marginTop: tokens.space[2]
  },
  sectionTitle: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  sectionSubtitle: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3, lineHeight: 16 },

  statTouch: { width: '48%' },
  statTile: {
    width: '100%',
    backgroundColor: c.bg.card,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: tokens.space[4],
    minHeight: 104,
    justifyContent: 'space-between'
  },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  statLabel: { flex: 1, fontSize: tokens.font.size.xs, color: c.text.secondary, lineHeight: 15 },
  statValue: { fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.heavy, marginTop: tokens.space[2] },
  statHint: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 3 },

  badge: {
    paddingHorizontal: tokens.space[2],
    paddingVertical: 3,
    borderRadius: tokens.radius.sm,
    alignSelf: 'flex-start',
    maxWidth: 180
  },
  badgeText: { fontSize: tokens.font.size.xxs, fontWeight: tokens.font.weight.heavy, letterSpacing: 0.3 },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space[4]
  },
  buttonText: { fontWeight: tokens.font.weight.bold },

  field: { marginBottom: tokens.space[4] },
  fieldLabel: {
    fontSize: tokens.font.size.xs,
    color: c.text.secondary,
    fontWeight: tokens.font.weight.semibold,
    marginBottom: 6,
    letterSpacing: 0.2
  },
  input: {
    backgroundColor: c.bg.sunken,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: c.border.medium,
    paddingHorizontal: tokens.space[4],
    height: 48,
    color: c.text.primary,
    fontSize: tokens.font.size.base
  },
  inputMultiline: { height: 104, paddingTop: tokens.space[3] },
  fieldHint: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 5 },
  fieldError: { fontSize: tokens.font.size.xxs, color: c.state.danger, marginTop: 5 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.sunken,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: tokens.space[3],
    height: 44,
    marginBottom: tokens.space[3]
  },
  searchIcon: { color: c.text.muted, fontSize: 18, marginRight: 8 },
  searchInput: { flex: 1, color: c.text.primary, fontSize: tokens.font.size.base, padding: 0 },
  searchClear: { color: c.text.muted, fontSize: 14, paddingHorizontal: 4 },

  segmentScroll: { marginBottom: tokens.space[3], flexGrow: 0 },
  segmented: { flexDirection: 'row', gap: tokens.space[2], paddingRight: tokens.space[4] },
  segment: {
    paddingHorizontal: tokens.space[4],
    paddingVertical: tokens.space[2],
    borderRadius: tokens.radius.pill,
    backgroundColor: c.bg.card,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  segmentActive: { backgroundColor: c.brand.amber, borderColor: c.brand.amber },
  segmentText: { fontSize: tokens.font.size.sm, color: c.text.secondary, fontWeight: tokens.font.weight.semibold },
  segmentTextActive: { color: '#2A0710', fontWeight: tokens.font.weight.bold },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: tokens.space[8],
    paddingHorizontal: tokens.space[5]
  },
  emptyIcon: { marginBottom: tokens.space[3], opacity: 0.9 },
  emptyTitle: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.bold,
    color: c.text.primary,
    textAlign: 'center'
  },
  emptyMessage: {
    fontSize: tokens.font.size.sm,
    color: c.text.muted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
    maxWidth: 300
  },

  loading: { paddingVertical: tokens.space[8], alignItems: 'center', gap: tokens.space[3] },
  loadingText: { color: c.text.muted, fontSize: tokens.font.size.sm },

  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: tokens.space[4]
  },
  // The label is the key to reading the row, so it keeps its space and the
  // value is what truncates. Letting both shrink turned "Dropping at" into
  // "Droppin…" next to an address that had plenty of room to be cut instead.
  kvLabel: { fontSize: tokens.font.size.sm, color: c.text.muted, flexShrink: 0, maxWidth: '45%' },
  kvValue: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.primary, textAlign: 'right' },
  kvValueStrong: { fontWeight: tokens.font.weight.bold },
  kvValueMoney: { fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },

  divider: { height: 1, backgroundColor: c.border.subtle, marginVertical: tokens.space[3] },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.bg.overlay },
  sheet: {
    backgroundColor: c.bg.raised,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    borderTopWidth: 1,
    borderColor: c.border.medium,
    maxHeight: '88%',
    paddingBottom: Platform.OS === 'ios' ? tokens.space[6] : tokens.space[4]
  },
  sheetGrabber: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginTop: tokens.space[3]
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: tokens.space[5],
    paddingTop: tokens.space[4],
    paddingBottom: tokens.space[3]
  },
  sheetTitle: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  sheetSubtitle: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3, lineHeight: 16 },
  sheetClose: { fontSize: 17, color: c.text.muted, paddingLeft: tokens.space[3] },
  sheetBody: { paddingHorizontal: tokens.space[5] },
  sheetFooter: {
    flexDirection: 'row',
    gap: tokens.space[3],
    paddingHorizontal: tokens.space[5],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[4] },
  toggleLabel: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.primary },
  toggleTrack: { width: 46, height: 27, borderRadius: 14, backgroundColor: c.bg.sunken, padding: 3, borderWidth: 1, borderColor: c.border.medium },
  toggleTrackOn: { backgroundColor: c.state.successBg, borderColor: c.state.success },
  toggleThumb: { width: 19, height: 19, borderRadius: 10, backgroundColor: c.text.muted },
  toggleThumbOn: { backgroundColor: c.state.success, transform: [{ translateX: 19 }] },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space[3], paddingVertical: tokens.space[2] },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1
  },
  checkboxOn: { backgroundColor: c.brand.amber, borderColor: c.brand.amber },
  checkMark: { color: '#2A0710', fontSize: 13, fontWeight: '800' },
  checkTitle: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold },
  checkDescription: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2, lineHeight: 15 },

  barRow: { marginBottom: tokens.space[3] },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: tokens.space[3] },
  barLabel: { fontSize: tokens.font.size.sm, color: c.text.secondary, flexShrink: 1 },
  barValue: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.bold },
  barTrack: { height: 7, borderRadius: 4, backgroundColor: c.bg.sunken, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  resourceErrorTitle: { color: c.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  resourceErrorBody: { color: c.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  resourceErrorHint: { color: c.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }
});

export const styles = s;
