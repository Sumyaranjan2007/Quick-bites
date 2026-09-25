import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  Modal,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity
} from 'react-native';
import { FileText, CheckCircle2, Clock3, XCircle, Camera, ShieldCheck } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Button, Field, Pill, ErrorNote } from '../components/ui';
import { fetchDocuments, uploadDocument } from '../lib/partnerApi';
import { chooseDocumentPhoto } from '../lib/photo';

interface Props {
  restaurantId: string;
}

/**
 * Document verification.
 *
 * This screen used to be an opaque "KYC Docs" panel that showed a status and
 * nothing else — no indication of what was needed, what each document was for,
 * what formats were accepted, or what to do about a rejection. The requirements
 * now come from the server's catalogue, so what the partner is told and what the
 * reviewer enforces cannot drift apart.
 *
 * THE DOCUMENT IS A PHOTOGRAPH, taken here.
 *
 * It was not. This screen asked for a "file reference" — a line of text — and
 * told the partner to email the licence to support and describe here where to
 * find it. There was no picker, no camera, no way to attach anything at all.
 * The delivery app has photographed documents since it was written; the
 * partner app, which is the one asking for an FSSAI licence without which a
 * kitchen cannot legally trade, asked the partner to use their email client.
 *
 * What reached the reviewer was prose: "emailed on 14 Sep". Verification then
 * depended on somebody matching that sentence to an inbox by hand, which is
 * why partners sat at "In review" for days.
 */
export const DocumentsScreen: React.FC<Props> = ({ restaurantId }) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<any | null>(null);
  const [number, setNumber] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      const res = await fetchDocuments(restaurantId);
      if (!res.ok) setError(res.message || 'Could not load your documents.');
      else {
        setError(null);
        setData(res.data);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [restaurantId]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  const open = (slot: any) => {
    setTarget(slot);
    setNumber(slot.documentNumber || '');
    // Never carried over from the last document: attaching the FSSAI licence to
    // a PAN submission by accident is a rejection and another day of waiting.
    setPhoto(null);
    setFormError(null);
  };

  const attach = async () => {
    if (!target) return;
    setPicking(true);
    try {
      const uri = await chooseDocumentPhoto(target.label);
      if (uri) {
        setPhoto(uri);
        setFormError(null);
      }
    } catch (err: any) {
      setFormError(err?.message || 'That photo could not be used. Try taking it again.');
    } finally {
      setPicking(false);
    }
  };

  const send = async () => {
    if (!target) return;
    if (number.trim().length < 4) {
      setFormError('Enter the number printed on the document.');
      return;
    }
    if (!photo) {
      setFormError('Add a photo of the document. The reviewer has to be able to read it.');
      return;
    }

    setBusy(true);
    const res = await uploadDocument(restaurantId, {
      documentType: target.documentType,
      documentNumber: number.trim(),
      fileUrl: photo
    });
    setBusy(false);

    if (!res.ok) {
      setFormError(res.message || 'Could not submit that document.');
      return;
    }
    setTarget(null);
    setPhoto(null);
    load('initial');
  };

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={c.brand} size="large" />
      </View>
    );
  }

  const statusPill = (status: string) => {
    if (status === 'APPROVED') return <Pill label="Verified" tone="success" />;
    if (status === 'PENDING') return <Pill label="In review" tone="warning" />;
    if (status === 'REJECTED') return <Pill label="Rejected" tone="danger" />;
    return <Pill label="Not uploaded" tone="muted" />;
  };

  const statusIcon = (status: string) => {
    if (status === 'APPROVED') return <CheckCircle2 size={18} color={c.success} />;
    if (status === 'PENDING') return <Clock3 size={18} color={c.warning} />;
    if (status === 'REJECTED') return <XCircle size={18} color={c.danger} />;
    return <FileText size={18} color={c.textMuted} />;
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />}
      >
        {!!error && <ErrorNote message={error} onRetry={() => load('initial')} />}

        <Card style={data?.verified ? styles.bannerOk : styles.bannerWork}>
          <View style={styles.bannerRow}>
            <ShieldCheck size={22} color={data?.verified ? c.success : c.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                {data?.verified ? 'Your restaurant is verified' : 'Verification incomplete'}
              </Text>
              <Text style={styles.bannerBody}>
                {data?.verified
                  ? 'All required documents have been approved. You can trade normally.'
                  : data?.rejected?.length
                    ? `${data.rejected.join(', ')} needs to be sent again.`
                    : data?.outstanding?.length
                      ? `Still needed: ${data.outstanding.join(', ')}.`
                      : 'Your documents are with our team for review.'}
              </Text>
            </View>
          </View>
        </Card>

        <SectionHeading
          title="Your documents"
          sub={`${data?.acceptedFormats?.join(', ')} · up to ${data?.maxSizeMb} MB each`}
        />

        {(data?.slots || []).map((slot: any) => (
          <Card key={slot.documentType}>
            <View style={styles.slotTop}>
              {statusIcon(slot.status)}
              <View style={{ flex: 1 }}>
                <Text style={styles.slotLabel}>
                  {slot.label}
                  {slot.required ? '' : ' (optional)'}
                </Text>
                {!!slot.documentNumber && <Text style={styles.slotNumber}>{slot.documentNumber}</Text>}
              </View>
              {statusPill(slot.status)}
            </View>

            <Text style={styles.purpose}>{slot.purpose}</Text>

            <View style={styles.requirementBox}>
              <Text style={styles.requirementLabel}>Must be legible</Text>
              <Text style={styles.requirementText}>{slot.mustShow}</Text>
              <Text style={styles.requirementLabel}>Accepted formats</Text>
              <Text style={styles.requirementText}>
                {slot.acceptedFormats.join(', ')} · maximum {slot.maxSizeMb} MB
              </Text>
            </View>

            {slot.status === 'REJECTED' && !!slot.rejectionReason && (
              <View style={styles.rejectBox}>
                <Text style={styles.rejectTitle}>Why it was rejected</Text>
                <Text style={styles.rejectBody}>{slot.rejectionReason}</Text>
              </View>
            )}

            {/* The photo they actually sent. Without it a partner facing a
                rejection has no way to tell which attempt was reviewed. */}
            {!!slot.fileUrl && slot.fileUrl.startsWith('data:image/') && (
              <Image source={{ uri: slot.fileUrl }} style={styles.sentThumb} resizeMode="cover" />
            )}

            {slot.status === 'PENDING' && (
              <Text style={styles.quiet}>Submitted {new Date(slot.submittedAt).toLocaleDateString('en-IN')}. Our team reviews within one working day.</Text>
            )}

            {(slot.status === 'NOT_UPLOADED' || slot.status === 'REJECTED') && (
              <Button
                label={slot.status === 'REJECTED' ? 'Send again' : 'Submit this document'}
                onPress={() => open(slot)}
                style={{ marginTop: spacing.md }}
              />
            )}
          </Card>
        ))}

        <Text style={styles.footnote}>
          Documents are reviewed by the Quick Bites operations team. Your kitchen stays hidden from customers and
          cannot go online until the required documents are approved. Anything rejected can be photographed and
          sent again from this screen.
        </Text>
      </ScrollView>

      <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => setTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.sheetHead}>
                <Camera size={20} color={c.brand} />
                <Text style={styles.sheetTitle}>{target?.label}</Text>
              </View>
              <Text style={styles.sheetBody}>{target?.mustShow}</Text>

              {!!formError && <ErrorNote message={formError} />}

              <Field
                label="Document number"
                value={number}
                onChangeText={setNumber}
                placeholder={target?.documentType === 'FSSAI' ? '14-digit licence number' : 'As printed'}
                autoCapitalize="characters"
              />

              <Text style={styles.photoLabel}>Photo of the document</Text>
              <TouchableOpacity
                style={[styles.photoBox, photo ? styles.photoBoxFilled : null]}
                onPress={attach}
                disabled={picking}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={photo ? 'Replace the document photo' : 'Add a photo of the document'}
              >
                {picking ? (
                  <ActivityIndicator color={c.brand} />
                ) : photo ? (
                  <>
                    {/* Shown at the size it was taken, so a partner can SEE it is
                        blurred or cropped before a reviewer rejects it tomorrow. */}
                    <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" />
                    <Text style={styles.photoReplace}>Tap to take it again</Text>
                  </>
                ) : (
                  <>
                    <Camera size={22} color={c.textMuted} />
                    <Text style={styles.photoHint}>Add a photo of the document</Text>
                    <Text style={styles.photoSub}>Camera or gallery · lay it flat, all four corners visible</Text>
                  </>
                )}
              </TouchableOpacity>

              <Button label="Submit for review" onPress={send} busy={busy} />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setTarget(null)}
                style={{ marginTop: spacing.md, marginBottom: spacing.xl }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  centre: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.xl, paddingBottom: 48 },
  bannerOk: { borderColor: c.success },
  bannerWork: { borderColor: c.warning },
  bannerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  bannerTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  bannerBody: { fontSize: 13, color: c.textMuted, marginTop: 4, lineHeight: 19 },
  slotTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  slotLabel: { fontSize: 15, fontWeight: '800', color: c.text },
  slotNumber: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: 'monospace' },
  purpose: { fontSize: 13, color: c.textSoft, lineHeight: 19, marginBottom: spacing.md },
  requirementBox: { backgroundColor: c.bg, borderRadius: radii.md, padding: spacing.md },
  requirementLabel: {
    fontSize: 10,
    color: c.textMuted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm
  },
  requirementText: { fontSize: 12, color: c.textSoft, marginTop: 3, lineHeight: 17 },
  rejectBox: { backgroundColor: c.dangerSoft, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  rejectTitle: { fontSize: 12, fontWeight: '800', color: c.danger },
  rejectBody: { fontSize: 13, color: c.dangerText, marginTop: 4, lineHeight: 18 },
  quiet: { fontSize: 12, color: c.textMuted, marginTop: spacing.md, lineHeight: 17 },
  footnote: { fontSize: 12, color: c.textMuted, lineHeight: 18, marginTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xxl,
    maxHeight: '88%'
  },
  photoLabel: {
    fontSize: 12,
    color: c.textMuted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm
  },
  photoBox: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.border,
    backgroundColor: c.bg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    marginBottom: spacing.xl
  },
  photoBoxFilled: { borderStyle: 'solid', borderColor: c.success, paddingVertical: spacing.md },
  photoHint: { fontSize: 14, color: c.text, fontWeight: '700', marginTop: spacing.sm },
  photoSub: { fontSize: 12, color: c.textMuted, marginTop: 4, textAlign: 'center' },
  photoReplace: { fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
  preview: { width: '100%', height: 180, borderRadius: radii.sm },
  sentThumb: {
    width: '100%',
    height: 120,
    borderRadius: radii.sm,
    marginTop: spacing.md,
    backgroundColor: c.bg
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: c.text },
  sheetBody: { fontSize: 13, color: c.textMuted, marginTop: 8, marginBottom: spacing.xl, lineHeight: 19 }
});
