import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Landmark, Smartphone, UserCheck, AlertTriangle } from 'lucide-react-native';
import {
  Card,
  Badge,
  Button,
  Field,
  Sheet,
  Divider,
  Loading,
  NoAccess,
  EmptyState,
  SectionTitle,
  Segmented
} from '../components/ui';
import { tokens, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface QueueRow {
  id: string;
  method: 'BANK' | 'VPA';
  holderName: string;
  accountLast4?: string;
  ifsc?: string;
  vpa?: string;
  registeredName?: string;
  nameMatchScore?: number;
  validationMessage?: string;
  ownerType: 'RESTAURANT' | 'RIDER';
  ownerId: string;
  ownerName: string;
  ownerDetail: string;
  createdAt: string;
}

interface CoverageGroup {
  total: number;
  payable: number;
  withoutAccount: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Who can be paid, and the accounts only a person can decide about.
 *
 * -------------------------------------------------------------------------
 * THE QUEUE
 * -------------------------------------------------------------------------
 * A penny drop returns the name the bank holds and a 0–100 comparison against
 * ours. Above 90 the platform accepts; below 70 it refuses. The band between
 * is left to a human deliberately, because two very different things land in
 * it and look identical to a score: a bank holding "R Sharma" for Rahul
 * Sharma, and somebody being paid into a relative's account.
 *
 * So every row shows BOTH names and the score. A queue that shows only "needs
 * review" is a queue that gets approved on autopilot, which is the same as not
 * having one.
 *
 * -------------------------------------------------------------------------
 * COVERAGE
 * -------------------------------------------------------------------------
 * The second tab answers a question worth asking on a Monday rather than on
 * payday: who has no account we can pay into? The expensive way to find out
 * that eleven riders cannot be paid is to draft eleven payouts and watch them
 * refuse.
 */
export const PayeeAccountsScreen: React.FC = () => {
  const { api, can } = useSession();
  const allowed = can('finance.payouts.manage', 'finance.settlements.manage');
  const canSeeCoverage = can('finance.payouts.view', 'finance.settlements.view');

  const queue = useResource<{
    queue: QueueRow[];
    thresholds: { accept: number; review: number };
    verificationAvailable: boolean;
  }>(() => api.get('/admin/payee-accounts/review').then(r => r.data), [], { enabled: allowed });

  const coverage = useResource<{ riders: CoverageGroup; restaurants: CoverageGroup }>(
    () => api.get('/admin/payee-accounts/coverage').then(r => r.data),
    [],
    { enabled: canSeeCoverage }
  );

  const [tab, setTab] = useState('review');
  const [deciding, setDeciding] = useState<QueueRow | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!allowed && !canSeeCoverage) return <NoAccess permission="finance.payouts.manage" />;
  if (queue.loading && !queue.data && allowed) return <Loading label="Reading the verification queue…" />;

  const decide = async () => {
    if (!deciding) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post(`/admin/payee-accounts/${deciding.id}/review`, { decision, note: note.trim() });
      setDeciding(null);
      setNote('');
      await queue.reload();
      void coverage.silentReload();
    } catch (err: any) {
      setSaveError(err?.message || 'That decision could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  const rows = queue.data?.queue || [];
  const thresholds = queue.data?.thresholds;

  const renderCoverage = (label: string, group?: CoverageGroup) => {
    if (!group) return null;
    const gap = group.withoutAccount.length;
    return (
      <>
        <SectionTitle
          title={label}
          subtitle={`${group.payable} of ${group.total} can be paid right now.`}
        />
        {gap === 0 ? (
          <Card>
            <Text style={s.allGood}>Everyone has a verified account. Nothing to chase.</Text>
          </Card>
        ) : (
          group.withoutAccount.map(person => (
            <Card key={person.id} style={s.gapCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.gapName}>{person.name}</Text>
                <Text style={s.gapReason}>{person.reason}</Text>
              </View>
              <Badge
                label={person.reason === 'Awaiting review' ? 'IN QUEUE' : 'CANNOT PAY'}
                tone={person.reason === 'Awaiting review' ? 'warning' : 'danger'}
              />
            </Card>
          ))
        )}
      </>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={queue.loading || coverage.loading}
            onRefresh={() => {
              void queue.reload();
              void coverage.reload();
            }}
          />
        }
      >
        {!!queue.error && (
          <Card style={s.errorCard}>
            <Text style={s.errorText}>{queue.error}</Text>
          </Card>
        )}

        {queue.data && !queue.data.verificationAvailable && (
          <Card style={s.warnCard}>
            <View style={s.warnRow}>
              <AlertTriangle size={18} color={c.state.warning} />
              <Text style={s.warnText}>
                Automatic bank verification is not configured on this deployment. New accounts arrive
                unverified and must be checked by hand before anybody is paid.
              </Text>
            </View>
          </Card>
        )}

        <Segmented
          options={[
            { key: 'review', label: `Review${rows.length ? ` (${rows.length})` : ''}` },
            { key: 'coverage', label: 'Who can be paid' }
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'review' ? (
          !allowed ? (
            <NoAccess permission="finance.payouts.manage" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              message="Every account has either been verified by the bank or refused. This queue only holds the ones where the name was close but not identical."
              icon={<UserCheck size={28} color={c.text.muted} />}
            />
          ) : (
            <>
              <SectionTitle
                title="Names that need a person"
                subtitle={
                  thresholds
                    ? `Verified automatically at ${thresholds.accept}% and above. Refused below ${thresholds.review}%. These are in between.`
                    : undefined
                }
              />
              {rows.map(row => (
                <Card key={row.id} style={s.rowCard}>
                  <View style={s.rowHead}>
                    {row.method === 'BANK' ? (
                      <Landmark size={18} color={c.brand.amberText} />
                    ) : (
                      <Smartphone size={18} color={c.brand.amberText} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.owner}>{row.ownerName}</Text>
                      <Text style={s.ownerDetail}>{row.ownerDetail}</Text>
                    </View>
                    <Badge label={`${row.nameMatchScore ?? '—'}%`} tone="warning" />
                  </View>

                  <Divider style={{ marginVertical: 10 }} />

                  {/* Both names, side by side. This IS the decision. */}
                  <View style={s.compareRow}>
                    <Text style={s.compareLabel}>The bank holds</Text>
                    <Text style={s.compareValue}>{row.registeredName || 'No name returned'}</Text>
                  </View>
                  <View style={s.compareRow}>
                    <Text style={s.compareLabel}>They entered</Text>
                    <Text style={s.compareValue}>{row.holderName}</Text>
                  </View>
                  <View style={s.compareRow}>
                    <Text style={s.compareLabel}>Account</Text>
                    <Text style={s.compareValue}>
                      {row.method === 'BANK'
                        ? `${row.ifsc || ''} •••• ${row.accountLast4 || '????'}`
                        : row.vpa}
                    </Text>
                  </View>

                  <Text style={s.added}>Added {timeAgo(row.createdAt)}</Text>

                  <View style={s.actions}>
                    <Button
                      label="Reject"
                      variant="danger"
                      onPress={() => {
                        setDeciding(row);
                        setDecision('REJECT');
                        setNote('');
                        setSaveError(null);
                      }}
                    />
                    <Button
                      label="Approve"
                      onPress={() => {
                        setDeciding(row);
                        setDecision('APPROVE');
                        setNote('');
                        setSaveError(null);
                      }}
                    />
                  </View>
                </Card>
              ))}
            </>
          )
        ) : !canSeeCoverage ? (
          <NoAccess permission="finance.payouts.view" />
        ) : coverage.loading && !coverage.data ? (
          <Loading label="Checking who can be paid…" />
        ) : (
          <>
            {renderCoverage('Riders', coverage.data?.riders)}
            {renderCoverage('Restaurants', coverage.data?.restaurants)}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={!!deciding}
        onClose={() => setDeciding(null)}
        title={decision === 'APPROVE' ? 'Approve this account' : 'Reject this account'}
        subtitle={deciding?.ownerName}
      >
        <View style={s.confirmBox}>
          <View style={s.compareRow}>
            <Text style={s.compareLabel}>The bank holds</Text>
            <Text style={s.compareValue}>{deciding?.registeredName || 'No name returned'}</Text>
          </View>
          <View style={s.compareRow}>
            <Text style={s.compareLabel}>They entered</Text>
            <Text style={s.compareValue}>{deciding?.holderName}</Text>
          </View>
        </View>

        <Text style={s.confirmNote}>
          {decision === 'APPROVE'
            ? 'Approving means every future settlement for them is sent to this account. Money sent to a wrong account is not recoverable.'
            : 'Rejecting tells them to add a different account. They are shown the reason you record here, so write something they can act on.'}
        </Text>

        <Field
          label={decision === 'APPROVE' ? 'What did you check?' : 'Why is it rejected?'}
          value={note}
          onChangeText={setNote}
          placeholder={
            decision === 'APPROVE'
              ? 'e.g. Matches the PAN on their KYC document'
              : 'e.g. The account is in a different person’s name'
          }
          multiline
          hint="Recorded in the audit log against your account. It is the only evidence a person looked at this."
        />

        {!!saveError && <Text style={s.errorText}>{saveError}</Text>}

        <Button
          label={saving ? 'Recording…' : decision === 'APPROVE' ? 'Approve and allow payouts' : 'Reject'}
          variant={decision === 'APPROVE' ? 'primary' : 'danger'}
          onPress={decide}
          disabled={saving || note.trim().length < 3}
        />
      </Sheet>
    </>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  errorCard: { borderColor: c.state.danger, marginBottom: 12 },
  errorText: { color: c.state.danger, fontSize: 13, marginTop: 8 },

  warnCard: { marginBottom: 12 },
  warnRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  warnText: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 },

  rowCard: { marginBottom: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  owner: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  ownerDetail: { color: c.text.secondary, fontSize: 12, marginTop: 2 },

  compareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  compareLabel: { color: c.text.muted, fontSize: 12 },
  compareValue: { color: c.text.primary, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },

  added: { color: c.text.muted, fontSize: 11, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' },

  confirmBox: { backgroundColor: c.bg.sunken, borderRadius: 10, padding: 12, marginBottom: 12 },
  confirmNote: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },

  allGood: { color: c.state.success, fontSize: 13 },
  gapCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  gapName: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  gapReason: { color: c.text.secondary, fontSize: 12, marginTop: 2 }
});
