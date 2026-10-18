import React, { useState } from 'react';
import { DownloadButton } from '../components/DownloadButton';
import { documentFileName } from '../lib/download';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image } from 'react-native';
import { FileCheck2 } from 'lucide-react-native';
import { Card, Segmented, Badge, Loading, EmptyState, NoAccess, KeyValue, ResourceError, Sheet } from '../components/ui';
import { DocumentActions, PersonDocuments } from '../components/PersonDocuments';
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
  const [person, setPerson] = useState<{ kind: 'restaurant' | 'rider'; id: string; name: string } | null>(null);

  const list = useResource(() => api.get<any>(`/admin/documents${query({ status })}`), [status]);
  const documents = list.data?.documents || [];

  if (!can('documents.view')) return <NoAccess permission="documents.view" />;

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

      <ResourceError resource={list} what="These documents" />
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
                {/* The name opens everything this person uploaded. */}
                <Text
                  style={[s.title, s.link]}
                  numberOfLines={1}
                  onPress={() => setPerson({ kind: doc.entityType === 'RIDER' ? 'rider' : 'restaurant', id: doc.entityId, name: doc.entityName || 'Partner' })}
                >
                  {doc.entityName || 'Partner'} ›
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {humanise(doc.entityType)} · {humanise(doc.documentType)}
                </Text>
              </View>
              <Badge label={doc.status} />
            </View>

            {doc.fileUrl ? <Image source={{ uri: doc.fileUrl }} style={s.scan} resizeMode="contain" /> : null}
            <DownloadButton source={doc.fileUrl} name={documentFileName([doc.entityName, doc.documentType, doc.documentNumber])} />

            <KeyValue label="Document number" value={doc.documentNumber} tone="strong" />
            <KeyValue label="Contact" value={doc.entityPhone} />
            <KeyValue label="City" value={doc.entityCity} />
            <KeyValue label="Submitted" value={formatDateTime(doc.submittedAt)} />
            {doc.rejectionReason ? <KeyValue label="Rejected because" value={doc.rejectionReason} /> : null}

            {doc.replacesId ? <KeyValue label="Replaces" value="A verified document (it still counts until this is approved)" /> : null}
            <DocumentActions doc={doc} onDone={() => void list.reload()} />
          </Card>
        ))}
      </ScrollView>
      <Sheet visible={Boolean(person)} onClose={() => setPerson(null)} title={person?.name || ''} subtitle="Everything they uploaded">
        {person ? <PersonDocuments kind={person.kind} id={person.id} onChanged={() => void list.reload()} /> : null}
      </Sheet>
    </View>
  );
};

const s = StyleSheet.create({
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  link: { color: c.brand.amber },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  scan: {
    width: '100%',
    height: 180,
    borderRadius: tokens.radius.md,
    backgroundColor: c.bg.sunken,
    marginVertical: tokens.space[3]
  },
});
