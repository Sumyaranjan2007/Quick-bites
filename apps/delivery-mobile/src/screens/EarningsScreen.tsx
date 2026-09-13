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
}> = ({ data, refreshing, onRefresh, onOpenWeekly, onOpenIncentives, onOpenRatings }) => {
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
          <Text style={s.walletLabel}>Withdrawable wallet balance</Text>
        </View>
        <View style={s.walletValueRow}>
          <IndianRupee size={28} color={t.color.money} strokeWidth={2.5} />
          <Text style={s.walletValue}>{metrics.walletBalance.toFixed(2)}</Text>
        </View>
        <Text style={s.walletSub}>
          Paid to your registered bank account every Tuesday, less any cash you are holding.
        </Text>
        {metrics.codCashInHand > 0 ? (
          <View style={s.cashNote}>
            <Text style={s.cashNoteText}>
              You are holding {rupees(metrics.codCashInHand)} in COD cash to deposit.
            </Text>
          </View>
        ) : null}
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
