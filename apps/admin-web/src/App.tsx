import React from 'react';
import { ThemeProvider, useTheme, I18nProvider, ErrorBoundary } from '@quick-bites/design-system';
import {
  Activity,
  ShoppingBag,
  Truck,
  IndianRupee,
  CreditCard,
  Wallet,
  UtensilsCrossed,
  FileCheck,
  LifeBuoy,
  ShieldCheck,
  Moon,
  Sun,
  LogOut,
  UserCog,
  RotateCcw
} from 'lucide-react';
import { LoginGate } from './components/LoginGate';
import { Overview } from './components/console/Overview';
import { AllOrders, LiveDeliveries } from './components/console/OrdersSection';
import { MenuApprovals, DocumentReview } from './components/console/Approvals';
import { RevenueSection, PaymentsSection, PayoutsSection } from './components/console/Finance';
import { SupportSection, AccessSection } from './components/console/AccessAndSupport';
import { ProfileSection } from './components/console/Profile';
import { RefundsSection } from './components/console/Refunds';
import { NoPermission, Loading, Failed } from './components/console/primitives';
import { fetchAccess, can, type AdminAccess } from './lib/adminApi';
import type { AdminPermission } from '@quick-bites/shared-types';
import { clearSession, getSession } from './lib/session';

type SectionKey =
  | 'overview'
  | 'orders'
  | 'deliveries'
  | 'revenue'
  | 'payments'
  | 'payouts'
  | 'refunds'
  | 'menus'
  | 'documents'
  | 'support'
  | 'access'
  | 'profile';

interface SectionDef {
  key: SectionKey;
  label: string;
  icon: any;
  /**
   * Any one of these is enough; a Super Admin passes everything.
   *
   * Typed against the server's own catalogue rather than free strings: a slug
   * that drifts from what requirePermission expects is a nav entry that leads
   * straight to a 403, and as plain strings nothing would catch it.
   */
  permissions: AdminPermission[];
  render: (access: AdminAccess | null) => React.ReactNode;
}

/**
 * The sections, each declaring the permission that reveals it.
 *
 * Hiding a section is a convenience so an operator is not shown doors that will
 * not open. It is not the control — every endpoint behind these screens enforces
 * the same permission server-side, which is what actually protects the data.
 */
const SECTIONS: SectionDef[] = [
  { key: 'overview', label: 'Control tower', icon: Activity, permissions: ['analytics.dashboard.view'], render: () => <Overview /> },
  { key: 'orders', label: 'All orders', icon: ShoppingBag, permissions: ['orders.view'], render: () => <AllOrders /> },
  { key: 'deliveries', label: 'Live deliveries', icon: Truck, permissions: ['orders.deliveries.manage'], render: () => <LiveDeliveries /> },
  { key: 'revenue', label: 'Revenue', icon: IndianRupee, permissions: ['finance.revenue.view'], render: () => <RevenueSection /> },
  { key: 'payments', label: 'Payments', icon: CreditCard, permissions: ['finance.payments.view'], render: () => <PaymentsSection /> },
  { key: 'payouts', label: 'Driver payouts', icon: Wallet, permissions: ['finance.payouts.view'], render: () => <PayoutsSection /> },
  { key: 'refunds', label: 'Returns & refunds', icon: RotateCcw, permissions: ['orders.refunds.handle', 'finance.refunds.manage', 'support.tickets.view'], render: () => <RefundsSection /> },
  { key: 'menus', label: 'Menu approvals', icon: UtensilsCrossed, permissions: ['catalog.menus.view', 'catalog.menus.review'], render: () => <MenuApprovals /> },
  { key: 'documents', label: 'Documents', icon: FileCheck, permissions: ['documents.view'], render: () => <DocumentReview /> },
  { key: 'support', label: 'Support', icon: LifeBuoy, permissions: ['support.tickets.view'], render: () => <SupportSection /> },
  { key: 'access', label: 'Roles & access', icon: ShieldCheck, permissions: ['admin.roles.manage', 'admin.accounts.manage'], render: access => <AccessSection access={access} /> },
  // No permission: every operator has an account of their own to manage.
  { key: 'profile', label: 'Your account', icon: UserCog, permissions: [], render: access => <ProfileSection access={access} /> }
];

function Console() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [access, setAccess] = React.useState<AdminAccess | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<SectionKey>('overview');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await fetchAccess();
      setAccess(me);
      // Land on the first section this role can actually open, so a limited
      // operator does not arrive at a locked screen.
      const first = SECTIONS.find(s => me.isSuperAdmin || s.permissions.some(p => me.permissions.includes(p)));
      if (first) setSection(first.key);
    } catch (err: any) {
      setError(err?.message || 'Could not load your account.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const signOut = () => {
    clearSession();
    window.location.reload();
  };

  if (loading) return <div className="console-boot"><Loading label="Signing you in" /></div>;
  if (error) return <div className="console-boot"><Failed message={error} onRetry={load} /></div>;

  // A section with no declared permission is open to any signed-in operator.
  const visible = SECTIONS.filter(s => s.permissions.length === 0 || can(access, ...s.permissions));
  const current = SECTIONS.find(s => s.key === section);
  const allowed = current ? current.permissions.length === 0 || can(access, ...current.permissions) : false;

  return (
    <div className="console">
      <aside className="console-nav">
        <div className="console-brand">
          <img src="/favicon.png" alt="" className="console-logo" />
          <div>
            <strong>Quick Bites</strong>
            <span>Admin</span>
          </div>
        </div>

        <nav>
          {visible.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                className={`console-nav-item${section === s.key ? ' active' : ''}`}
                onClick={() => setSection(s.key)}
              >
                <Icon size={17} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="console-foot">
          <div className="console-who">
            <strong>{access?.user.fullName}</strong>
            <span>
              {access?.isSuperAdmin ? 'Super Admin' : access?.role?.name || access?.user.role}
            </span>
          </div>
          <div className="console-foot-actions">
            <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="Switch theme">
              {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={signOut} title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="console-main">
        <ErrorBoundary fallbackTitle="This section could not be displayed">
          {allowed && current ? current.render(access) : <NoPermission section="this section" />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <I18nProvider defaultLanguage="en">
        <LoginGate>
          <Console />
        </LoginGate>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
