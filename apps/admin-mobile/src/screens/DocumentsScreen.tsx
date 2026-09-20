import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image, Alert } from 'react-native';
import { FileCheck2 } from 'lucide-react-native';
import { Card, Segmented, Badge, Button, Field, Divider, Loading, EmptyState, NoAccess, KeyValue } from '../components/ui';
import { tokens, humanise, formatDateTime } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

/**
 * The KYC queue.
 *
 * The scan itself is shown, not just its number: approving a licence without
 * looking at it is the part of onboarding that has to actually happen, and the
 * previous screen only ever displayed the typed-in number.
 */
export const DocumentsScreen: React.FC = () => {
  const { api, can } = useSession();
  const [status, setStatus] = useState('PENDING');
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useResource(() => api.get<any>(`/admin/documents${query({ status })}`), [status]);
  const documents = list.data?.documents || [];
  const canReview = can('documents.review');

  if (!can('documents.view')) return <NoAccess permission="documents.view" />;

  const review = async (doc: any, action: 'APPROVE' | 'REJECT' | 'REQUEST_REUPLOAD', rejectionReason?: string) => {
    setBusyId(doc.id);
    try {
      const result = await api.post<any>('/admin/documents/review', {
        documentId: doc.id,
        action,
        ...(rejectionReason ? { rejectionReason } : {})
      });
      setRejecting(null);
      setReason('');
      await list.reload();

      /*
       * The server's own words, because this screen used to guess.
       *
       * It said "<partner> can now trade on the platform" after EVERY
       * approval — which was true while approving any one document approved
       * the whole partner, and is a lie now that the required set has to be
       * complete. A reviewer who approves a bank proof and is told the
       * restaurant is trading will not go looking for the food licence.
       */
      const outcome = result?.outcome;
      Alert.alert(
        action === 'APPROVE'
          ? outcome?.verified === false
            ? 'Approved — still not verified'
            : 'Approved'
          : 'Sent back',
        outcome?.summary ||
          (action === 'APPROVE'
            ? `${doc.entityName || 'The partner'} can now trade on the platform.`
            : 'The partner has been told what to fix and can resubmit.')
      );
    } catch (err: any) {
      Alert.alert('Could not review', err?.message || 'Nothing was changed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <Segmented
          options={[
            { key: 'PENDING', label: 'Waiting' },
            { key: 'APPROVED', label: 'Approved' },
            { key: 'REJECTED', label: 'Rejected' },
            { key: 'ALL', label: 'All' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {list.loading && documents.length === 0 ? <Loading /> : null}
      {!list.loading && documents.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          message="Restaurant and rider documents arrive here as they are submitted."
          icon={<FileCheck2 size={34} color={c.text.muted} />}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {documents.map((doc: any) => (
          <Card key={doc.id}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {doc.entityName || 'Partner'}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {humanise(doc.entityType)} · {humanise(doc.documentType)}
                </Text>
              </View>
              <Badge label={doc.status} />
            </View>

            {doc.fileUrl ? <Image source={{ uri: doc.fileUrl }} style={s.scan} resizeMode="contain" /> : null}

            <KeyValue label="Document number" value={doc.documentNumber} tone="strong" />
            <KeyValue label="Contact" value={doc.entityPhone} />
            <KeyValue label="City" value={doc.entityCity} />
            <KeyValue label="Submitted" value={formatDateTime(doc.submittedAt)} />
            {doc.rejectionReason ? <KeyValue label="Rejected because" value={doc.rejectionReason} /> : null}

            {doc.status === 'PENDING' && canReview ? (
              rejecting?.id === doc.id ? (
                <>
                  <Divider />
                  <Field label="What is wrong with it?" value={reason} onChangeText={setReason} placeholder="The licence photo is cut off at the expiry date." multiline />
                  <View style={s.actionRow}>
                    <Button label="Back" variant="secondary" full onPress={() => setRejecting(null)} />
                    <Button
                      label="Ask for a re-upload"
                      variant="danger"
                      full
                      loading={busyId === doc.id}
                      onPress={() => {
                        if (!reason.trim()) {
                          Alert.alert('A reason is required', 'The partner is shown this so they know what to fix.');
                          return;
                        }
                        review(doc, 'REQUEST_REUPLOAD', reason.trim());
                      }}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Divider />
                  <View style={s.actionRow}>
                    <Button label="Reject" variant="danger" full onPress={() => setRejecting(doc)} />
                    <Button label="Approve" variant="success" full loading={busyId === doc.id} onPress={() => review(doc, 'APPROVE')} />
                  </View>
                </>
              )
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  scan: {
    width: '100%',
    height: 180,
    borderRadius: tokens.radius.md,
    backgroundColor: c.bg.sunken,
    marginVertical: tokens.space[3]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] }
});
