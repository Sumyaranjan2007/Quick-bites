import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { UserCog, KeyRound, LogOut, ShieldCheck } from 'lucide-react-native';
import { Card, Button, Field, KeyValue, Divider, Badge, SectionTitle } from '../components/ui';
import { tokens, humanise } from '../theme/tokens';
import { useSession } from '../lib/session';

const c = tokens.colors;

/**
 * The administrator's own account: their details, their password, what their
 * role actually grants them, and the way out.
 *
 * The permission list is shown in full rather than summarised as a role name,
 * because "why can't I see payouts?" is the question this screen exists to
 * answer without anyone having to ask a Super Admin.
 */
export const ProfileScreen: React.FC = () => {
  const { api, user, roleName, permissions, permissionCatalogue, isSuperAdmin, signOut, apiUrl, refreshAccess, replaceToken } =
    useSession();

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.patch('/auth/me', { fullName: fullName.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
      await refreshAccess();
      setEditing(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      Alert.alert('Too short', 'Choose a password of at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('They do not match', 'The new password and the confirmation are different.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<any>('/auth/change-password', { currentPassword, newPassword });
      // Every other token is retired by the change; keep this phone signed in.
      if (result?.token) replaceToken(result.token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChangingPassword(false);
      Alert.alert('Password changed', 'Any other phone signed in to this account has been signed out.');
    } catch (err: any) {
      Alert.alert('Could not change your password', err?.message || 'Your password is unchanged.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need your password to get back in.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await api.post('/auth/logout').catch(() => undefined);
          signOut();
        }
      }
    ]);
  };

  const granted = new Set(permissions);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <View style={s.identity}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(user?.fullName || 'A').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>
              {user?.fullName}
            </Text>
            <Text style={s.email} numberOfLines={1}>
              {user?.email}
            </Text>
            <View style={{ marginTop: 6, flexDirection: 'row' }}>
              <Badge label={roleName} tone={isSuperAdmin ? 'amber' : 'info'} />
            </View>
          </View>
        </View>
      </Card>

      {editing ? (
        <Card>
          <Text style={s.cardHeading}>Edit your profile</Text>
          <Field label="Full name" value={fullName} onChangeText={setFullName} />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint="Your email is the login and cannot be changed here." />
          <View style={s.actionRow}>
            <Button label="Cancel" variant="secondary" full onPress={() => setEditing(false)} />
            <Button label="Save" full loading={busy} onPress={saveProfile} />
          </View>
        </Card>
      ) : null}

      {changingPassword ? (
        <Card>
          <Text style={s.cardHeading}>Change your password</Text>
          <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry hint="At least 8 characters." />
          <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
          <View style={s.actionRow}>
            <Button label="Cancel" variant="secondary" full onPress={() => setChangingPassword(false)} />
            <Button label="Change it" full loading={busy} onPress={changePassword} />
          </View>
        </Card>
      ) : null}

      {!editing && !changingPassword ? (
        <Card>
          <Button
            label="Edit profile"
            variant="secondary"
            icon={<UserCog size={16} color={c.text.primary} />}
            onPress={() => {
              setFullName(user?.fullName || '');
              setEditing(true);
            }}
          />
          <View style={{ height: tokens.space[3] }} />
          <Button
            label="Change password"
            variant="secondary"
            icon={<KeyRound size={16} color={c.text.primary} />}
            onPress={() => setChangingPassword(true)}
          />
          <View style={{ height: tokens.space[3] }} />
          <Button label="Sign out" variant="danger" icon={<LogOut size={16} color={c.state.danger} />} onPress={confirmSignOut} />
        </Card>
      ) : null}

      <SectionTitle title="What your role allows" subtitle="Enforced by the server, not just hidden in this app." />
      <Card>
        <KeyValue label="Role" value={roleName} tone="strong" />
        <KeyValue label="Permissions held" value={isSuperAdmin ? 'All of them' : `${permissions.length}`} />
        {isSuperAdmin ? (
          <>
            <Divider />
            <View style={s.superRow}>
              <ShieldCheck size={18} color={c.brand.amber} />
              <Text style={s.superText}>
                As the platform owner you hold every permission, including creating roles and provisioning other
                administrators.
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      {!isSuperAdmin
        ? permissionCatalogue.map(group => {
            const held = group.permissions.filter(permission => granted.has(permission.id));
            if (held.length === 0) return null;
            return (
              <Card key={group.key}>
                <Text style={s.cardHeading}>{group.label}</Text>
                {held.map(permission => (
                  <View key={permission.id} style={s.permissionRow}>
                    <Text style={s.permissionTick}>✓</Text>
                    <Text style={s.permissionLabel}>{permission.label}</Text>
                  </View>
                ))}
              </Card>
            );
          })
        : null}

      <Card>
        <Text style={s.cardHeading}>Connection</Text>
        <KeyValue label="Server" value={apiUrl} />
        <KeyValue label="Signed in as" value={humanise(user?.role || '')} />
      </Card>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { padding: tokens.space[5], paddingBottom: tokens.space[8] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[4] },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: c.brand.amberSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },
  name: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  email: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 2 },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[3]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  superRow: { flexDirection: 'row', gap: tokens.space[3], alignItems: 'flex-start' },
  superText: { flex: 1, fontSize: tokens.font.size.xs, color: c.text.secondary, lineHeight: 17 },
  permissionRow: { flexDirection: 'row', gap: tokens.space[3], alignItems: 'center', paddingVertical: 5 },
  permissionTick: { color: c.state.success, fontSize: tokens.font.size.sm, fontWeight: '800' },
  permissionLabel: { flex: 1, fontSize: tokens.font.size.sm, color: c.text.primary }
});
