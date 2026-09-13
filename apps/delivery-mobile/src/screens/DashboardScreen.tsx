import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Award,
  ChevronRight,
  Clock,
  IndianRupee,
  Package,
  Percent,
  Star,
  TrendingUp,
  Wallet
} from 'lucide-react-native';
import { t } from '../theme';
import { Button, Card, EmptyState, LoadingBlock, Pill, ProgressBar, Row, SectionTitle, StatTile } from '../components/ui';
import { dayAndTime, hoursAndMinutes, rupees, rupeesShort } from '../lib/format';
import type { DashboardResponse, Trip } from '../lib/api';

/**
 * The rider's home screen.
 *
 * Everything here is a number the server computed from completed trips, so it
 * is the same figure operations and payouts are working from. It refreshes
 * after every accept, delivery and cancellation, and on pull-to-refresh.
 */
export const DashboardScreen: React.FC<{
  data: DashboardResponse | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenTrip: (trip: Trip) => void;
  onOpenEarnings: () => void;
  onOpenIncentives: () => void;
  onOpenRatings: () => void;
  onOpenWeekly: () => void;
  onCompleteProfile: () => void;
  onGoOnline: () => void;
}> = ({
  data,
  loading,
  refreshing,
  onRefresh,
  onOpenTrip,
  onOpenEarnings,
  onOpenIncentives,
  onOpenRatings,
  onOpenWeekly,
  onCompleteProfile,
  onGoOnline
}) => {
  if (loading && !data) return <LoadingBlock label="Loading your dashboard…" />;
  if (!data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        message="We could not load your numbers. Pull down to try again."
        action={<Button label="Retry" onPress={onRefresh} />}
      />
    );
  }

  const { metrics, rider, incentives, activeOrder, recentTrips, profile } = data;
  const nextIncentive = incentives.find(i => !i.achieved) || null;

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color.go} />}
      showsVerticalScrollIndicator={false}
    >
      {!profile.complete ? (
        <TouchableOpacity style={s.banner} onPress={onCompleteProfile} activeOpacity={0.9}>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>Finish your profile to start earning</Text>
            <Text style={s.bannerBody}>Still needed: {profile.missing.join(', ')}.</Text>
          </View>
          <ChevronRight size={20} color={t.color.money} />
        </TouchableOpacity>
      ) : null}

      {/* Today's earnings — the number a rider opens the app for. */}
      <Card tone="raised" style={s.heroCard}>
        <View style={s.heroHeader}>
          <Text style={s.heroLabel}>Today's earnings</Text>
          <Pill
            label={rider.isOnline ? 'On shift' : 'Off shift'}
            tone={rider.isOnline ? 'go' : 'neutral'}
          />
        </View>
        <View style={s.heroValueRow}>
          <IndianRupee size={30} color={t.color.money} strokeWidth={2.5} />
          <Text style={s.heroValue}>{metrics.todayEarnings.toFixed(2)}</Text>
        </View>
        <View style={s.heroMetaRow}>
          <View style={s.heroMeta}>
            <Package size={14} color={t.color.textMuted} />
            <Text style={s.heroMetaText}>
              {metrics.todayTrips} trip{metrics.todayTrips === 1 ? '' : 's'} today
            </Text>
          </View>
          <View style={s.heroMeta}>
            <Clock size={14} color={t.color.textMuted} />
            <Text style={s.heroMetaText}>{hoursAndMinutes(metrics.onlineMinutesToday)} online</Text>
          </View>
        </View>
        {!rider.isOnline && profile.complete ? (
          <Button label="Go online" onPress={onGoOnline} style={{ marginTop: t.space[4] }} />
        ) : null}
      </Card>

      {/* Active delivery */}
      {activeOrder ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenTrip(activeOrder)} style={{ marginTop: t.space[4] }}>
          <Card style={s.activeCard}>
            <View style={s.activeHead}>
              <Pill label="Delivery in progress" tone="go" />
              <Text style={s.activeOrderNumber}>#{activeOrder.orderNumber}</Text>
            </View>
            <Text style={s.activeRestaurant}>{activeOrder.restaurantName}</Text>
            <Text style={s.activeAddress} numberOfLines={1}>
              {activeOrder.stage === 'OUT_FOR_DELIVERY' || activeOrder.stage === 'AT_DOORSTEP'
                ? activeOrder.dropAddress
                : activeOrder.pickupAddress}
            </Text>
            <View style={s.activeFooter}>
              <Text style={s.activeEarnings}>{rupees(activeOrder.estimatedEarnings)}</Text>
              <View style={s.activeCta}>
                <Text style={s.activeCtaText}>Open trip</Text>
                <ChevronRight size={16} color={t.color.goText} />
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ) : null}

      {/* Core metrics */}
      <SectionTitle style={{ marginTop: t.space[6] }} action="Earnings" onAction={onOpenEarnings}>
        Your performance
      </SectionTitle>
      <View style={s.tileRow}>
        <StatTile
          label="Wallet"
          value={rupeesShort(metrics.walletBalance)}
          caption="Withdrawable"
          tone="money"
          icon={<Wallet size={14} color={t.color.money} />}
          onPress={onOpenEarnings}
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="This week"
          value={rupeesShort(metrics.weekEarnings)}
          caption={`${metrics.weekTrips} trips`}
          icon={<TrendingUp size={14} color={t.color.goText} />}
          onPress={onOpenWeekly}
          style={{ flex: 1 }}
        />
      </View>
      <View style={[s.tileRow, { marginTop: t.space[3] }]}>
        <StatTile
          label="Acceptance"
          value={`${metrics.acceptanceRate}%`}
          caption={`${metrics.offersAccepted} of ${metrics.offersReceived} offers`}
          tone={metrics.acceptanceRate >= 80 ? 'go' : 'default'}
          icon={<Percent size={14} color={t.color.textMuted} />}
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="Rating"
          value={metrics.averageRating ? metrics.averageRating.toFixed(1) : '—'}
          caption={metrics.ratedTripCount ? `${metrics.ratedTripCount} rated trips` : 'No ratings yet'}
          icon={<Star size={14} color={t.color.money} />}
          onPress={onOpenRatings}
          style={{ flex: 1 }}
        />
      </View>
      <View style={[s.tileRow, { marginTop: t.space[3] }]}>
        <StatTile
          label="Total trips"
          value={String(metrics.totalTrips)}
          caption="All time"
          icon={<Package size={14} color={t.color.textMuted} />}
          onPress={onOpenWeekly}
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="Cash in hand"
          value={rupeesShort(metrics.codCashInHand)}
          caption="To deposit"
          tone={metrics.codCashInHand > 0 ? 'money' : 'default'}
          icon={<IndianRupee size={14} color={t.color.textMuted} />}
          style={{ flex: 1 }}
        />
      </View>

      {/* Incentive progress */}
      <SectionTitle style={{ marginTop: t.space[6] }} action="All bonuses" onAction={onOpenIncentives}>
        Incentives & bonuses
      </SectionTitle>
      <Card>
        <View style={s.incentiveHead}>
          <View style={s.incentiveIcon}>
            <Award size={18} color={t.color.money} />
          </View>
          <View style={{ flex: 1, marginLeft: t.space[3] }}>
            <Text style={s.incentiveTitle}>{nextIncentive ? nextIncentive.title : 'Every target cleared'}</Text>
            <Text style={s.incentiveBody} numberOfLines={2}>
              {nextIncentive
                ? nextIncentive.description
                : 'You have hit every incentive available this period. New targets open tomorrow.'}
            </Text>
          </View>
          <Text style={s.incentiveReward}>{nextIncentive ? rupees(nextIncentive.reward, 0) : ''}</Text>
        </View>
        {nextIncentive ? (
          <>
            <ProgressBar value={nextIncentive.progress} max={nextIncentive.target} tone={t.color.money} />
            <Text style={s.incentiveProgress}>
              {nextIncentive.unit === 'rating'
                ? `${nextIncentive.progress.toFixed(1)} of ${nextIncentive.target} rating`
                : `${nextIncentive.progress} of ${nextIncentive.target} trips`}
            </Text>
          </>
        ) : null}
        <Row label="Earned this week" value={rupees(metrics.incentivesEarned)} />
      </Card>

      {/* Recent trips */}
      <SectionTitle style={{ marginTop: t.space[6] }} action="See all" onAction={onOpenWeekly}>
        Recent deliveries
      </SectionTitle>
      {recentTrips.length === 0 ? (
        <Card>
          <Text style={s.emptyTrips}>
            No completed deliveries yet. Go online and your first trip will appear here.
          </Text>
        </Card>
      ) : (
        <Card>
          {recentTrips.map((trip, index) => (
            <View key={trip.orderId}>
              {index > 0 ? <View style={s.tripDivider} /> : null}
              <View style={s.tripRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.tripName} numberOfLines={1}>
                    {trip.restaurantName || 'Restaurant'}
                  </Text>
                  <Text style={s.tripMeta} numberOfLines={1}>
                    #{trip.orderNumber} · {dayAndTime(trip.deliveredAt)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.tripPayout}>{rupees(trip.payout)}</Text>
                  {trip.rating ? (
                    <View style={s.tripRating}>
                      <Star size={11} color={t.color.money} fill={t.color.money} />
                      <Text style={s.tripRatingText}>{trip.rating}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Text style={s.updatedAt}>Updated {dayAndTime(data.generatedAt)}</Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: 132 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.moneySoft,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.money,
    padding: t.space[4],
    marginBottom: t.space[4]
  },
  bannerTitle: { color: t.color.money, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  bannerBody: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: 3, lineHeight: 18 },
  heroCard: { paddingVertical: t.space[5] },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  heroValueRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[3] },
  heroValue: {
    color: t.color.money,
    fontSize: t.font.size.display,
    fontWeight: t.font.weight.extrabold,
    marginLeft: 2
  },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[3] },
  heroMeta: { flexDirection: 'row', alignItems: 'center', marginRight: t.space[5] },
  heroMetaText: { color: t.color.textMuted, fontSize: t.font.size.sm, marginLeft: 5 },
  activeCard: { borderColor: t.color.go, backgroundColor: t.color.goSoft },
  activeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeOrderNumber: { color: t.color.goText, fontSize: t.font.size.sm, fontWeight: t.font.weight.bold },
  activeRestaurant: {
    color: t.color.text,
    fontSize: t.font.size.md,
    fontWeight: t.font.weight.bold,
    marginTop: t.space[3]
  },
  activeAddress: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: 3 },
  activeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: t.space[4]
  },
  activeEarnings: { color: t.color.money, fontSize: t.font.size.lg, fontWeight: t.font.weight.extrabold },
  activeCta: { flexDirection: 'row', alignItems: 'center' },
  activeCtaText: { color: t.color.goText, fontSize: t.font.size.sm, fontWeight: t.font.weight.bold, marginRight: 2 },
  tileRow: { flexDirection: 'row' },
  incentiveHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space[4] },
  incentiveIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.color.moneySoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  incentiveTitle: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  incentiveBody: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: 2, lineHeight: 18 },
  incentiveReward: { color: t.color.money, fontSize: t.font.size.base, fontWeight: t.font.weight.extrabold },
  incentiveProgress: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: t.space[2] },
  emptyTrips: { color: t.color.textMuted, fontSize: t.font.size.sm, lineHeight: 20 },
  tripRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space[3] },
  tripDivider: { height: 1, backgroundColor: t.color.border },
  tripName: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.semibold },
  tripMeta: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  tripPayout: { color: t.color.money, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  tripRating: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  tripRatingText: { color: t.color.textMuted, fontSize: t.font.size.xs, marginLeft: 3 },
  updatedAt: {
    color: t.color.textMuted,
    fontSize: t.font.size.xs,
    textAlign: 'center',
    marginTop: t.space[6]
  }
});
