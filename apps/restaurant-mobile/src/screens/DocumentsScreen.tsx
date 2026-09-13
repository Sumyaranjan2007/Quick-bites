import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { FileText, CheckCircle2, Clock3, XCircle, Upload, ShieldCheck } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Button, Field, Pill, ErrorNote } from '../components/ui';
import { fetchDocuments, uploadDocument } from '../lib/partnerApi';

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
 * There is no file picker yet: the platform has no upload storage, so asking for
 * a file and then discarding it would be worse than being honest. The partner
 * sends the document reference and support attaches the file, which is what
 * actually happens today.
 */
export const DocumentsScreen: React.FC<Props> = ({ restaurantId }) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<any | null>(null);
  const [number, setNumber] = useState('');
  const [reference, setReference] = useState('');
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
    setReference('');
    setFormError(null);
  };

  const send = async () => {
    if (!target) return;
    if (number.trim().length < 4) {
      setFormError('Enter the number printed on the document.');
      return;
    }
    if (reference.trim().length < 3) {
      setFormError('Describe the file you are sending, so support can match it up.');
      return;
    }

    setBusy(true);
    const res = await uploadDocument(restaurantId, {
      documentType: target.documentType,
      documentNumber: number.trim(),
      fileUrl: reference.trim()
    });
    setBusy(false);

    if (!res.ok) {
      setFormError(res.message || 'Could not submit that document.');
      return;
    }
    setTarget(null);
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
          Documents are reviewed by the Quick Bites operations team. Anything rejected can be corrected and sent
          again from this screen.
        </Text>
      </ScrollView>

      <Modal visible={!!target} transparent animationType="slide" onRequestClose={() => setTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.sheetHead}>
                <Upload size={20} color={c.brand} />
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
              <Field
                label="File reference"
                value={reference}
                onChangeText={setReference}
                placeholder="e.g. emailed to partners@quickbite.app on 14 Sep"
                hint={`Send the ${target?.acceptedFormats?.join('/')} to partners@quickbite.app, then note here how to find it. File upload from the app is coming.`}
                multiline
              />

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
  rejectBox: { backgroundColor: '#3A1714', borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  rejectTitle: { fontSize: 12, fontWeight: '800', color: c.danger },
  rejectBody: { fontSize: 13, color: '#F0B4AE', marginTop: 4, lineHeight: 18 },
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
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: c.text },
  sheetBody: { fontSize: 13, color: c.textMuted, marginTop: 8, marginBottom: spacing.xl, lineHeight: 19 }
});
