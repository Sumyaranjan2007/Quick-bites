import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image } from 'react-native';
import { Store } from 'lucide-react-native';
import {
  Card,
  Segmented,
  Badge,
  Button,
  Field,
  Divider,
  Loading,
  EmptyState,
  NoAccess
} from '../components/ui';
import { tokens, formatDateTime } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

/**
 * Partner-submitted changes to how a restaurant appears to customers.
 *
 * The live restaurant has not moved. What is here is what the partner has
 * ASKED it to become, and approving is the only thing that writes it — so a
 * reviewer on a phone is looking at the same decision the web console shows,
 * and both must refuse the same things.
 *
 * Reviewed field by field, because a partner who corrected their hours and
 * also uploaded a bad photograph should keep the correction. One verdict for
 * the whole submission means they lose it and send both again, and the same
 * submission comes back round.
 */

const FIELD_WORD: Record<string, string> = {
  name: 'Restaurant name',
  description: 'About',
  phone: 'Phone number',
  addressLine: 'Address',
  city: 'City',
  pincode: 'Pincode',
  coordinates: 'Map pin',
  cuisineTags: 'Cuisines',
  costForTwo: 'Cost for two',
  bannerUrl: 'Cover photo',
  galleryUrls: 'Photos',
  openingHours: 'Opening hours'
};

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Shows a value the way a reviewer can judge it, not the way it is stored. */
const Value: React.FC<{ field: string; value: any }> = ({ field, value }) => {
  if (value === undefined || value === null || value === '') {
    return <Text style={s.valueMuted}>not set</Text>;
  }

  if (field === 'bannerUrl') {
    return <Image source={{ uri: String(value) }} style={s.cover} resizeMode="cover" />;
  }

  if (field === 'galleryUrls') {
    const list: string[] = Array.isArray(value) ? value : [];
    if (!list.length) return <Text style={s.valueMuted}>none</Text>;
    return (
      <View style={s.thumbRow}>
        {list.map((uri, i) => (
          <Image key={i} source={{ uri }} style={s.thumb} resizeMode="cover" />
        ))}
      </View>
    );
  }

  if (field === 'openingHours') {
    const week = (value?.week || {}) as Record<string, Array<{ opensAt: number; closesAt: number }>>;
    const days = Object.keys(week);
    if (!days.length) return <Text style={s.valueMuted}>not declared</Text>;
    return (
      <View>
        {days.map(d => (
          <Text key={d} style={s.value}>
            {d[0] + d.slice(1).toLowerCase()}:{' '}
            {week[d].length
              ? week[d].map(w => `${clock(w.opensAt)}–${clock(w.closesAt)}`).join(', ')
              : 'closed'}
          </Text>
        ))}
      </View>
    );
  }

  if (field === 'coordinates') {
    return (
      <Text style={s.value}>
        {Number(value.latitude).toFixed(5)}, {Number(value.longitude).toFixed(5)}
      </Text>
    );
  }

  if (Array.isArray(value)) return <Text style={s.value}>{value.join(', ')}</Text>;
  return <Text style={s.value}>{String(value)}</Text>;
};

export const ProfileApprovalsScreen: React.FC = () => {
  const { api, can } = useSession();
  const [status, setStatus] = useState('PENDING');
  const [decisions, setDecisions] = useState<Record<string, Record<string, string>>>({});
  const [reasons, setReasons] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useResource(() => api.get<any>(`/admin/profile-edits${query({ status })}`), [status]);
  const edits = list.data?.edits || [];

  if (!can('catalog.restaurants.approve')) {
    return <NoAccess permission="catalog.restaurants.approve" />;
  }

  const decide = (editId: string, field: string, verdict: string) =>
    setDecisions(d => ({ ...d, [editId]: { ...(d[editId] || {}), [field]: verdict } }));

  const setReason = (editId: string, field: string, reason: string) =>
    setReasons(r => ({ ...r, [editId]: { ...(r[editId] || {}), [field]: reason } }));

  const submit = async (edit: any) => {
    const chosen = decisions[edit.id] || {};
    const approve = edit.fields.filter((f: string) => chosen[f] === 'APPROVE');
    const reject = edit.fields
      .filter((f: string) => chosen[f] === 'REJECT')
      .map((f: string) => ({ field: f, reason: (reasons[edit.id]?.[f] || '').trim() }));

    const missing = reject.find((r: any) => r.reason.length < 4);
    if (missing) {
      setError(
        `Say why "${FIELD_WORD[missing.field] ?? missing.field}" was refused — the partner has to know what to fix.`
      );
      return;
    }

    setBusyId(edit.id);
    setError(null);
    try {
      await api.post<any>(`/admin/profile-edits/${edit.id}/review`, { approve, reject });
      setDecisions(d => ({ ...d, [edit.id]: {} }));
      setReasons(r => ({ ...r, [edit.id]: {} }));
      list.reload();
    } catch (err: any) {
      setError(err?.message || 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={s.body}
      refreshControl={
        <RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />
      }
    >
      <Segmented
        options={[
          { key: 'PENDING', label: 'Waiting' },
          { key: 'APPROVED', label: 'Approved' },
          { key: 'REJECTED', label: 'Refused' },
          { key: 'ALL', label: 'All' }
        ]}
        value={status}
        onChange={setStatus}
      />

      {!!error && (
        <Card style={s.errorCard}>
          <Text style={s.errorText}>{error}</Text>
        </Card>
      )}

      {list.loading && !edits.length ? (
        <Loading label="Loading profile changes" />
      ) : !edits.length ? (
        <EmptyState
          title="Nothing waiting"
          message="When a partner changes their photos, name, hours or address, it appears here before any customer sees it."
          icon={<Store size={26} color={c.text.secondary} />}
        />
      ) : (
        edits.map((edit: any) => {
          const chosen = decisions[edit.id] || {};
          const undecided = edit.fields.filter((f: string) => !chosen[f]);
          const settled = edit.status !== 'PENDING';

          return (
            <Card key={edit.id} style={s.card}>
              <View style={s.head}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{edit.restaurantName}</Text>
                  <Text style={s.sub}>
                    {edit.city ? `${edit.city} · ` : ''}
                    {edit.fields.length} change{edit.fields.length === 1 ? '' : 's'} ·{' '}
                    {formatDateTime(edit.submittedAt)}
                  </Text>
                </View>
                <Badge label={edit.status} />
              </View>

              {/* Both change the decision, so both are said rather than left
                  for the reviewer to look up somewhere else. */}
              {edit.restaurantStatus !== 'ACTIVE' && (
                <Text style={s.warn}>
                  This restaurant is {String(edit.restaurantStatus).replace(/_/g, ' ').toLowerCase()} and is not
                  trading yet.
                </Text>
              )}
              {edit.affectsListing && (
                <Text style={s.warn}>
                  This moves where the restaurant is, so it changes which customers can order from it.
                </Text>
              )}

              {edit.fields.map((field: string) => (
                <View key={field} style={s.field}>
                  <Divider style={{ marginBottom: 12 }} />
                  <Text style={s.fieldName}>{FIELD_WORD[field] ?? field}</Text>

                  <Text style={s.sideLabel}>NOW</Text>
                  <Value field={field} value={edit.previous?.[field]} />

                  <Text style={[s.sideLabel, { marginTop: 10 }]}>ASKED FOR</Text>
                  <Value field={field} value={edit.changes?.[field]} />

                  {settled ? (
                    <Text style={s.settled}>
                      {(edit.approvedFields || []).includes(field)
                        ? 'Approved'
                        : (edit.rejections || []).find((r: any) => r.field === field)?.reason || 'Not approved'}
                    </Text>
                  ) : (
                    <>
                      <View style={s.actions}>
                        <Button
                          label="Approve"
                          size="sm"
                          variant={chosen[field] === 'APPROVE' ? 'success' : 'secondary'}
                          onPress={() => decide(edit.id, field, 'APPROVE')}
                        />
                        <Button
                          label="Refuse"
                          size="sm"
                          variant={chosen[field] === 'REJECT' ? 'danger' : 'secondary'}
                          onPress={() => decide(edit.id, field, 'REJECT')}
                        />
                      </View>
                      {chosen[field] === 'REJECT' && (
                        <Field
                          label="Why?"
                          value={reasons[edit.id]?.[field] || ''}
                          onChangeText={v => setReason(edit.id, field, v)}
                          placeholder="The partner sees this."
                          hint="Say what to change, not just that it was refused."
                        />
                      )}
                    </>
                  )}
                </View>
              ))}

              {!settled && (
                <View style={s.footer}>
                  <Button
                    label="Approve all"
                    variant="secondary"
                    size="sm"
                    onPress={() =>
                      setDecisions(d => ({
                        ...d,
                        [edit.id]: Object.fromEntries(edit.fields.map((f: string) => [f, 'APPROVE']))
                      }))
                    }
                  />
                  {/*
                    Disabled until every field is decided, and it says how many
                    are left. The server already refuses an incomplete review;
                    letting the tap through and showing the refusal afterwards
                    is a worse version of the same rule.
                  */}
                  <Button
                    label={undecided.length > 0 ? `${undecided.length} to decide` : 'Record decision'}
                    size="sm"
                    disabled={undecided.length > 0}
                    loading={busyId === edit.id}
                    onPress={() => void submit(edit)}
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: c.text.primary, fontSize: 15, fontWeight: '800' },
  sub: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  warn: { color: c.state.warning, fontSize: 12, marginTop: 8, lineHeight: 17 },

  field: { marginTop: 14 },
  fieldName: { color: c.text.primary, fontSize: 13.5, fontWeight: '700', marginBottom: 8 },
  sideLabel: { color: c.text.secondary, fontSize: 10, letterSpacing: 0.6, fontWeight: '700' },
  value: { color: c.text.primary, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  valueMuted: { color: c.text.secondary, fontSize: 13, fontStyle: 'italic', marginTop: 2 },

  // Bounded so one tall photograph cannot push the decision buttons off screen.
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, marginTop: 4, backgroundColor: c.bg.card },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  thumb: { width: 76, height: 54, borderRadius: 8, backgroundColor: c.bg.card },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  settled: { color: c.text.secondary, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 8, marginTop: 16, justifyContent: 'flex-end' },

  errorCard: { borderColor: c.state.danger },
  errorText: { color: c.state.danger, fontSize: 13, lineHeight: 18 }
});

export default ProfileApprovalsScreen;
