import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { t } from '../theme';
import { Card, Divider, EmptyState, LoadingBlock, ProgressBar, SectionTitle, Stars } from '../components/ui';
import { dayAndTime } from '../lib/format';
import { api, type ApiContext, type RatingsResponse } from '../lib/api';

/** What customers thought of the rider, and what they wrote. */
export const RatingsScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [data, setData] = useState<RatingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .ratings(ctx)
      .then(result => !cancelled && setData(result))
      .catch(err => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ctx.apiUrl, ctx.token]);

  if (loading) return <LoadingBlock label="Loading your ratings…" />;
  if (error) return <EmptyState title="Could not load ratings" message={error} />;
  if (!data) return null;

  if (data.total === 0) {
    return (
      <EmptyState
        icon={<Star size={34} color={t.color.money} />}
        title="No ratings yet"
        message="Customers can rate you once an order is delivered. Their stars and comments will appear here."
      />
    );
  }

  const maxCount = Math.max(1, ...data.distribution.map(d => d.count));

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Card tone="raised">
        <View style={s.summary}>
          <View style={s.summaryLeft}>
            <Text style={s.average}>{data.average?.toFixed(1)}</Text>
            <Stars value={data.average || 0} size={16} />
            <Text style={s.total}>{data.total} rated trips</Text>
          </View>
          <View style={s.distribution}>
            {data.distribution.map(bucket => (
              <View key={bucket.stars} style={s.distRow}>
                <Text style={s.distStar}>{bucket.stars}</Text>
                <Star size={10} color={t.color.money} fill={t.color.money} />
                <View style={s.distBar}>
                  <ProgressBar value={bucket.count} max={maxCount} tone={t.color.money} height={6} />
                </View>
                <Text style={s.distCount}>{bucket.count}</Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      <SectionTitle style={{ marginTop: t.space[6] }}>What customers said</SectionTitle>
      <Card>
        {data.reviews.map((review, index) => (
          <View key={review.orderId}>
            {index > 0 ? <Divider /> : null}
            <View style={s.review}>
              <View style={s.reviewHead}>
                <Stars value={review.rating} size={13} />
                <Text style={s.reviewDate}>{dayAndTime(review.ratedAt)}</Text>
              </View>
              {review.comment ? (
                <Text style={s.reviewComment}>“{review.comment}”</Text>
              ) : (
                <Text style={s.reviewNoComment}>No comment left.</Text>
              )}
              <Text style={s.reviewMeta} numberOfLines={1}>
                #{review.orderNumber}
                {review.restaurantName ? ` · ${review.restaurantName}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  summary: { flexDirection: 'row', alignItems: 'center' },
  summaryLeft: { alignItems: 'center', paddingRight: t.space[5], borderRightWidth: 1, borderRightColor: t.color.border },
  average: { color: t.color.text, fontSize: t.font.size.display, fontWeight: t.font.weight.extrabold },
  total: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: t.space[2] },
  distribution: { flex: 1, paddingLeft: t.space[4] },
  distRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  distStar: { color: t.color.textMuted, fontSize: t.font.size.xs, marginRight: 3, width: 8 },
  distBar: { flex: 1, marginHorizontal: t.space[2] },
  distCount: { color: t.color.textMuted, fontSize: t.font.size.xs, width: 18, textAlign: 'right' },
  review: { paddingVertical: t.space[4] },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewDate: { color: t.color.textMuted, fontSize: t.font.size.xs },
  reviewComment: {
    color: t.color.text,
    fontSize: t.font.size.base,
    marginTop: t.space[3],
    lineHeight: 21,
    fontStyle: 'italic'
  },
  reviewNoComment: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[3] },
  reviewMeta: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: t.space[3] }
});
