import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { CircleCheck, CircleX, Clock, FileUp, Info } from 'lucide-react-native';
import { t } from '../theme';
import { Button, Card, EmptyState, LoadingBlock, Pill, SectionTitle } from '../components/ui';
import { dayAndTime } from '../lib/format';
import { choosePhoto } from '../lib/photo';
import { api, type ApiContext, type DocumentRequirement } from '../lib/api';

/**
 * Document verification, start to finish.
 *
 * Each requirement shows what it is, what it is for, what state it is in and —
 * when a reviewer has rejected it — why, with the upload button turning back
 * into a re-upload. Approved documents are locked: a rider who could quietly
 * swap an approved licence could pass verification on someone else's.
 */
const STATUS_META: Record<string, { label: string; tone: 'go' | 'money' | 'danger' | 'neutral' }> = {
  APPROVED: { label: 'Approved', tone: 'go' },
  PENDING: { label: 'In review', tone: 'money' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  NOT_UPLOADED: { label: 'Not uploaded', tone: 'neutral' }
};

export const DocumentsScreen: React.FC<{ ctx: ApiContext; onChanged: () => void }> = ({ ctx, onChanged }) => {
  const [documents, setDocuments] = useState<DocumentRequirement[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<DocumentRequirement | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.documents(ctx);
      setDocuments(result.documents);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [ctx.apiUrl, ctx.token]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openUpload = (requirement: DocumentRequirement) => {
    setActive(requirement);
    setDocumentNumber(requirement.documentNumber || '');
    setPhoto(null);
  };

  const submit = async () => {
    if (!active) return;
    if (documentNumber.trim().length < 4) {
      Alert.alert('Document number required', 'Enter the number printed on the document.');
      return;
    }
    if (!photo) {
      Alert.alert('Photo required', 'Add a clear photograph of the document.');
      return;
    }
    setSubmitting(true);
    try {
      await api.uploadDocument(ctx, {
        documentType: active.documentType,
        documentNumber: documentNumber.trim(),
        fileUrl: photo
      });
      setActive(null);
      setPhoto(null);
      await load();
      onChanged();
      Alert.alert('Submitted', 'Your document has been sent for verification. This usually takes a few hours.');
    } catch (err: any) {
      Alert.alert('Upload failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !documents) return <EmptyState title="Could not load documents" message={error} />;
  if (!documents) return <LoadingBlock label="Loading your documents…" />;

  const required = documents.filter(d => d.required);
  const optional = documents.filter(d => !d.required);

  const renderDocument = (requirement: DocumentRequirement) => {
    const meta = STATUS_META[requirement.status] || STATUS_META.NOT_UPLOADED;
    const icon =
      requirement.status === 'APPROVED' ? (
        <CircleCheck size={18} color={t.color.goText} />
      ) : requirement.status === 'REJECTED' ? (
        <CircleX size={18} color={t.color.danger} />
      ) : requirement.status === 'PENDING' ? (
        <Clock size={18} color={t.color.money} />
      ) : (
        <FileUp size={18} color={t.color.textMuted} />
      );

    return (
      <Card key={requirement.documentType} style={{ marginBottom: t.space[3] }}>
        <View style={s.docHead}>
          {icon}
          <View style={{ flex: 1, marginLeft: t.space[3] }}>
            <Text style={s.docLabel}>{requirement.label}</Text>
            {requirement.documentNumber ? (
              <Text style={s.docNumber}>{requirement.documentNumber}</Text>
            ) : null}
          </View>
          <Pill label={meta.label} tone={meta.tone} />
        </View>

        <View style={s.instructions}>
          <Info size={13} color={t.color.textMuted} />
          <Text style={s.instructionsText}>{requirement.instructions}</Text>
        </View>

        {requirement.status === 'REJECTED' && requirement.rejectionReason ? (
          <View style={s.rejection}>
            <Text style={s.rejectionText}>Rejected: {requirement.rejectionReason}</Text>
          </View>
        ) : null}

        {requirement.submittedAt ? (
          <Text style={s.docMeta}>
            Submitted {dayAndTime(requirement.submittedAt)}
            {requirement.reviewedAt ? ` · Reviewed ${dayAndTime(requirement.reviewedAt)}` : ''}
          </Text>
        ) : null}

        {requirement.canReupload ? (
          <Button
            label={requirement.status === 'REJECTED' ? 'Re-upload document' : 'Upload document'}
            variant={requirement.status === 'REJECTED' ? 'money' : 'primary'}
            onPress={() => openUpload(requirement)}
            style={{ marginTop: t.space[4] }}
          />
        ) : requirement.status === 'PENDING' ? (
          <Text style={s.pendingNote}>Waiting for a reviewer. You will be told as soon as it is decided.</Text>
        ) : (
          <Text style={s.approvedNote}>Approved and locked. Contact support if this needs to change.</Text>
        )}
      </Card>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.color.go} />}
        showsVerticalScrollIndicator={false}
      >
        <Card tone="raised" style={{ marginBottom: t.space[5] }}>
          <Text style={s.introTitle}>What we need, and why</Text>
          <Text style={s.introBody}>
            A licence and a registration certificate are required by law before you can carry an order. Photograph
            each one flat, in good light, with all four corners visible. Reviews usually finish within a few hours.
          </Text>
        </Card>

        <SectionTitle>Required</SectionTitle>
        {required.map(renderDocument)}

        <SectionTitle style={{ marginTop: t.space[4] }}>Optional</SectionTitle>
        {optional.map(renderDocument)}
      </ScrollView>

      <Modal visible={Boolean(active)} animationType="slide" transparent statusBarTranslucent>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>{active?.label}</Text>
            <Text style={s.modalBody}>{active?.instructions}</Text>

            <Text style={s.fieldLabel}>Document number</Text>
            <TextInput
              style={s.input}
              value={documentNumber}
              onChangeText={setDocumentNumber}
              autoCapitalize="characters"
              placeholder="As printed on the document"
              placeholderTextColor={t.color.textMuted}
            />

            <TouchableOpacity
              style={[s.photoBox, photo ? s.photoBoxFilled : null]}
              onPress={async () => setPhoto(await choosePhoto(active?.label || 'Document', 'document'))}
              activeOpacity={0.85}
            >
              <FileUp size={20} color={photo ? t.color.goText : t.color.textMuted} />
              <Text style={[s.photoBoxText, photo ? { color: t.color.goText } : null]}>
                {photo ? 'Photo attached — tap to replace' : 'Add a photo of the document'}
              </Text>
            </TouchableOpacity>

            <View style={s.modalActions}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setActive(null)}
                style={{ flex: 1, marginRight: t.space[3] }}
              />
              <Button label="Submit" loading={submitting} onPress={submit} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  introTitle: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  introBody: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: t.space[2], lineHeight: 20 },
  docHead: { flexDirection: 'row', alignItems: 'center' },
  docLabel: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  docNumber: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2, letterSpacing: 0.5 },
  instructions: { flexDirection: 'row', marginTop: t.space[3] },
  instructionsText: { color: t.color.textMuted, fontSize: t.font.size.sm, marginLeft: 6, flex: 1, lineHeight: 18 },
  rejection: {
    marginTop: t.space[3],
    backgroundColor: t.color.dangerSoft,
    borderRadius: t.radius.sm,
    padding: t.space[3]
  },
  rejectionText: { color: t.color.danger, fontSize: t.font.size.sm, lineHeight: 18 },
  docMeta: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: t.space[3] },
  pendingNote: { color: t.color.money, fontSize: t.font.size.sm, marginTop: t.space[4] },
  approvedNote: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[4] },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    padding: t.space[5],
    paddingBottom: t.space[10],
    borderTopWidth: 1,
    borderColor: t.color.borderStrong
  },
  modalTitle: { color: t.color.text, fontSize: t.font.size.lg, fontWeight: t.font.weight.extrabold },
  modalBody: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[2], lineHeight: 19 },
  fieldLabel: {
    color: t.color.textSecondary,
    fontSize: t.font.size.sm,
    fontWeight: t.font.weight.semibold,
    marginTop: t.space[5],
    marginBottom: t.space[2]
  },
  input: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    height: 50,
    paddingHorizontal: t.space[4],
    color: t.color.text,
    fontSize: t.font.size.base
  },
  photoBox: {
    marginTop: t.space[4],
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surfaceSunken,
    paddingVertical: t.space[6],
    alignItems: 'center'
  },
  photoBoxFilled: { borderColor: t.color.go, backgroundColor: t.color.goSoft, borderStyle: 'solid' },
  photoBoxText: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[2] },
  modalActions: { flexDirection: 'row', marginTop: t.space[5] }
});
