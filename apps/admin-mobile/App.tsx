import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  LayoutDashboard,
  ShoppingBag,
  Navigation,
  Users,
  Undo2,
  UtensilsCrossed,
  IndianRupee,
  Percent,
  Landmark,
  Banknote,
  Megaphone,
  LifeBuoy,
  FileCheck2,
  FileText,
  Store,
  ShieldCheck,
  SlidersHorizontal,
  UserCog
} from 'lucide-react-native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Screen, AppHeader, SectionRail, NoAccess, type RailItem } from './src/components/ui';
import { tokens } from './src/theme/tokens';
import { SessionProvider, useSession, type SessionState } from './src/lib/session';
import { useLiveUpdates } from './src/lib/useLiveUpdates';
import { useResource } from './src/lib/useResource';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { DeliveriesScreen } from './src/screens/DeliveriesScreen';
import { PeopleScreen } from './src/screens/PeopleScreen';
import { RefundsScreen } from './src/screens/RefundsScreen';
import { CatalogScreen } from './src/screens/CatalogScreen';
import { FinanceScreen } from './src/screens/FinanceScreen';
import { RatesScreen } from './src/screens/RatesScreen';
import { PayeeAccountsScreen } from './src/screens/PayeeAccountsScreen';
import { PayoutsScreen } from './src/screens/PayoutsScreen';
import { MarketingScreen } from './src/screens/MarketingScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { ProfileApprovalsScreen } from './src/screens/ProfileApprovalsScreen';
import { RolesScreen } from './src/screens/RolesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { useHardwareBackWithExitConfirm } from './src/lib/useHardwareBack';
import { loadStoredSession, saveStoredSession, clearStoredSession } from './src/lib/storedSession';
import { createClient } from './src/lib/api';
import { registerForPush, unregisterForPush } from './src/lib/pushRegistration';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const c = tokens.colors;

/**
 * The sections of the console, and the permission each one needs.
 *
 * Listing the requirement alongside the screen keeps the navigation honest: a
 * section is offered only when the account could actually use it, and the same
 * permission is what the server checks when the screen makes its first request.
 * Adding a screen without naming its permission would put a section in the menu
 * that leads straight to a refusal.
 */
type SectionGroup = 'today' | 'money' | 'people' | 'catalogue' | 'help' | 'system';

/*
 * The groups, in the order an administrator works through a day.
 *
 * Today first because it is what is happening right now; System last because
 * it is touched once a month. Money before People because when something is
 * wrong it is usually money, and a person hunting a payout should not scroll
 * past three sections of user management to find it.
 */
const GROUPS: Array<{ key: SectionGroup; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'money', label: 'Money' },
  { key: 'people', label: 'People' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'help', label: 'Help' },
  { key: 'system', label: 'System' }
];

const SECTIONS: Array<{
  key: string;
  group: SectionGroup;
  label: string;
  title: string;
  subtitle: string;
  permissions: string[];
  icon: (active: boolean) => React.ReactNode;
  badge?: (counts: any) => number | undefined;
  render: (navigate: (key: string) => void) => React.ReactNode;
}> = [
  {
    key: 'dashboard',
    group: 'today',
    label: 'Dashboard',
    title: 'Platform overview',
    subtitle: 'Everything happening across Quick Bites',
    permissions: ['analytics.dashboard.view'],
    icon: active => <LayoutDashboard size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: navigate => <DashboardScreen onNavigate={navigate} />
  },
  {
    key: 'orders',
    group: 'today',
    label: 'Orders',
    title: 'All orders',
    subtitle: 'Every order placed on the platform',
    permissions: ['orders.view'],
    icon: active => <ShoppingBag size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <OrdersScreen />
  },
  {
    key: 'deliveries',
    group: 'today',
    label: 'Live',
    title: 'Live deliveries',
    subtitle: 'Trips in flight right now',
    permissions: ['orders.deliveries.manage', 'orders.view'],
    icon: active => <Navigation size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.liveOrders,
    render: () => <DeliveriesScreen />
  },
  {
    key: 'people',
    group: 'people',
    label: 'People',
    title: 'Customers, drivers & restaurants',
    subtitle: 'Everyone on the platform',
    permissions: ['users.customers.view', 'users.drivers.view', 'users.restaurants.view'],
    icon: active => <Users size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <PeopleScreen />
  },
  {
    key: 'refunds',
    group: 'help',
    label: 'Refunds',
    title: 'Returns & refunds',
    subtitle: 'Cases raised against an order',
    permissions: ['orders.refunds.handle', 'finance.refunds.manage'],
    icon: active => <Undo2 size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.openRefunds,
    render: () => <RefundsScreen />
  },
  {
    key: 'catalog',
    group: 'catalogue',
    label: 'Menus',
    title: 'Menus & categories',
    subtitle: 'What customers can order',
    permissions: ['catalog.menus.view', 'catalog.menus.review', 'catalog.categories.manage'],
    icon: active => <UtensilsCrossed size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.pendingMenuRequests,
    render: () => <CatalogScreen />
  },
  {
    key: 'finance',
    group: 'money',
    label: 'Finance',
    title: 'Payments, revenue & payouts',
    subtitle: 'Where the money moves',
    permissions: ['finance.revenue.view', 'finance.payments.view', 'finance.payouts.view'],
    icon: active => <IndianRupee size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <FinanceScreen />
  },
  {
    key: 'rates',
    group: 'money',
    label: 'Rates',
    title: 'Rates & fees',
    subtitle: 'What the platform charges, keeps and pays out',
    permissions: ['finance.config.edit'],
    icon: active => <Percent size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <RatesScreen />
  },
  {
    key: 'payouts',
    group: 'money',
    label: 'Pay',
    title: 'Payouts',
    subtitle: 'Who is owed what, and sending it',
    permissions: ['finance.payouts.view', 'finance.settlements.view', 'finance.payouts.manage'],
    icon: active => <Banknote size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => (counts?.openPayoutRequests || 0) + (counts?.cashDepositsAwaitingConfirmation || 0) || undefined,
    render: () => <PayoutsScreen />
  },
  {
    key: 'payees',
    group: 'money',
    label: 'Bank',
    title: 'Payout accounts',
    subtitle: 'Who can be paid, and the names that need a person',
    permissions: ['finance.payouts.manage', 'finance.settlements.manage', 'finance.payouts.view'],
    icon: active => <Landmark size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.payeeAccountsAwaitingReview,
    render: () => <PayeeAccountsScreen />
  },
  {
    key: 'marketing',
    group: 'catalogue',
    label: 'Marketing',
    title: 'Coupons & reviews',
    subtitle: 'Campaigns and what customers said',
    permissions: ['marketing.coupons.manage', 'reviews.view'],
    icon: active => <Megaphone size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <MarketingScreen />
  },
  {
    key: 'support',
    group: 'help',
    label: 'Support',
    title: 'Complaints & safety',
    subtitle: 'Raised from the apps',
    permissions: ['support.tickets.view'],
    icon: active => <LifeBuoy size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => (counts?.openTickets || 0) + (counts?.openSos || 0) || undefined,
    render: () => <SupportScreen />
  },
  {
    key: 'documents',
    group: 'people',
    label: 'KYC',
    title: 'Partner documents',
    subtitle: 'Licences and registrations to review',
    permissions: ['documents.view'],
    icon: active => <FileCheck2 size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.pendingKyc,
    render: () => <DocumentsScreen />
  },
  {
    // Beside KYC rather than under the catalogue: documents and profile
    // changes are one job done by one person, and a review queue nobody can
    // find is a review queue nobody empties.
    key: 'profileChanges',
    group: 'people',
    label: 'Profiles',
    title: 'Profile changes',
    subtitle: 'What partners have asked to change about how they appear',
    permissions: ['catalog.restaurants.approve'],
    icon: active => <Store size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    badge: counts => counts?.pendingProfileEdits,
    render: () => <ProfileApprovalsScreen />
  },
  {
    key: 'access',
    group: 'system',
    label: 'Access',
    title: 'Roles & audit',
    subtitle: 'Who can do what, and what they did',
    permissions: ['admin.roles.manage', 'admin.accounts.manage', 'admin.audit.view'],
    icon: active => <ShieldCheck size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <RolesScreen />
  },
  {
    key: 'settings',
    group: 'system',
    label: 'Switches',
    title: 'Platform switches',
    subtitle: 'Take something offline without a deployment',
    permissions: ['admin.settings.manage'],
    icon: active => <SlidersHorizontal size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <SettingsScreen />
  },
  {
    key: 'profile',
    group: 'system',
    label: 'You',
    title: 'Your account',
    subtitle: 'Profile, password and permissions',
    permissions: [],
    icon: active => <UserCog size={16} color={active ? c.brand.amberText : c.text.secondary} />,
    render: () => <ProfileScreen />
  }
];

const Console: React.FC = () => {
  const { api, can, apiUrl, token } = useSession();
  const [active, setActive] = useState('dashboard');

  // Any section but the dashboard returns to it; the dashboard leaves the app.
  useHardwareBackWithExitConfirm(
    useCallback(() => {
      if (active !== 'dashboard') {
        setActive('dashboard');
        return true;
      }
      return false;
    }, [active])
  );

  // The small, frequently-polled slice behind the navigation badges. It is
  // separate from the dashboard on purpose: this runs every time a live event
  // arrives, and walking every order on the platform for a badge count would
  // make the socket a liability rather than a feature.
  const counts = useResource(() => api.get<any>('/admin/live'), [], { enabled: Boolean(token) });

  const { connected } = useLiveUpdates(token ? { kind: 'admin' } : null, apiUrl, token, () => {
    void counts.silentReload();
  });

  const visible = useMemo(
    () => SECTIONS.filter(section => section.permissions.length === 0 || can(...section.permissions)),
    [can]
  );

  const current = visible.find(section => section.key === active) || visible[0];

  /*
   * NAVIGATION IN TWO TIERS, because one tier had stopped working.
   *
   * Every section lived in a single horizontal rail. At seventeen of them that
   * is a strip a person scrolls sideways through, reading labels, to find the
   * one they want - and the ones past the fold are the ones nobody visits. The
   * owner asked for this to be easier to understand, and the honest problem was
   * not the labels, it was that finding anything required remembering where it
   * was.
   *
   * Groups on top, sections within. At most four or five in a row, nothing
   * hidden past a fold.
   */
  const groups = useMemo(
    () => GROUPS.filter(g => visible.some(s => s.group === g.key)),
    [visible]
  );

  /*
   * The group follows the section rather than being stored separately.
   *
   * Dashboard cards navigate straight to a section by key, and so does the
   * badge on a group. If the active group were its own state, either of those
   * would land on a section while the wrong group was highlighted - the nav
   * disagreeing with the screen, which is worse than no nav at all.
   */
  const activeGroup = current?.group || groups[0]?.key;

  const inGroup = visible.filter(section => section.group === activeGroup);

  /*
   * A group's badge is the sum of its sections' badges, so attention is
   * visible without opening every group to look for it. That is the whole
   * point of grouping - it must not hide the thing a person came to find.
   */
  const groupItems: RailItem[] = groups.map(group => {
    const total = visible
      .filter(section => section.group === group.key)
      .reduce((sum, section) => sum + (section.badge?.(counts.data) || 0), 0);
    return {
      key: group.key,
      label: group.label,
      icon: null,
      badge: total || undefined
    };
  });

  const railItems: RailItem[] = inGroup.map(section => ({
    key: section.key,
    label: section.label,
    icon: section.icon(section.key === current?.key),
    badge: section.badge?.(counts.data)
  }));

  /** Selecting a group opens its first section, since a group is not a screen. */
  const selectGroup = (key: string) => {
    const first = visible.find(section => section.group === key);
    if (first) setActive(first.key);
  };

  return (
    <Screen>
      <AppHeader
        title={current?.title || 'Quick Bites Ops'}
        subtitle={current?.subtitle}
        right={
          <TouchableOpacity
            style={[st.liveChip, connected ? st.liveChipOn : null]}
            onPress={() => counts.reload()}
            activeOpacity={0.8}
          >
            <View style={[st.liveDot, connected ? st.liveDotOn : null]} />
            <Text style={[st.liveText, connected ? st.liveTextOn : null]}>{connected ? 'LIVE' : 'IDLE'}</Text>
          </TouchableOpacity>
        }
      />

      <SectionRail items={groupItems} active={activeGroup || ''} onSelect={selectGroup} variant="group" />
      <SectionRail items={railItems} active={current?.key || ''} onSelect={setActive} />

      <View style={st.body}>
        {current ? current.render(setActive) : <NoAccess />}
      </View>
    </Screen>
  );
};

function AdminApp() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [restoring, setRestoring] = useState(true);

  /**
   * Restores the previous sign-in.
   *
   * Only the token and the server address are kept on the device. The role and
   * its permissions are re-read from /admin/me on every restore rather than
   * stored, so an administrator whose role was narrowed or disabled while the
   * app was closed comes back with the access they have now, not the access
   * they had then. A token the server no longer accepts simply drops through to
   * the sign-in screen.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredSession();
      if (stored) {
        try {
          const client = createClient(stored.apiUrl, stored.token);
          const access = await client.get<any>('/admin/me');
          if (!cancelled) {
            setSession({
              token: stored.token,
              apiUrl: stored.apiUrl,
              user: access.user,
              roleName: access.role?.name || (access.isSuperAdmin ? 'Super Admin' : 'Unassigned'),
              roleId: access.role?.id || null,
              isSuperAdmin: Boolean(access.isSuperAdmin),
              permissions: access.permissions || [],
              permissionCatalogue: access.permissionCatalogue || []
            });
            // Not awaited: the console must open whether or not a push
            // service answers.
            void registerForPush(stored.apiUrl, stored.token);
          }
        } catch {
          // Expired, revoked, or the server is unreachable: ask for a password.
          await clearStoredSession();
        }
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (restoring) return <Screen />;

  if (!session) {
    return (
      <SessionProvider>
        <LoginScreen
          onSignedIn={next => {
            setSession(next);
            void saveStoredSession({ token: next.token, user: next.user, apiUrl: next.apiUrl });
            // Registered on a fresh sign-in as well as on restore. Only doing
            // it on restore means an operator is unreachable for their whole
            // first session, which is the one where they are setting things up.
            void registerForPush(next.apiUrl, next.token);
          }}
        />
      </SessionProvider>
    );
  }

  return (
    <SessionProvider
      key={session.token}
      onSignOut={() => {
        // Before the session is dropped, because the request needs its token.
        void unregisterForPush(session.apiUrl, session.token);
        void clearStoredSession();
        setSession(null);
      }}
    >
      <Bootstrapped session={session} />
    </SessionProvider>
  );
}

/**
 * Pushes the credentials gathered at sign-in into the session context.
 *
 * The provider owns the state so that a role change can refresh it in place;
 * this runs once per sign-in to seed it.
 */
const Bootstrapped: React.FC<{ session: SessionState }> = ({ session }) => {
  const { signIn, token } = useSession();
  const [seeded, setSeeded] = useState(false);

  if (!seeded) {
    setSeeded(true);
    signIn(session);
  }

  if (!token) return <Screen />;
  return <Console />;
};

const st = StyleSheet.create({
  body: { flex: 1 },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.bg.card,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: tokens.radius.pill
  },
  liveChipOn: { backgroundColor: c.state.successBg, borderColor: c.state.success },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.text.muted },
  liveDotOn: { backgroundColor: c.state.success },
  liveText: { fontSize: 10, fontWeight: '800', color: c.text.muted, letterSpacing: 0.5 },
  liveTextOn: { color: c.state.success }
});

export default function App() {
  return (
    <ErrorBoundary appName="Quick Bites Operations" accent={c.brand.amber}>
    {/* Required by useSafeAreaInsets. Without it every inset reads zero and
        the bottom row slides back under Android's navigation bar. */}
    <SafeAreaProvider>
        <AdminApp />
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
