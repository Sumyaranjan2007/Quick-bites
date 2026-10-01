import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Bike, Store, Landmark, ShieldAlert, Wallet } from 'lucide-react-native';
import { Card, Segmented, Badge, Loading, EmptyState, NoAccess, SectionTitle, Button, Sheet, Field, KeyValue } from '../components/ui';
import { tokens, formatMoney, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * What is owed to each partner, and where it would go.
 *
 * -------------------------------------------------------------------------
 * WHY THIS READS THE SAME ENDPOINT AS PAY
 * -------------------------------------------------------------------------
 * There used to be a rider settlement helper in financeRoutes that worked out
 * what a rider was owed by SCANNING THEIR ORDERS, while payouts.ts works it out
 * from the LEDGER. Reviving it for this screen would have been the easy route
 * and would have given the platform two sources for one number.
 *
 * That is a defect this project already has elsewhere and has already been
 * bitten by: two screens deriving one fact from two sources eventually disagree,
 * and the one somebody believes is whichever they happened to open. So this
 * screen reads `/admin/payouts/dues` — the same call Pay makes. If a figure is
 * wrong it is wrong in one place, and fixing it fixes both.
 *
 * What makes this a different SCREEN rather than a duplicate is the question it
 * answers. Pay asks "what am I sending today". This asks "what do we owe this
 * partner, and can it actually reach them" — which is the question asked when a
 * partner rings up, and it is asked about one person rather than about a run.
 */
export const SettlementsScreen: React.FC = () => {
  const { api, can } = useSession();
  const [tab, setTab] = useState<'riders' | 'restaurants'>('riders');
  const [paying, setPaying] = useState<any | null>(null);
  const canPay = can('finance.payouts.manage') || can('finance.settlements.manage');

  const allowed = can('finance.settlements.view') || can('finance.payouts.view');

  const dues = useResource<any>(
    () => api.get('/admin/payouts/dues'),
    [],
    { enabled: allowed }
  );

  if (!allowed) return <NoAccess permission="finance.settlements.view" />;
  if (dues.loading && !dues.data) return <Loading label="Reading what is owed…" />;

  const rows: any[] = dues.data?.dues || [];
  const riders = rows.filter(r => r.ownerType === 'RIDER');
  const restaurants = rows.filter(r => r.ownerType === 'RESTAURANT');
  const shown = tab === 'riders' ? riders : restaurants;

  /*
   * Everyone with money outstanding, not only those who can be paid.
   *
   * A list of the payable ones looks finished. The blocked rows ARE the work:
   * a rider carrying cash and a partner with no connected account are both
   * unpaid for reasons somebody has to act on, and hiding them is how a partner
   * goes three weeks without being paid while the screen looks healthy.
   */
  const owing = shown.filter(r => r.outstanding > 0 || r.cashInHand > 0);

  return (
    <ScrollView
      contentContainerStyle={s.list}
      refreshControl={
        <RefreshControl refreshing={dues.loading} onRefresh={dues.reload} tintColor={c.brand.amber} />
      }
    >
      <Segmented
        options={[
          { key: 'riders', label: `Riders${riders.length ? ` (${riders.length})` : ''}` },
          { key: 'restaurants', label: `Restaurants${restaurants.length ? ` (${restaurants.length})` : ''}` }
        ]}
        value={tab}
        onChange={next => setTab(next as 'riders' | 'restaurants')}
      />

      {!!dues.error && (
        <Card style={s.errorCard}>
          <Text style={s.errorText}>{dues.error}</Text>
        </Card>
      )}

      {owing.length === 0 ? (
        <EmptyState
          title={tab === 'riders' ? 'Nothing owed to any rider' : 'Nothing owed to any restaurant'}
          message={
            dues.error
              ? 'This screen could not reach the server, so it is not saying anything about what is owed.'
              : 'Everything earned has been settled, and nobody is carrying platform cash.'
          }
          icon={tab === 'riders' ? <Bike size={28} color={c.text.muted} /> : <Store size={28} color={c.text.muted} />}
        />
      ) : (
        <>
          <SectionTitle
            title={tab === 'riders' ? 'Owed to delivery partners' : 'Owed to restaurants'}
            subtitle="The same figures Pay works from. Ready rows can be paid now. Amber means something has to be done first."
          />

          {owing.map(row => (
            <Card key={`${row.ownerType}:${row.ownerId}`}>
              <View style={s.rowTop}>
                <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                  <Text style={s.name} numberOfLines={1}>
                    {row.ownerName}
                  </Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {row.held > 0
                      ? `${formatMoney(row.held)} still inside the hold period`
                      : 'Everything earned is released'}
                  </Text>
                </View>
                <StatusBadge row={row} />
              </View>

              <View style={s.figures}>
                <Figure label="Payable now" value={formatMoney(row.payable)} strong />
                <Figure label="Outstanding" value={formatMoney(row.outstanding)} />
                {row.ownerType === 'RIDER' ? (
                  <Figure label="Cash in hand" value={formatMoney(row.cashInHand)} />
                ) : null}
              </View>

              {/*
                * Where it would go, on the row that says what is owed. Without
                * this, "can this partner actually be paid" is a different
                * screen — and it is the question this one exists to answer.
                */}
              {row.willPayInto ? (
                <View style={s.line}>
                  <Landmark size={14} color={c.text.muted} />
                  <Text style={s.lineText}>
                    {row.willPayInto.method === 'VPA'
                      ? `${row.willPayInto.holderName} · ${row.willPayInto.vpa}`
                      : `${row.willPayInto.holderName} · ending ${row.willPayInto.accountLast4 || '----'}`}
                  </Text>
                </View>
              ) : (
                <View style={s.line}>
                  <ShieldAlert size={14} color={c.state.warning} />
                  <Text style={[s.lineText, { color: c.state.warning }]}>
                    No account connected. They add one from their own app, and you apply it in Bank.
                  </Text>
                </View>
              )}

              {/* Only what somebody has to act on; "nothing owed" is not a problem. */}
              {!!row.blockedReason && (row.blockedCode === 'CASH_IN_HAND' || row.blockedCode === 'BELOW_MINIMUM') && (
                <View style={s.line}>
                  <Wallet size={14} color={c.state.warning} />
                  <Text style={[s.lineText, { color: c.state.warning }]}>{row.blockedReason}</Text>
                </View>
              )}

              {!!row.requestedAt && (
                <Text style={s.asked}>They asked to be paid {timeAgo(row.requestedAt)}.</Text>
              )}

              {canPay && !row.blockedReason && row.payable > 0 ? (
                <Button
                  label={`Pay ${formatMoney(row.payable)} now`}
                  variant="success"
                  style={{ marginTop: tokens.space[3], alignSelf: 'stretch' }}
                  onPress={() => setPaying(row)}
                />
              ) : null}
            </Card>
          ))}
        </>
      )}
      <PayNowSheet
        row={paying}
        rails={dues.data?.rails || []}
        defaultRail={dues.data?.defaultRail}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          void dues.reload();
        }}
      />
    </ScrollView>
  );
};

/** What a row's state is, in words. Amber only when someone must act. */
const StatusBadge: React.FC<{ row: any }> = ({ row }) => {
  if (row.blockedCode === 'CASH_IN_HAND') return <Badge label="Cash to deposit" tone="warning" />;
  if (row.blockedCode === 'NO_ACCOUNT') return <Badge label="No bank account" tone="warning" />;
  if (row.blockedCode === 'BELOW_MINIMUM') return <Badge label="Under minimum" tone="neutral" />;
  if (row.blockedCode === 'NOTHING_OWED') return <Badge label={row.held > 0 ? 'In hold' : 'Settled'} tone="neutral" />;
  if (row.payable > 0) return <Badge label="Ready to pay" tone="success" />;
  return null;
};

/**
 * Paying one partner in one go (owner, 2 Oct 2026): draft, approve and send,
 * by hand (UPI or bank, with the UTR) or through RazorpayX. A super admin signs
 * both sides of a large payout; anybody else is told a second approver is needed.
 */
const PayNowSheet: React.FC<{
  row: any | null;
  rails: Array<{ id: string; displayName: string; description: string; available: boolean; needsManualReference: boolean }>;
  defaultRail?: string;
  onClose: () => void;
  onPaid: () => void;
}> = ({ row, rails, defaultRail, onClose, onPaid }) => {
  const { api } = useSession();
  const usable = rails.filter(r => r.available);
  const [railId, setRailId] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<any | null>(null);
  const chosen = usable.find(r => r.id === (railId || defaultRail)) || usable[0];
  const needsUtr = Boolean(chosen?.needsManualReference);
  const dest = row?.willPayInto;

  const reset = () => {
    setRailId(null);
    setUtr('');
    setDetails(null);
  };

  const showDetails = async () => {
    if (!dest?.accountId) return;
    try {
      setDetails(await api.get<any>(`/admin/payee-accounts/${dest.accountId}/number`));
    } catch (err: any) {
      Alert.alert('Could not show the details', err?.message || 'Try again.');
    }
  };

  const pay = async () => {
    if (!row || !chosen) return;
    setBusy(true);
    try {
      const drafted = await api.post<any>('/admin/payouts', { ownerType: row.ownerType, ownerId: row.ownerId, rail: chosen.id });
      const payout = drafted.payout;
      if (payout.state === 'AWAITING_APPROVAL') await api.post(`/admin/payouts/${payout.id}/approve`, {});
      await api.post(`/admin/payouts/${payout.id}/send`, { manualReference: utr.trim() || undefined });
      Alert.alert('Paid', `${formatMoney(row.payable)} to ${row.ownerName} is recorded.`);
      reset();
      onPaid();
    } catch (err: any) {
      Alert.alert('Not paid', `${err?.message || 'The payment could not be completed.'} Anything left half-done is on the Pay screen.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(row)}
      onClose={() => {
        reset();
        onClose();
      }}
      title={row ? `Pay ${row.ownerName}` : 'Pay'}
      subtitle={row ? `${formatMoney(row.payable)} payable now` : undefined}
      footer={
        <View style={{ flex: 1 }}>
          <Button
            label={row ? `Pay ${formatMoney(row.payable)}` : 'Pay'}
            variant="success"
            loading={busy}
            disabled={!chosen || (needsUtr && utr.trim().length < 4)}
            style={{ alignSelf: 'stretch' }}
            onPress={pay}
          />
        </View>
      }
    >
      {usable.length > 1 ? (
        <Segmented
          options={usable.map(r => ({ key: r.id, label: r.displayName }))}
          value={chosen?.id || ''}
          onChange={setRailId}
        />
      ) : null}
      {chosen ? <Text style={s.sheetNote}>{chosen.description}</Text> : null}

      <Card>
        <Text style={s.sheetHeading}>Pay into</Text>
        {dest ? (
          <>
            <KeyValue label="Name at the bank" value={dest.holderName} />
            {dest.method === 'VPA' ? (
              <KeyValue label="UPI ID" value={dest.vpa} tone="strong" />
            ) : details ? (
              details.missing ? (
                <Text style={s.sheetNote}>
                  This account was added before full numbers were kept. Ask them to re-enter it in their app, or pay
                  through RazorpayX.
                </Text>
              ) : (
                <>
                  <KeyValue label="Account number" value={details.accountNumber} tone="strong" />
                  <KeyValue label="IFSC" value={details.ifsc} tone="strong" />
                </>
              )
            ) : (
              <>
                <KeyValue label="Account" value={`ending ${dest.accountLast4 || '----'} · ${dest.ifsc || ''}`} />
                {needsUtr ? <Button label="Show full bank details" variant="secondary" size="sm" onPress={showDetails} /> : null}
              </>
            )}
          </>
        ) : (
          <Text style={s.sheetNote}>No account connected.</Text>
        )}
      </Card>

      {needsUtr ? (
        <Field
          label="UTR or transaction reference"
          value={utr}
          onChangeText={setUtr}
          placeholder="From your bank or UPI app, after you send it"
        />
      ) : null}
    </Sheet>
  );
};

const Figure: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <View style={s.figure}>
    <Text style={s.figureLabel}>{label}</Text>
    <Text style={[s.figureValue, strong ? s.figureStrong : null]}>{value}</Text>
  </View>
);

const s = StyleSheet.create({
  list: { padding: tokens.space[4], gap: tokens.space[3], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontSize: tokens.font.size.md, color: c.text.primary, fontWeight: '700' },
  sub: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2 },
  figures: { flexDirection: 'row', marginTop: tokens.space[3], gap: tokens.space[4] },
  figure: { flex: 1 },
  figureLabel: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  figureValue: { fontSize: tokens.font.size.sm, color: c.text.primary, marginTop: 2, fontWeight: '600' },
  figureStrong: { color: c.brand.amberText, fontSize: tokens.font.size.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: tokens.space[2] },
  lineText: { flex: 1, fontSize: tokens.font.size.xxs, color: c.text.secondary },
  asked: { marginTop: tokens.space[2], fontSize: tokens.font.size.xxs, color: c.text.muted },
  errorCard: { borderColor: c.state.danger },
  sheetNote: { fontSize: tokens.font.size.xs, color: c.text.secondary, marginVertical: tokens.space[2] },
  sheetHeading: { fontSize: tokens.font.size.xs, fontWeight: '800', color: c.text.muted, marginBottom: tokens.space[2] },
  errorText: { color: c.state.danger, fontSize: 13 }
});
