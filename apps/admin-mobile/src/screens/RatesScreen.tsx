import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, TouchableOpacity } from 'react-native';
import { Store, Percent, TriangleAlert, Info, Gift, Search } from 'lucide-react-native';
import {
  Card,
  Button,
  Sheet,
  Divider,
  Loading,
  NoAccess,
  EmptyState,
  SectionTitle,
  Segmented,
  Badge
} from '../components/ui';
import { tokens } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface ChargeRow {
  restaurantId: string;
  name: string;
  partnerDeclared: boolean;
  partnerPackagingFee: number;
  customerPackagingFee: number;
  packagingMargin: number;
  platformFee: number;
  gstFoodPercent: number;
  commissionPercent: number;
  deliveryBaseFee: number;
  extraCharge: number;
  extraChargeLabel: string;
  overridden: string[];
  marginNote: string;
}

interface RatesPayload {
  restaurants: ChargeRow[];
  defaults: Record<string, number>;
  bounds: Record<string, { min: number; max: number; unit: string; label: string }>;
}

interface Incentive {
  code: string;
  enabled: boolean;
  reward: number;
  target: number;
}

const rupees = (n: number) => `Rs ${(Number(n) || 0).toLocaleString('en-IN')}`;

const INCENTIVE_LABEL: Record<string, string> = {
  DAILY_8: 'Daily Dash — trips in one day',
  PEAK_5: 'Dinner Rush — trips in the evening peak',
  WEEK_20: 'Steady Week — trips in one week',
  WEEK_40: 'Full Week — trips in one week',
  WEEK_RATING: 'Five Star Service — average rating held'
};

/**
 * Rates: what each restaurant costs a customer, and what we keep.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS SCREEN IS FOR, IN THE OWNER'S WORDS
 * -------------------------------------------------------------------------
 * *"The rates section is what admin will see exactly how much each restaurant
 * is costing... admin can edit which restaurant will have extra charges for the
 * platform fees... and the charges will actually apply to the users."*
 *
 * It used to be a list of platform-wide defaults — commission, TDS, hold
 * periods, payout thresholds. Useful, but not this. That configuration still
 * exists as the fallback every restaurant starts from; this screen is the one
 * the owner asked for, and it is per restaurant.
 *
 * -------------------------------------------------------------------------
 * THE MARKUP IS SHOWN IN WORDS, NOT ONLY AS A NUMBER
 * -------------------------------------------------------------------------
 * Every restaurant row says, in a sentence, who gets what: the customer pays
 * this, the restaurant earns that, and the difference is ours. The whole reason
 * this feature exists is that the two figures are different and must not be
 * confused, and a screen showing two numbers side by side without saying which
 * is which is exactly how they get confused.
 */
export const RatesScreen: React.FC = () => {
  const { api, can } = useSession();
  const canView = can('finance.config.edit', 'finance.reports.view');
  const canEdit = can('finance.config.edit');

  const [tab, setTab] = useState('restaurants');
  const [search, setSearch] = useState('');

  const rates = useResource<RatesPayload>(() => api.get('/admin/rates/restaurants').then(r => r.data), [], {
    enabled: canView
  });
  const platform = useResource<any>(() => api.get('/admin/pricing/config').then(r => r.data), [], {
    enabled: canView
  });
  const bonuses = useResource<{ incentives: Incentive[]; note: string }>(
    () => api.get('/admin/rates/incentives').then(r => r.data),
    [],
    { enabled: canView }
  );

  const [platformEdits, setPlatformEdits] = useState<Record<string, string>>({});
  const [platformNote, setPlatformNote] = useState('');

  const [editing, setEditing] = useState<ChargeRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const rows = rates.data?.restaurants || [];
    const term = search.trim().toLowerCase();
    return term ? rows.filter(r => r.name.toLowerCase().includes(term)) : rows;
  }, [rates.data, search]);

  if (!canView) return <NoAccess permission="finance.config.edit" />;
  if (rates.loading && !rates.data) return <Loading label="Reading what each restaurant costs…" />;

  const open = (row: ChargeRow) => {
    setEditing(row);
    setForm({
      customerPackagingFee: String(row.customerPackagingFee),
      platformFee: String(row.platformFee),
      gstFoodPercent: String(row.gstFoodPercent),
      commissionPercent: String(row.commissionPercent),
      deliveryBaseFee: String(row.deliveryBaseFee),
      extraCharge: String(row.extraCharge),
      extraChargeLabel: row.extraChargeLabel
    });
    setNote('');
    setError(null);
  };

  const num = (key: string) => {
    const raw = (form[key] ?? '').replace(/[^0-9.]/g, '');
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  };

  const liveMargin = editing ? Math.round((num('customerPackagingFee') - editing.partnerPackagingFee) * 100) / 100 : 0;

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/admin/rates/restaurants/${editing.restaurantId}`, {
        customerPackagingFee: num('customerPackagingFee'),
        platformFee: num('platformFee'),
        gstFoodPercent: num('gstFoodPercent'),
        commissionPercent: num('commissionPercent'),
        deliveryBaseFee: num('deliveryBaseFee'),
        extraCharge: num('extraCharge'),
        extraChargeLabel: form.extraChargeLabel || '',
        ...(note.trim() ? { note: note.trim() } : {})
      });
      setEditing(null);
      await rates.reload();
    } catch (err: any) {
      setError(err?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const toggleBonus = async (incentive: Incentive, changes: Partial<Incentive>) => {
    setBusy(true);
    try {
      await api.put('/admin/rates/incentives', {
        changes: [{ code: incentive.code, ...changes }]
      });
      await bonuses.reload();
    } catch (err: any) {
      setError(err?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={rates.loading} onRefresh={rates.reload} />}
        keyboardShouldPersistTaps="handled"
      >
        <Segmented
          options={[
            { key: 'restaurants', label: 'Per restaurant' },
            { key: 'platform', label: 'Rider pay & defaults' },
            { key: 'bonuses', label: 'Rider bonuses' }
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'restaurants' && (
          <>
            <Card style={s.explainer}>
              <View style={s.head}>
                <Info size={16} color={c.text.secondary} />
                <Text style={s.explainerTitle}>How this works</Text>
              </View>
              <Text style={s.explainerBody}>
                A restaurant tells us what it charges for packaging. You decide what the CUSTOMER pays. If you
                charge more than the restaurant asked for, the difference is ours — the restaurant is still
                paid only what it asked for.
              </Text>
              <Text style={s.explainerBody}>
                Changing anything here prices the next order. Nothing already placed changes: every order keeps
                the charges it was placed under.
              </Text>
            </Card>

            <View style={s.searchRow}>
              <Search size={16} color={c.text.muted} />
              <TextInput
                style={s.search}
                value={search}
                onChangeText={setSearch}
                placeholder="Find a restaurant"
                placeholderTextColor={c.text.muted}
              />
            </View>

            {filtered.length === 0 ? (
              <EmptyState
                title={search ? 'No restaurant by that name' : 'No restaurants yet'}
                message={search ? 'Try a different name.' : 'Charges appear here once a restaurant is approved.'}
                icon={<Store size={28} color={c.text.muted} />}
              />
            ) : (
              filtered.map(row => (
                <TouchableOpacity
                  key={row.restaurantId}
                  onPress={() => canEdit && open(row)}
                  activeOpacity={canEdit ? 0.75 : 1}
                >
                  <Card style={s.row}>
                    <View style={s.rowHead}>
                      <Text style={s.rowName}>{row.name}</Text>
                      {row.packagingMargin > 0 ? (
                        <Badge label={`+${rupees(row.packagingMargin)} ours`} tone="success" />
                      ) : row.packagingMargin < 0 ? (
                        <Badge label={`${rupees(row.packagingMargin)} subsidy`} tone="warning" />
                      ) : (
                        <Badge label="No markup" tone="neutral" />
                      )}
                    </View>

                    {/* The sentence is the point of the row. */}
                    <Text style={s.marginNote}>{row.marginNote}</Text>

                    <Divider style={{ marginVertical: 10 }} />

                    <View style={s.figures}>
                      <Figure label="Commission" value={`${row.commissionPercent}%`} />
                      <Figure label="Platform fee" value={rupees(row.platformFee)} />
                      <Figure label="GST" value={`${row.gstFoodPercent}%`} />
                      <Figure label="Delivery from" value={rupees(row.deliveryBaseFee)} />
                    </View>

                    {row.extraCharge > 0 && (
                      <Text style={s.extra}>
                        Plus {rupees(row.extraCharge)} — “{row.extraChargeLabel}”. All ours.
                      </Text>
                    )}

                    {!row.partnerDeclared && (
                      /*
                       * Said out loud rather than shown as a plausible number.
                       * A restaurant that has never declared a packaging charge
                       * is being priced from the platform default, and an
                       * administrator setting a markup against a figure the
                       * restaurant never gave is marking up a guess.
                       */
                      <View style={s.warnRow}>
                        <TriangleAlert size={13} color={c.state.warning} />
                        <Text style={s.warnText}>
                          This restaurant has not told us its packaging charge. The figure above is the
                          platform default.
                        </Text>
                      </View>
                    )}

                    {canEdit && <Text style={s.tap}>Tap to change</Text>}
                  </Card>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ------------------ Rider pay and platform defaults ------------------ */}
        {tab === 'platform' && (
          <>
            <Card style={s.explainer}>
              <View style={s.head}>
                <Info size={16} color={c.text.secondary} />
                <Text style={s.explainerTitle}>What you pay riders, and every fallback</Text>
              </View>
              <Text style={s.explainerBody}>
                These apply everywhere. A restaurant with nothing set of its own follows them, and keeps
                following them when you change one.
              </Text>
              <Text style={s.explainerBody}>
                Rider pay is a base fee plus a rate for every kilometre beyond the free distance, never less
                than the guaranteed minimum. The delivery fee you charge the customer is separate — the gap
                between the two is yours.
              </Text>
            </Card>

            {platform.loading && !platform.data ? (
              <Loading label="Reading your rates…" />
            ) : !platform.data ? (
              <EmptyState title="Could not load these" message={platform.error || 'Pull down to try again.'} />
            ) : (
              <>
                {(platform.data.bounds || []).map((bound: any) => {
                  const live = platform.data.config?.rates?.[bound.key];
                  const edited = platformEdits[bound.key];
                  const changed = edited !== undefined && edited !== '' && Number(edited) !== Number(live);
                  return (
                    <Card key={bound.key} style={s.row}>
                      <View style={s.rowHead}>
                        <Text style={s.rowName}>{bound.label}</Text>
                        {bound.affectsCustomerBill && <Badge label="On the bill" tone="warning" />}
                      </View>
                      <Text style={s.explainerBody}>{bound.help}</Text>

                      <View style={{ marginTop: 10 }}>
                        <View style={s.fieldRow}>
                          <TextInput
                            style={s.fieldInput}
                            value={edited ?? String(live ?? '')}
                            onChangeText={v =>
                              setPlatformEdits(e => ({ ...e, [bound.key]: v.replace(/[^0-9.]/g, '') }))
                            }
                            keyboardType="numeric"
                          />
                          <Text style={s.fieldSuffix}>
                            {bound.unit === 'PERCENT' ? '%' : bound.unit === 'KM' ? 'km' : bound.unit === 'DAYS' ? 'days' : 'Rs'}
                          </Text>
                        </View>
                        {changed && (
                          <Text style={s.fieldHint}>
                            Now {String(live)} — saving creates a new version. Orders already placed keep what
                            they were charged.
                          </Text>
                        )}
                      </View>
                    </Card>
                  );
                })}

                {Object.keys(platformEdits).some(
                  k => platformEdits[k] !== '' && Number(platformEdits[k]) !== Number(platform.data.config?.rates?.[k])
                ) && (
                  <Card>
                    <Text style={s.fieldLabel}>Why are you changing these?</Text>
                    <View style={s.fieldRow}>
                      <TextInput
                        style={s.fieldInput}
                        value={platformNote}
                        onChangeText={setPlatformNote}
                        placeholder="e.g. raising rider pay for the monsoon"
                        placeholderTextColor={c.text.muted}
                      />
                    </View>
                    <Text style={s.fieldHint}>
                      Required. Rates are versioned, never overwritten — this is what somebody reads when they
                      ask why a number moved.
                    </Text>

                    {!!error && <Text style={s.error}>{error}</Text>}

                    <Button
                      label={busy ? 'Saving…' : 'Save these rates'}
                      onPress={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const changes: Record<string, number> = {};
                          for (const [key, value] of Object.entries(platformEdits)) {
                            if (value === '' || Number(value) === Number(platform.data.config?.rates?.[key])) continue;
                            changes[key] = Number(value);
                          }
                          await api.put('/admin/pricing/config', { changes, note: platformNote.trim() });
                          setPlatformEdits({});
                          setPlatformNote('');
                          await platform.reload();
                          await rates.reload();
                        } catch (err: any) {
                          setError(err?.message || 'Those rates could not be saved.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy || platformNote.trim().length < 4}
                      style={{ marginTop: 12 }}
                    />
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {tab === 'bonuses' && (
          <>
            <Card style={s.explainer}>
              <View style={s.head}>
                <Gift size={16} color={c.text.secondary} />
                <Text style={s.explainerTitle}>Bonuses you pay riders</Text>
              </View>
              <Text style={s.explainerBody}>
                These used to pay automatically with nobody approving them — including one worth Rs 700. They
                are all switched OFF now. Turn on only what you actually want to pay.
              </Text>
              <Text style={s.explainerBody}>
                A rider never sees a bonus that is switched off, so nobody works towards something that pays
                nothing.
              </Text>
            </Card>

            {(bonuses.data?.incentives || []).map(incentive => (
              <Card key={incentive.code} style={s.row}>
                <View style={s.rowHead}>
                  <Text style={s.rowName}>{INCENTIVE_LABEL[incentive.code] || incentive.code}</Text>
                  <Badge
                    label={incentive.enabled ? 'Paying' : 'Off'}
                    tone={incentive.enabled ? 'success' : 'neutral'}
                  />
                </View>

                <Text style={s.bonusLine}>
                  {incentive.enabled
                    ? `Pays ${rupees(incentive.reward)} when a rider reaches ${incentive.target}.`
                    : `Would pay ${rupees(incentive.reward)} at ${incentive.target}. Not being paid.`}
                </Text>

                {canEdit && (
                  <View style={s.bonusActions}>
                    <Button
                      label={incentive.enabled ? 'Stop paying this' : 'Start paying this'}
                      variant={incentive.enabled ? 'ghost' : 'primary'}
                      onPress={() => void toggleBonus(incentive, { enabled: !incentive.enabled })}
                      disabled={busy}
                    />
                  </View>
                )}
              </Card>
            ))}

            <Text style={s.footnote}>
              Switching one off stops it from now on. A rider who already earned one keeps it — we do not take
              back money somebody has been paid.
            </Text>
          </>
        )}
      </ScrollView>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name || ''}
        subtitle="What a customer pays for an order from here"
      >
        {/* Packaging first and on its own, because it is the one with two figures. */}
        <View style={s.compareBox}>
          <View style={s.compareRow}>
            <Text style={s.compareLabel}>This restaurant asked for</Text>
            <Text style={s.compareValue}>{rupees(editing?.partnerPackagingFee || 0)}</Text>
          </View>
          <View style={s.compareRow}>
            <Text style={s.compareLabel}>The customer will pay</Text>
            <Text style={s.compareValue}>{rupees(num('customerPackagingFee'))}</Text>
          </View>
          <Divider style={{ marginVertical: 8 }} />
          <View style={s.compareRow}>
            <Text style={[s.compareLabel, { fontWeight: '700', color: c.text.primary }]}>You keep</Text>
            <Text
              style={[
                s.compareValue,
                { fontSize: 16 },
                liveMargin > 0 && { color: c.state.success },
                liveMargin < 0 && { color: c.state.warning }
              ]}
            >
              {rupees(liveMargin)}
            </Text>
          </View>
          {liveMargin < 0 && (
            <Text style={s.subsidy}>
              You are charging less than this restaurant asked for. The difference comes out of your own
              revenue — which is allowed, it is just a discount you are funding.
            </Text>
          )}
        </View>

        <Field
          label="Packaging charged to the customer"
          value={form.customerPackagingFee}
          onChange={v => setForm(f => ({ ...f, customerPackagingFee: v }))}
          suffix="Rs"
        />
        <Field
          label="Platform fee"
          value={form.platformFee}
          onChange={v => setForm(f => ({ ...f, platformFee: v }))}
          suffix="Rs"
          hint="Charged to the customer, kept in full. GST is added to it on the bill."
        />
        <Field
          label="Our commission on the food"
          value={form.commissionPercent}
          onChange={v => setForm(f => ({ ...f, commissionPercent: v }))}
          suffix="%"
          hint="Taken off what this restaurant earns."
        />
        <Field
          label="GST on food"
          value={form.gstFoodPercent}
          onChange={v => setForm(f => ({ ...f, gstFoodPercent: v }))}
          suffix="%"
        />
        <Field
          label="Delivery fee starts at"
          value={form.deliveryBaseFee}
          onChange={v => setForm(f => ({ ...f, deliveryBaseFee: v }))}
          suffix="Rs"
        />
        <Field
          label="Any extra charge"
          value={form.extraCharge}
          onChange={v => setForm(f => ({ ...f, extraCharge: v }))}
          suffix="Rs"
          hint="Added to the bill and kept in full. It needs a name the customer will understand."
        />
        {num('extraCharge') > 0 && (
          <Field
            label="What to call it on the bill"
            value={form.extraChargeLabel}
            onChange={v => setForm(f => ({ ...f, extraChargeLabel: v }))}
            hint="A charge with no name is the fastest way to lose a customer."
          />
        )}

        <Field
          label="Why (optional)"
          value={note}
          onChange={setNote}
          hint="What somebody reads in six months when they ask why this changed."
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <Button label={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
        <Text style={s.sheetFoot}>
          This prices the next order from {editing?.name}. Orders already placed keep what they were charged.
        </Text>
      </Sheet>
    </>
  );
};

const Figure: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={s.figure}>
    <Text style={s.figureValue}>{value}</Text>
    <Text style={s.figureLabel}>{label}</Text>
  </View>
);

const Field: React.FC<{
  label: string;
  value?: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: string;
}> = ({ label, value, onChange, suffix, hint }) => (
  <View style={{ marginBottom: 14 }}>
    <Text style={s.fieldLabel}>{label}</Text>
    <View style={s.fieldRow}>
      <TextInput
        style={s.fieldInput}
        value={value ?? ''}
        onChangeText={onChange}
        keyboardType={suffix ? 'numeric' : 'default'}
        placeholderTextColor={c.text.muted}
      />
      {!!suffix && <Text style={s.fieldSuffix}>{suffix}</Text>}
    </View>
    {!!hint && <Text style={s.fieldHint}>{hint}</Text>}
  </View>
);

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },

  explainer: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  explainerTitle: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  explainerBody: { color: c.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 8 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bg.sunken,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  search: { flex: 1, color: c.text.primary, fontSize: 14, paddingVertical: 10 },

  row: { marginBottom: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { color: c.text.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  marginNote: { color: c.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 6 },

  figures: { flexDirection: 'row', flexWrap: 'wrap' },
  figure: { width: '50%', paddingVertical: 4 },
  figureValue: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  figureLabel: { color: c.text.muted, fontSize: 11, marginTop: 1 },

  extra: { color: c.text.secondary, fontSize: 12, marginTop: 8 },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10 },
  warnText: { color: c.state.warning, fontSize: 11, lineHeight: 16, flex: 1 },
  tap: { color: c.text.muted, fontSize: 11, marginTop: 10 },

  bonusLine: { color: c.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  bonusActions: { marginTop: 12 },

  compareBox: { backgroundColor: c.bg.sunken, borderRadius: 10, padding: 12, marginBottom: 16 },
  compareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  compareLabel: { color: c.text.muted, fontSize: 12 },
  compareValue: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  subsidy: { color: c.state.warning, fontSize: 11, lineHeight: 16, marginTop: 8 },

  fieldLabel: { color: c.text.primary, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.sunken,
    borderRadius: 10,
    paddingHorizontal: 12
  },
  fieldInput: { flex: 1, color: c.text.primary, fontSize: 15, paddingVertical: 11 },
  fieldSuffix: { color: c.text.muted, fontSize: 13, marginLeft: 8 },
  fieldHint: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },

  error: { color: c.state.danger, fontSize: 13, marginBottom: 10 },
  sheetFoot: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  footnote: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 12 }
});

export default RatesScreen;
