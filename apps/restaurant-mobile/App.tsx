import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LayoutDashboard, Bell, History, Layers, ShieldCheck, LifeBuoy } from 'lucide-react-native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { c, radii, spacing } from './src/theme';
import { configureApi, fetchOwnedRestaurant, setKitchenOpen } from './src/lib/partnerApi';
import { useLiveUpdates } from './src/lib/useLiveUpdates';
import { prepareOrderAlerts, releaseOrderAlerts, stopOrderAlert } from './src/lib/orderAlert';
import { SignInScreen } from './src/screens/SignInScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LiveOrdersScreen } from './src/screens/LiveOrdersScreen';
import { OrderHistoryScreen } from './src/screens/OrderHistoryScreen';
import { MenuScreen } from './src/screens/MenuScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { HelpCentreScreen } from './src/screens/HelpCentreScreen';
import { ErrorNote } from './src/components/ui';

const DEFAULT_API_URL = 'https://quick-bites-production-9f45.up.railway.app/api';

type Tab = 'dashboard' | 'orders' | 'history' | 'menu' | 'documents' | 'help';

const TABS: Array<{ key: Tab; label: string; icon: any }> = [
  { key: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { key: 'orders', label: 'Orders', icon: Bell },
  { key: 'history', label: 'History', icon: History },
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
  const [restaurant, setRestaurant] = useState<any | null>(null);

  const [tab, setTab] = useState<Tab>('dashboard');
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

  const onSignedIn = async (nextToken: string, nextUser: any) => {
    configureApi(DEFAULT_API_URL, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    await prepareOrderAlerts();
    if (nextUser?.id) await loadProfile(nextUser.id);
  };

  const signOut = async () => {
    await releaseOrderAlerts();
    configureApi(DEFAULT_API_URL, '');
    setToken('');
    setUser(null);
    setRestaurant(null);
    setTab('dashboard');
  };

  const { connected } = useLiveUpdates(
    token && restaurant?.id ? { kind: 'restaurant', restaurantId: restaurant.id } : null,
    DEFAULT_API_URL,
    token,
    () => setRefreshSignal(n => n + 1)
  );

  const toggleKitchen = async () => {
    if (!restaurant) return;
    const next = !restaurant.isOpen;

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

  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={c.bg} />
        <SignInScreen onSignedIn={onSignedIn} />
      </SafeAreaView>
    );
  }

  if (loadingProfile) {
    return (
      <SafeAreaView style={[styles.safe, styles.centre]}>
        <ActivityIndicator color={c.brand} size="large" />
      </SafeAreaView>
    );
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={c.bg} />
        <View style={styles.blocked}>
          <ShieldCheck size={40} color={c.warning} />
          <Text style={styles.blockedTitle}>Kitchen not linked yet</Text>
          <Text style={styles.blockedBody}>{profileError}</Text>
          <TouchableOpacity style={styles.blockedBtn} onPress={signOut}>
            <Text style={styles.blockedBtnText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const open = Boolean(restaurant.isOpen);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={c.bg} />

      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.storeName} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <View style={styles.storeMeta}>
            <View style={[styles.dot, { backgroundColor: open ? c.success : c.textMuted }]} />
            <Text style={styles.storeMetaText}>{open ? 'Taking orders' : 'Closed'}</Text>
            {connected && <Text style={styles.liveTag}>LIVE</Text>}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.kitchenToggle, open ? styles.kitchenOn : styles.kitchenOff]}
          onPress={toggleKitchen}
          disabled={togglingKitchen}
          accessibilityRole="switch"
          accessibilityState={{ checked: open }}
        >
          {togglingKitchen ? (
            <ActivityIndicator size="small" color={open ? '#FFFFFF' : c.textSoft} />
          ) : (
            <Text style={[styles.kitchenToggleText, open && { color: '#FFFFFF' }]}>
              {open ? 'Online' : 'Offline'}
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
        {tab === 'menu' && <MenuScreen restaurantId={restaurant.id} refreshSignal={refreshSignal} />}
        {tab === 'documents' && <DocumentsScreen restaurantId={restaurant.id} />}
        {tab === 'help' && (
          <HelpCentreScreen restaurantName={restaurant.name} ownerEmail={user?.email} onSignOut={signOut} />
        )}
      </View>

      <View style={styles.tabBar}>
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
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PartnerApp />
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
  tabLabel: { fontSize: 10, color: c.textMuted, fontWeight: '700' },
  tabLabelActive: { color: c.brand },
  blocked: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  blockedTitle: { fontSize: 20, fontWeight: '800', color: c.text, marginTop: spacing.lg },
  blockedBody: { fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 21 },
  blockedBtn: { marginTop: spacing.xxl, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
  blockedBtnText: { color: c.brand, fontSize: 15, fontWeight: '800' }
});
