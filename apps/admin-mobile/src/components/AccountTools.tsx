import { FONT_FAMILY } from '../theme/tokens';
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Card, Button, Field, Sheet, Segmented, Divider } from './ui';
import { tokens } from '../theme/tokens';
import { useSession } from '../lib/session';

const c = tokens.colors;

/**
 * Operations builds a kitchen's or rider's account for them (owner item 8,
 * master plan B6). Same fields as their own sign-up; no password: they get an
 * email code to set their own. Documents are then uploaded from their record.
 */
export const CreateAccountSheet: React.FC<{
  kind: 'restaurant' | 'rider' | null;
  onClose: () => void;
  onCreated: () => void;
}> = ({ kind, onClose, onCreated }) => {
  const { api } = useSession();
  const [f, setF] = useState<Record<string, string>>({ vehicleType: 'BIKE' });
  const [busy, setBusy] = useState(false);
  const set = (key: string) => (value: string) => setF(current => ({ ...current, [key]: value }));
  const kitchen = kind === 'restaurant';

  const create = async () => {
    setBusy(true);
    try {
      // Two literal bodies, so the body-contract check can read each one.
      kitchen
        ? await api.post<any>('/admin/accounts/create', {
            kind: 'restaurant',
            fullName: f.fullName,
            email: f.email,
            phone: f.phone,
            restaurantName: f.restaurantName,
            addressLine: f.addressLine,
            city: f.city,
            pincode: f.pincode,
            ...(f.password ? { password: f.password } : {}),
            ...(f.fssai ? { fssaiLicenseNumber: f.fssai } : {})
          })
        : await api.post<any>('/admin/accounts/create', {
            kind: 'rider',
            fullName: f.fullName,
            email: f.email,
            phone: f.phone,
            vehicleType: f.vehicleType,
            licenseNumber: f.licenseNumber,
            ...(f.password ? { password: f.password } : {}),
            ...(f.rc ? { vehicleRegistrationNumber: f.rc } : {})
          });
      // Worded from what was sent (R2-10): the api client returns only `data`, never the server's message.
      const typedPassword = Boolean(f.password);
      setF({ vehicleType: 'BIKE' });
      onCreated();
      onClose();
      Alert.alert(
        'Account created',
        typedPassword
          ? 'They can sign in now with the password you set. Give it to them in person or by phone.'
          : 'They got an email to set their own password.'
      );
    } catch (err: any) {
      Alert.alert('Not created', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(kind)}
      onClose={onClose}
      title={kitchen ? 'Create a restaurant' : 'Create a delivery partner'}
      subtitle="Set their password here, or leave it empty and they get an email code to set their own. Upload and approve their documents afterwards from their record."
    >
      <Card>
        <Field label="Owner's full name" value={f.fullName || ''} onChangeText={set('fullName')} />
        <Field label="Email" value={f.email || ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Mobile number" value={f.phone || ''} onChangeText={v => set('phone')(v.replace(/[^0-9]/g, '').slice(0, 10))} keyboardType="phone-pad" />
        <Field
          label="Password (optional)"
          value={f.password || ''}
          onChangeText={set('password')}
          secureTextEntry
          autoCapitalize="none"
          hint="At least 8 characters. Leave empty and they get an email code to set their own."
        />
        {kitchen ? (
          <>
            <Field label="Restaurant name" value={f.restaurantName || ''} onChangeText={set('restaurantName')} />
            <Field label="Kitchen address" value={f.addressLine || ''} onChangeText={set('addressLine')} multiline />
            <Field label="City" value={f.city || ''} onChangeText={set('city')} />
            <Field label="Pincode" value={f.pincode || ''} onChangeText={v => set('pincode')(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="numeric" />
            <Field label="FSSAI licence number (optional)" value={f.fssai || ''} onChangeText={v => set('fssai')(v.replace(/[^0-9]/g, '').slice(0, 14))} keyboardType="numeric" />
          </>
        ) : (
          <>
            <Text style={s.label}>Vehicle</Text>
            <Segmented
              options={[
                { key: 'BIKE', label: 'Bike' },
                { key: 'EV', label: 'Electric' },
                { key: 'CYCLE', label: 'Cycle' }
              ]}
              value={f.vehicleType}
              onChange={set('vehicleType')}
            />
            <Field label="Driving licence number" value={f.licenseNumber || ''} onChangeText={set('licenseNumber')} />
            <Field label="Vehicle registration (optional)" value={f.rc || ''} onChangeText={set('rc')} />
          </>
        )}
        <Button label="Create account" full loading={busy} onPress={create} />
      </Card>
    </Sheet>
  );
};

/**
 * Remove an account for good (owner Q1): closed, data kept, they may register
 * again. Block (above it) is the one that also stops them coming back.
 */
export const RemoveAccountCard: React.FC<{ userId: string; name: string; onRemoved: () => void }> = ({ userId, name, onRemoved }) => {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const result = await api.post<any>(`/admin/accounts/${userId}/remove`, { confirmName: typed.trim(), reason: reason.trim() });
      onRemoved();
      Alert.alert('Removed', result?.message || `${name}'s account is removed.`);
    } catch (err: any) {
      Alert.alert('Not removed', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.heading}>Remove account</Text>
      <Text style={s.muted}>
        Closes the account for good. Their orders and payouts stay on record, and they can register again from scratch.
        To stop them ever coming back, Block instead.
      </Text>
      {open ? (
        <>
          <Divider />
          <Field label={`Type "${name}" to confirm`} value={typed} onChangeText={setTyped} />
          <Field label="Reason (kept with the account)" value={reason} onChangeText={setReason} multiline />
          <View style={s.row}>
            <Button label="Back" variant="secondary" full onPress={() => setOpen(false)} />
            <Button
              label="Remove"
              variant="danger"
              full
              loading={busy}
              disabled={typed.trim().toLowerCase() !== name.trim().toLowerCase() || reason.trim().length < 3}
              onPress={remove}
            />
          </View>
        </>
      ) : (
        <Button label="Remove this account" variant="danger" full onPress={() => setOpen(true)} />
      )}
    </Card>
  );
};

const s = StyleSheet.create({
  heading: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary, marginBottom: tokens.space[2] },
  label: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.primary, marginBottom: tokens.space[2] },
  muted: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.muted, marginBottom: tokens.space[3] },
  row: { flexDirection: 'row', gap: tokens.space[3] }
});
