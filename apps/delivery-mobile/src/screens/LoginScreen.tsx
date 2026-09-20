import React, { useState } from 'react';
import { SafeScreen } from '../components/SafeScreen';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Bike, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react-native';
import { t } from '../theme';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { useHiddenSettings } from '../lib/useHiddenSettings';
import { useBlockHardwareBack } from '../lib/useHardwareBack';

/**
 * Signing in.
 *
 * The server address is tucked behind a disclosure rather than sitting in the
 * middle of the form: it matters to whoever is testing a build against a local
 * API, and to nobody else. A rider should see two fields and a button.
 */
export const LoginScreen: React.FC<{
  apiUrl: string;
  onApiUrlChange: (value: string) => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  busy: boolean;
  error?: string | null;
}> = ({ apiUrl, onApiUrlChange, onSubmit, busy, error }) => {
  const [email, setEmail] = useState(__DEV__ ? 'rider@quickbite.app' : '');
  const [password, setPassword] = useState(__DEV__ ? 'pass123' : '');
  const [showServer, setShowServer] = useState(false);
  const { unlocked, registerTap } = useHiddenSettings();

  // Password recovery. A rider locked out mid-shift has no desk to walk to, so
  // the whole flow happens on this screen rather than pointing them at support.
  const [mode, setMode] = useState<'signin' | 'forgot' | 'register' | 'registered'>('signin');

  /**
   * Back is refused while a request is in flight. Rider registration creates an
   * account and uploads documents; backing out mid-request leaves the rider
   * unsure whether they are registered, and the retry fails on a duplicate.
   */
  useBlockHardwareBack(busy, 'One moment — finishing that off.');

  // Registering. A rider could not get onto the platform at all before this:
  // the only rider account was seeded with a password held in one deployment's
  // environment, which is why this app could not be handed to a tester.
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLicence, setRegLicence] = useState('');
  const [regVehicle, setRegVehicle] = useState<'BIKE' | 'EV' | 'CYCLE'>('BIKE');
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const submitRegistration = async () => {
    setRegError(null);
    if (regName.trim().length < 2) return setRegError('Enter your full name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(regEmail.trim())) return setRegError('Enter a valid email address.');
    if (regPhone.replace(/\D/g, '').length !== 10) return setRegError('Enter your 10-digit mobile number.');
    if (regPassword.length < 8) return setRegError('Choose a password of at least 8 characters.');
    if (regLicence.trim().length < 4) return setRegError('Enter your driving licence number.');

    setRegBusy(true);
    try {
      await api.register(apiUrl, {
        fullName: regName,
        email: regEmail,
        phone: regPhone,
        password: regPassword,
        vehicleType: regVehicle,
        licenseNumber: regLicence
      });
      setEmail(regEmail.trim().toLowerCase());
      setPassword('');
      setMode('registered');
    } catch (err: any) {
      setRegError(err?.message || 'Could not complete your registration.');
    } finally {
      setRegBusy(false);
    }
  };
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <SafeScreen style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={t.color.bg} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brandBlock} onTouchEnd={registerTap}>
            <View style={s.brandIcon}>
              <Bike size={38} color={t.color.go} />
            </View>
            <Text style={s.title}>Quick Bites Rider</Text>
            <Text style={s.subtitle}>
              {mode === 'signin'
                ? 'Sign in to start your shift'
                : 'Locked out of your account'}
            </Text>
          </View>

          <View style={s.card}>
            {mode === 'registered' ? (
              <>
                <Text style={s.label}>Registration received</Text>
                <Text style={s.notice}>
                  Your account is created and waiting for approval. Sign in now to upload your driving
                  licence and photo — an administrator reviews them, and you can start a shift as soon as
                  they are approved.
                </Text>
                <Button
                  label="Sign in"
                  size="lg"
                  onPress={() => setMode('signin')}
                  style={{ marginTop: t.space[5] }}
                />
              </>
            ) : mode === 'register' ? (
              <>
                <Text style={s.label}>Full name</Text>
                <TextInput
                  style={s.input}
                  value={regName}
                  onChangeText={setRegName}
                  placeholder="As printed on your licence"
                  placeholderTextColor={t.color.textMuted}
                />
                <Text style={[s.label, { marginTop: t.space[4] }]}>Email</Text>
                <TextInput
                  style={s.input}
                  value={regEmail}
                  onChangeText={setRegEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="you@example.com"
                  placeholderTextColor={t.color.textMuted}
                />
                <Text style={[s.label, { marginTop: t.space[4] }]}>Mobile number</Text>
                <TextInput
                  style={s.input}
                  value={regPhone}
                  onChangeText={v => setRegPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                  maxLength={10}
                  placeholder="98765 43210"
                  placeholderTextColor={t.color.textMuted}
                />
                <Text style={[s.label, { marginTop: t.space[4] }]}>Password</Text>
                <TextInput
                  style={s.input}
                  value={regPassword}
                  onChangeText={setRegPassword}
                  secureTextEntry
                  placeholder="At least 8 characters"
                  placeholderTextColor={t.color.textMuted}
                />
                <Text style={[s.label, { marginTop: t.space[4] }]}>Driving licence number</Text>
                <TextInput
                  style={s.input}
                  value={regLicence}
                  onChangeText={setRegLicence}
                  autoCapitalize="characters"
                  placeholder="KA0320240001"
                  placeholderTextColor={t.color.textMuted}
                />
                <Text style={[s.label, { marginTop: t.space[4] }]}>Vehicle</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['BIKE', 'EV', 'CYCLE'] as const).map(v => (
                    <TouchableOpacity
                      key={v}
                      onPress={() => setRegVehicle(v)}
                      style={[
                        s.input,
                        {
                          flex: 1,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderColor: regVehicle === v ? t.color.go : undefined
                        }
                      ]}
                    >
                      <Text style={{ color: regVehicle === v ? t.color.go : t.color.textMuted, fontWeight: '700' }}>
                        {v}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {regError ? <Text style={s.error}>{regError}</Text> : null}

                <Button
                  label="Register"
                  size="lg"
                  loading={regBusy}
                  onPress={submitRegistration}
                  style={{ marginTop: t.space[5] }}
                />
                <TouchableOpacity
                  style={s.recoveryLink}
                  onPress={() => setMode('signin')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.recoveryLinkText}>Back to sign in</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
            <Text style={s.label}>Registered email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@quickbites.app"
              placeholderTextColor={t.color.textMuted}
              returnKeyType="next"
            />

            {mode === 'signin' ? (
              <>
                <Text style={[s.label, { marginTop: t.space[4] }]}>Password</Text>
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="••••••••"
                  placeholderTextColor={t.color.textMuted}
                  returnKeyType="go"
                  onSubmitEditing={() => !busy && onSubmit(email, password)}
                />
              </>
            ) : null}

            {mode !== 'signin' ? (
              <Text style={s.notice}>
                Emailed reset codes are gone. Call Quick Bites operations and an administrator
                will set a temporary password for you — the change is recorded against their
                name. Change it from your profile once you are back in.
              </Text>
            ) : null}

            {notice ? <Text style={s.notice}>{notice}</Text> : null}
            {error && mode === 'signin' ? <Text style={s.error}>{error}</Text> : null}
            {recoveryError ? <Text style={s.error}>{recoveryError}</Text> : null}

            <Button
              label={mode === 'signin' ? 'Sign in' : 'Back to sign in'}
              size="lg"
              loading={mode === 'signin' ? busy : false}
              onPress={() => {
                if (mode === 'signin') onSubmit(email, password);
                else setMode('signin');
              }}
              style={{ marginTop: t.space[5] }}
            />

            <TouchableOpacity
              style={s.recoveryLink}
              onPress={() => {
                setRecoveryError(null);
                setNotice(null);
                setMode(mode === 'signin' ? 'forgot' : 'signin');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.recoveryLinkText}>
                {mode === 'signin' ? 'Trouble signing in?' : 'Back to sign in'}
              </Text>
            </TouchableOpacity>

              </>
            )}

            {mode === 'signin' ? (
              <TouchableOpacity
                style={s.recoveryLink}
                onPress={() => {
                  setRegError(null);
                  setMode('register');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.recoveryLinkText}>New rider? Register</Text>
              </TouchableOpacity>
            ) : null}

            {unlocked && (
            <TouchableOpacity
              style={s.serverToggle}
              onPress={() => setShowServer(v => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.serverToggleText}>Server settings</Text>
              {showServer ? (
                <ChevronUp size={14} color={t.color.textMuted} />
              ) : (
                <ChevronDown size={14} color={t.color.textMuted} />
              )}
            </TouchableOpacity>
            )}

            {unlocked && showServer ? (
              <TextInput
                style={[s.input, { marginTop: t.space[2] }]}
                value={apiUrl}
                onChangeText={onApiUrlChange}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://api.quickbites.app/api"
                placeholderTextColor={t.color.textMuted}
              />
            ) : null}
          </View>

          <View style={s.footerNote}>
            <ShieldCheck size={14} color={t.color.textMuted} />
            <Text style={s.footerNoteText}>
              Your location is only shared while you are on shift and carrying an order.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.color.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: t.space[6] },
  brandBlock: { alignItems: 'center', marginBottom: t.space[8] },
  brandIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: t.color.goSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.space[4]
  },
  title: { color: t.color.text, fontSize: t.font.size.xxl, fontWeight: t.font.weight.extrabold },
  subtitle: { color: t.color.textMuted, fontSize: t.font.size.base, marginTop: t.space[2] },
  card: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.xl,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space[5],
    ...t.shadow.card
  },
  label: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, marginBottom: t.space[2] },
  input: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: t.radius.md,
    height: 54,
    paddingHorizontal: t.space[4],
    color: t.color.text,
    fontSize: t.font.size.base,
    borderWidth: 1,
    borderColor: t.color.border
  },
  error: {
    color: t.color.danger,
    fontSize: t.font.size.sm,
    marginTop: t.space[4],
    lineHeight: 19
  },
  notice: {
    color: t.color.goText,
    backgroundColor: t.color.goSoft,
    borderRadius: t.radius.md,
    padding: t.space[3],
    fontSize: t.font.size.sm,
    marginTop: t.space[4],
    lineHeight: 19
  },
  recoveryLink: { alignItems: 'center', paddingVertical: t.space[4] },
  recoveryLinkText: { color: t.color.goText, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold },
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: t.space[5],
    paddingVertical: t.space[2]
  },
  serverToggleText: { color: t.color.textMuted, fontSize: t.font.size.sm, marginRight: 6 },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: t.space[6],
    paddingHorizontal: t.space[4]
  },
  footerNoteText: {
    color: t.color.textMuted,
    fontSize: t.font.size.xs,
    marginLeft: 6,
    flexShrink: 1,
    lineHeight: 16
  }
});
