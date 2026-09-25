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
  ResourceError,
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

type Tab = 'revenue' | 'losses' | 'payments' | 'settlements';

export const FinanceScreen: React.FC = () => {
  const { can } = useSession();
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(can('finance.revenue.view') ? [{ key: 'revenue' as Tab, label: 'Revenue' }] : []),
    ...(can('finance.reports.view') ? [{ key: 'losses' as Tab, label: 'Orders that lost money' }] : []),
    ...(can('finance.payments.view') ? [{ key: 'payments' as Tab, label: 'Payments' }] : []),
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
      {tab === 'losses' ? <LossesTab /> : null}
      {tab === 'payments' ? <PaymentsTab /> : null}
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

/* ---------------------------------- Losses --------------------------------- */

/**
 * Delivered orders that cost the platform money (A7), worst first, with what
 * drove each loss, so the owner can see which coupon or which restaurant's
 * delivery pricing to change. The fix is on the Rates screen: "Minimum we keep
 * per order" trims coupons so no order goes below it.
 */
const LossesTab: React.FC = () => {
  const { api } = useSession();
  const [days, setDays] = useState('7');
  const resource = useResource(() => api.get<any>(`/admin/reports/losses${query({ days })}`), [days]);

  if (resource.loading && !resource.data) return <Loading label="Checking every delivered order…" />;
  if (!resource.data) return <EmptyState title="Could not load the loss report" message={resource.error || undefined} />;

  const report = resource.data;
  const orders: any[] = report.orders || [];

  /** The biggest single cause on an order, in plain words. */
  const cause = (o: any) => {
    const riderGap = Math.max(0, (Number(o.riderCost) || 0) - (Number(o.deliveryFee) || 0));
    const parts = [
      { amount: Number(o.couponDiscount) || 0, text: `Coupon ${o.couponCode || ''}`.trim() },
      { amount: Number(o.membershipDiscount) || 0, text: 'Membership discount' },
      { amount: riderGap, text: 'Rider paid more than the delivery fee' }
    ].sort((a, b) => b.amount - a.amount);
    return parts[0].amount > 0 ? `${parts[0].text} (${formatMoney(parts[0].amount)})` : 'Commission too low for this order';
  };

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={resource.loading} onRefresh={resource.reload} tintColor={c.brand.amber} />}
    >
      <Segmented
        options={[
          { key: '1', label: 'Today' },
          { key: '7', label: '7 days' },
          { key: '30', label: '30 days' },
          { key: '90', label: '90 days' }
        ]}
        value={days}
        onChange={setDays}
      />

      <View style={s.grid}>
        <StatTile
          label="Orders that lost money"
          value={`${report.lossMaking} of ${report.delivered}`}
          tone={report.lossMaking > 0 ? 'danger' : 'success'}
        />
        <StatTile label="Total lost" value={formatMoney(report.totalLoss)} tone={report.totalLoss > 0 ? 'danger' : 'success'} />
      </View>

      {orders.length === 0 ? (
        <EmptyState title="No order lost money" message="Every delivered order in this period kept something for the platform." />
      ) : (
        <Card>
          <Text style={s.cardHeading}>Worst first</Text>
          {orders.map(o => (
            <View key={o.orderId}>
              <KeyValue label={`#${o.orderNumber} · ${o.restaurantName || o.restaurantId}`} value={formatMoney(o.contribution)} tone="strong" />
              <Text style={s.lossCause}>{cause(o)}</Text>
              <Divider />
            </View>
          ))}
        </Card>
      )}

      <Text style={s.lossCause}>
        {report.note} To stop this, set "Least we keep per order" on the Rates screen: coupons are then trimmed so no
        order goes below it.
      </Text>
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

/*
 * The "Driver payouts" tab was removed.
 *
 * It drafted rider settlements through a second payout system that wrote
 * nothing to the ledger, so the platform held two disagreeing answers to what
 * a rider was owed and how much of our cash they were carrying. Driver
 * payouts are made from the Payouts section, where the amount is computed
 * from the ledger rather than typed, and every state change is recorded.
 */

const s = StyleSheet.create({
  lossCause: { fontSize: 12, color: c.text.secondary, marginTop: 2, marginBottom: 8, lineHeight: 17 },
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

            {/*
              * Where a settlement would land, on the row it is settled from.
              *
              * The owner asked that a verified account be attached to the
              * partner's profile "so they can pay everything as settlement".
              * Knowing the destination on the profile screen is no use if the
              * screen somebody actually pays from does not show it -- checking
              * would mean leaving the row, and a step you have to remember is
              * one that gets skipped on a busy payday.
              */}
            {row.willPayInto ? (
              <Text style={s.sub} numberOfLines={1}>
                Pays to {row.willPayInto.holderName} ·{' '}
                {row.willPayInto.method === 'VPA'
                  ? row.willPayInto.vpa
                  : `ending ${row.willPayInto.accountLast4 || '----'}`}
              </Text>
            ) : row.pendingAmount > 0 ? (
              <Text style={[s.sub, { color: c.state.warning }]} numberOfLines={2}>
                {row.payoutBlockedReason || 'No account connected — this partner cannot be paid.'}
              </Text>
            ) : null}
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

  /*
   * The sheet renders these three as empty when the request fails, so a partner
   * with unsettled money reads as a partner with nothing outstanding. The error
   * goes at the top of the sheet body below.
   */
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
      <ResourceError resource={detail} what="This settlement" />
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
                The amount comes from the ledger — the same figure the Pay screen shows, so the two cannot
                disagree. Refunds are already deducted automatically when the refund is sent.
              </Text>
              {/*
                THE HINT HERE USED TO CAUSE A DOUBLE DEDUCTION.
                It said "use adjustments to recover a refund". But a refund already debits
                the kitchen's share from what they are owed, the moment it is sent — so
                following that instruction deducted the same refund twice, against the
                partner. The field is kept so an older app build still renders, and the
                server now refuses a non-zero value and says why.
              */}
              <View style={{ height: tokens.space[4] }} />
              <Field
                label="Adjustments (₹) — no longer used"
                value={adjustments}
                onChangeText={setAdjustments}
                keyboardType="numeric"
                placeholder="0"
                hint="Leave this at zero. Refunds already come off what a restaurant is owed."
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
