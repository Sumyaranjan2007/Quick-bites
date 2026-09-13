import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Award, CheckCircle2 } from 'lucide-react-native';
import { t } from '../theme';
import { Card, EmptyState, LoadingBlock, Pill, ProgressBar, SectionTitle } from '../components/ui';
import { rupees } from '../lib/format';
import { api, type ApiContext, type Incentive } from '../lib/api';

/**
 * Incentives, with the arithmetic shown.
 *
 * A rider should never have to guess how close they are or wonder whether a
 * bonus was paid: each card carries the target, the progress toward it, and
 * either a "paid" mark or the exact number of trips still to go.
 */
export const IncentivesScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [incentives, setIncentives] = useState<Incentive[] | null>(null);
  const [earned, setEarned] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .incentives(ctx)
      .then(result => {
        if (cancelled) return;
        setIncentives(result.incentives);
        setEarned(result.earnedThisPeriod);
      })
      .catch(err => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [ctx.apiUrl, ctx.token]);

  if (error) return <EmptyState title="Could not load incentives" message={error} />;
  if (!incentives) return <LoadingBlock label="Loading incentives…" />;

  const daily = incentives.filter(i => i.period === 'DAY');
  const weekly = incentives.filter(i => i.period === 'WEEK');

  const renderCard = (incentive: Incentive) => {
    const remaining = Math.max(0, incentive.target - incentive.progress);
    return (
      <Card key={incentive.code} style={{ marginBottom: t.space[3] }} tone={incentive.paid ? 'raised' : 'default'}>
        <View style={s.head}>
          <View style={[s.icon, incentive.paid && { backgroundColor: t.color.goSoft }]}>
            {incentive.paid ? (
              <CheckCircle2 size={18} color={t.color.goText} />
            ) : (
              <Award size={18} color={t.color.money} />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: t.space[3] }}>
            <Text style={s.title}>{incentive.title}</Text>
            <Text style={s.description}>{incentive.description}</Text>
          </View>
          <Text style={[s.reward, incentive.paid && { color: t.color.goText }]}>
            {rupees(incentive.reward, 0)}
          </Text>
        </View>

        <ProgressBar
          value={incentive.progress}
          max={incentive.target}
          tone={incentive.paid ? t.color.go : t.color.money}
        />

        <View style={s.footer}>
          <Text style={s.progressText}>
            {incentive.unit === 'rating'
              ? `${incentive.progress.toFixed(1)} / ${incentive.target.toFixed(1)} rating`
              : `${incentive.progress} / ${incentive.target} trips`}
          </Text>
          {incentive.paid ? (
            <Pill label="Paid to wallet" tone="go" />
          ) : incentive.unit === 'rating' ? (
            <Text style={s.remaining}>Hold {incentive.target.toFixed(1)} to qualify</Text>
          ) : (
            <Text style={s.remaining}>
              {remaining} more trip{remaining === 1 ? '' : 's'}
            </Text>
          )}
        </View>
      </Card>
    );
  };

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Card tone="raised" style={s.summaryCard}>
        <Text style={s.summaryLabel}>Bonuses earned this week</Text>
        <Text style={s.summaryValue}>{rupees(earned)}</Text>
        <Text style={s.summarySub}>
          Paid into your wallet automatically the moment a target is met. Daily targets reset at midnight,
          weekly targets on Monday.
        </Text>
      </Card>

      <SectionTitle style={{ marginTop: t.space[6] }}>Today</SectionTitle>
      {daily.map(renderCard)}

      <SectionTitle style={{ marginTop: t.space[4] }}>This week</SectionTitle>
      {weekly.map(renderCard)}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: 132 },
  summaryCard: { alignItems: 'flex-start' },
  summaryLabel: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  summaryValue: {
    color: t.color.money,
    fontSize: t.font.size.xxl,
    fontWeight: t.font.weight.extrabold,
    marginTop: t.space[2]
  },
  summarySub: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[2], lineHeight: 19 },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space[4] },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.color.moneySoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  description: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: 2, lineHeight: 18 },
  reward: { color: t.color.money, fontSize: t.font.size.base, fontWeight: t.font.weight.extrabold, marginLeft: t.space[2] },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.space[3] },
  progressText: { color: t.color.textSecondary, fontSize: t.font.size.xs, fontWeight: t.font.weight.semibold },
  remaining: { color: t.color.textMuted, fontSize: t.font.size.xs }
});
