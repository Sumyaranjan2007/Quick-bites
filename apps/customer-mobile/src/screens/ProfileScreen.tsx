import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Modal,
  Image,
  ActivityIndicator
} from 'react-native';
import {
  ArrowLeft,
  User,
  MapPin,
  Receipt,
  LifeBuoy,
  Globe,
  Bell,
  Wallet,
  ChevronRight,
  Lock,
  LogOut,
  Check,
  X,
  Sparkles,
  Crown,
  Camera
} from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';
import { chooseProfilePhoto } from '../lib/photo';
import { useTranslation, LANGUAGES, Language } from '../lib/i18n';

const c = tokens.colors;

interface Props {
  onBack: () => void;
  onOpenOrders: () => void;
  onOpenSupport: () => void;
  onOpenWallet: () => void;
  onOpenMembership: () => void;
  onOpenAddresses: () => void;
  apiUrl?: string;
  token?: string;
  user?: any;
  onUserUpdated?: (user: any) => void;
  onLogout?: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: (enabled: boolean) => void;
}

/**
 * The customer's own area.
 *
 * Organised by what the person is trying to do - their activity, their account,
 * their preferences, then help - rather than as one flat list of switches. There
 * is deliberately no delete-account control: deletion is handled through customer
 * care, which keeps a route to deletion available without putting an irreversible
 * action one tap from a wallet balance.
 */
export const ProfileScreen: React.FC<Props> = ({
  onBack,
  onOpenOrders,
  onOpenSupport,
  onOpenWallet,
  onOpenMembership,
  onOpenAddresses,
  apiUrl,
  token,
  user,
  onUserUpdated,
  onLogout,
  notificationsEnabled,
  onToggleNotifications
}) => {
  const { t, language, setLanguage } = useTranslation();

  const [addresses, setAddresses] = useState<any[] | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);

  // The profile showed initials and offered no way to change them. A photo is
  // held on the account as a data URI and sent through the customer router.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const changeAvatar = async () => {
    if (!apiUrl || !token) return;
    const dataUri = await chooseProfilePhoto();
    if (!dataUri) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const res = await apiFetch(`${apiUrl}/customers/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatarUrl: dataUri })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(
          data?.error?.details?.[0]?.message || data?.error?.message || 'That photo could not be saved.'
        );
      }
      onUserUpdated?.({ ...(user || {}), avatarUrl: data.data?.avatarUrl || dataUri });
    } catch (err: any) {
      setAvatarError(err?.message || 'That photo could not be saved.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  // Changing a password without losing the session: the current password is
  // required, so an unlocked phone left on a table cannot lock its owner out.
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  const changePassword = async () => {
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Your new password needs at least 8 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await apiFetch(`${apiUrl}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setPasswordError(parseApiError(data, 'Your password could not be changed.').message);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setPasswordDone(true);
      setPasswordOpen(false);
      setTimeout(() => setPasswordDone(false), 4000);
    } catch {
      setPasswordError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setPasswordBusy(false);
    }
  };

  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.fullName, user?.phone]);

  useEffect(() => {
    if (!apiUrl || !token) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch(`${apiUrl}/addresses`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!cancelled && data.success) setAddresses(data.data?.addresses ?? []);
      } catch {
        if (!cancelled) setAddresses([]);
      }

      try {
        const res = await apiFetch(`${apiUrl}/wallets/me`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        const balance = data?.data?.wallet?.balance ?? data?.data?.balance;
        if (!cancelled && typeof balance === 'number') setWallet(balance);
      } catch {
        /* The wallet row simply omits the balance if it cannot be read. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiUrl, token]);

  const saveProfile = async () => {
    if (!apiUrl || !token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`${apiUrl}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() || undefined })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSaveError(parseApiError(data, 'Your profile could not be saved.').message);
        return;
      }
      onUserUpdated?.(data.data.user);
      setEditOpen(false);
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2200);
    } catch {
      setSaveError('Could not reach Quick Bites. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  /** Language is stored on the account too, so it follows the user to a new phone. */
  const chooseLanguage = async (next: Language) => {
    setLanguage(next);
    setLangOpen(false);
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preferredLanguage: next })
      });
      const data = await res.json();
      if (data.success) onUserUpdated?.(data.data.user);
    } catch {
      /* The interface has already switched; the server copy catches up later. */
    }
  };

  const defaultAddress = addresses?.find(a => a.isDefault) ?? addresses?.[0];
  const initials = (user?.fullName ?? 'Q B')
    .split(' ')
    .map((p: string) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const activeLanguage = LANGUAGES.find(l => l.code === language);

  const Row = ({
    icon,
    title,
    sub,
    onPress,
    right,
    last
  }: {
    icon: React.ReactNode;
    title: string;
    sub?: string;
    onPress?: () => void;
    right?: React.ReactNode;
    last?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowDivider]}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
      disabled={!onPress}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!sub && (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {right ?? (onPress ? <ChevronRight size={17} color={c.text.muted} /> : null)}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <ArrowLeft size={18} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.title')}</Text>
      </View>

      {/* Identity */}
      <Card style={styles.identity}>
        <TouchableOpacity
          style={styles.avatar}
          onPress={changeAvatar}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Change your profile photo"
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
          <View style={styles.avatarBadge}>
            {avatarBusy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Camera size={11} color="#FFFFFF" />
            )}
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.fullName || 'Quick Bites customer'}
            </Text>
            {user?.isGold && (
              <View style={styles.goldChip}>
                <Sparkles size={11} color={c.dietary.gold} />
                <Text style={styles.goldChipText}>GOLD</Text>
              </View>
            )}
          </View>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email}
          </Text>
          {!!user?.phone && <Text style={styles.email}>{user.phone}</Text>}
        </View>
        <TouchableOpacity style={styles.editBtn} onPress={() => setEditOpen(true)} activeOpacity={0.85}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </Card>

      {savedNote && (
        <View style={styles.savedBanner}>
          <Check size={14} color={c.dietary.veg} />
          <Text style={styles.savedText}>{t('common.saved')}</Text>
        </View>
      )}

      {/* Activity */}
      <Text style={styles.sectionLabel}>{t('profile.activity')}</Text>
      <Card style={styles.group}>
        <Row
          icon={<Receipt size={18} color={c.primary[500]} />}
          title={t('profile.orders')}
          sub={t('profile.ordersSub')}
          onPress={onOpenOrders}
        />
        <Row
          icon={<Wallet size={18} color={c.dietary.gold} />}
          title={t('profile.wallet')}
          sub={wallet !== null ? `₹${wallet.toFixed(2)} available` : 'Balance and refunds'}
          onPress={onOpenWallet}
        />
        <Row
          icon={<Crown size={18} color={c.dietary.gold} />}
          title="Quick Bites Gold"
          sub="Free delivery, a discount on every order, priority support"
          onPress={onOpenMembership}
          last
        />
      </Card>

      {/* Account */}
      <Text style={styles.sectionLabel}>{t('profile.account')}</Text>
      <Card style={styles.group}>
        <Row
          icon={<User size={18} color={c.primary[500]} />}
          title={t('profile.editProfile')}
          sub={t('profile.editProfileSub')}
          onPress={() => setEditOpen(true)}
        />
        <Row
          icon={<MapPin size={18} color={c.semantic.error} />}
          title={t('profile.addresses')}
          sub={
            defaultAddress
              ? [defaultAddress.addressLine, defaultAddress.pincode].filter(Boolean).join(', ')
              : addresses === null
                ? 'Loading…'
                : 'No saved addresses yet'
          }
          onPress={onOpenAddresses}
          last
        />
      </Card>

      {/* Preferences */}
      <Text style={styles.sectionLabel}>{t('profile.preferences')}</Text>
      <Card style={styles.group}>
        <Row
          icon={<Globe size={18} color={c.primary[500]} />}
          title={t('profile.language')}
          sub={activeLanguage ? `${activeLanguage.native} · ${activeLanguage.label}` : 'English'}
          onPress={() => setLangOpen(true)}
        />
        <Row
          icon={<Bell size={18} color={c.accent[600]} />}
          title={t('profile.notifications')}
          sub={t('profile.notificationsSub')}
          right={
            <Switch
              value={notificationsEnabled}
              onValueChange={onToggleNotifications}
              trackColor={{ false: c.border.strong, true: c.primary[300] }}
              thumbColor={notificationsEnabled ? c.primary[500] : '#FFFFFF'}
            />
          }
          last
        />
      </Card>

      {/* Security */}
      <Text style={styles.sectionLabel}>Security</Text>
      <Card style={styles.group}>
        <Row
          icon={<Lock size={18} color={c.primary[500]} />}
          title="Change password"
          sub={passwordDone ? 'Your password was changed' : 'Update the password you sign in with'}
          onPress={() => {
            setPasswordError(null);
            setPasswordOpen(true);
          }}
          last
        />
      </Card>

      {/* Help */}
      <Text style={styles.sectionLabel}>{t('profile.support')}</Text>
      <Card style={styles.group}>
        <Row
          icon={<LifeBuoy size={18} color={c.dietary.veg} />}
          title={t('profile.support')}
          sub={t('profile.supportSub')}
          onPress={onOpenSupport}
          last
        />
      </Card>

      {onLogout && (
        <TouchableOpacity style={styles.logout} onPress={onLogout} activeOpacity={0.85}>
          <LogOut size={17} color={c.semantic.error} />
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.version}>Quick Bites · Harohalli, Kanakapura Road</Text>

      {/* Edit profile */}
      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('profile.editProfile')}</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.closeBtn} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your name"
              placeholderTextColor={c.text.muted}
            />

            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="10-digit mobile"
              placeholderTextColor={c.text.muted}
              keyboardType="phone-pad"
            />

            <Text style={styles.helper}>
              Your email is your login, so it cannot be changed here. Customer care can move an account to a new address.
            </Text>

            {!!saveError && <Text style={styles.error}>{saveError}</Text>}

            <TouchableOpacity
              style={[styles.primaryBtn, (saving || !fullName.trim()) && { opacity: 0.5 }]}
              onPress={saveProfile}
              disabled={saving || !fullName.trim()}
              activeOpacity={0.88}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Change password */}
      <Modal visible={passwordOpen} animationType="slide" transparent onRequestClose={() => setPasswordOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Change password</Text>
              <TouchableOpacity onPress={() => setPasswordOpen(false)} style={styles.closeBtn} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Current password</Text>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              placeholder="Your password now"
              placeholderTextColor={c.text.muted}
            />

            <Text style={styles.label}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={c.text.muted}
            />

            <Text style={styles.helper}>
              You stay signed in on this phone. Use the new password the next time you sign in anywhere else.
            </Text>

            {!!passwordError && <Text style={styles.error}>{passwordError}</Text>}

            <TouchableOpacity
              style={[styles.primaryBtn, passwordBusy && { opacity: 0.5 }]}
              onPress={changePassword}
              disabled={passwordBusy}
              activeOpacity={0.88}
            >
              {passwordBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Change password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Language */}
      <Modal visible={langOpen} animationType="slide" transparent onRequestClose={() => setLangOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('profile.language')}</Text>
              <TouchableOpacity onPress={() => setLangOpen(false)} style={styles.closeBtn} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            {LANGUAGES.map(l => (
              <TouchableOpacity
                key={l.code}
                style={[styles.langRow, language === l.code && styles.langRowActive]}
                onPress={() => chooseLanguage(l.code)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.langNative}>{l.native}</Text>
                  <Text style={styles.langLabel}>{l.label}</Text>
                </View>
                {language === l.code && <Check size={19} color={c.primary[500]} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  title: { fontSize: 20, fontWeight: '800', color: c.text.primary },

  identity: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.primary[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 999 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.primary[500],
    borderWidth: 2,
    borderColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarErrorText: { color: c.semantic.error, fontSize: 11, marginTop: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { fontSize: 17, fontWeight: '800', color: c.text.primary, flexShrink: 1 },
  goldChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: c.dietary.goldBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999
  },
  goldChipText: { fontSize: 9.5, fontWeight: '900', color: c.dietary.gold, letterSpacing: 0.4 },
  email: { fontSize: 12.5, color: c.text.muted, marginTop: 2 },
  editBtn: {
    borderWidth: 1,
    borderColor: c.primary[500],
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  editBtnText: { color: c.primary[500], fontSize: 13, fontWeight: '800' },

  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: c.dietary.vegBg,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 14
  },
  savedText: { color: c.dietary.veg, fontWeight: '700', fontSize: 13 },

  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4
  },
  group: { marginBottom: 16, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: c.text.primary },
  rowSub: { fontSize: 12, color: c.text.muted, marginTop: 2 },

  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 13,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: c.semantic.error,
    backgroundColor: c.surface.card,
    marginTop: 4
  },
  logoutText: { color: c.semantic.error, fontSize: 14.5, fontWeight: '800' },
  version: { textAlign: 'center', color: c.text.muted, fontSize: 11.5, marginTop: 18 },

  backdrop: { flex: 1, backgroundColor: 'rgba(26,16,20,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.app,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: c.text.primary },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken
  },
  label: { fontSize: 12.5, fontWeight: '700', color: c.text.secondary, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: c.surface.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.medium,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text.primary
  },
  helper: { fontSize: 11.5, color: c.text.muted, marginTop: 10, lineHeight: 16 },
  error: { color: c.semantic.error, fontSize: 12.5, fontWeight: '600', marginTop: 10 },
  primaryBtn: {
    backgroundColor: c.primary[500],
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.card,
    marginBottom: 10
  },
  langRowActive: { borderColor: c.primary[500], backgroundColor: c.primary[50] },
  langNative: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  langLabel: { fontSize: 12, color: c.text.muted, marginTop: 2 }
});
