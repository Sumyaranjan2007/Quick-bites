import React from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, RefreshControl } from 'react-native';
import {
  IndianRupee,
  Activity,
  Bike,
  Store,
  Users,
  ShoppingBag,
  CheckCircle2,
  XCircle,
  FileCheck2,
  Undo2,
  LifeBuoy,
  Wallet,
  Star,
  Tag,
  TriangleAlert
} from 'lucide-react-native';
import {
  Card,
  SectionTitle,
  StatTile,
  Loading,
  EmptyState,
  Sparkline,
  BarRow,
  KeyValue,
  Divider,
  Badge
} from '../components/ui';
import { tokens, formatCompactMoney, formatMoney } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * The overview.
 *
 * Ordered the way an operator actually reads it: what is happening right now
 * first, then today's trade, then the queues waiting for somebody, and the
 * slower platform totals last. A dashboard sorted by data model rather than by
 * urgency makes the reader hunt for the one number that needed them.
 */
export const DashboardScreen: React.FC<{ onNavigate: (section: string) => void }> = ({ onNavigate }) => {
  const { api, can, user, roleName } = useSession();
  const { width } = useWindowDimensions();
  const resource = useResource(() => api.get<any>('/admin/dashboard'), []);

  if (resource.loading && !resource.data) return <Loading label="Reading the platform…" />;
  if (!resource.data) {
    return (
      <EmptyState
        title={resource.denied ? 'Dashboard not available on your role' : 'Could not load the dashboard'}
        message={resource.error || undefined}
      />
    );
  }

  const d = resource.data;
  const trend = (d.revenueTrend || []) as Array<{ date: string; netRevenue: number; gross: number; orders: number }>;
  const chartWidth = Math.max(120, width - tokens.space[5] * 2 - tokens.space[4] * 2);
  const revenueSplit = [
    { label: 'Commission', value: d.money.commission, color: c.brand.amber },
    { label: 'Delivery fees', value: d.money.deliveryFees, color: c.state.info },
    { label: 'Platform fees', value: d.money.platformFees, color: c.state.success }
  ];
  const splitTotal = revenueSplit.reduce((total, row) => total + row.value, 0) || 1;

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={
        <RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />
      }
    >
      <View style={s.greeting}>
        <Text style={s.greetingName}>{user?.fullName || 'Operations'}</Text>
        <Badge label={roleName} tone="amber" />
      </View>

      {/* Right now */}
      <SectionTitle title="Right now" subtitle="Live across the platform this minute." />
      <View style={s.grid}>
        <StatTile
          label="Live orders"
          value={d.orders.live}
          hint={`${d.orders.inTransit} with a rider`}
          tone="info"
          icon={<Activity size={16} color={c.state.info} />}
          onPress={() => onNavigate('deliveries')}
        />
        <StatTile
          label="Drivers online"
          value={d.people.onlineDrivers}
          hint={`of ${d.people.activeDrivers} approved`}
          tone="success"
          icon={<Bike size={16} color={c.state.success} />}
          onPress={() => onNavigate('people')}
        />
        <StatTile
          label="Restaurants open"
          value={d.people.openRestaurants}
          hint={`of ${d.people.activeRestaurants} active`}
          tone="amber"
          icon={<Store size={16} color={c.brand.amber} />}
          onPress={() => onNavigate('people')}
        />
        <StatTile
          label="Orders today"
          value={d.orders.today}
          hint={formatCompactMoney(d.money.gmvToday) + ' today'}
          tone="neutral"
          icon={<ShoppingBag size={16} color={c.text.secondary} />}
          onPress={() => onNavigate('orders')}
        />
      </View>

      {/* Needs attention */}
      {(() => {
        // A queue is only shown to somebody who could actually work it. The
        // dashboard payload is the same for every administrator, so without
        // this a finance admin was invited to open a KYC queue that would then
        // refuse them — which reads as the console being broken.
        const queues = [
          { key: 'refunds', label: 'Refund requests', count: d.queues.openRefundRequests, permissions: ['orders.refunds.handle', 'finance.refunds.manage'], icon: <Undo2 size={16} color={c.state.danger} />, tone: 'danger' as const },
          { key: 'support', label: 'Support tickets', count: d.queues.openSupportTickets, permissions: ['support.tickets.view'], icon: <LifeBuoy size={16} color={c.state.warning} />, tone: 'warning' as const },
          { key: 'documents', label: 'KYC to review', count: d.queues.pendingKyc, permissions: ['documents.view'], icon: <FileCheck2 size={16} color={c.state.info} />, tone: 'info' as const },
          { key: 'catalog', label: 'Menu requests', count: d.queues.pendingMenuRequests, permissions: ['catalog.menus.review', 'catalog.menus.view'], icon: <Tag size={16} color={c.brand.amber} />, tone: 'amber' as const },
          { key: 'support', label: 'Open SOS alerts', count: d.queues.openSosAlerts, permissions: ['support.tickets.view', 'users.drivers.view'], icon: <TriangleAlert size={16} color={c.state.danger} />, tone: 'danger' as const },
          { key: 'finance', label: 'Payouts pending', count: d.queues.pendingPayouts, permissions: ['finance.payouts.view'], icon: <Wallet size={16} color={c.state.success} />, tone: 'success' as const }
        ].filter(queue => queue.count > 0 && can(...queue.permissions));

        if (queues.length === 0) {
          return (
            <>
              <SectionTitle title="Needs attention" />
              <Card>
                <View style={s.allClear}>
                  <CheckCircle2 size={20} color={c.state.success} />
                  <Text style={s.allClearText}>Every queue is empty. Nothing is waiting on an administrator.</Text>
                </View>
              </Card>
            </>
          );
        }

        return (
          <>
            <SectionTitle title="Needs attention" subtitle="Queues with work waiting in them." />
            <View style={s.grid}>
              {queues.map((queue, index) => (
                <StatTile
                  key={`${queue.key}-${index}`}
                  label={queue.label}
                  value={queue.count}
                  tone={queue.tone}
                  icon={queue.icon}
                  onPress={() => onNavigate(queue.key)}
                />
              ))}
            </View>
          </>
        );
      })()}

      {/* Revenue */}
      {can('finance.revenue.view', 'analytics.dashboard.view') ? (
        <>
          <SectionTitle title="Revenue" subtitle="Recognised on delivery, not when an order is placed." />
          <Card>
            <View style={s.revenueHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.revenueLabel}>Platform net revenue</Text>
                <Text style={s.revenueValue}>{formatMoney(d.money.netRevenue)}</Text>
                <Text style={s.revenueHint}>
                  {formatMoney(d.money.grossMerchandiseValue)} gross merchandise value across {d.orders.completed}{' '}
                  delivered orders
                </Text>
              </View>
              <View style={s.revenueTodayPill}>
                <Text style={s.revenueTodayLabel}>Today</Text>
                <Text style={s.revenueTodayValue}>{formatCompactMoney(d.money.netRevenueToday)}</Text>
              </View>
            </View>

            {trend.length > 1 ? (
              <>
                <Sparkline points={trend.map(p => p.netRevenue)} width={chartWidth} height={126} />
                <View style={s.trendAxis}>
                  <Text style={s.trendAxisText}>{trend[0]?.date?.slice(5)}</Text>
                  <Text style={s.trendAxisText}>Last 14 days</Text>
                  <Text style={s.trendAxisText}>{trend[trend.length - 1]?.date?.slice(5)}</Text>
                </View>
              </>
            ) : null}

            <Divider />
            {revenueSplit.map(row => (
              <BarRow
                key={row.label}
                label={row.label}
                value={formatMoney(row.value)}
                fraction={row.value / splitTotal}
                color={row.color}
              />
            ))}

            <Divider />
            <KeyValue label="Average order value" value={formatMoney(d.orders.averageOrderValue)} tone="strong" />
            <KeyValue label="Owed to restaurants" value={formatMoney(d.money.restaurantPayable)} />
            <KeyValue label="Owed to riders" value={formatMoney(d.money.riderPayable)} />
            <KeyValue label="GST collected" value={formatMoney(d.money.taxCollected)} />
            <KeyValue label="Discounts funded" value={formatMoney(d.money.discountsGiven)} />
            <KeyValue label="Refunded" value={formatMoney(d.money.refundedAmount)} />
          </Card>
        </>
      ) : null}

      {/* Orders */}
      <SectionTitle title="Orders" subtitle="Everything placed on the platform to date." />
      <View style={s.grid}>
        <StatTile label="Total orders" value={d.orders.total} icon={<ShoppingBag size={16} color={c.text.secondary} />} />
        <StatTile
          label="Completed"
          value={d.orders.completed}
          hint={`${d.orders.completionRate}% of all orders`}
          tone="success"
          icon={<CheckCircle2 size={16} color={c.state.success} />}
        />
        <StatTile
          label="Cancelled"
          value={d.orders.cancelled}
          hint={`${d.orders.cancellationRate}% of all orders`}
          tone="danger"
          icon={<XCircle size={16} color={c.state.danger} />}
        />
        <StatTile label="Refunded" value={d.orders.refunded} tone="warning" icon={<Undo2 size={16} color={c.state.warning} />} />
      </View>

      {/* Payments */}
      <SectionTitle title="Payments" />
      <Card>
        <KeyValue label="Paid" value={d.payments.paid} tone="strong" />
        <KeyValue label="Pending" value={d.payments.pending} />
        <KeyValue label="Failed" value={d.payments.failed} />
        <KeyValue label="Refunded" value={d.payments.refunded} />
        <Divider />
        <KeyValue label="Cash on delivery" value={d.payments.codOrders} />
        <KeyValue label="Online" value={d.payments.onlineOrders} />
        <KeyValue label="Wallet" value={d.payments.walletOrders} />
        <Divider />
        <KeyValue label="Cash held by riders" value={formatMoney(d.payments.codCashInHand)} tone="money" />
      </Card>

      {/* People and catalogue */}
      <SectionTitle title="Platform" />
      <View style={s.grid}>
        <StatTile label="Customers" value={d.people.totalCustomers} hint={`+${d.people.newCustomersToday} today`} icon={<Users size={16} color={c.text.secondary} />} onPress={() => onNavigate('people')} />
        <StatTile label="Delivery partners" value={d.people.totalDrivers} hint={`${d.people.activeDrivers} approved`} icon={<Bike size={16} color={c.text.secondary} />} onPress={() => onNavigate('people')} />
        <StatTile label="Restaurants" value={d.people.totalRestaurants} hint={`${d.people.activeRestaurants} active`} icon={<Store size={16} color={c.text.secondary} />} onPress={() => onNavigate('people')} />
        {can('catalog.menus.view') ? (
          <StatTile label="Menu items" value={d.catalogue.menuItems} hint={`${d.catalogue.categories} categories`} icon={<Tag size={16} color={c.text.secondary} />} onPress={() => onNavigate('catalog')} />
        ) : null}
        {can('marketing.coupons.manage') ? (
          <StatTile label="Active coupons" value={d.catalogue.activeCoupons} hint={`${d.catalogue.totalCoupons} created`} tone="amber" icon={<IndianRupee size={16} color={c.brand.amber} />} onPress={() => onNavigate('marketing')} />
        ) : null}
        {can('reviews.view') ? (
          <StatTile
            label="Average rating"
            value={d.reviews.total ? d.reviews.averageRating.toFixed(1) : '—'}
            hint={`${d.reviews.total} reviews · ${d.reviews.lowRated} poor`}
            tone="warning"
            icon={<Star size={16} color={c.state.warning} />}
            onPress={() => onNavigate('marketing')}
          />
        ) : null}
      </View>

      <Text style={s.footNote}>
        Updated {new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · pull to
        refresh
      </Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { padding: tokens.space[5], paddingBottom: tokens.space[8] },
  greeting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[3] },
  greetingName: {
    flex: 1,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.primary
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[3], marginBottom: tokens.space[2] },
  allClear: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] },
  allClearText: { flex: 1, color: c.text.secondary, fontSize: tokens.font.size.sm, lineHeight: 19 },
  revenueHead: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space[3] },
  revenueLabel: { fontSize: tokens.font.size.xs, color: c.text.muted },
  revenueValue: {
    fontSize: tokens.font.size.xxl,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.primary,
    marginTop: 2
  },
  revenueHint: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 4, lineHeight: 16 },
  revenueTodayPill: {
    backgroundColor: c.brand.amberSoft,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space[3],
    paddingVertical: tokens.space[2],
    alignItems: 'flex-end'
  },
  revenueTodayLabel: { fontSize: tokens.font.size.xxs, color: c.brand.amberText },
  revenueTodayValue: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },
  trendAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  trendAxisText: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  footNote: { textAlign: 'center', color: c.text.muted, fontSize: tokens.font.size.xxs, marginTop: tokens.space[4] }
});
