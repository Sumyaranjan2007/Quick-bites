import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { t } from '../theme';
import { Card, Divider, EmptyState, LoadingBlock, Pill, SectionTitle, StatTile } from '../components/ui';
import { dayAndTime, distance, rupees, rupeesShort } from '../lib/format';
import type { ApiContext, TripsResponse } from '../lib/api';
import { api } from '../lib/api';

/**
 * The week in trips.
 *
 * The bar chart is drawn from flex heights rather than a charting library — a
 * rider wants to see which days were busy, and seven bars do that without
 * shipping a chart engine into a delivery app.
 */
export const WeeklyTripsScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [range, setRange] = useState<'week' | 'all'>('week');
  const [data, setData] = useState<TripsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .trips(ctx, range)
      .then(result => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch(err => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, ctx.apiUrl, ctx.token]);

  if (loading && !data) return <LoadingBlock label="Loading your trips…" />;
  if (error && !data) {
    return <EmptyState title="Could not load trips" message={error} />;
  }
  if (!data) return null;

  const busiest = Math.max(1, ...data.byDay.map(d => d.trips));

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.rangeRow}>
        {(['week', 'all'] as const).map(option => (
          <TouchableOpacity
            key={option}
            style={[s.rangeChip, range === option && s.rangeChipActive]}
            onPress={() => setRange(option)}
            activeOpacity={0.85}
          >
            <Text style={[s.rangeChipText, range === option && s.rangeChipTextActive]}>
              {option === 'week' ? 'This week' : 'All time'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.tileRow}>
        <StatTile
          label="Trips"
          value={String(data.totals.trips)}
          caption={range === 'week' ? 'Monday to Sunday' : 'All deliveries'}
          tone="go"
          style={{ flex: 1, marginRight: t.space[3] }}
        />
        <StatTile
          label="Earned"
          value={rupeesShort(data.totals.earnings)}
          caption={`${data.totals.distanceKm} km ridden`}
          tone="money"
          style={{ flex: 1 }}
        />
      </View>

      {range === 'week' ? (
        <>
          <SectionTitle style={{ marginTop: t.space[6] }}>Trips per day</SectionTitle>
          <Card>
            <View style={s.chart}>
              {data.byDay.map(day => (
                <View key={day.day} style={s.chartColumn}>
                  <Text style={s.chartValue}>{day.trips || ''}</Text>
                  <View style={s.chartBarTrack}>
                    <View
                      style={[
                        s.chartBar,
                        {
                          height: `${Math.max(day.trips === 0 ? 2 : 8, (day.trips / busiest) * 100)}%`,
                          backgroundColor: day.trips > 0 ? t.color.go : t.color.border
                        }
                      ]}
                    />
                  </View>
                  <Text style={s.chartLabel}>{day.day}</Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      <SectionTitle style={{ marginTop: t.space[6] }}>
        {range === 'week' ? 'This week’s deliveries' : 'All deliveries'}
      </SectionTitle>
      {data.trips.length === 0 ? (
        <Card>
          <Text style={s.empty}>
            No completed deliveries in this period yet.
          </Text>
        </Card>
      ) : (
        <Card>
          {data.trips.map((trip, index) => (
            <View key={trip.orderId}>
              {index > 0 ? <Divider /> : null}
              <View style={s.tripRow}>
                <View style={{ flex: 1, paddingRight: t.space[3] }}>
                  <Text style={s.tripName} numberOfLines={1}>
                    {trip.restaurantName || 'Restaurant'}
                  </Text>
                  <Text style={s.tripMeta} numberOfLines={1}>
                    #{trip.orderNumber} · {dayAndTime(trip.deliveredAt)}
                  </Text>
                  <View style={s.tripPills}>
                    <Pill label={distance(trip.distanceKm)} />
                    {trip.cashCollected > 0 ? (
                      <Pill
                        label={`COD ${rupees(trip.cashCollected, 0)}`}
                        tone="money"
                        style={{ marginLeft: t.space[2] }}
                      />
                    ) : null}
                  </View>
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
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: 132 },
  rangeRow: { flexDirection: 'row', marginBottom: t.space[4] },
  rangeChip: {
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[2],
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color.border,
    marginRight: t.space[2]
  },
  rangeChipActive: { backgroundColor: t.color.goSoft, borderColor: t.color.go },
  rangeChipText: { color: t.color.textMuted, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  rangeChipTextActive: { color: t.color.goText },
  tileRow: { flexDirection: 'row' },
  chart: { flexDirection: 'row', height: 150, alignItems: 'flex-end' },
  chartColumn: { flex: 1, alignItems: 'center', height: '100%' },
  chartValue: { color: t.color.textSecondary, fontSize: t.font.size.xs, fontWeight: t.font.weight.bold, height: 14 },
  chartBarTrack: { flex: 1, width: 18, justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 6 },
  chartLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 6 },
  empty: { color: t.color.textMuted, fontSize: t.font.size.sm, lineHeight: 20 },
  tripRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space[3] },
  tripName: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.semibold },
  tripMeta: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  tripPills: { flexDirection: 'row', marginTop: t.space[2] },
  tripPayout: { color: t.color.money, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  tripRating: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  tripRatingText: { color: t.color.textMuted, fontSize: t.font.size.xs, marginLeft: 3 }
});
