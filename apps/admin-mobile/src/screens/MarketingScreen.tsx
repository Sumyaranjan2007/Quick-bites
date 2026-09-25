import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Ticket, Star } from 'lucide-react-native';
import {
  Card,
  Segmented,
  SearchBar,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  NoAccess,
  Toggle
} from '../components/ui';
import { tokens, formatMoney, formatDateTime, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

type Tab = 'coupons' | 'reviews';

export const MarketingScreen: React.FC = () => {
  const { can } = useSession();
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(can('marketing.coupons.manage') ? [{ key: 'coupons' as Tab, label: 'Coupons' }] : []),
    ...(can('reviews.view') ? [{ key: 'reviews' as Tab, label: 'Reviews' }] : [])
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key || 'coupons');

  if (tabs.length === 0) return <NoAccess permission="marketing.coupons.manage" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented options={tabs} value={tab} onChange={next => setTab(next as Tab)} />
      </View>
      {tab === 'coupons' ? <CouponsTab /> : null}
      {tab === 'reviews' ? <ReviewsTab /> : null}
    </View>
  );
};

/* --------------------------------- Coupons -------------------------------- */

const EMPTY_COUPON = {
  code: '',
  title: '',
  description: '',
  discountType: 'FLAT' as 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY',
  discountValue: '',
  minOrderValue: '',
  maxDiscountCap: '',
  usageLimit: '',
  perUserLimit: '',
  budget: '',
  newCustomersOnly: false,
  days: '',
  isActive: true
};

const CouponsTab: React.FC = () => {
  const { api } = useSession();
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_COUPON });
  const [busy, setBusy] = useState(false);
  const list = useResource(() => api.get<any>('/admin/coupons'), []);
  const coupons = list.data?.coupons || [];

  const create = async () => {
    const value = Number(form.discountValue);
    if (!form.code.trim() || (!value && form.discountType !== 'FREE_DELIVERY')) {
      Alert.alert('Check the details', 'A code and a discount value are both required.');
      return;
    }
    if (form.discountType === 'PERCENTAGE' && !Number(form.maxDiscountCap)) {
      Alert.alert('Set a ceiling', 'A percentage campaign needs a maximum discount, or one large order can spend the budget.');
      return;
    }

    setBusy(true);
    try {
      const days = Number(form.days);
      await api.post('/admin/coupons', {
        code: form.code.trim().toUpperCase(),
        title: form.title.trim() || undefined,
        description: form.description.trim() || undefined,
        discountType: form.discountType,
        discountValue: form.discountType === 'FREE_DELIVERY' ? 100 : value,
        ...(Number(form.minOrderValue) ? { minOrderValue: Number(form.minOrderValue) } : {}),
        ...(Number(form.maxDiscountCap) ? { maxDiscountCap: Number(form.maxDiscountCap) } : {}),
        ...(Number(form.usageLimit) ? { usageLimit: Number(form.usageLimit) } : {}),
        ...(Number(form.perUserLimit) ? { perUserLimit: Number(form.perUserLimit) } : {}),
        ...(Number(form.budget) ? { budget: Number(form.budget) } : {}),
        ...(form.newCustomersOnly ? { newCustomersOnly: true } : {}),
        ...(days
          ? {
              startsAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + days * 86400000).toISOString()
            }
          : {}),
        isActive: form.isActive
      });
      setForm({ ...EMPTY_COUPON });
      setComposing(false);
      await list.reload();
    } catch (err: any) {
      Alert.alert('Could not create the coupon', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (coupon: any) => {
    try {
      await api.patch(`/admin/coupons/${coupon.code}`, { isActive: !coupon.isActive });
      await list.silentReload();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    }
  };

  const remove = (coupon: any) => {
    Alert.alert(
      'Delete this coupon?',
      coupon.timesUsed > 0
        ? `${coupon.code} has been used on ${coupon.timesUsed} order(s), so it will be deactivated and kept for the record.`
        : `${coupon.code} has never been used and will be removed completely.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.del(`/admin/coupons/${coupon.code}`);
              await list.reload();
            } catch (err: any) {
              Alert.alert('Could not delete', err?.message || 'Nothing was changed.');
            }
          }
        }
      ]
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        <Button label="Create a coupon" onPress={() => setComposing(true)} style={{ marginBottom: tokens.space[4] }} />

        {list.loading && coupons.length === 0 ? <Loading /> : null}
        {!list.loading && coupons.length === 0 ? (
          <EmptyState title="No campaigns yet" message="A coupon created here is honoured at checkout immediately." icon={<Ticket size={34} color={c.text.muted} />} />
        ) : null}

        {coupons.map((coupon: any) => (
          <Card key={coupon.code}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.code}>{coupon.code}</Text>
                <Text style={s.sub} numberOfLines={2}>
                  {coupon.title || coupon.description || describeCoupon(coupon)}
                </Text>
              </View>
              <Badge
                label={coupon.effectiveStatus}
                tone={coupon.effectiveStatus === 'LIVE' ? 'success' : coupon.effectiveStatus === 'SCHEDULED' ? 'info' : 'neutral'}
              />
            </View>

            <Divider />
            <KeyValue label="Discount" value={describeCoupon(coupon)} tone="strong" />
            {coupon.minOrderValue ? <KeyValue label="Minimum order" value={formatMoney(coupon.minOrderValue)} /> : null}
            {coupon.usageLimit ? <KeyValue label="Usage" value={`${coupon.timesUsed} of ${coupon.usageLimit} claimed`} /> : (
              <KeyValue label="Used" value={`${coupon.timesUsed} time${coupon.timesUsed === 1 ? '' : 's'}`} />
            )}
            {coupon.perUserLimit ? <KeyValue label="Per customer" value={`${coupon.perUserLimit} use(s)`} /> : null}
            {coupon.budget ? <KeyValue label="Budget" value={`Rs ${coupon.spent || 0} of Rs ${coupon.budget} spent`} /> : null}
            {coupon.newCustomersOnly ? <KeyValue label="Who" value="First order only" /> : null}
            {coupon.expiresAt ? <KeyValue label="Ends" value={formatDateTime(coupon.expiresAt)} /> : null}
            <KeyValue label="Discount given" value={formatMoney(coupon.discountGiven)} tone="money" />
            <KeyValue label="Revenue influenced" value={formatMoney(coupon.revenueInfluenced)} />

            <Divider />
            <View style={s.actionRow}>
              <Button label={coupon.isActive ? 'Pause' : 'Resume'} size="sm" variant="secondary" full onPress={() => toggle(coupon)} />
              <Button label="Delete" size="sm" variant="danger" full onPress={() => remove(coupon)} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <Sheet
        visible={composing}
        onClose={() => setComposing(false)}
        title="Create a coupon"
        subtitle="Every condition set here is enforced at checkout."
        footer={
          <>
            <Button label="Cancel" variant="secondary" full onPress={() => setComposing(false)} />
            <Button label="Create" full loading={busy} onPress={create} />
          </>
        }
      >
        <Card>
          <Field label="Code" value={form.code} onChangeText={v => setForm(f => ({ ...f, code: v.toUpperCase() }))} placeholder="MONSOON40" autoCapitalize="none" hint="This is what the customer types at checkout." />
          <Field label="Title" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="Monsoon offer" />
          <Field label="Description" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} placeholder="₹40 off when it rains." multiline />
        </Card>

        <Card>
          <Text style={s.cardHeading}>Discount</Text>
          <Segmented
            options={[
              { key: 'FLAT', label: 'Flat ₹' },
              { key: 'PERCENTAGE', label: 'Percentage' },
              { key: 'FREE_DELIVERY', label: 'Free delivery' }
            ]}
            value={form.discountType}
            onChange={v => setForm(f => ({ ...f, discountType: v as any }))}
          />
          {form.discountType !== 'FREE_DELIVERY' ? (
            <Field
              label={form.discountType === 'PERCENTAGE' ? 'Percentage off' : 'Amount off (₹)'}
              value={form.discountValue}
              onChangeText={v => setForm(f => ({ ...f, discountValue: v }))}
              keyboardType="numeric"
            />
          ) : null}
          {form.discountType === 'PERCENTAGE' ? (
            <Field
              label="Maximum discount (₹)"
              value={form.maxDiscountCap}
              onChangeText={v => setForm(f => ({ ...f, maxDiscountCap: v }))}
              keyboardType="numeric"
              hint="Required — this is the ceiling on what one order can take."
            />
          ) : null}
          <Field label="Minimum order value (₹)" value={form.minOrderValue} onChangeText={v => setForm(f => ({ ...f, minOrderValue: v }))} keyboardType="numeric" placeholder="Optional" />
        </Card>

        <Card>
          <Text style={s.cardHeading}>Limits</Text>
          <Field label="Total redemptions" value={form.usageLimit} onChangeText={v => setForm(f => ({ ...f, usageLimit: v }))} keyboardType="numeric" placeholder="Leave blank for unlimited" />
          <Field label="Per customer" value={form.perUserLimit} onChangeText={v => setForm(f => ({ ...f, perUserLimit: v }))} keyboardType="numeric" placeholder="Leave blank for unlimited" />
          <Field label="Runs for (days)" value={form.days} onChangeText={v => setForm(f => ({ ...f, days: v }))} keyboardType="numeric" placeholder="Leave blank for no end date" />
          <Field label="Campaign budget (Rs)" value={form.budget} onChangeText={v => setForm(f => ({ ...f, budget: v }))} keyboardType="numeric" placeholder="Most this offer may cost in discounts. Blank = no cap" />
          <Toggle label="First order only (new customers)" value={form.newCustomersOnly} onChange={v => setForm(f => ({ ...f, newCustomersOnly: v }))} />
          <Toggle label="Start it live" value={form.isActive} onChange={v => setForm(f => ({ ...f, isActive: v }))} />
        </Card>
      </Sheet>
    </View>
  );
};

function describeCoupon(coupon: any): string {
  if (coupon.discountType === 'FREE_DELIVERY') return 'Free delivery';
  if (coupon.discountType === 'PERCENTAGE') {
    return `${coupon.discountValue}% off${coupon.maxDiscountCap ? `, up to ${formatMoney(coupon.maxDiscountCap)}` : ''}`;
  }
  return `${formatMoney(coupon.discountValue)} off`;
}

/* --------------------------------- Reviews -------------------------------- */

const ReviewsTab: React.FC = () => {
  const { api, can } = useSession();
  const [rating, setRating] = useState('ALL');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [reason, setReason] = useState('');
  const [moderating, setModerating] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useResource(() => api.get<any>(`/admin/reviews${query({ rating, q: submitted })}`), [rating, submitted]);
  const reviews = list.data?.reviews || [];
  const summary = list.data?.summary;
  const canModerate = can('reviews.moderate');

  const moderate = async (review: any, action: 'HIDE' | 'RESTORE') => {
    if (action === 'HIDE' && !reason.trim()) {
      Alert.alert('A reason is required', 'Record why this review is being hidden.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/reviews/${review.orderId}/moderate`, { action, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setModerating(null);
      setReason('');
      await list.reload();
    } catch (err: any) {
      Alert.alert('Could not moderate', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Comment, customer or restaurant" onSubmit={() => setSubmitted(search.trim())} />
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'LOW', label: 'Poor (1–2)' },
            { key: '5', label: '5 star' },
            { key: '4', label: '4 star' },
            { key: '3', label: '3 star' }
          ]}
          value={rating}
          onChange={setRating}
        />
        {summary ? (
          <Text style={s.summary}>
            {summary.total} reviews · {summary.average} average · {summary.lowRated} poor · {summary.hidden} hidden
          </Text>
        ) : null}
      </View>

      {list.loading && reviews.length === 0 ? <Loading /> : null}
      {!list.loading && reviews.length === 0 ? (
        <EmptyState title="No reviews match" message={list.error || 'Customers rate an order once it has arrived.'} icon={<Star size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {reviews.map((review: any) => (
          <Card key={review.orderId}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.stars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {review.restaurantName} · #{review.orderNumber}
                </Text>
              </View>
              {review.isHidden ? <Badge label="Hidden" tone="danger" /> : null}
            </View>

            {review.comment ? <Text style={s.comment}>“{review.comment}”</Text> : <Text style={s.noComment}>No comment left.</Text>}

            <Text style={s.meta}>
              {review.customerName} · {timeAgo(review.ratedAt)}
              {review.riderRating ? ` · rider rated ${review.riderRating}/5` : ''}
            </Text>

            {canModerate ? (
              moderating?.orderId === review.orderId ? (
                <>
                  <Divider />
                  <Field label="Why is it being hidden?" value={reason} onChangeText={setReason} placeholder="Abusive language about the delivery partner." multiline />
                  <View style={s.actionRow}>
                    <Button label="Back" variant="secondary" full onPress={() => setModerating(null)} />
                    <Button label="Hide it" variant="danger" full loading={busy} onPress={() => moderate(review, 'HIDE')} />
                  </View>
                </>
              ) : (
                <>
                  <Divider />
                  {review.isHidden ? (
                    <Button label="Restore this review" size="sm" variant="secondary" loading={busy} onPress={() => moderate(review, 'RESTORE')} />
                  ) : (
                    <Button label="Hide this review" size="sm" variant="secondary" onPress={() => setModerating(review)} />
                  )}
                </>
              )
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2], paddingBottom: tokens.space[8] },
  summary: { fontSize: tokens.font.size.xs, color: c.text.muted, marginBottom: tokens.space[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  code: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText, letterSpacing: 1 },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 4, lineHeight: 16 },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  // Mid gold rather than the bright brand gold: star glyphs in #FFC928 on a
  // cream ground are about 1.7:1 and read as a smudge.
  stars: { fontSize: tokens.font.size.md, color: c.state.warning, letterSpacing: 2 },
  comment: { fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 20, marginTop: tokens.space[3], fontStyle: 'italic' },
  noComment: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: tokens.space[3] },
  meta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: tokens.space[3] }
});
