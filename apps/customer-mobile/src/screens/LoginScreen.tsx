import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Lock, Mail, User, Phone, Server, Sparkles } from 'lucide-react-native';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';

const c = tokens.colors;

interface Props {
  initialApiUrl: string;
  onLoginSuccess: (token: string, user: any, apiUrl: string) => void;
}

export const LoginScreen: React.FC<Props> = ({ initialApiUrl, onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  // Play rejects builds that look like test harnesses, so prefilled demo
  // credentials and the server picker exist only in development.
  const [email, setEmail] = useState(__DEV__ ? 'customer@quickbite.app' : '');
  const [password, setPassword] = useState(__DEV__ ? 'pass123' : '');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  // Field-level problems returned by the server, shown under the field they
  // name. An alert saying "validation failed" tells the user nothing.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Password recovery. Without it, a customer who forgets their password loses
  // their addresses, wallet balance and order history — and the only way back
  // was to create a second account.
  const [recovery, setRecovery] = useState<'off' | 'request' | 'code'>('off');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const requestResetCode = async () => {
    if (!email.trim()) {
      setFieldErrors({ email: 'Enter the email address on your account.' });
      return;
    }
    setLoading(true);
    setFormError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`${apiUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setFormError(parseApiError(data, 'Could not start a password reset.').message);
        return;
      }
      if (data.data?.resetCode) {
        setResetCode(String(data.data.resetCode));
        setNotice(`Your reset code is ${data.data.resetCode}. It expires in ${data.data.expiresInMinutes} minutes.`);
      } else if (data.data?.emailDeliveryConfigured) {
        setNotice('If that address is on an account, a reset code has been sent to it.');
      } else {
        // Saying "check your email" when nothing was sent is what made this
        // flow look broken: the code exists, but this deployment has no mail
        // provider, so it has to be obtained from support.
        setNotice(
          'A reset code has been generated for that address, but this Quick Bites deployment cannot send email yet. Contact support to receive your code.'
        );
      }
      setRecovery('code');
    } catch {
      setFormError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const applyResetCode = async () => {
    if (resetCode.trim().length !== 6 || newPassword.length < 8) {
      setFormError('Enter the six-digit code and a new password of at least 8 characters.');
      return;
    }
    setLoading(true);
    setFormError(null);
    try {
      const res = await apiFetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: resetCode.trim(), newPassword })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setFormError(parseApiError(data, 'That reset code was not accepted.').message);
        return;
      }
      setPassword(newPassword);
      setNewPassword('');
      setResetCode('');
      setRecovery('off');
      setNotice('Your password has been changed. Sign in with it now.');
    } catch {
      setFormError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = 'Enter your email address.';
    if (!password) local.password = 'Enter your password.';
    if (isRegistering) {
      if (!fullName.trim()) local.fullName = 'Enter your full name.';
      // Checked here as well as on the server so the user is told before a
      // round trip, using the same wording the server would use.
      if (password && password.length < 8) local.password = 'Password must be at least 8 characters.';
    }
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setLoading(true);
    try {
      const endpoint = isRegistering ? `${apiUrl}/auth/register` : `${apiUrl}/auth/login`;
      const bodyPayload = isRegistering
        ? { email, password, fullName, phone, role: 'customer' }
        : { email, password, role: 'customer' };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (res.ok && data.success && data.data?.token) {
        onLoginSuccess(data.data.token, data.data.user, apiUrl);
      } else {
        const parsed = parseApiError(
          data,
          isRegistering ? 'Could not create your account.' : 'Email or password is incorrect.'
        );
        setFieldErrors(parsed.fieldErrors);
        setFormError(Object.keys(parsed.fieldErrors).length ? null : parsed.message);
      }
    } catch (err: any) {
      setFormError(`Could not reach Quick Bites. Check your connection and try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = () => {
    setEmail('customer@quickbite.app');
    setPassword('pass123');
    setIsRegistering(false);
    handleSubmit();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={styles.brand}>
          <Image source={require('../../assets/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandName}>Quick Bites</Text>
          <Text style={styles.brandTag}>Your craving, delivered fast.</Text>
        </View>

        <Card style={styles.card}>
          {/* Tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, !isRegistering && styles.tabActive]}
              onPress={() => { setIsRegistering(false); setFieldErrors({}); setFormError(null); }}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, !isRegistering && styles.tabTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, isRegistering && styles.tabActive]}
              onPress={() => { setIsRegistering(true); setFieldErrors({}); setFormError(null); }}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, isRegistering && styles.tabTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {isRegistering && (
            <>
              <Text style={styles.label}>Full Name</Text>
              <View style={[styles.field, !!fieldErrors.fullName && styles.fieldError]}>
                <User size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  placeholderTextColor={c.text.muted}
                />
              </View>
              {!!fieldErrors.fullName && <Text style={styles.fieldErrorText}>{fieldErrors.fullName}</Text>}

              <Text style={styles.label}>Phone</Text>
              <View style={styles.field}>
                <Phone size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  // Ten digits is the whole of an Indian mobile number; the
                  // field used to accept twenty characters of anything, so an
                  // account could be saved with a number nobody could ring.
                  onChangeText={v => setPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
                  maxLength={10}
                  placeholder="10-digit mobile"
                  placeholderTextColor={c.text.muted}
                  keyboardType="phone-pad"
                />
              </View>
              {!!fieldErrors.phone && <Text style={styles.fieldErrorText}>{fieldErrors.phone}</Text>}
            </>
          )}

          <Text style={styles.label}>Email Address</Text>
          <View style={[styles.field, !!fieldErrors.email && styles.fieldError]}>
            <Mail size={17} color={c.text.muted} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={c.text.muted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          {!!fieldErrors.email && <Text style={styles.fieldErrorText}>{fieldErrors.email}</Text>}

          <Text style={styles.label}>Password</Text>
          <View style={[styles.field, !!fieldErrors.password && styles.fieldError]}>
            <Lock size={17} color={c.text.muted} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••"
              placeholderTextColor={c.text.muted}
              secureTextEntry
            />
          </View>
          {!!fieldErrors.password ? (
            <Text style={styles.fieldErrorText}>{fieldErrors.password}</Text>
          ) : isRegistering ? (
            <Text style={styles.fieldHint}>At least 8 characters.</Text>
          ) : null}
          {recovery === 'code' && (
            <>
              <Text style={styles.label}>Six-digit code</Text>
              <View style={styles.field}>
                <Lock size={16} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={resetCode}
                  onChangeText={setResetCode}
                  keyboardType="number-pad"
                  placeholder="123456"
                  placeholderTextColor={c.text.muted}
                />
              </View>
              <Text style={styles.label}>New password</Text>
              <View style={styles.field}>
                <Lock size={16} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  placeholder="At least 8 characters"
                  placeholderTextColor={c.text.muted}
                />
              </View>
            </>
          )}

          {!!notice && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {!!formError && (
            <View style={styles.formErrorBox}>
              <Text style={styles.formErrorText}>{formError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={
              recovery === 'request' ? requestResetCode : recovery === 'code' ? applyResetCode : handleSubmit
            }
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {recovery === 'request'
                  ? 'Send reset code'
                  : recovery === 'code'
                    ? 'Set new password'
                    : isRegistering
                      ? 'Create Account'
                      : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>

          {!isRegistering && (
            <TouchableOpacity
              style={styles.recoveryLink}
              onPress={() => {
                setFormError(null);
                setNotice(null);
                setFieldErrors({});
                setRecovery(recovery === 'off' ? 'request' : recovery === 'code' ? 'request' : 'off');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.recoveryLinkText}>
                {recovery === 'off'
                  ? 'Forgot your password?'
                  : recovery === 'code'
                    ? 'Send another code'
                    : 'Back to sign in'}
              </Text>
            </TouchableOpacity>
          )}

          {__DEV__ && (
            <TouchableOpacity style={styles.demoBtn} onPress={handleQuickDemoLogin} activeOpacity={0.85}>
              <Sparkles size={15} color={c.accent[600]} />
              <Text style={styles.demoBtnText}>One-Tap Demo Login</Text>
            </TouchableOpacity>
          )}

          {__DEV__ && (
            <TouchableOpacity
              style={styles.serverToggle}
              onPress={() => setShowServerConfig(!showServerConfig)}
              activeOpacity={0.7}
            >
              <Server size={13} color={c.text.muted} />
              <Text style={styles.serverToggleText}>
                {showServerConfig ? 'Hide server settings' : 'Server settings'}
              </Text>
            </TouchableOpacity>
          )}

          {__DEV__ && showServerConfig && (
            <View style={styles.serverBox}>
              <Text style={styles.label}>Backend API URL</Text>
              <View style={styles.field}>
                <Server size={16} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={apiUrl}
                  onChangeText={setApiUrl}
                  autoCapitalize="none"
                  placeholderTextColor={c.text.muted}
                />
              </View>
            </View>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  noticeBox: {
    backgroundColor: c.dietary.vegBg,
    borderRadius: tokens.radii.md,
    padding: 12,
    marginTop: 12
  },
  noticeText: { color: c.dietary.veg, fontSize: 13, lineHeight: 18 },
  recoveryLink: { alignItems: 'center', paddingVertical: 14 },
  recoveryLinkText: { color: c.primary[500], fontSize: 14, fontWeight: '700' },
  content: { padding: 20, paddingTop: 56, paddingBottom: 40 },

  brand: { alignItems: 'center', marginBottom: 26 },
  logo: { width: 128, height: 128 },
  brandName: {
    fontSize: tokens.font.size['2xl'],
    fontWeight: tokens.font.weight.extrabold,
    color: c.primary[500],
    marginTop: 10,
    letterSpacing: -0.6
  },
  brandTag: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 5 },

  card: { padding: 20 },

  tabs: {
    flexDirection: 'row',
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.md,
    padding: 4,
    marginBottom: 20
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: tokens.radii.sm, alignItems: 'center' },
  tabActive: { backgroundColor: c.surface.card, ...tokens.shadow.card },
  tabText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold, color: c.text.muted },
  tabTextActive: { color: c.primary[500], fontWeight: tokens.font.weight.extrabold },

  fieldError: {
    borderColor: c.semantic.error,
    backgroundColor: '#FDECEC'
  },
  fieldErrorText: {
    color: c.semantic.error,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: -6,
    marginBottom: 10
  },
  fieldHint: {
    color: c.text.muted,
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10
  },
  formErrorBox: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: c.semantic.error
  },
  formErrorText: {
    color: c.semantic.error,
    fontSize: 13,
    fontWeight: '600'
  },
  label: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    color: c.text.secondary,
    marginBottom: 6,
    marginTop: 12
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderWidth: 1,
    borderColor: c.border.medium,
    backgroundColor: c.surface.subtle,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 13
  },
  input: { flex: 1, fontSize: tokens.font.size.base, color: c.text.primary, padding: 0 },

  primaryBtn: {
    height: 52,
    borderRadius: tokens.radii.md,
    backgroundColor: c.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.extrabold },

  demoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: tokens.radii.md,
    backgroundColor: c.accent[50],
    borderWidth: 1,
    borderColor: c.accent[300],
    marginTop: 12
  },
  demoBtnText: { color: c.accent[600], fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold },

  serverToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  serverToggleText: { fontSize: tokens.font.size.xs, color: c.text.muted, fontWeight: tokens.font.weight.semibold },
  serverBox: { marginTop: 6 }
});