import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert
} from 'react-native';
import { SafeScreen } from './src/components/SafeScreen';
import { LayoutDashboard, Bell, History, Layers, ShieldCheck, LifeBuoy, Banknote } from 'lucide-react-native';
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
import { prepareOrderAlerts, releaseOrderAlerts, stopOrderAlert } from './src/lib/orderAlert';
import { SignInScreen } from './src/screens/SignInScreen';
import { SettlementsScreen } from './src/screens/SettlementsScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LiveOrdersScreen } from './src/screens/LiveOrdersScreen';
import { OrderHistoryScreen } from './src/screens/OrderHistoryScreen';
import { MenuScreen } from './src/screens/MenuScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { HelpCentreScreen } from './src/screens/HelpCentreScreen';
import { ErrorNote } from './src/components/ui';
import { useHardwareBackWithExitConfirm } from './src/lib/useHardwareBack';
import { loadStoredSession, saveStoredSession, clearStoredSession } from './src/lib/storedSession';

import { DEFAULT_API_URL } from './src/config';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Tab = 'dashboard' | 'orders' | 'history' | 'menu' | 'documents' | 'help' | 'settlements';

const TABS: Array<{ key: Tab; label: string; icon: any }> = [
  { key: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { key: 'orders', label: 'Orders', icon: Bell },
  { key: 'history', label: 'History', icon: History },
  { key: 'settlements', label: 'Payouts', icon: Banknote },
  { key: 'menu', label: 'Menu', icon: Layers },
  { key: 'documents', label: 'Docs', icon: ShieldCheck },
  { key: 'help', label: 'Help', icon: LifeBuoy }
];

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
    if (nextUser?.id) await loadProfile(nextUser.id);
  };

  const signOut = async () => {
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

  const { connected } = useLiveUpdates(
    token && restaurant?.id ? { kind: 'restaurant', restaurantId: restaurant.id } : null,
    currentApiUrl(),
    token,
    () => setRefreshSignal(n => n + 1)
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
        {tab === 'menu' && <MenuScreen restaurantId={restaurant.id} refreshSignal={refreshSignal} />}
        {tab === 'documents' && <DocumentsScreen restaurantId={restaurant.id} />}
        {tab === 'help' && (
          <HelpCentreScreen
            restaurantName={restaurant.name}
            ownerEmail={user?.email}
            ownerName={user?.fullName}
            onSignOut={signOut}
          />
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)}>
              <Icon size={19} color={active ? c.brand : c.textMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
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
    flexGrow: 0,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm
  },
  tabItem: { minWidth: 68, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, gap: 3 },
  tabLabel: { fontSize: 10, color: c.textMuted, fontWeight: '700' },
  tabLabelActive: { color: c.brand },
  blocked: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  blockedTitle: { fontSize: 20, fontWeight: '800', color: c.text, marginTop: spacing.lg },
  blockedBody: { fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 21 },
  blockedBtn: { marginTop: spacing.xxl, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
  blockedBtnText: { color: c.brand, fontSize: 15, fontWeight: '800' }
});
