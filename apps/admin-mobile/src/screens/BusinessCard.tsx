import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Card, Button, Field, Sheet, KeyValue, SectionTitle, ResourceError } from '../components/ui';
import { tokens } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/** The fields the owner types on the phone. The rest stay as they are. */
const FIELDS: Array<{ key: string; label: string; placeholder?: string; hint?: string }> = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'tradingName', label: 'Trading name', placeholder: 'Quick Bites' },
  {
    key: 'gstin',
    label: 'GSTIN',
    placeholder: '29ABCDE1234F1Z5',
    hint: 'Leave empty until registered. While it is empty, no GST is charged on our own fees.'
  },
  { key: 'udyamNumber', label: 'Udyam number', placeholder: 'UDYAM-KR-29-0052148' },
  { key: 'contactPhone', label: 'Business phone' },
  { key: 'contactEmail', label: 'Business email' },
  { key: 'addressLine', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'PIN code' }
];

/**
 * The platform's own registration: GSTIN, Udyam, legal name and address (A31).
 *
 * Printed on every receipt, and the GSTIN is what switches GST on for the
 * platform's own fees. The server allows only a super administrator to read or
 * change it, so the card is shown to nobody else.
 */
export const BusinessCard: React.FC = () => {
  const { api, isSuperAdmin } = useSession();
  const record = useResource<any>(() => api.get<any>('/admin/platform/business'), [], { enabled: isSuperAdmin });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSuperAdmin) return null;
  const identity = record.data?.identity || {};

  const open = () => {
    const next: Record<string, string> = {};
    for (const f of FIELDS) next[f.key] = identity[f.key] ? String(identity[f.key]) : '';
    setForm(next);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only what changed is sent, and an empty field is left alone, except
      // the GSTIN, where empty is a real answer ("not registered").
      const body: Record<string, string> = {};
      for (const f of FIELDS) {
        const value = (form[f.key] || '').trim();
        const was = identity[f.key] ? String(identity[f.key]) : '';
        if (value === was) continue;
        if (value === '' && f.key !== 'gstin') continue;
        body[f.key] = value;
      }
      if (Object.keys(body).length) await api.put('/admin/platform/business', body);
      setEditing(false);
      await record.reload();
    } catch (err: any) {
      // The server's words: it checks the GSTIN, Udyam, PIN and phone shapes.
      setError(err?.message || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionTitle title="Business registration" subtitle="Printed on every receipt" />
      <ResourceError resource={record} what="The business registration" />
      {record.data ? (
        <Card>
          <KeyValue label="Legal name" value={identity.legalName || '—'} tone="strong" />
          <KeyValue label="GSTIN" value={identity.gstin || 'Not registered: no GST on our fees'} />
          <KeyValue label="Udyam" value={identity.udyamNumber || '—'} />
          <KeyValue label="Phone" value={identity.contactPhone || '—'} />
          <KeyValue label="Email" value={identity.contactEmail || '—'} />
          <KeyValue
            label="Address"
            value={[identity.addressLine, identity.city, identity.state, identity.pincode].filter(Boolean).join(', ') || '—'}
          />
          <Button label="Edit registration" variant="secondary" onPress={open} style={{ marginTop: 12 }} />
        </Card>
      ) : null}

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Business registration">
        {FIELDS.map(f => (
          <Field
            key={f.key}
            label={f.label}
            value={form[f.key] || ''}
            onChangeText={v => setForm(prev => ({ ...prev, [f.key]: v }))}
            placeholder={f.placeholder}
            hint={f.hint}
          />
        ))}
        {!!error && <Text style={s.error}>{error}</Text>}
        <Button label="Save" full loading={saving} onPress={save} />
      </Sheet>
    </>
  );
};

const s = StyleSheet.create({
  error: { color: c.state.danger, fontSize: 13, marginVertical: 8 }
});
