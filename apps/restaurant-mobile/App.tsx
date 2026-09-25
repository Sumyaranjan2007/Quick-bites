import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeScreen } from './src/components/SafeScreen';
import { LayoutDashboard, Bell, Layers, Wallet, MoreHorizontal, ShieldCheck } from 'lucide-react-native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { c, radii, spacing } from './src/theme';
import {
  configureApi,
  currentApiUrl,
  fetchOwnedRestaurant,
  setKitchenOpen,
  setSessionEndedHandler
} from './src/lib/partnerApi';
import { useLiveUpdates } from './src/lib/useLiveUpdates';
import {
  prepareOrderAlerts,
  releaseOrderAlerts,
  stopOrderAlert,
  announceOrder
} from './src/lib/orderAlert';
import { SignInScreen } from './src/screens/SignInScreen';
import { SettlementsScreen } from './src/screens/SettlementsScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LiveOrdersScreen } from './src/screens/LiveOrdersScreen';
import { OrderHistoryScreen } from './src/screens/OrderHistoryScreen';
import { MenuScreen } from './src/screens/MenuScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { PayoutAccountScreen } from './src/screens/PayoutAccountScreen';
import { EarningsStatementScreen } from './src/screens/EarningsStatementScreen';
import { ProfileEditScreen } from './src/screens/ProfileEditScreen';
import { registerForPush, unregisterForPush } from './src/lib/pushRegistration';
import { HelpCentreScreen } from './src/screens/HelpCentreScreen';
import { ErrorNote } from './src/components/ui';
import { useHardwareBackWithExitConfirm } from './src/lib/useHardwareBack';
import { loadStoredSession, saveStoredSession, clearStoredSession } from './src/lib/storedSession';

import { DEFAULT_API_URL } from './src/config';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Tab =
  | 'dashboard'
  | 'orders'
  | 'history'
  | 'menu'
  | 'documents'
  | 'help'
  | 'settlements'
  | 'bank'
  | 'statement'
  | 'profile';

/*
 * FIVE GROUPS, ALL ON SCREEN (QA #10 and #13, 26 Sep).
 *
 * Ten tabs used to sit in one sideways-scrolling bar. Menu, Profile, Docs and
 * Help were off the right edge with nothing to say they were there, and that
 * bar was the one scrolling view mounted for the app's whole life — the
 * kitchen app that froze after hours, redrawing continuously and ignoring
 * taps, had nothing else always on screen that could keep drawing. A bar that
 * cannot scroll can neither hide a tab nor get stuck mid-fling.
 *
 * So the bottom bar is five fixed groups, and a group with more than one page
 * shows its pages as a fixed row at the top. Every page is at most two taps
 * away, and every label is always visible.
 */
const GROUPS: Array<{ key: string; label: string; icon: any; tabs: Array<{ key: Tab; label: string }> }> = [
  { key: 'home', label: 'Home', icon: LayoutDashboard, tabs: [{ key: 'dashboard', label: 'Home' }] },
  {
    key: 'orders',
    label: 'Orders',
    icon: Bell,
    tabs: [
      { key: 'orders', label: 'Live orders' },
      { key: 'history', label: 'History' }
    ]
  },
  { key: 'menu', label: 'Menu', icon: Layers, tabs: [{ key: 'menu', label: 'Menu' }] },
  {
    key: 'money',
    label: 'Money',
    icon: Wallet,
    // Payouts is what the partner is OWED; Statement is why it is that much,
    // order by order; Bank is the account it is paid into.
    tabs: [
      { key: 'settlements', label: 'Payouts' },
      { key: 'statement', label: 'Statement' },
      { key: 'bank', label: 'Bank' }
    ]
  },
  {
    key: 'more',
    label: 'More',
    icon: MoreHorizontal,
    tabs: [
      { key: 'profile', label: 'Profile' },
      { key: 'documents', label: 'Docs' },
      { key: 'help', label: 'Help' }
    ]
  }
];

const groupOf = (tab: Tab) => GROUPS.find(g => g.tabs.some(t => t.key === tab)) || GROUPS[0];

/**
 * The partner app shell.
 *
 * Each tab owns its own scroll container. The previous version wrapped all four
 * tabs in one shared ScrollView, so the scroll offset carried between them and
 * was re-clamped whenever a background refresh changed the content height — which
 * is what the partner saw as the page jumping back to the top.
 */
function PartnerApp() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any | null>(null);
  // Null while the stored session is read, so the sign-in screen does not flash
  // at an owner who is already signed in.
  const [restoringSession, setRestoringSession] = useState(true);
  const [restaurant, setRestaurant] = useState<any | null>(null);

  const [tab, setTab] = useState<Tab>('dashboard');

  // Any tab but the dashboard returns to it; the dashboard leaves the app.
  // Previously the gesture closed the app from wherever the kitchen happened
  // to be, mid-service.
  useHardwareBackWithExitConfirm(
    useCallback(() => {
      if (tab !== 'dashboard') {
        setTab('dashboard');
        return true;
      }
      return false;
    }, [tab])
  );
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [togglingKitchen, setTogglingKitchen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  /*
   * Read through a ref inside the socket callback.
   *
   * useLiveUpdates keeps the handler it was given at registration, so a
   * callback closing over `soundEnabled` would go on using whatever the value
   * was when the socket connected — silencing a kitchen that had turned sound
   * back on, and ringing for one that had turned it off.
   */
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  /** Incremented on every live event, so screens can refresh without remounting. */
  const [refreshSignal, setRefreshSignal] = useState(0);

  const loadProfile = useCallback(async (ownerId: string) => {
    setLoadingProfile(true);
    const res = await fetchOwnedRestaurant(ownerId);
    setLoadingProfile(false);

    if (!res.ok || !res.data?.restaurant) {
      // No restaurant linked is a real state, not an error to hide: a newly
      // registered owner has an account before they have an approved kitchen.
      setProfileError(
        res.message ||
          'No restaurant is linked to this account yet. Our team links your kitchen once your documents are verified.'
      );
      return;
    }
    setProfileError(null);
    setRestaurant(res.data.restaurant);
  }, []);

  // Restores the previous sign-in. A kitchen that gets closed by Android in the
  // middle of service should come back to its orders, not to a password prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredSession();
      if (!cancelled && stored) {
        configureApi(stored.apiUrl, stored.token);
        setToken(stored.token);
        setUser(stored.user);
        await prepareOrderAlerts();
        // Not awaited: a kitchen phone must reach its dashboard whether or not
        // a push service answers.
        void registerForPush(stored.token);
        if (stored.user?.id) await loadProfile(stored.user.id);
      }
      if (!cancelled) setRestoringSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignedIn = async (nextToken: string, nextUser: any) => {
    // currentApiUrl(), not DEFAULT_API_URL: the sign-in screen's Server settings
    // may have pointed this install at another backend, and forcing the default
    // back here would send every authenticated call to a server the token is not
    // valid for.
    configureApi(currentApiUrl(), nextToken);
    setToken(nextToken);
    setUser(nextUser);
    void saveStoredSession({ token: nextToken, user: nextUser, apiUrl: currentApiUrl() });
    await prepareOrderAlerts();
    void registerForPush(nextToken);
    if (nextUser?.id) await loadProfile(nextUser.id);
  };

  const signOut = async () => {
    // Unregistered BEFORE the token is cleared, because the request needs it.
    // A kitchen phone changes hands between shifts and the partner going home
    // must stop receiving that restaurant's orders now, not whenever the push
    // token happens to fail on its own.
    await unregisterForPush(token);
    // Cleared first: a sign-out that leaves the token on the device is not one.
    await clearStoredSession();
    await releaseOrderAlerts();
    configureApi(currentApiUrl(), '');
    setToken('');
    setUser(null);
    setRestaurant(null);
    setTab('dashboard');
  };

  /*
   * An account blocked while the app is open.
   *
   * Blocking applies to the session a partner already has, so the refusal
   * arrives on whatever request they happen to make next — a dashboard
   * refresh, a status change, anything. Leaving them inside the app produces
   * the same red banner on every tap and no way to understand it, so the
   * session ends and the server's own words are shown once.
   */
  useEffect(() => {
    setSessionEndedHandler(({ message }) => {
      Alert.alert('You have been signed out', message);
      void signOut();
    });
    return () => setSessionEndedHandler(null);
    // signOut closes over stable setters only, so this registers once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * THE KITCHEN IS TOLD ABOUT AN ORDER FROM HERE, not from the Orders tab.
   *
   * The alert used to live inside LiveOrdersScreen, which React mounts only
   * while that tab is selected. A phone propped by the pass sits on the
   * dashboard — the tab this app opens on — so the one screen that could ring
   * was the one nobody was looking at, and an order arrived in silence.
   *
   * The socket already delivered `order:created`, with the whole order in the
   * payload, to this exact callback. It was discarded: the handler bumped a
   * counter and threw the event away. Everything needed to ring was arriving
   * and being dropped one line above where it was needed.
   *
   * Ringing is deduplicated inside orderAlert, so the Orders tab's polling
   * fallback — which still matters on the mobile networks where websockets are
   * blocked — cannot ring for the same order a second time.
   */
  const { connected } = useLiveUpdates(
    token && restaurant?.id ? { kind: 'restaurant', restaurantId: restaurant.id } : null,
    currentApiUrl(),
    token,
    (event, payload) => {
      setRefreshSignal(n => n + 1);

      if (event !== 'order:created') return;
      const order = payload?.order;
      if (!order?.id || !soundEnabledRef.current) return;

      void announceOrder({
        id: order.id,
        orderNumber: order.orderNumber,
        itemCount: (order.items || []).length,
        total: Number(order.bill?.totalAmount) || 0
      });
    }
  );

  const toggleKitchen = async () => {
    if (!restaurant) return;
    const next = !restaurant.isOpen;

    /*
     * Say why, here, rather than sending a request that will be refused.
     *
     * The server refuses this too — `POST /restaurants/:id/kitchen-status` is
     * the control, and hiding a button is a courtesy, not one. But a partner
     * who taps Online and gets a red banner has learnt nothing about what to
     * do next, and the answer is always the same: finish verification.
     */
    if (next && restaurant.status !== 'ACTIVE') {
      setProfileError(
        restaurant.status === 'SUSPENDED'
          ? 'Your restaurant is suspended, so it cannot go online. Contact Quick Bites support.'
          : restaurant.status === 'CLOSED'
            ? 'This restaurant is closed on the platform and cannot go online.'
            : 'Your restaurant is still being verified. Send your documents from the Docs tab — you can go online once our team approves them.'
      );
      setTab(restaurant.status === 'PENDING_APPROVAL' ? 'documents' : 'help');
      return;
    }

    setTogglingKitchen(true);
    const res = await setKitchenOpen(restaurant.id, next);
    setTogglingKitchen(false);

    if (!res.ok) {
      setProfileError(res.message || 'Could not change your kitchen status.');
      return;
    }
    // Trust the server's answer rather than assuming the toggle took. The old
    // version set local state optimistically and never persisted, which is why it
    // showed Online after being switched to Offline.
    setProfileError(null);
    setRestaurant((r: any) => ({ ...r, isOpen: res.data?.isOpen ?? next }));
    if (!next) stopOrderAlert();
  };

  useEffect(() => {
    return () => {
      releaseOrderAlerts();
    };
  }, []);

  if (restoringSession) {
    return (
      <SafeScreen style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={c.bg} />
      </SafeScreen>
    );
  }

  if (!token) {
    return (
      <SafeScreen style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={c.bg} />
        <SignInScreen onSignedIn={onSignedIn} />
      </SafeScreen>
    );
  }

  if (loadingProfile) {
    return (
      <SafeScreen style={[styles.safe, styles.centre]}>
        <ActivityIndicator color={c.brand} size="large" />
      </SafeScreen>
    );
  }

  if (!restaurant) {
    return (
      <SafeScreen style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={c.bg} />
        <View style={styles.blocked}>
          <ShieldCheck size={40} color={c.warning} />
          <Text style={styles.blockedTitle}>Kitchen not linked yet</Text>
          <Text style={styles.blockedBody}>{profileError}</Text>
          <TouchableOpacity style={styles.blockedBtn} onPress={signOut}>
            <Text style={styles.blockedBtnText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeScreen>
    );
  }

  const open = Boolean(restaurant.isOpen);
  /*
   * "Offline" means "you could be online". For a kitchen that has not been
   * approved it is the wrong word: nothing the partner does to this switch
   * will change anything, and they waited for orders that could not arrive.
   */
  const approved = restaurant.status === 'ACTIVE';

  return (
    <SafeScreen style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={c.bg} />

      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.storeName} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <View style={styles.storeMeta}>
            <View
              style={[
                styles.dot,
                { backgroundColor: !approved ? c.warning : open ? c.success : c.textMuted }
              ]}
            />
            <Text style={styles.storeMetaText}>
              {!approved
                ? restaurant.status === 'SUSPENDED'
                  ? 'Suspended'
                  : restaurant.status === 'CLOSED'
                    ? 'Closed by Quick Bites'
                    : 'Awaiting verification'
                : open
                  ? 'Taking orders'
                  : 'Closed'}
            </Text>
            {connected && <Text style={styles.liveTag}>LIVE</Text>}
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.kitchenToggle,
            open ? styles.kitchenOn : styles.kitchenOff,
            !approved && styles.kitchenLocked
          ]}
          onPress={toggleKitchen}
          disabled={togglingKitchen}
          accessibilityRole="switch"
          accessibilityState={{ checked: open, disabled: !approved }}
          accessibilityHint={
            approved ? undefined : 'Your restaurant has not been verified yet, so it cannot go online.'
          }
        >
          {togglingKitchen ? (
            <ActivityIndicator size="small" color={open ? '#FFFFFF' : c.textSoft} />
          ) : (
            <Text style={[styles.kitchenToggleText, open && { color: '#FFFFFF' }]}>
              {!approved ? 'Locked' : open ? 'Online' : 'Offline'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {!!profileError && (
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
          <ErrorNote message={profileError} />
        </View>
      )}

      {groupOf(tab).tabs.length > 1 && (
        <View style={styles.subTabs} accessibilityRole="tablist">
          {groupOf(tab).tabs.map(t => {
            const active = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.subTab, active && styles.subTabActive]}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                testID={`subtab-${t.key}`}
              >
                <Text style={[styles.subTabText, active && styles.subTabTextActive]} numberOfLines={1}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.body}>
        {tab === 'dashboard' && <DashboardScreen restaurantId={restaurant.id} refreshSignal={refreshSignal} />}
        {tab === 'orders' && (
          <LiveOrdersScreen
            restaurantId={restaurant.id}
            refreshSignal={refreshSignal}
            soundEnabled={soundEnabled}
            onToggleSound={setSoundEnabled}
          />
        )}
        {tab === 'history' && <OrderHistoryScreen restaurantId={restaurant.id} />}
        {tab === 'settlements' && (
          <SettlementsScreen restaurantId={restaurant.id} refreshSignal={refreshSignal} />
        )}
        {tab === 'bank' && <PayoutAccountScreen />}
        {tab === 'statement' && <EarningsStatementScreen />}
        {tab === 'menu' && <MenuScreen restaurantId={restaurant.id} refreshSignal={refreshSignal} />}
        {tab === 'profile' && <ProfileEditScreen restaurantId={restaurant.id} />}
        {tab === 'documents' && <DocumentsScreen restaurantId={restaurant.id} />}
        {tab === 'help' && (
          <HelpCentreScreen
            restaurantName={restaurant.name}
            ownerEmail={user?.email}
            ownerName={user?.fullName}
            onSignOut={signOut}
            onTokenRefreshed={next => {
              configureApi(currentApiUrl(), next);
              setToken(next);
              void saveStoredSession({ token: next, user, apiUrl: currentApiUrl() });
            }}
          />
        )}
      </View>

      <View style={styles.tabBar} accessibilityRole="tablist">
        {GROUPS.map(g => {
          const Icon = g.icon;
          const active = groupOf(tab).key === g.key;
          return (
            <TouchableOpacity
              key={g.key}
              style={styles.tabItem}
              onPress={() => setTab(active ? tab : g.tabs[0].key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`tab-${g.key}`}
            >
              <Icon size={20} color={active ? c.brand : c.textMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                {g.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeScreen>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    {/* Required by useSafeAreaInsets. Without it every inset reads zero and
        the bottom row slides back under Android's navigation bar. */}
    <SafeAreaProvider>
        <PartnerApp />
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  centre: { justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: c.surface,
    gap: spacing.md
  },
  storeName: { fontSize: 19, fontWeight: '800', color: c.text },
  storeMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  storeMetaText: { fontSize: 13, color: c.textMuted },
  liveTag: { fontSize: 10, color: c.success, fontWeight: '800', letterSpacing: 0.5, marginLeft: 4 },
  kitchenToggle: {
    minWidth: 88,
    height: 38,
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1
  },
  kitchenOn: { backgroundColor: c.success, borderColor: c.success },
  kitchenOff: { backgroundColor: 'transparent', borderColor: c.border },
  kitchenLocked: { backgroundColor: 'transparent', borderColor: c.warning, opacity: 0.85 },
  kitchenToggleText: { fontSize: 13, fontWeight: '800', color: c.textSoft },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingVertical: spacing.sm
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 6, gap: 3 },
  subTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.surface
  },
  subTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border
  },
  subTabActive: { backgroundColor: c.brand, borderColor: c.brand },
  subTabText: { fontSize: 13, fontWeight: '700', color: c.textSoft },
  subTabTextActive: { color: '#FFFFFF' },
  tabLabel: { fontSize: 11, color: c.textMuted, fontWeight: '700' },
  tabLabelActive: { color: c.brand },
  blocked: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  blockedTitle: { fontSize: 20, fontWeight: '800', color: c.text, marginTop: spacing.lg },
  blockedBody: { fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 21 },
  blockedBtn: { marginTop: spacing.xxl, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
  blockedBtnText: { color: c.brand, fontSize: 15, fontWeight: '800' }
});
