import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { History, Percent, ReceiptText } from 'lucide-react-native';
import {
  Card,
  Badge,
  Button,
  Field,
  Sheet,
  Divider,
  Loading,
  NoAccess,
  SectionTitle,
  Segmented
} from '../components/ui';
import { tokens, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface RateBound {
  key: string;
  label: string;
  help: string;
  unit: 'PERCENT' | 'RUPEES' | 'KM' | 'DAYS' | 'MINUTES';
  min: number;
  max: number;
  affectsCustomerBill: boolean;
}

interface PricingConfig {
  id: string;
  version: number;
  rates: Record<string, number>;
  effectiveFrom: string;
  createdAt: string;
  createdByUserId: string;
  note?: string;
}

interface ConfigPayload {
  config: PricingConfig;
  bounds: RateBound[];
  defaults: Record<string, number>;
  versionCount: number;
}

/**
 * Every rate the platform charges or withholds.
 *
 * These numbers used to live in source code — commission in two separate files,
 * where they could drift apart with nothing to notice. Changing any of them
 * meant a deployment.
 *
 * Three things this screen is careful about, because each one is a way to lose
 * real money:
 *
 *   - A rate that changes what the CUSTOMER pays is marked as such, and the
 *     confirmation says so in plain words. Raising commission is a conversation
 *     with one partner; raising GST is a different price on every bill on the
 *     platform, and the two should not feel identical to press.
 *
 *   - Nothing saves without a reason. It lands in the audit log and on the
 *     version itself, and it is what answers "why is commission 18%?" next
 *     quarter when whoever changed it has left.
 *
 *   - Only what was actually edited is sent. Sending the whole form back would
 *     mean a second administrator's change, made while this screen was open,
 *     is silently reverted by whatever this device happened to be showing.
 */
const UNIT_PREFIX: Record<RateBound['unit'], string> = {
  PERCENT: '',
  RUPEES: 'Rs ',
  KM: '',
  DAYS: '',
  MINUTES: ''
};

const UNIT_SUFFIX: Record<RateBound['unit'], string> = {
  PERCENT: '%',
  RUPEES: '',
  KM: ' km',
  DAYS: ' days',
  MINUTES: ' min'
};

function display(bound: RateBound, value: number): string {
  return `${UNIT_PREFIX[bound.unit]}${value}${UNIT_SUFFIX[bound.unit]}`;
}

/** Which section of the screen a rate belongs in. */
const GROUPS: Array<{ key: string; label: string; title: string; subtitle: string; keys: string[] }> = [
  {
    key: 'customer',
    label: 'The bill',
    title: 'What the customer pays',
    subtitle: 'Every change here shows on the next bill anybody sees.',
    keys: [
      'gstFoodPercent',
      'packagingFeeDefault',
      'deliveryBaseFee',
      'deliveryBaseKm',
      'deliveryPerKmBeyond',
      'memberFreeDeliveryMinOrder',
      'platformFeeBase',
      'platformFeeGstPercent'
    ]
  },
  {
    key: 'partner',
    label: 'Partners',
    title: 'What the platform keeps',
    subtitle: 'Commission and the tax on it. A restaurant may be on its own rate, set on its record.',
    keys: ['defaultCommissionPercent', 'commissionGstPercent', 'tdsPercent', 'tcsPercent']
  },
  {
    key: 'rider',
    label: 'Riders',
    title: 'What a rider earns',
    subtitle: 'Per trip, before tips. Tips are paid in full and are never commissioned.',
    keys: ['riderBaseFeePerTrip', 'riderBaseKm', 'riderPerKmFee', 'riderMinEarningPerTrip']
  },
  {
    key: 'payouts',
    label: 'Payouts',
    title: 'Paying people, and the controls on it',
    subtitle: 'When money becomes payable, and who has to agree before it leaves.',
    keys: [
      'partnerHoldDays',
      'riderHoldDays',
      'minPayoutAmount',
      'makerCheckerThreshold',
      'dailyPayoutCap',
      'payoutLinkExpiryHours'
    ]
  },
  {
    key: 'cash',
    label: 'Cash',
    title: 'Cash a rider is carrying',
    subtitle: 'How much of your money one rider may hold before they must deposit it.',
    keys: ['codCashCeiling', 'codCashWarnPercent', 'doorQrExpiryMinutes']
  }
];

export const RatesScreen: React.FC = () => {
  const { api, can } = useSession();
  const allowed = can('finance.config.edit');

  const config = useResource<ConfigPayload>(() => api.get('/admin/pricing/config').then(r => r.data), [], {
    enabled: allowed
  });
  const history = useResource<{ versions: PricingConfig[] }>(
    () => api.get('/admin/pricing/config/history').then(r => r.data),
    [],
    { enabled: allowed }
  );

  const [group, setGroup] = useState('customer');
  /** Only what the operator actually typed. Untouched rates are never sent. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const bounds = config.data?.bounds || [];
  const rates = config.data?.config.rates || {};
  const defaults = config.data?.defaults || {};

  const boundFor = useMemo(() => new Map(bounds.map(b => [b.key, b])), [bounds]);

  /**
   * What will actually be sent, and what it will change from.
   *
   * A field the operator typed in and then typed back to its original value is
   * NOT a change, and is dropped here rather than being sent and quietly
   * ignored by the server.
   */
  const pending = useMemo(() => {
    const out: Array<{ key: string; label: string; from: number; to: number; affectsCustomerBill: boolean; problem?: string }> = [];
    for (const [key, raw] of Object.entries(edits)) {
      const bound = boundFor.get(key);
      if (!bound) continue;
      const from = Number(rates[key]);
      const trimmed = raw.trim();
      if (trimmed === '') {
        out.push({ key, label: bound.label, from, to: NaN, affectsCustomerBill: bound.affectsCustomerBill, problem: 'Enter a number.' });
        continue;
      }
      const to = Number(trimmed);
      if (!Number.isFinite(to)) {
        out.push({ key, label: bound.label, from, to: NaN, affectsCustomerBill: bound.affectsCustomerBill, problem: 'That is not a number.' });
        continue;
      }
      if (to < bound.min || to > bound.max) {
        out.push({
          key,
          label: bound.label,
          from,
          to,
          affectsCustomerBill: bound.affectsCustomerBill,
          problem: `Must be between ${bound.min} and ${bound.max}.`
        });
        continue;
      }
      if (to === from) continue;
      out.push({ key, label: bound.label, from, to, affectsCustomerBill: bound.affectsCustomerBill });
    }
    return out;
  }, [edits, rates, boundFor]);

  const problems = pending.filter(p => p.problem);
  const changes = pending.filter(p => !p.problem);
  const touchesBill = changes.some(ch => ch.affectsCustomerBill);

  if (!allowed) return <NoAccess permission="finance.config.edit" />;
  if (config.loading && !config.data) return <Loading label="Reading the platform’s rates…" />;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        rates: Object.fromEntries(changes.map(ch => [ch.key, ch.to])),
        note: note.trim()
      };
      const result = await api.put('/admin/pricing/config', body);
      config.setData({ ...config.data!, config: result.data.config, versionCount: config.data!.versionCount + 1 });
      setEdits({});
      setNote('');
      setConfirming(false);
      void history.silentReload();
    } catch (err: any) {
      setSaveError(err?.message || 'Those rates could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const active = GROUPS.find(g => g.key === group) || GROUPS[0];
  const current = config.data?.config;

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={config.loading} onRefresh={config.reload} />}
      >
        {!!config.error && (
          <Card style={s.errorCard}>
            <Text style={s.errorText}>{config.error}</Text>
          </Card>
        )}

        <Card style={s.versionCard}>
          <View style={s.versionRow}>
            <Percent size={18} color={c.brand.amberText} />
            <View style={{ flex: 1 }}>
              <Text style={s.versionTitle}>Version {current?.version} is live</Text>
              <Text style={s.versionMeta}>
                Set {current ? timeAgo(current.effectiveFrom) : ''}
                {current?.note ? ` — ${current.note}` : ''}
              </Text>
            </View>
            <Button
              label="History"
              variant="ghost"
              onPress={() => {
                setShowHistory(true);
                void history.reload();
              }}
            />
          </View>
          <Divider style={{ marginVertical: 10 }} />
          <Text style={s.versionNote}>
            Changing a rate writes a new version. Orders already placed keep the rates they were priced
            under, so nothing you do here can change money somebody has already earned.
          </Text>
        </Card>

        <Segmented options={GROUPS.map(g => ({ key: g.key, label: g.label }))} value={group} onChange={setGroup} />

        <SectionTitle title={active.title} subtitle={active.subtitle} />

        {active.keys.map(key => {
          const bound = boundFor.get(key);
          if (!bound) return null;
          const live = Number(rates[key]);
          const edited = edits[key];
          const row = pending.find(p => p.key === key);
          const isDefault = live === Number(defaults[key]);

          return (
            <Card key={key} style={s.rateCard}>
              <View style={s.rateHead}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rateLabel}>{bound.label}</Text>
                  <Text style={s.rateHelp}>{bound.help}</Text>
                </View>
                <View style={s.rateBadges}>
                  {bound.affectsCustomerBill && <Badge label="ON THE BILL" tone="warning" />}
                  {!isDefault && <Badge label="CHANGED" tone="info" />}
                </View>
              </View>

              <View style={s.rateBody}>
                <View style={s.currentBox}>
                  <Text style={s.currentLabel}>Now</Text>
                  <Text style={s.currentValue}>{display(bound, live)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={`New value (${bound.min}–${bound.max})`}
                    value={edited ?? ''}
                    onChangeText={text => setEdits(prev => ({ ...prev, [key]: text }))}
                    placeholder={String(live)}
                    keyboardType="numeric"
                    error={row?.problem}
                    hint={
                      row && !row.problem
                        ? `${display(bound, row.from)} becomes ${display(bound, row.to)}`
                        : isDefault
                        ? 'Platform default'
                        : `Default is ${display(bound, Number(defaults[key]))}`
                    }
                  />
                </View>
              </View>
            </Card>
          );
        })}

        <View style={{ height: 120 }} />
      </ScrollView>

      {(changes.length > 0 || problems.length > 0) && (
        <View style={s.bar}>
          <View style={{ flex: 1 }}>
            <Text style={s.barText}>
              {problems.length > 0
                ? `${problems.length} value${problems.length === 1 ? '' : 's'} to correct`
                : `${changes.length} rate${changes.length === 1 ? '' : 's'} to change`}
            </Text>
            {touchesBill && problems.length === 0 && (
              <Text style={s.barWarn}>This changes what customers are charged.</Text>
            )}
          </View>
          <Button label="Discard" variant="ghost" onPress={() => setEdits({})} />
          <Button
            label="Review"
            onPress={() => {
              setSaveError(null);
              setConfirming(true);
            }}
            disabled={changes.length === 0 || problems.length > 0}
          />
        </View>
      )}

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Confirm the new rates">
        {changes.map(ch => (
          <View key={ch.key} style={s.confirmRow}>
            <Text style={s.confirmLabel}>{ch.label}</Text>
            <Text style={s.confirmValue}>
              {display(boundFor.get(ch.key)!, ch.from)} → {display(boundFor.get(ch.key)!, ch.to)}
            </Text>
          </View>
        ))}

        <Divider style={{ marginVertical: 12 }} />

        {touchesBill ? (
          <View style={s.warnBox}>
            <ReceiptText size={16} color={c.state.warning} />
            <Text style={s.warnText}>
              At least one of these appears on the customer’s bill. The next order placed will be charged at
              the new rates. Orders already placed are not affected.
            </Text>
          </View>
        ) : (
          <Text style={s.confirmNote}>
            None of these change what a customer pays. They affect what the platform keeps and what it pays
            out.
          </Text>
        )}

        <Field
          label="Why is this changing?"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Q4 commission agreed with partners"
          multiline
          hint="Recorded on the version and in the audit log. This is what answers the question next quarter."
        />

        {!!saveError && <Text style={s.errorText}>{saveError}</Text>}

        <Button
          label={saving ? 'Saving…' : 'Write a new version'}
          onPress={save}
          disabled={saving || note.trim().length < 3}
        />
      </Sheet>

      <Sheet visible={showHistory} onClose={() => setShowHistory(false)} title="Every version">
        {history.loading && !history.data ? (
          <Loading label="Reading the history…" />
        ) : (history.data?.versions || []).length === 0 ? (
          <Text style={s.meta}>No versions recorded yet.</Text>
        ) : (
          (history.data?.versions || []).map(version => (
            <View key={version.id} style={s.historyRow}>
              <View style={s.historyHead}>
                <History size={14} color={c.text.secondary} />
                <Text style={s.historyVersion}>Version {version.version}</Text>
                {version.version === current?.version && <Badge label="LIVE" tone="success" />}
              </View>
              <Text style={s.historyMeta}>
                {timeAgo(version.effectiveFrom)}
                {version.createdByUserId === 'system' ? ' — platform defaults' : ''}
              </Text>
              {!!version.note && <Text style={s.historyNote}>“{version.note}”</Text>}
              <Text style={s.historyRates}>
                Commission {version.rates.defaultCommissionPercent}% · GST {version.rates.gstFoodPercent}% ·
                Delivery Rs {version.rates.deliveryBaseFee}
              </Text>
            </View>
          ))
        )}
      </Sheet>
    </>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  errorCard: { borderColor: c.state.danger, marginBottom: 12 },
  errorText: { color: c.state.danger, fontSize: 13, marginBottom: 8 },
  meta: { color: c.text.muted, fontSize: 12 },

  versionCard: { marginBottom: 14 },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  versionTitle: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  versionMeta: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  versionNote: { color: c.text.muted, fontSize: 12, lineHeight: 17 },

  rateCard: { marginBottom: 10 },
  rateHead: { flexDirection: 'row', alignItems: 'flex-start' },
  rateLabel: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  rateHelp: { color: c.text.secondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  rateBadges: { gap: 4, alignItems: 'flex-end' },
  rateBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 10 },
  currentBox: {
    backgroundColor: c.bg.sunken,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 92,
    marginTop: 18
  },
  currentLabel: { color: c.text.muted, fontSize: 10, letterSpacing: 0.6 },
  currentValue: { color: c.text.primary, fontSize: 16, fontWeight: '700', marginTop: 2 },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: c.bg.raised,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  barText: { color: c.text.primary, fontSize: 13, fontWeight: '700' },
  barWarn: { color: c.state.warning, fontSize: 11, marginTop: 2 },

  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  confirmLabel: { color: c.text.secondary, fontSize: 13, flex: 1, paddingRight: 12 },
  confirmValue: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  confirmNote: { color: c.text.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 },

  warnBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: c.bg.sunken,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12
  },
  warnText: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 },

  historyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyVersion: { color: c.text.primary, fontSize: 14, fontWeight: '700', flex: 1 },
  historyMeta: { color: c.text.muted, fontSize: 11, marginTop: 2 },
  historyNote: { color: c.text.secondary, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  historyRates: { color: c.text.muted, fontSize: 11, marginTop: 4 }
});
