import React, { useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import {
  BadgeCheck,
  Camera,
  ChevronRight,
  CircleCheck,
  FileText,
  IdCard,
  LogOut,
  ScrollText,
  ShieldAlert,
  Star,
  TriangleAlert
} from 'lucide-react-native';
import { t } from '../theme';
import { Avatar, Button, Card, Divider, LoadingBlock, Pill, Row, SectionTitle } from '../components/ui';
import { titleCase } from '../lib/format';
import { choosePhoto } from '../lib/photo';
import type { DashboardResponse } from '../lib/api';

/**
 * Who the rider is, as the platform and the customer see them.
 *
 * The verification checklist sits at the top rather than buried: a rider who
 * cannot go online needs to know why in one glance, and needs the thing that
 * fixes it to be one tap away.
 */
export const ProfileScreen: React.FC<{
  data: DashboardResponse | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSaveProfile: (patch: Record<string, unknown>) => Promise<boolean>;
  onOpenDocuments: () => void;
  onOpenRatings: () => void;
  onOpenPolicies: () => void;
  onOpenSafety: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onLogout: () => void;
}> = ({
  data,
  refreshing,
  onRefresh,
  onSaveProfile,
  onOpenDocuments,
  onOpenRatings,
  onOpenPolicies,
  onOpenSafety,
  onChangePassword,
  onLogout
}) => {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<'BIKE' | 'EV' | 'CYCLE'>('BIKE');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  if (!data) return <LoadingBlock label="Loading your profile…" />;
  const { rider, profile, metrics } = data;

  const beginEdit = () => {
    setFullName(rider.fullName || '');
    setPhone(rider.phone || '');
    setVehicleType(rider.vehicleType || 'BIKE');
    setEditing(true);
  };

  const save = async () => {
    if (fullName.trim().length < 3) {
      Alert.alert('Name required', 'Enter your full name exactly as it appears on your licence.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      Alert.alert('Phone required', 'Enter a phone number the customer and operations can reach you on.');
      return;
    }
    setSaving(true);
    const ok = await onSaveProfile({ fullName: fullName.trim(), phone: phone.trim(), vehicleType });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const changePhoto = async () => {
    const dataUri = await choosePhoto('Profile photo', 'profile');
    if (!dataUri) return;
    setUploading(true);
    await onSaveProfile({ profilePhotoUrl: dataUri });
    setUploading(false);
  };

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color.go} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Identity */}
      <Card tone="raised" style={s.identityCard}>
        <TouchableOpacity onPress={changePhoto} activeOpacity={0.85} style={s.avatarWrap}>
          <Avatar uri={rider.profilePhotoUrl} name={rider.fullName} size={88} ring />
          <View style={s.avatarBadge}>
            <Camera size={14} color="#04231A" />
          </View>
        </TouchableOpacity>

        <Text style={s.name}>{rider.fullName || 'Add your name'}</Text>
        <View style={s.idRow}>
          <IdCard size={14} color={t.color.textMuted} />
          <Text style={s.driverCode}>{rider.driverCode || 'Partner ID pending'}</Text>
        </View>

        <View style={s.badgeRow}>
          <Pill
            label={rider.kycStatus === 'ACTIVE' ? 'Verified partner' : titleCase(rider.kycStatus)}
            tone={rider.kycStatus === 'ACTIVE' ? 'go' : 'money'}
            icon={
              rider.kycStatus === 'ACTIVE' ? (
                <BadgeCheck size={12} color={t.color.goText} />
              ) : (
                <TriangleAlert size={12} color={t.color.money} />
              )
            }
          />
          <Pill label={rider.vehicleType} style={{ marginLeft: t.space[2] }} />
          {metrics.averageRating ? (
            <Pill
              label={metrics.averageRating.toFixed(1)}
              tone="money"
              icon={<Star size={11} color={t.color.money} fill={t.color.money} />}
              style={{ marginLeft: t.space[2] }}
            />
          ) : null}
        </View>

        {uploading ? <Text style={s.uploadingNote}>Uploading photo…</Text> : null}
      </Card>

      {/* Verification checklist */}
      <SectionTitle style={{ marginTop: t.space[6] }}>Account verification</SectionTitle>
      <Card>
        <View style={s.checklistHead}>
          <Text style={[s.checklistStatus, { color: profile.complete ? t.color.goText : t.color.money }]}>
            {profile.complete ? 'Ready to ride' : `${profile.missing.length} item${profile.missing.length === 1 ? '' : 's'} outstanding`}
          </Text>
          <Text style={s.checklistSub}>
            {profile.complete
              ? 'Everything required to accept trips is in place.'
              : 'These are required before you can go online.'}
          </Text>
        </View>
        {profile.requirements.map((requirement, index) => (
          <View key={requirement.key}>
            {index > 0 ? <Divider /> : null}
            <View style={s.checkRow}>
              {requirement.satisfied ? (
                <CircleCheck size={18} color={t.color.goText} />
              ) : (
                <TriangleAlert size={18} color={t.color.money} />
              )}
              <View style={{ flex: 1, marginLeft: t.space[3] }}>
                <Text style={s.checkLabel}>{requirement.label}</Text>
                {requirement.detail ? (
                  <Text style={s.checkDetail} numberOfLines={1}>
                    {requirement.detail}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ))}
        {!profile.complete ? (
          <Button label="Upload documents" onPress={onOpenDocuments} style={{ marginTop: t.space[4] }} />
        ) : null}
      </Card>

      {/* Editable details */}
      <SectionTitle style={{ marginTop: t.space[6] }} action={editing ? undefined : 'Edit'} onAction={beginEdit}>
        Your details
      </SectionTitle>
      <Card>
        {editing ? (
          <>
            <Text style={s.fieldLabel}>Full name</Text>
            <TextInput style={s.input} value={fullName} onChangeText={setFullName} placeholder="As on your licence" placeholderTextColor={t.color.textMuted} />

            <Text style={[s.fieldLabel, { marginTop: t.space[4] }]}>Phone</Text>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+91 90000 00000"
              placeholderTextColor={t.color.textMuted}
            />

            <Text style={[s.fieldLabel, { marginTop: t.space[4] }]}>Vehicle</Text>
            <View style={s.vehicleRow}>
              {(['BIKE', 'EV', 'CYCLE'] as const).map(option => (
                <TouchableOpacity
                  key={option}
                  style={[s.vehicleChip, vehicleType === option && s.vehicleChipActive]}
                  onPress={() => setVehicleType(option)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.vehicleChipText, vehicleType === option && { color: t.color.goText }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.editActions}>
              <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} style={{ flex: 1, marginRight: t.space[3] }} />
              <Button label="Save" loading={saving} onPress={save} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <Row label="Partner ID" value={rider.driverCode} />
            <Divider />
            <Row label="Phone" value={rider.phone} />
            <Divider />
            <Row label="Email" value={rider.email} />
            <Divider />
            <Row label="Vehicle" value={rider.vehicleType} />
            <Divider />
            <Row label="Licence" value={rider.licenseNumber} />
            <Divider />
            <Row label="Registration" value={rider.vehicleRcNumber} />
          </>
        )}
      </Card>

      {/* Links */}
      <SectionTitle style={{ marginTop: t.space[6] }}>More</SectionTitle>
      <Card style={{ paddingVertical: 0 }}>
        <LinkRow icon={<FileText size={18} color={t.color.textSecondary} />} label="Documents & verification" onPress={onOpenDocuments} />
        <Divider />
        <LinkRow icon={<Star size={18} color={t.color.textSecondary} />} label="Ratings & reviews" onPress={onOpenRatings} />
        <Divider />
        <LinkRow icon={<ShieldAlert size={18} color={t.color.danger} />} label="Safety & SOS" onPress={onOpenSafety} />
        <Divider />
        <LinkRow icon={<ScrollText size={18} color={t.color.textSecondary} />} label="App policies" onPress={onOpenPolicies} />
      </Card>

      {/* Account security. A rider changes their password on the same screen
          that holds the rest of their account, rather than having to find it in
          a settings menu that does not exist on this app. */}
      <SectionTitle style={{ marginTop: t.space[6] }}>Password</SectionTitle>
      <Card>
        {passwordOpen ? (
          <>
            <Text style={s.fieldLabel}>Current password</Text>
            <TextInput
              style={s.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              placeholder="Your password now"
              placeholderTextColor={t.color.textMuted}
            />
            <Text style={s.fieldLabel}>New password</Text>
            <TextInput
              style={s.input}
              value={nextPassword}
              onChangeText={setNextPassword}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={t.color.textMuted}
            />
            <View style={s.passwordRow}>
              <Button label="Cancel" variant="secondary" onPress={() => setPasswordOpen(false)} />
              <Button
                label="Change it"
                loading={passwordBusy}
                onPress={async () => {
                  if (!currentPassword || nextPassword.length < 8) {
                    Alert.alert('Check the details', 'Enter your current password and a new one of at least 8 characters.');
                    return;
                  }
                  setPasswordBusy(true);
                  const ok = await onChangePassword(currentPassword, nextPassword);
                  setPasswordBusy(false);
                  if (ok) {
                    setCurrentPassword('');
                    setNextPassword('');
                    setPasswordOpen(false);
                  }
                }}
              />
            </View>
          </>
        ) : (
          <Button label="Change your password" variant="secondary" onPress={() => setPasswordOpen(true)} />
        )}
      </Card>

      <Button
        label="Sign out"
        variant="secondary"
        icon={<LogOut size={16} color={t.color.text} />}
        onPress={() =>
          Alert.alert('Sign out?', 'You will be taken off shift and will stop receiving delivery offers.', [
            { text: 'Stay signed in', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: onLogout }
          ])
        }
        style={{ marginTop: t.space[6] }}
      />

      <Text style={s.version}>Quick Bites Rider · v1.2.0</Text>
    </ScrollView>
  );
};

const LinkRow: React.FC<{ icon: React.ReactNode; label: string; onPress: () => void }> = ({ icon, label, onPress }) => (
  <TouchableOpacity style={s.linkRow} onPress={onPress} activeOpacity={0.7}>
    {icon}
    <Text style={s.linkLabel}>{label}</Text>
    <ChevronRight size={18} color={t.color.textMuted} />
  </TouchableOpacity>
);

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  identityCard: { alignItems: 'center', paddingVertical: t.space[6] },
  avatarWrap: { position: 'relative' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: t.color.go,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: t.color.surfaceRaised
  },
  name: { color: t.color.text, fontSize: t.font.size.lg, fontWeight: t.font.weight.extrabold, marginTop: t.space[4] },
  idRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[2] },
  driverCode: { color: t.color.textMuted, fontSize: t.font.size.sm, marginLeft: 6, letterSpacing: 0.6 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[4], flexWrap: 'wrap', justifyContent: 'center' },
  uploadingNote: { color: t.color.goText, fontSize: t.font.size.xs, marginTop: t.space[3] },
  checklistHead: { marginBottom: t.space[4] },
  checklistStatus: { fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  checklistSub: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: 3, lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space[3] },
  checkLabel: { color: t.color.text, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  checkDetail: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  passwordRow: { flexDirection: 'row', gap: t.space[3], justifyContent: 'flex-end', marginTop: t.space[3] },
  fieldLabel: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, marginBottom: t.space[2] },
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
  vehicleRow: { flexDirection: 'row' },
  vehicleChip: {
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[3],
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color.border,
    marginRight: t.space[2]
  },
  vehicleChipActive: { backgroundColor: t.color.goSoft, borderColor: t.color.go },
  vehicleChipText: { color: t.color.textMuted, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  editActions: { flexDirection: 'row', marginTop: t.space[5] },
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space[4] },
  linkLabel: { flex: 1, color: t.color.text, fontSize: t.font.size.base, marginLeft: t.space[3] },
  version: { color: t.color.textMuted, fontSize: t.font.size.xs, textAlign: 'center', marginTop: t.space[6] }
});
