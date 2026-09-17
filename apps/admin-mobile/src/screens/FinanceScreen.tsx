import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, useWindowDimensions, Alert } from 'react-native';
import { IndianRupee, Wallet, CreditCard } from 'lucide-react-native';
import {
  Card,
  Segmented,
  StatTile,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  NoAccess,
  Sparkline,
  BarRow,
  SearchBar
} from '../components/ui';
import { tokens, formatMoney, formatCompactMoney, humanise, formatDateTime } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

type Tab = 'revenue' | 'payments' | 'payouts' | 'settlements';

export const FinanceScreen: React.FC = () => {
  const { can } = useSession();
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(can('finance.revenue.view') ? [{ key: 'revenue' as Tab, label: 'Revenue' }] : []),
    ...(can('finance.payments.view') ? [{ key: 'payments' as Tab, label: 'Payments' }] : []),
    ...(can('finance.payouts.view') ? [{ key: 'payouts' as Tab, label: 'Driver payouts' }] : []),
    ...(can('finance.settlements.view')
      ? [{ key: 'settlements' as Tab, label: 'Restaurant settlements' }]
      : [])
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key || 'revenue');

  if (tabs.length === 0) return <NoAccess permission="finance.revenue.view" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented options={tabs} value={tab} onChange={next => setTab(next as Tab)} />
      </View>
      {tab === 'revenue' ? <RevenueTab /> : null}
      {tab === 'payments' ? <PaymentsTab /> : null}
      {tab === 'payouts' ? <PayoutsTab /> : null}
      {tab === 'settlements' ? <SettlementsTab /> : null}
    </View>
  );
};

/* --------------------------------- Revenue -------------------------------- */

const RevenueTab: React.FC = () => {
  const { api } = useSession();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState('week');
  const resource = useResource(() => api.get<any>(`/admin/revenue${query({ period })}`), [period]);

  if (resource.loading && !resource.data) return <Loading label="Adding it up…" />;
  if (!resource.data) return <EmptyState title="Could not load revenue" message={resource.error || undefined} />;

  const { summary, trend, topRestaurants } = resource.data;
  const chartWidth = Math.max(120, width - tokens.space[5] * 2 - tokens.space[4] * 2);
  const topRevenue = topRestaurants?.[0]?.gross || 1;

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />}
    >
      <Segmented
        options={[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'This week' },
          { key: 'month', label: 'This month' },
          { key: 'all', label: 'All time' }
        ]}
        value={period}
        onChange={setPeriod}
      />

      <View style={s.grid}>
        <StatTile label="Net platform revenue" value={formatCompactMoney(summary.netRevenue)} tone="amber" icon={<IndianRupee size={16} color={c.brand.amber} />} />
        <StatTile label="Gross merchandise value" value={formatCompactMoney(summary.gross)} tone="info" />
        <StatTile label="Orders delivered" value={summary.orders} tone="success" />
        <StatTile label="Average order" value={formatMoney(summary.averageOrderValue)} tone="neutral" />
      </View>

      <Card>
        <Text style={s.cardHeading}>Last 30 days</Text>
        {trend?.length > 1 ? <Sparkline points={trend.map((p: any) => p.netRevenue)} width={chartWidth} height={130} /> : null}
        <View style={s.axis}>
          <Text style={s.axisText}>{trend?.[0]?.date?.slice(5)}</Text>
          <Text style={s.axisText}>Net revenue per day</Text>
          <Text style={s.axisText}>{trend?.[trend.length - 1]?.date?.slice(5)}</Text>
        </View>
      </Card>

      <Card>
        <Text style={s.cardHeading}>Where the money came from</Text>
        <KeyValue label="Commission (15%)" value={formatMoney(summary.commission)} tone="strong" />
        <KeyValue label="Delivery fees" value={formatMoney(summary.deliveryFees)} />
        <KeyValue label="Platform fees" value={formatMoney(summary.platformFees)} />
        <Divider />
        <Text style={s.cardHeading}>And where it went</Text>
        <KeyValue label="Paid to restaurants" value={formatMoney(summary.restaurantPayout)} />
        <KeyValue label="Paid to riders" value={formatMoney(summary.riderPayout)} />
        <KeyValue label="Discounts funded" value={formatMoney(summary.discounts)} />
        <KeyValue label="GST collected for the government" value={formatMoney(summary.taxCollected)} />
        <Divider />
        <KeyValue label="Kept by the platform" value={formatMoney(summary.netRevenue)} tone="money" />
      </Card>

      {topRestaurants?.length ? (
        <Card>
          <Text style={s.cardHeading}>Top restaurants</Text>
          {topRestaurants.map((restaurant: any) => (
            <BarRow
              key={restaurant.id}
              label={restaurant.name}
              value={formatMoney(restaurant.gross)}
              fraction={restaurant.gross / topRevenue}
            />
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
};

/* -------------------------------- Payments -------------------------------- */

const PaymentsTab: React.FC = () => {
  const { api } = useSession();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const resource = useResource(() => api.get<any>(`/admin/payments${query({ status, q: submitted })}`), [status, submitted]);

  const payments = resource.data?.payments || [];
  const totals = resource.data?.totals;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Order number or customer" onSubmit={() => setSubmitted(search.trim())} />
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'PAID', label: 'Paid' },
            { key: 'PENDING', label: 'Pending' },
            { key: 'FAILED', label: 'Failed' },
            { key: 'REFUNDED', label: 'Refunded' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />}
      >
        {totals ? (
          <View style={s.grid}>
            <StatTile label="Collected" value={formatCompactMoney(totals.collected)} tone="success" icon={<CreditCard size={16} color={c.state.success} />} />
            <StatTile label="Pending" value={formatCompactMoney(totals.pending)} tone="warning" />
            <StatTile label="Failed" value={formatCompactMoney(totals.failed)} tone="danger" />
            <StatTile label="Refunded" value={formatCompactMoney(totals.refunded)} tone="neutral" />
          </View>
        ) : null}

        {resource.loading && payments.length === 0 ? <Loading /> : null}
        {!resource.loading && payments.length === 0 ? (
          <EmptyState title="No payments match" message={resource.error || 'Try a different filter.'} />
        ) : null}

        {payments.map((payment: any) => (
          <Card key={payment.orderId}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  #{payment.orderNumber}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {payment.customerName} · {payment.restaurantName}
                </Text>
              </View>
              <Badge label={payment.status} />
            </View>
            <View style={s.paymentGrid}>
              <PayCell label="Charged" value={formatMoney(payment.amount)} />
              <PayCell label="Platform" value={formatMoney(payment.platformEarning)} />
              <PayCell label="Restaurant" value={formatMoney(payment.restaurantPayout)} />
              <PayCell label="Rider" value={formatMoney(payment.riderPayout)} />
            </View>
            <Text style={s.meta} numberOfLines={1}>
              {humanise(payment.method)}
              {payment.couponCode ? ` · ${payment.couponCode} saved ${formatMoney(payment.discount)}` : ''} ·{' '}
              {formatDateTime(payment.createdAt)}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
};

const PayCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={s.payCell}>
    <Text style={s.payValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={s.payLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

/* --------------------------------- Payouts -------------------------------- */

const PayoutsTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [openRider, setOpenRider] = useState<any | null>(null);
  const resource = useResource(() => api.get<any>(`/admin/payouts${query({ q: submitted })}`), [submitted]);

  const rows = resource.data?.payouts || [];
  const totals = resource.data?.totals;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Partner name or ID" onSubmit={() => setSubmitted(search.trim())} />
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />}
      >
        {totals ? (
          <View style={s.grid}>
            <StatTile label="Owed to partners" value={formatCompactMoney(totals.pending)} tone="warning" icon={<Wallet size={16} color={c.state.warning} />} />
            <StatTile label="Paid to date" value={formatCompactMoney(totals.paid)} tone="success" />
            <StatTile label="COD cash with riders" value={formatCompactMoney(totals.codOutstanding)} tone="info" wide />
          </View>
        ) : null}

        {resource.loading && rows.length === 0 ? <Loading /> : null}
        {!resource.loading && rows.length === 0 ? (
          <EmptyState title="No delivery partners" message={resource.error || undefined} />
        ) : null}

        {rows.map((row: any) => (
          <Card key={row.riderId} onPress={() => setOpenRider(row)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {row.riderName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {row.driverCode} · {row.lifetimeTrips} trips delivered
                </Text>
              </View>
              {row.pendingAmount > 0 ? <Badge label="Due" tone="warning" /> : <Badge label="Settled" tone="success" />}
            </View>
            <View style={s.paymentGrid}>
              <PayCell label="Unsettled" value={formatMoney(row.pendingAmount)} />
              <PayCell label="COD held" value={formatMoney(row.codCashInHand)} />
              <PayCell label="Net payable" value={formatMoney(row.netPayable)} />
              <PayCell label="Paid" value={formatMoney(row.paidToDate)} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <PayoutSheet rider={openRider} onClose={() => setOpenRider(null)} onChanged={resource.reload} canManage={can('finance.payouts.manage')} />
    </View>
  );
};

const PayoutSheet: React.FC<{ rider: any | null; onClose: () => void; onChanged: () => void; canManage: boolean }> = ({
  rider,
  onClose,
  onChanged,
  canManage
}) => {
  const { api } = useSession();
  const [bonuses, setBonuses] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const draft = async () => {
    setBusy(true);
    try {
      const result = await api.post<any>('/admin/payouts', {
        riderId: rider.riderId,
        ...(bonuses ? { bonuses: Number(bonuses) } : {})
      });
      setBonuses('');
      onChanged();
      Alert.alert(
        'Payout drafted',
        `${formatMoney(result.payout.netAmount)} covering ${result.payout.tripsCompleted} trip(s). Mark it paid once the transfer has gone out.`
      );
    } catch (err: any) {
      Alert.alert('Could not draft the payout', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (payoutId: string) => {
    setBusy(true);
    try {
      await api.post(`/admin/payouts/${payoutId}/status`, { status: 'PAID', ...(reference ? { reference } : {}) });
      setReference('');
      onChanged();
      Alert.alert('Marked paid', "The amount has been credited to the partner's Quick Bites wallet.");
    } catch (err: any) {
      Alert.alert('Could not mark it paid', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={Boolean(rider)} onClose={onClose} title={rider?.riderName || 'Payout'} subtitle={rider?.driverCode}>
      {rider ? (
        <>
          <Card>
            <Text style={s.cardHeading}>What is owed</Text>
            <KeyValue label="Unsettled trips" value={rider.unsettledTrips} tone="strong" />
            <KeyValue label="Trip earnings" value={formatMoney(rider.pendingAmount)} tone="money" />
            <KeyValue label="COD cash the partner holds" value={`− ${formatMoney(rider.codCashInHand)}`} />
            <Divider />
            <KeyValue label="Net payable now" value={formatMoney(rider.netPayable)} tone="money" />
            <KeyValue label="Paid to date" value={formatMoney(rider.paidToDate)} />
          </Card>

          {canManage ? (
            <Card>
              <Text style={s.cardHeading}>Draft a settlement</Text>
              <Text style={s.muted}>
                Covers every delivered trip not already settled. Cash the partner is holding from COD orders is netted
                off automatically.
              </Text>
              <View style={{ height: tokens.space[4] }} />
              <Field label="Bonus (₹, optional)" value={bonuses} onChangeText={setBonuses} keyboardType="numeric" placeholder="0" />
              <Button
                label={rider.unsettledTrips > 0 ? `Draft payout for ${rider.unsettledTrips} trip(s)` : 'Nothing to settle'}
                disabled={rider.unsettledTrips === 0}
                loading={busy}
                onPress={draft}
              />
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardHeading}>Settlement history</Text>
            {(rider.payouts || []).length === 0 ? <Text style={s.muted}>No payouts yet.</Text> : null}
            {(rider.payouts || []).map((payout: any) => (
              <View key={payout.id} style={s.payoutRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{formatMoney(payout.netAmount)}</Text>
                  <Text style={s.sub}>
                    {payout.tripsCompleted} trips · {formatDateTime(payout.createdAt)}
                  </Text>
                  <Text style={s.payoutBreakdown}>
                    {formatMoney(payout.tripEarnings)} fees
                    {payout.incentives ? ` + ${formatMoney(payout.incentives)} incentives` : ''}
                    {payout.bonuses ? ` + ${formatMoney(payout.bonuses)} bonus` : ''}
                    {payout.deductions ? ` − ${formatMoney(payout.deductions)} COD` : ''}
                  </Text>
                  {payout.reference ? <Text style={s.sub}>Ref {payout.reference}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={payout.status} />
                  {canManage && payout.status !== 'PAID' ? (
                    <Button label="Mark paid" size="sm" loading={busy} onPress={() => markPaid(payout.id)} />
                  ) : null}
                </View>
              </View>
            ))}
            {canManage ? (
              <>
                <Divider />
                <Field label="Bank reference (optional)" value={reference} onChangeText={setReference} placeholder="UTR number" />
              </>
            ) : null}
          </Card>
        </>
      ) : null}
    </Sheet>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  scroll: { padding: tokens.space[5], paddingBottom: tokens.space[8] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[3], marginBottom: tokens.space[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  meta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: tokens.space[3] },
  paymentGrid: {
    flexDirection: 'row',
    gap: tokens.space[2],
    marginTop: tokens.space[3],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  payCell: { flex: 1, minWidth: 0 },
  payValue: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  payLabel: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2 },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  muted: { fontSize: tokens.font.size.sm, color: c.text.muted, lineHeight: 19 },
  payoutRow: {
    flexDirection: 'row',
    gap: tokens.space[3],
    alignItems: 'flex-start',
    paddingVertical: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  payoutBreakdown: { fontSize: tokens.font.size.xxs, color: c.text.secondary, marginTop: 4 }
});

/* --------------------------- Restaurant settlements --------------------------- */

/**
 * Paying the kitchens.
 *
 * The console could pay riders and could show what restaurants had earned, but
 * had no way to actually settle with one — so "have you paid us for last week?"
 * was a question nobody could answer from here. Deliberately the same shape as
 * the driver payouts beside it: drafting a settlement and drafting a payout are
 * the same job, and an administrator should not have to learn it twice.
 */
const SettlementsTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [openRestaurant, setOpenRestaurant] = useState<any | null>(null);
  const resource = useResource(() => api.get<any>(`/admin/settlements${query({ q: submitted })}`), [submitted]);

  const rows = resource.data?.settlements || [];
  const totals = resource.data?.totals;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Restaurant name or city"
          onSubmit={() => setSubmitted(search.trim())}
        />
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />
        }
      >
        {totals ? (
          <View style={s.grid}>
            <StatTile
              label="Owed to restaurants"
              value={formatCompactMoney(totals.pending)}
              tone="warning"
              icon={<Wallet size={16} color={c.state.warning} />}
            />
            <StatTile label="Settled to date" value={formatCompactMoney(totals.paid)} tone="success" />
          </View>
        ) : null}

        {resource.loading && rows.length === 0 ? <Loading /> : null}
        {!resource.loading && rows.length === 0 ? (
          <EmptyState title="No restaurants" message={resource.error || undefined} />
        ) : null}

        {rows.map((row: any) => (
          <Card key={row.restaurantId} onPress={() => setOpenRestaurant(row)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {row.restaurantName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {row.city} · {row.ordersAllTime} orders delivered
                </Text>
              </View>
              {row.pendingAmount > 0 ? <Badge label="Due" tone="warning" /> : <Badge label="Settled" tone="success" />}
            </View>
            <View style={s.paymentGrid}>
              <PayCell label="Unsettled" value={String(row.ordersPending)} />
              <PayCell label="Food sales" value={formatMoney(row.grossPending)} />
              <PayCell label="Net payable" value={formatMoney(row.pendingAmount)} />
              <PayCell label="Paid" value={formatMoney(row.paidToDate)} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <SettlementSheet
        restaurant={openRestaurant}
        onClose={() => setOpenRestaurant(null)}
        onChanged={resource.reload}
        canManage={can('finance.settlements.manage')}
      />
    </View>
  );
};

const SettlementSheet: React.FC<{
  restaurant: any | null;
  onClose: () => void;
  onChanged: () => void;
  canManage: boolean;
}> = ({ restaurant, onClose, onChanged, canManage }) => {
  const { api } = useSession();
  const [adjustments, setAdjustments] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  // The per-order breakdown is fetched only when a sheet is opened: it is the
  // detail behind one restaurant's figure, and loading it for every row would
  // walk every order on the platform to render a list.
  const detail = useResource(
    () =>
      restaurant
        ? api.get<any>(`/admin/settlements/${restaurant.restaurantId}`)
        : Promise.resolve(null as any),
    [restaurant?.restaurantId],
    { enabled: Boolean(restaurant) }
  );

  const draft = async () => {
    setBusy(true);
    try {
      const result = await api.post<any>('/admin/settlements', {
        restaurantId: restaurant.restaurantId,
        ...(adjustments ? { adjustments: Number(adjustments) } : {})
      });
      setAdjustments('');
      onChanged();
      detail.reload();
      Alert.alert(
        'Settlement drafted',
        `${formatMoney(result.settlement.netAmount)} covering ${result.settlement.ordersCount} order(s). Mark it paid once the transfer has gone out.`
      );
    } catch (err: any) {
      Alert.alert('Could not draft the settlement', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (settlementId: string, status: 'PAID' | 'FAILED') => {
    setBusy(true);
    try {
      await api.post(`/admin/settlements/${settlementId}/status`, {
        status,
        ...(reference ? { reference } : {})
      });
      setReference('');
      onChanged();
      detail.reload();
      Alert.alert(
        status === 'PAID' ? 'Marked paid' : 'Marked failed',
        status === 'PAID'
          ? 'The settlement is recorded as transferred.'
          : 'Its orders have been released and will appear in the next settlement.'
      );
    } catch (err: any) {
      Alert.alert('Could not change it', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const pending = detail.data?.pending;
  const lines = detail.data?.lines || [];
  const history = detail.data?.history || [];

  return (
    <Sheet
      visible={Boolean(restaurant)}
      onClose={onClose}
      title={restaurant?.restaurantName || 'Settlement'}
      subtitle={restaurant?.city}
    >
      {restaurant ? (
        <>
          <Card>
            <Text style={s.cardHeading}>What is owed</Text>
            <KeyValue label="Orders awaiting settlement" value={pending?.orders ?? restaurant.ordersPending} tone="strong" />
            <KeyValue label="Food sales" value={formatMoney(pending?.grossSales ?? restaurant.grossPending)} tone="money" />
            <KeyValue label="Platform commission" value={`− ${formatMoney(pending?.commission ?? restaurant.commissionPending)}`} />
            <KeyValue label="TDS withheld" value={`− ${formatMoney(pending?.tds ?? 0)}`} />
            <Divider />
            <KeyValue label="Net payable now" value={formatMoney(pending?.netAmount ?? restaurant.pendingAmount)} tone="money" />
            <KeyValue label="Settled to date" value={formatMoney(restaurant.paidToDate)} />
          </Card>

          {canManage ? (
            <Card>
              <Text style={s.cardHeading}>Draft a settlement</Text>
              <Text style={s.muted}>
                Covers every delivered order not already settled. Use adjustments to recover a refund or apply a
                penalty; the amount is deducted from what is transferred.
              </Text>
              <View style={{ height: tokens.space[4] }} />
              <Field
                label="Adjustments (₹, optional)"
                value={adjustments}
                onChangeText={setAdjustments}
                keyboardType="numeric"
                placeholder="0"
              />
              <Button
                label={
                  (pending?.orders ?? restaurant.ordersPending) > 0
                    ? `Draft settlement for ${pending?.orders ?? restaurant.ordersPending} order(s)`
                    : 'Nothing to settle'
                }
                disabled={(pending?.orders ?? restaurant.ordersPending) === 0}
                loading={busy}
                onPress={draft}
              />
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardHeading}>Orders in the next settlement</Text>
            {detail.loading && lines.length === 0 ? <Loading /> : null}
            {!detail.loading && lines.length === 0 ? <Text style={s.muted}>Nothing outstanding.</Text> : null}
            {lines.slice(0, 40).map((line: any) => (
              <View key={line.orderId} style={s.payoutRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{line.orderNumber}</Text>
                  <Text style={s.sub}>{formatDateTime(line.deliveredAt)}</Text>
                  <Text style={s.payoutBreakdown}>
                    {formatMoney(line.grossSales)} sales − {formatMoney(line.commission)} commission −{' '}
                    {formatMoney(line.tds)} TDS
                  </Text>
                </View>
                <Text style={s.title}>{formatMoney(line.net)}</Text>
              </View>
            ))}
            {lines.length > 40 ? (
              <Text style={s.muted}>and {lines.length - 40} more, all included in the total above.</Text>
            ) : null}
          </Card>

          <Card>
            <Text style={s.cardHeading}>Settlement history</Text>
            {history.length === 0 ? <Text style={s.muted}>No settlements yet.</Text> : null}
            {history.map((row: any) => (
              <View key={row.id} style={s.payoutRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{formatMoney(row.netAmount)}</Text>
                  <Text style={s.sub}>
                    {row.ordersCount} orders · {formatDateTime(row.createdAt)}
                  </Text>
                  <Text style={s.payoutBreakdown}>
                    {formatMoney(row.grossSales)} sales − {formatMoney(row.commission)} commission
                    {row.tds ? ` − ${formatMoney(row.tds)} TDS` : ''}
                    {row.adjustments ? ` − ${formatMoney(row.adjustments)} adjustments` : ''}
                  </Text>
                  {row.reference ? <Text style={s.sub}>Ref {row.reference}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={row.status} />
                  {canManage && row.status !== 'PAID' ? (
                    <>
                      <Button label="Mark paid" size="sm" loading={busy} onPress={() => setStatus(row.id, 'PAID')} />
                      <Button
                        label="Mark failed"
                        size="sm"
                        variant="ghost"
                        loading={busy}
                        onPress={() => setStatus(row.id, 'FAILED')}
                      />
                    </>
                  ) : null}
                </View>
              </View>
            ))}
            {canManage ? (
              <>
                <Divider />
                <Field
                  label="Bank reference (optional)"
                  value={reference}
                  onChangeText={setReference}
                  placeholder="UTR number"
                />
              </>
            ) : null}
          </Card>
        </>
      ) : null}
    </Sheet>
  );
};
