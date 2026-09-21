import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Award, CalendarDays, IndianRupee, Package, Percent, Star, Wallet } from 'lucide-react-native';
import { t } from '../theme';
import { Button, Card, Divider, LoadingBlock, ProgressBar, Row, SectionTitle, StatTile } from '../components/ui';
import { hoursAndMinutes, rupees, rupeesShort } from '../lib/format';
import type { DashboardResponse } from '../lib/api';

/**
 * The money screen: what is in the wallet, what today and this week earned,
 * and the two ratios — acceptance and rating — that decide which trips and
 * which incentives a rider is eligible for.
 */
export const EarningsScreen: React.FC<{
  data: DashboardResponse | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenWeekly: () => void;
  onOpenIncentives: () => void;
  onOpenRatings: () => void;
  /** The settlement ledger: what has been paid across, and when. */
  onOpenSettlement: () => void;
  onOpenPayoutAccount: () => void;
  /** Cash-on-delivery money the rider is carrying, and declaring a deposit. */
  onOpenCash: () => void;
  /** Trip-by-trip breakdown, and asking to be paid. */
  onOpenStatement: () => void;
}> = ({
  data,
  refreshing,
  onRefresh,
  onOpenWeekly,
  onOpenIncentives,
  onOpenRatings,
  onOpenSettlement,
  onOpenPayoutAccount,
  onOpenCash,
  onOpenStatement
}) => {
  if (!data) return <LoadingBlock label="Loading your earnings…" />;
  const { metrics, incentives } = data;
  const paidIncentives = incentives.filter(i => i.paid);

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color.go} />}
      showsVerticalScrollIndicator={false}
    >
      <Card tone="raised" style={s.walletCard}>
        <View style={s.walletHead}>
          <Wallet size={18} color={t.color.money} />
          <Text style={s.walletLabel}>Earned and waiting to be paid out</Text>
        </View>
        <View style={s.walletValueRow}>
          <IndianRupee size={28} color={t.color.money} strokeWidth={2.5} />
          <Text style={s.walletValue}>{metrics.walletBalance.toFixed(2)}</Text>
        </View>
        {/* Not a wallet, and deliberately no longer called one. Nothing is held
            on the rider's behalf inside the app: this is what the ledger says
            has been earned, and it is sent to their bank. */}
        <Text style={s.walletSub}>
          Sent to your registered bank account. A day's earnings become payable the day after delivery, and
          nothing is paid out while you are still holding our cash.
        </Text>
        {metrics.codCashInHand > 0 ? (
          <View style={s.cashNote}>
            <Text style={s.cashNoteText}>
              You are holding {rupees(metrics.codCashInHand)} in COD cash to deposit.
            </Text>
          </View>
        ) : null}
        {/* The balance above says what is owed; settlement says what has been
            paid, against which trips, and with what reference. */}
        <Button
          label="Settlement & payment history"
          variant="secondary"
          onPress={onOpenSettlement}
          style={{ marginTop: t.space[4] }}
        />
        {/* Directly under the balance, because a rider who has never added an
            account is looking at money that has nowhere to go. */}
        <Button
          label="Bank account"
          variant="secondary"
          onPress={onOpenPayoutAccount}
          style={{ marginTop: t.space[3] }}
        />
        {/* Directly under the balance, because a rider looking at a figure is
            one tap from asking why it is that much — and the answer should not
            be a phone call to somebody who cannot see the arithmetic either. */}
        <Button
          label="Statement — trip by trip"
          variant="secondary"
          onPress={onOpenStatement}
          style={{ marginTop: t.space[3] }}
        />
        {/* Cash sits between a rider and their own money: carry too much and
            both cash orders and payouts stop. It belongs on the same card as
            the balance, not buried in a menu. */}
        <Button
          label="Cash in your bag"
          variant="secondary"
          onPress={onOpenCash}
          style={{ marginTop: t.space[3] }}
        />
      </Card>

      <SectionTitle style={{ marginTop: t.space[6] }}>Earnings</SectionTitle>
      <View style={s.tileRow}>
        <StatTile
          label="Today"
          value={rupeesShort(metrics.todayEarnings)}
          caption={`${metrics.todayTrips} trips · ${hoursAndMinutes(metrics.onlineMinutesToday)} online`}
          tone="money"
          icon={<IndianRupee size={14} color={t.color.money} />}
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="This week"
          value={rupeesShort(metrics.weekEarnings)}
          caption={`${metrics.weekTrips} trips`}
          tone="money"
          icon={<CalendarDays size={14} color={t.color.money} />}
          onPress={onOpenWeekly}
          style={{ flex: 1 }}
        />
      </View>
      <View style={[s.tileRow, { marginTop: t.space[3] }]}>
        <StatTile
          label="All time"
          value={rupeesShort(metrics.totalEarnings)}
          caption={`${metrics.totalTrips} deliveries`}
          icon={<Package size={14} color={t.color.textMuted} />}
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="Incentives"
          value={rupeesShort(metrics.incentivesEarned)}
          caption="Paid this week"
          tone="go"
          icon={<Award size={14} color={t.color.goText} />}
          onPress={onOpenIncentives}
          style={{ flex: 1 }}
        />
      </View>

      <SectionTitle style={{ marginTop: t.space[6] }}>Acceptance rate</SectionTitle>
      <Card>
        <View style={s.rateHead}>
          <Percent size={18} color={metrics.acceptanceRate >= 80 ? t.color.goText : t.color.money} />
          <Text style={s.rateValue}>{metrics.acceptanceRate}%</Text>
        </View>
        <ProgressBar
          value={metrics.acceptanceRate}
          max={100}
          tone={metrics.acceptanceRate >= 80 ? t.color.go : t.color.money}
          height={10}
        />
        <Text style={s.rateCaption}>
          You accepted {metrics.offersAccepted} of the {metrics.offersReceived} trips offered to you.
          {metrics.acceptanceRate >= 80
            ? ' Keep it above 80% to stay first in line for dispatch.'
            : ' Riders above 80% are offered trips first.'}
        </Text>
        <Divider style={{ marginVertical: t.space[4] }} />
        <Row label="Offers received" value={String(metrics.offersReceived)} />
        <Row label="Offers accepted" value={String(metrics.offersAccepted)} />
      </Card>

      <SectionTitle style={{ marginTop: t.space[6] }} action="See reviews" onAction={onOpenRatings}>
        Customer rating
      </SectionTitle>
      <Card>
        <View style={s.rateHead}>
          <Star size={18} color={t.color.money} fill={metrics.averageRating ? t.color.money : 'transparent'} />
          <Text style={s.rateValue}>
            {metrics.averageRating ? metrics.averageRating.toFixed(1) : '—'}
          </Text>
          <Text style={s.rateOutOf}>/ 5.0</Text>
        </View>
        <Text style={s.rateCaption}>
          {metrics.ratedTripCount
            ? `Averaged across ${metrics.ratedTripCount} rated deliveries.`
            : 'No customer has rated you yet. Ratings appear here as soon as they do.'}
        </Text>
      </Card>

      {paidIncentives.length > 0 ? (
        <>
          <SectionTitle style={{ marginTop: t.space[6] }}>Bonuses paid</SectionTitle>
          <Card>
            {paidIncentives.map((incentive, index) => (
              <View key={incentive.code}>
                {index > 0 ? <Divider /> : null}
                <Row label={incentive.title} value={rupees(incentive.reward, 0)} valueStyle={{ color: t.color.money }} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Button
        label="View weekly trips"
        variant="secondary"
        onPress={onOpenWeekly}
        style={{ marginTop: t.space[6] }}
      />
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  walletCard: { paddingVertical: t.space[5] },
  walletHead: { flexDirection: 'row', alignItems: 'center' },
  walletLabel: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, marginLeft: 8 },
  walletValueRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[3] },
  walletValue: { color: t.color.money, fontSize: t.font.size.display, fontWeight: t.font.weight.extrabold, marginLeft: 2 },
  walletSub: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[2], lineHeight: 19 },
  cashNote: {
    marginTop: t.space[4],
    backgroundColor: t.color.moneySoft,
    borderRadius: t.radius.sm,
    padding: t.space[3]
  },
  cashNoteText: { color: t.color.money, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  tileRow: { flexDirection: 'row' },
  rateHead: { flexDirection: 'row', alignItems: 'center', marginBottom: t.space[3] },
  rateValue: {
    color: t.color.text,
    fontSize: t.font.size.xxl,
    fontWeight: t.font.weight.extrabold,
    marginLeft: t.space[3]
  },
  rateOutOf: { color: t.color.textMuted, fontSize: t.font.size.base, marginLeft: 4 },
  rateCaption: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[3], lineHeight: 19 }
});
