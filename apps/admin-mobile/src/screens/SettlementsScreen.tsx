import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Bike, Store, Landmark, ShieldAlert, Wallet } from 'lucide-react-native';
import { Card, Segmented, Badge, Loading, EmptyState, NoAccess, SectionTitle } from '../components/ui';
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

  const allowed = can('finance.settlements.view') || can('finance.payouts.view');

  const dues = useResource<any>(
    () => api.get('/admin/payouts/dues').then(r => r.data),
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
            subtitle="The same figures Pay works from. A blocked row is somebody who is not getting paid until it is cleared."
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
                {row.blockedReason ? (
                  <Badge label="Blocked" tone="warning" />
                ) : row.payable > 0 ? (
                  <Badge label="Ready" tone="success" />
                ) : null}
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

              {!!row.blockedReason && (
                <View style={s.line}>
                  <Wallet size={14} color={c.state.warning} />
                  <Text style={[s.lineText, { color: c.state.warning }]}>{row.blockedReason}</Text>
                </View>
              )}

              {!!row.requestedAt && (
                <Text style={s.asked}>They asked to be paid {timeAgo(row.requestedAt)}.</Text>
              )}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
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
  errorText: { color: c.state.danger, fontSize: 13 }
});
