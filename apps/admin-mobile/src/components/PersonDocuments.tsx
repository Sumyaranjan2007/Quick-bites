import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Alert } from 'react-native';
import { Card, Badge, Button, Field, Divider, Loading, KeyValue, ResourceError } from './ui';
import { DownloadButton } from './DownloadButton';
import { documentFileName } from '../lib/download';
import { tokens, humanise, formatDateTime } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * Approve, refuse, or withdraw one document (owner, 18 Oct 2026: every
 * document can be re-verified, not only a waiting one). The server answers
 * with what the decision did to the person; that is what is shown.
 */
export const DocumentActions: React.FC<{ doc: any; onDone: () => void }> = ({ doc, onDone }) => {
  const { api, can } = useSession();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!can('documents.review')) return null;

  const review = async (action: 'APPROVE' | 'REJECT' | 'REQUEST_REUPLOAD') => {
    if (action !== 'APPROVE' && !reason.trim()) {
      Alert.alert('A reason is required', 'They are shown this so they know what to fix.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<any>('/admin/documents/review', {
        documentId: doc.id,
        action,
        ...(action !== 'APPROVE' ? { rejectionReason: reason.trim() } : {})
      });
      setAsking(false);
      setReason('');
      onDone();
      const outcome = result?.outcome;
      Alert.alert(
        action === 'APPROVE' ? (outcome?.verified === false ? 'Approved — still not verified' : 'Approved') : 'Sent back',
        outcome?.summary || (action === 'APPROVE' ? 'Recorded.' : 'They have been told what to fix and can upload again.')
      );
    } catch (err: any) {
      Alert.alert('Could not review', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  if (asking) {
    return (
      <>
        <Divider />
        <Field
          label={doc.status === 'APPROVED' ? 'Why is the approval withdrawn?' : 'What is wrong with it?'}
          value={reason}
          onChangeText={setReason}
          placeholder={doc.status === 'APPROVED' ? 'The licence expired in March.' : 'The photo is cut off at the expiry date.'}
          multiline
        />
        <View style={s.actionRow}>
          <Button label="Back" variant="secondary" full onPress={() => setAsking(false)} />
          <Button
            label={doc.status === 'APPROVED' ? 'Withdraw approval' : 'Ask for a re-upload'}
            variant="danger"
            full
            loading={busy}
            onPress={() => review(doc.status === 'APPROVED' ? 'REJECT' : 'REQUEST_REUPLOAD')}
          />
        </View>
      </>
    );
  }
  return (
    <>
      <Divider />
      <View style={s.actionRow}>
        {doc.status !== 'REJECTED' ? (
          <Button label={doc.status === 'APPROVED' ? 'Withdraw approval' : 'Reject'} variant="danger" full onPress={() => setAsking(true)} />
        ) : null}
        {doc.status !== 'APPROVED' ? (
          <Button label={doc.status === 'REJECTED' ? 'Approve after all' : 'Approve'} variant="success" full loading={busy} onPress={() => review('APPROVE')} />
        ) : null}
      </View>
    </>
  );
};

/** Which upload this is, in words a reviewer can act on. */
function standingLabel(doc: any): string | null {
  if (doc.current && doc.status === 'APPROVED') return 'In force';
  if (doc.standing) return 'Still counts (newer upload not approved)';
  if (doc.current) return doc.replacesId ? 'New upload, replaces a verified one' : 'Latest upload';
  return 'Earlier upload';
}

/**
 * One person's uploads, grouped (Licences, Tax, Identity, Bank), newest first,
 * each with its photo, download and review buttons (master plan #11, B7).
 * Used inside the People sheets and from the KYC queue's names.
 */
export const PersonDocuments: React.FC<{ kind: 'restaurant' | 'rider' | 'customer'; id: string; onChanged?: () => void }> = ({
  kind,
  id,
  onChanged
}) => {
  const { api } = useSession();
  const [showEarlier, setShowEarlier] = useState(false);
  // Photos are fetched one at a time through the audited file route (each open is
  // recorded against the admin), never shipped inside the record.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const fileUrl = (doc: any) => `${api.baseUrl}${String(doc.downloadPath).replace(/^\/api/, '')}`;
  const auth = { Authorization: `Bearer ${api.token}` };
  const showPhoto = async (doc: any) => {
    try {
      const res = await fetch(fileUrl(doc), { headers: auth });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const uri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      setPhotos(p => ({ ...p, [doc.id]: uri }));
    } catch {
      Alert.alert('Not shown', 'The photo could not be fetched. Check the internet connection and try again.');
    }
  };
  const record = useResource(() => api.get<any>(`/admin/records/${kind}/${id}`), [kind, id]);
  const groups: any[] = record.data?.documents || [];
  const reload = () => {
    void record.reload();
    onChanged?.();
  };

  if (record.loading && !record.data) return <Loading />;
  const all = groups.flatMap(g => g.items);
  const earlier = all.filter(d => !d.current && !d.standing).length;

  return (
    <View>
      <ResourceError resource={record} what="Their documents" />
      {record.data && record.data.documents === null ? <Text style={s.muted}>You cannot view documents.</Text> : null}
      {record.data?.documents && all.length === 0 ? <Text style={s.muted}>No documents on file.</Text> : null}
      {all.length > 0 ? (
        <DownloadButton
          source={`${api.baseUrl}/admin/records/${kind}/${id}/documents.zip`}
          headers={{ Authorization: `Bearer ${api.token}` }}
          name={documentFileName([record.data?.name, 'documents'])}
          label="Download all (ZIP)"
          full
        />
      ) : null}
      {groups.map(group => (
        <View key={group.group}>
          <Text style={s.group}>{group.group}</Text>
          {group.items
            .filter((doc: any) => showEarlier || doc.current || doc.standing)
            .map((doc: any) => (
              <Card key={doc.id}>
                <View style={s.rowTop}>
                  <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                    <Text style={s.title}>{humanise(doc.documentType)}</Text>
                    <Text style={s.sub}>{standingLabel(doc)}</Text>
                  </View>
                  <Badge label={doc.status} />
                </View>
                {photos[doc.id] ? <Image source={{ uri: photos[doc.id] }} style={s.scan} resizeMode="contain" /> : null}
                {doc.file === 'missing' ? <Text style={s.muted}>No file attached.</Text> : null}
                {doc.file !== 'missing' ? (
                  <View style={s.actionRow}>
                    {doc.file === 'image' && !photos[doc.id] ? (
                      <Button label="Show photo" variant="secondary" size="sm" onPress={() => void showPhoto(doc)} />
                    ) : null}
                    <DownloadButton source={fileUrl(doc)} headers={auth} name={documentFileName([record.data?.name, doc.documentType, doc.documentNumber])} />
                  </View>
                ) : null}
                <KeyValue label="Number" value={doc.documentNumber || 'No number recorded'} tone="strong" />
                <KeyValue label="Uploaded" value={formatDateTime(doc.submittedAt)} />
                {doc.reviewedAt ? <KeyValue label="Reviewed" value={formatDateTime(doc.reviewedAt)} /> : null}
                {doc.rejectionReason ? <KeyValue label="Refused because" value={doc.rejectionReason} /> : null}
                <DocumentActions doc={doc} onDone={reload} />
              </Card>
            ))}
        </View>
      ))}
      {earlier > 0 ? (
        <Button
          label={showEarlier ? 'Hide earlier uploads' : `Show ${earlier} earlier upload${earlier === 1 ? '' : 's'}`}
          variant="secondary"
          full
          onPress={() => setShowEarlier(v => !v)}
        />
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  group: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    color: c.text.muted,
    textTransform: 'uppercase',
    marginTop: tokens.space[4],
    marginBottom: tokens.space[2]
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  muted: { fontSize: tokens.font.size.sm, color: c.text.muted, marginVertical: tokens.space[2] },
  scan: {
    width: '100%',
    height: 200,
    borderRadius: tokens.radius.md,
    backgroundColor: c.bg.sunken,
    marginVertical: tokens.space[3]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] }
});
