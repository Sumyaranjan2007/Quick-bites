import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Scale } from 'lucide-react-native';
import { Card, Button, Field, Sheet, SectionTitle , ResourceError} from '../components/ui';
import { tokens } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface GrievanceContact {
  officerName: string;
  designation?: string;
  email: string;
  phone?: string;
  address: string;
  hours?: string;
}

/**
 * THE GRIEVANCE OFFICER, AND WHAT IS LEGALLY MISSING WITHOUT ONE.
 *
 * The Consumer Protection (E-Commerce) Rules require a marketplace to publish
 * a named person, a working email and a postal address that complaints
 * escalate to. The server already knows whether that has been done -
 * `policyGaps()` returns the list of what is missing, and every payment policy
 * prints a paragraph saying the escalation route is unpublished rather than
 * inventing a name.
 *
 * All of which had no screen. The check existed, the route existed, and the
 * only way to discover the platform was non-compliant was to read the source.
 * That is the same defect as the payout requests nobody could see: a fact the
 * system knows, kept from the one person who can act on it.
 *
 * Kept deliberately blunt. This is the one place in the admin app that says
 * "you are not allowed to operate like this yet", and softening it into a
 * neutral empty state would defeat the point.
 */
export const GrievanceCard: React.FC = () => {
  const { api, can } = useSession();
  const canView = can('finance.config.edit', 'finance.ledger.view');
  const canEdit = can('finance.config.edit');

  const policy = useResource<{ contact: GrievanceContact | null; gaps: string[] }>(
    () => api.get('/admin/policies/grievance'),
    [],
    { enabled: canView }
  );

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GrievanceContact>({
    officerName: '',
    designation: '',
    email: '',
    phone: '',
    address: '',
    hours: ''
  });

  if (!canView) return null;

  const contact = policy.data?.contact || null;
  const gaps = policy.data?.gaps || [];

  const open = () => {
    // Pre-filled from what is published, so correcting one field does not mean
    // retyping an address. An empty form would also let a partial save wipe
    // details that were already compliant.
    setForm({
      officerName: contact?.officerName || '',
      designation: contact?.designation || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      address: contact?.address || '',
      hours: contact?.hours || ''
    });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put('/admin/policies/grievance', {
        officerName: form.officerName.trim(),
        designation: form.designation?.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone?.trim() || undefined,
        address: form.address.trim(),
        hours: form.hours?.trim() || undefined
      });
      setEditing(false);
      await policy.reload();
    } catch (err: any) {
      // The server's own words. It validates the email and insists on a
      // postal address of real length, and those refusals are more precise
      // than anything this screen could invent.
      setError(err?.message || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionTitle title="Legal" subtitle="What the law requires you to publish" />

      {/*
        `gaps` is [] when the request fails, which renders as "nothing missing" —
        the most dangerous possible reading of a failed compliance check.
      */}
      <ResourceError resource={policy} what="What the law requires" />

      {gaps.length > 0 ? (
        <Card style={s.gapCard}>
          <View style={s.gapHead}>
            <Scale size={16} color={c.state.danger} />
            <Text style={s.gapTitle}>Not ready for customers yet</Text>
          </View>
          {gaps.map(gap => (
            <Text key={gap} style={s.gapText}>
              {'•'} {gap}
            </Text>
          ))}
          {canEdit ? (
            <Button label="Publish a grievance officer" onPress={open} style={{ marginTop: 12 }} />
          ) : (
            <Text style={s.gapNote}>Ask someone with finance settings access to publish it.</Text>
          )}
        </Card>
      ) : (
        <Card>
          <View style={s.gapHead}>
            <Scale size={16} color={c.state.success} />
            <Text style={s.okTitle}>Grievance officer published</Text>
          </View>
          <Text style={s.contactLine}>
            {contact?.officerName}
            {contact?.designation ? ` — ${contact.designation}` : ''}
          </Text>
          <Text style={s.contactMeta}>{contact?.email}</Text>
          {!!contact?.phone && <Text style={s.contactMeta}>{contact.phone}</Text>}
          <Text style={s.contactMeta}>{contact?.address}</Text>
          {!!contact?.hours && <Text style={s.contactMeta}>{contact.hours}</Text>}
          {canEdit && (
            <Button
              label="Change these details"
              variant="secondary"
              onPress={open}
              style={{ marginTop: 12 }}
            />
          )}
        </Card>
      )}

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Grievance officer">
        <Text style={s.sheetIntro}>
          A real person, a working email and a postal address. This is printed in the payment
          policies customers and partners read, so anything written here is a public commitment.
        </Text>

        <Field label="Name" value={form.officerName} onChangeText={v => setForm(f => ({ ...f, officerName: v }))} />
        <Field
          label="Designation"
          value={form.designation || ''}
          onChangeText={v => setForm(f => ({ ...f, designation: v }))}
          hint="Optional. For example: Grievance Officer."
        />
        <Field
          label="Email"
          value={form.email}
          onChangeText={v => setForm(f => ({ ...f, email: v }))}
          keyboardType="email-address"
          autoCapitalize="none"
          hint="Must be monitored. A complaint arriving here starts a legal clock."
        />
        <Field
          label="Phone"
          value={form.phone || ''}
          onChangeText={v => setForm(f => ({ ...f, phone: v }))}
          keyboardType="phone-pad"
          hint="Optional."
        />
        <Field
          label="Postal address"
          value={form.address}
          onChangeText={v => setForm(f => ({ ...f, address: v }))}
          multiline
          hint="Required by the e-commerce rules, not optional."
        />
        <Field
          label="Hours"
          value={form.hours || ''}
          onChangeText={v => setForm(f => ({ ...f, hours: v }))}
          hint="Optional. For example: Monday to Friday, 10am to 6pm."
        />

        {!!error && <Text style={s.error}>{error}</Text>}

        <Button label="Publish" onPress={save} loading={saving} style={{ marginTop: 8 }} />
      </Sheet>
    </>
  );
};

const s = StyleSheet.create({
  gapCard: { borderWidth: 1, borderColor: c.state.danger, backgroundColor: c.state.dangerBg },
  gapHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  gapTitle: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.state.danger },
  okTitle: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.state.success },
  gapText: { fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 19, marginBottom: 4 },
  gapNote: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 10 },
  contactLine: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.semibold, color: c.text.primary },
  contactMeta: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 2 },
  sheetIntro: { fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 19, marginBottom: 14 },
  error: { fontSize: tokens.font.size.sm, color: c.state.danger, marginTop: 10 }
});
