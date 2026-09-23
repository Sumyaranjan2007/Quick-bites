import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { Store, Search, TriangleAlert, ChevronLeft, Package } from 'lucide-react-native';
import { Card, Button, Loading, EmptyState, SearchBar, Badge, KeyValue } from '../components/ui';
import { tokens, formatMoney } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * Typing what the customer pays for one dish.
 *
 * -------------------------------------------------------------------------
 * WHY EVERY ROW SAVES ITSELF
 * -------------------------------------------------------------------------
 * A sixty-dish menu behind one Save button loses the whole lot on one failed
 * request -- and that only happens on a bad connection, which is exactly the
 * condition somebody pricing a menu on a phone is most likely to be in. So each
 * row is its own request and reports its own result. A failure costs one dish
 * rather than an afternoon of typing.
 *
 * -------------------------------------------------------------------------
 * WHAT THE NUMBERS MEAN
 * -------------------------------------------------------------------------
 * Three figures per dish and they must never be confused: what the KITCHEN
 * charges (what they are paid), what the CUSTOMER pays (what is typed here), and
 * the margin between them. The screen shows all three on every row rather than
 * making anybody subtract, because a margin somebody has to work out in their
 * head is a margin they get wrong.
 */
export const MenuPricingTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [openRestaurant, setOpenRestaurant] = useState<{ id: string; name: string } | null>(null);

  const list = useResource<any>(() => api.get('/admin/rates/restaurants').then(r => r.data), []);

  if (openRestaurant) {
    return (
      <RestaurantMenuPrices
        restaurant={openRestaurant}
        onBack={() => setOpenRestaurant(null)}
        canEdit={can('finance.config.edit')}
      />
    );
  }

  const restaurants = (list.data?.restaurants || []).filter((r: any) =>
    !search.trim() ? true : String(r.name || '').toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <View style={{ flex: 1 }}>
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Restaurant name"
        onSubmit={() => undefined}
      />

      {list.loading && !list.data ? <Loading label="Reading your restaurants…" /> : null}

      {!list.loading && restaurants.length === 0 ? (
        <EmptyState
          title="No restaurants match"
          message={list.error || 'Try a different search.'}
          icon={<Search size={28} color={c.text.muted} />}
        />
      ) : null}

      {restaurants.map((r: any) => (
        <Card key={r.restaurantId || r.id} onPress={() => setOpenRestaurant({ id: r.restaurantId || r.id, name: r.name })}>
          <View style={s.rowTop}>
            <Store size={16} color={c.text.secondary} />
            <Text style={s.name} numberOfLines={1}>
              {r.name}
            </Text>
          </View>
          <Text style={s.sub}>
            {r.foodMarkupPercent > 0
              ? `${r.foodMarkupPercent}% on every dish unless you price one`
              : 'No percentage set — dishes cost what the kitchen charges unless you price them'}
          </Text>
        </Card>
      ))}
    </View>
  );
};

const RestaurantMenuPrices: React.FC<{
  restaurant: { id: string; name: string };
  onBack: () => void;
  canEdit: boolean;
}> = ({ restaurant, onBack, canEdit }) => {
  const { api } = useSession();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  /** Per row, so one failure is visible on the row that caused it. */
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowDone, setRowDone] = useState<Record<string, string>>({});

  const menu = useResource<any>(
    () => api.get(`/admin/rates/restaurants/${restaurant.id}/menu`).then(r => r.data),
    [restaurant.id]
  );

  const saveOne = async (item: any, clear = false) => {
    setSaving(item.id);
    setRowError(e => ({ ...e, [item.id]: '' }));
    setRowDone(d => ({ ...d, [item.id]: '' }));
    try {
      const typed = clear ? null : Number(edits[item.id]);
      const res = await api.put(`/admin/rates/restaurants/${restaurant.id}/menu/${item.id}`, {
        customerPrice: clear ? null : typed
      });
      setRowDone(d => ({ ...d, [item.id]: res?.message || 'Saved.' }));
      setEdits(e => {
        const next = { ...e };
        delete next[item.id];
        return next;
      });
      await menu.silentReload();
    } catch (err: any) {
      // Shown on the row rather than as a screen-level banner. A refusal names
      // both prices, and it belongs beside the dish it is about.
      setRowError(e => ({ ...e, [item.id]: err?.message || 'That price could not be saved.' }));
    } finally {
      setSaving(null);
    }
  };

  if (menu.loading && !menu.data) return <Loading label={`Reading ${restaurant.name}…`} />;

  const summary = menu.data?.summary;
  const packaging = menu.data?.packaging;

  return (
    <ScrollView
      contentContainerStyle={s.list}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={menu.loading} onRefresh={menu.reload} tintColor={c.brand.amber} />
      }
    >
      <Button label="All restaurants" variant="ghost" onPress={onBack} icon={<ChevronLeft size={16} color={c.text.secondary} />} />

      <Card>
        <Text style={s.heading}>{restaurant.name}</Text>
        {summary ? (
          <>
            <KeyValue label="Dishes on the menu" value={summary.dishes} />
            <KeyValue label="Priced by you" value={summary.markedUp} tone="strong" />
            <KeyValue label="Earning us something" value={summary.earning} />
            <KeyValue label="Average margin" value={formatMoney(summary.averageMarginRupees)} tone="money" />
            {summary.foodMarkupPercent > 0 ? (
              <KeyValue label="Percentage on the rest" value={`${summary.foodMarkupPercent}%`} />
            ) : null}
          </>
        ) : null}

        {/*
          * Stale prices for dishes that have been deleted. Shown rather than
          * cleaned up quietly: if this grows, dishes are being removed after
          * being priced, and that is worth knowing.
          */}
        {summary?.orphanedPrices > 0 ? (
          <View style={s.warnRow}>
            <TriangleAlert size={14} color={c.state.warning} />
            <Text style={s.warnText}>
              {summary.orphanedPrices} price{summary.orphanedPrices === 1 ? '' : 's'} belong to dishes that
              have been deleted. They affect nothing, and they mean dishes are being removed after being
              priced.
            </Text>
          </View>
        ) : null}
      </Card>

      {/* Packaging, here because the owner asked for it here. */}
      {packaging ? (
        <Card>
          <View style={s.rowTop}>
            <Package size={16} color={c.text.secondary} />
            <Text style={s.heading}>Packaging</Text>
          </View>
          <KeyValue label="The kitchen is paid" value={formatMoney(packaging.partnerPackagingFee)} />
          <KeyValue label="The customer pays" value={formatMoney(packaging.customerPackagingFee)} tone="strong" />
          <KeyValue label="We keep" value={formatMoney(packaging.packagingMarkup)} tone="money" />
          <Text style={s.sub}>Set this per restaurant under “Per restaurant”.</Text>
        </Card>
      ) : null}

      {(menu.data?.categories || []).map((category: any) => (
        <View key={category.id || category.name}>
          <Text style={s.categoryName}>{category.name}</Text>

          {(category.items || []).map((item: any) => {
            const edited = edits[item.id];
            const shown = edited ?? (item.typedPrice === null ? '' : String(item.typedPrice));
            const preview = edited !== undefined && edited !== '' ? Number(edited) : item.customerPrice;
            const previewMargin = Number.isFinite(preview) ? preview - item.kitchenPrice : 0;

            return (
              <Card key={item.id} style={s.itemCard}>
                <View style={s.rowTop}>
                  <Text style={s.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.source === 'TYPED' ? (
                    <Badge label="Priced" tone="success" />
                  ) : item.source === 'PERCENTAGE' ? (
                    <Badge label="Percentage" />
                  ) : null}
                </View>

                <View style={s.figures}>
                  <Figure label="Kitchen charges" value={formatMoney(item.kitchenPrice)} />
                  <Figure label="Customer pays" value={formatMoney(item.customerPrice)} strong />
                  <Figure
                    label="We keep"
                    value={formatMoney(item.marginRupees)}
                    tone={item.marginRupees > 0 ? 'money' : undefined}
                  />
                </View>

                {canEdit ? (
                  <>
                    <View style={s.editRow}>
                      <TextInput
                        style={s.input}
                        value={shown}
                        keyboardType="decimal-pad"
                        placeholder={`At least ${item.kitchenPrice}`}
                        placeholderTextColor={c.text.muted}
                        onChangeText={v =>
                          setEdits(e => ({ ...e, [item.id]: v.replace(/[^0-9.]/g, '') }))
                        }
                      />
                      <Button
                        label={saving === item.id ? 'Saving…' : 'Save'}
                        onPress={() => saveOne(item)}
                        disabled={saving === item.id || edited === undefined || edited === ''}
                      />
                    </View>

                    {/* The margin the typed number WOULD produce, before saving.
                        Typing a price and then working out the margin in your
                        head is how a dish gets priced below cost. */}
                    {edited !== undefined && edited !== '' ? (
                      <Text style={previewMargin < 0 ? s.previewBad : s.preview}>
                        {previewMargin < 0
                          ? `That is ${formatMoney(Math.abs(previewMargin))} BELOW what the kitchen is paid — it would lose money on every order.`
                          : `You would keep ${formatMoney(previewMargin)} on every one.`}
                      </Text>
                    ) : null}

                    {item.typedPrice !== null ? (
                      <Button
                        label="Clear, and follow the percentage"
                        variant="ghost"
                        onPress={() => saveOne(item, true)}
                        disabled={saving === item.id}
                      />
                    ) : null}
                  </>
                ) : null}

                {!!rowError[item.id] && <Text style={s.rowError}>{rowError[item.id]}</Text>}
                {!!rowDone[item.id] && <Text style={s.rowDone}>{rowDone[item.id]}</Text>}
              </Card>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
};

const Figure: React.FC<{ label: string; value: string; strong?: boolean; tone?: string }> = ({
  label,
  value,
  strong,
  tone
}) => (
  <View style={{ flex: 1 }}>
    <Text style={s.figureLabel}>{label}</Text>
    <Text style={[s.figureValue, strong ? s.figureStrong : null, tone === 'money' ? s.figureMoney : null]}>
      {value}
    </Text>
  </View>
);

const s = StyleSheet.create({
  list: { gap: tokens.space[3], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: tokens.font.size.md, color: c.text.primary, fontWeight: '700' },
  heading: { fontSize: tokens.font.size.md, color: c.text.primary, fontWeight: '700' },
  sub: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 4 },
  categoryName: {
    fontSize: tokens.font.size.xs,
    color: c.text.secondary,
    fontWeight: '700',
    marginTop: tokens.space[3],
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  itemCard: { marginBottom: tokens.space[2] },
  itemName: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: '600' },
  figures: { flexDirection: 'row', gap: tokens.space[3], marginTop: tokens.space[2] },
  figureLabel: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  figureValue: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: '600', marginTop: 2 },
  figureStrong: { color: c.brand.amberText },
  figureMoney: { color: c.state.success },
  editRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: tokens.space[3] },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: c.text.primary,
    backgroundColor: c.bg.raised
  },
  preview: { fontSize: tokens.font.size.xxs, color: c.state.success, marginTop: 6 },
  previewBad: { fontSize: tokens.font.size.xxs, color: c.state.danger, marginTop: 6, fontWeight: '700' },
  rowError: { fontSize: tokens.font.size.xxs, color: c.state.danger, marginTop: 6 },
  rowDone: { fontSize: tokens.font.size.xxs, color: c.state.success, marginTop: 6 },
  warnRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: tokens.space[3] },
  warnText: { flex: 1, fontSize: tokens.font.size.xxs, color: c.state.warning }
});
