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
  validationStatus: 'VERIFIED' | 'UNVERIFIED' | 'NAME_MISMATCH' | 'INVALID';
  /** Set when an administrator applied it. Absent means nobody can be paid. */
  appliedAt?: string;
  appliedByAdminId?: string;
  /** What the automatic check thinks, stated as advice rather than a decision. */
  advice: string;
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
    accounts: QueueRow[];
    waiting: number;
    applied: number;
    thresholds: { accept: number; review: number };
    verificationAvailable: boolean;
  }>(() => api.get('/admin/payee-accounts').then(r => r.data), [], { enabled: allowed });

  const coverage = useResource<{ riders: CoverageGroup; restaurants: CoverageGroup }>(
    () => api.get('/admin/payee-accounts/coverage').then(r => r.data),
    [],
    { enabled: canSeeCoverage }
  );

  const [tab, setTab] = useState('restaurants');
  const [deciding, setDeciding] = useState<QueueRow | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!allowed && !canSeeCoverage) return <NoAccess permission="finance.payouts.manage" />;
  if (queue.loading && !queue.data && allowed) return <Loading label="Reading the accounts…" />;

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

  const all = queue.data?.accounts || [];
  /*
   * Split on appliedAt, not on the bank's verdict.
   *
   * "What do I have to do" and "what have I already done" are different
   * questions, and an administrator should not have to read a status column to
   * tell them apart. An account the bank refused cannot be applied, so it sits
   * with the finished work rather than in the queue — showing work that cannot
   * be done beside work that can is how somebody learns to ignore the number.
   */
  const waiting = all.filter(r => !r.appliedAt && r.validationStatus !== 'INVALID');
  const settled = all.filter(r => r.appliedAt || r.validationStatus === 'INVALID');

  /*
   * Split the queue by who is waiting, not just by whether anybody is.
   *
   * A single "Waiting (7)" badge cannot say whether seven restaurants are
   * unpaid or seven riders are, and those are different mornings. The counts
   * live on the segments themselves for the same reason.
   */
  const restaurants = waiting.filter(r => r.ownerType === 'RESTAURANT');
  const riders = waiting.filter(r => r.ownerType === 'RIDER');
  const approved = settled.slice().sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));

  const rows = tab === 'restaurants' ? restaurants : tab === 'riders' ? riders : approved;
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
        {/*
          * Only when there is something on screen for it to qualify. With an
          * empty list the empty state says the same thing and offers a retry,
          * and two red messages about one failure read as two failures.
          */}
        {!!queue.error && rows.length > 0 && (
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
            { key: 'restaurants', label: `Restaurants${restaurants.length ? ` (${restaurants.length})` : ''}` },
            { key: 'riders', label: `Riders${riders.length ? ` (${riders.length})` : ''}` },
            { key: 'approved', label: 'Approved' },
            { key: 'coverage', label: 'Who can be paid' }
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab !== 'coverage' ? (
          !allowed ? (
            <NoAccess permission="finance.payouts.manage" />
          ) : rows.length === 0 ? (
            /*
             * Three different nothings, three different sentences.
             *
             * This screen was reported as broken — "nothing is coming up" —
             * while it was working correctly and the platform simply had no
             * accounts on file. A request that failed and a queue that is
             * genuinely clear both rendered as the same blank card, so there
             * was no way to tell a fault from a quiet morning without opening
             * the server. Saying which nothing this is costs four lines.
             */
            queue.error ? (
              <EmptyState
                title="Could not reach the server"
                message={`${queue.error} Nothing here is a statement about your accounts — this screen could not ask.`}
                icon={<AlertTriangle size={28} color={c.state.danger} />}
                action={<Button label="Try again" variant="secondary" onPress={() => void queue.reload()} />}
              />
            ) : all.length === 0 ? (
              <EmptyState
                title="No bank accounts yet"
                message={
                  'No restaurant or rider has added one. They add it from their own app, under ' +
                  'Payout account — it appears here the moment they do, and nobody can be paid ' +
                  'until you apply it.'
                }
                icon={<Landmark size={28} color={c.text.muted} />}
              />
            ) : (
              <EmptyState
                title={
                  tab === 'restaurants'
                    ? 'No restaurant is waiting'
                    : tab === 'riders'
                      ? 'No rider is waiting'
                      : 'Nothing decided yet'
                }
                message={
                  tab === 'approved'
                    ? `No account has been applied or refused yet. ${waiting.length} ${waiting.length === 1 ? 'is' : 'are'} waiting for you.`
                    : `Nothing waiting here. ${approved.length} ${approved.length === 1 ? 'account has' : 'accounts have'} already been decided.`
                }
                icon={<UserCheck size={28} color={c.text.muted} />}
              />
            )
          ) : (
            <>
              <SectionTitle
                title={
                  tab === 'restaurants'
                    ? 'Restaurants waiting for you to apply'
                    : tab === 'riders'
                      ? 'Riders waiting for you to apply'
                      : 'Already decided'
                }
                subtitle={
                  tab !== 'approved'
                    ? 'No account receives money until you apply it — whatever the bank check said. Check the name against the account, then apply.'
                    : thresholds
                      ? `Applied accounts receive the money. Refused ones cannot be applied: the bank said they do not exist.`
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
                    <Badge
                      label={
                        row.appliedAt
                          ? 'APPLIED'
                          : row.validationStatus === 'INVALID'
                            ? 'REFUSED'
                            : row.validationStatus === 'VERIFIED'
                              ? 'BANK OK'
                              : row.validationStatus === 'NAME_MISMATCH'
                                ? `${row.nameMatchScore ?? '—'}%`
                                : 'UNCHECKED'
                      }
                      tone={
                        row.appliedAt
                          ? 'success'
                          : row.validationStatus === 'INVALID'
                            ? 'danger'
                            : 'warning'
                      }
                    />
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

                  {/* The automatic check, as advice. The decision is theirs. */}
                  <Text style={s.advice}>{row.advice}</Text>

                  <Text style={s.added}>
                    Added {timeAgo(row.createdAt)}
                    {row.appliedAt ? ` · applied ${timeAgo(row.appliedAt)}` : ''}
                  </Text>

                  {row.validationStatus === 'INVALID' ? (
                    <Text style={s.refusedNote}>
                      The bank says this account does not exist, so it cannot be applied. Ask them
                      to add different details.
                    </Text>
                  ) : (
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
                        label={row.appliedAt ? 'Apply again' : 'Apply'}
                        onPress={() => {
                          setDeciding(row);
                          setDecision('APPROVE');
                          setNote('');
                          setSaveError(null);
                        }}
                      />
                    </View>
                  )}
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
        title={decision === 'APPROVE' ? 'Apply this account' : 'Reject this account'}
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
  advice: { color: c.text.secondary, fontSize: 12, marginTop: 10, lineHeight: 17 },
  refusedNote: {
    color: c.state.danger,
    fontSize: 12,
    marginTop: 12,
    lineHeight: 17
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' },

  confirmBox: { backgroundColor: c.bg.sunken, borderRadius: 10, padding: 12, marginBottom: 12 },
  confirmNote: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },

  allGood: { color: c.state.success, fontSize: 13 },
  gapCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  gapName: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  gapReason: { color: c.text.secondary, fontSize: 12, marginTop: 2 }
});
