import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Phone, Server, ShieldCheck, User, ArrowLeft } from 'lucide-react-native';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';
import { useTranslation } from '../lib/i18n';

const c = tokens.colors;

interface Props {
  initialApiUrl: string;
  onLoginSuccess: (token: string, user: any, apiUrl: string) => void;
}

/**
 * Signing in with a phone number and a code.
 *
 * There is no password and no separate sign-up. Verifying a code for a number
 * nobody holds creates the account, so a new customer and a returning one walk
 * the same two screens — which is how every delivery app they already use
 * behaves, and one fewer form to abandon.
 *
 * The name step appears only for a genuinely new account, after the code has
 * been accepted. Asking for it up front would ask returning customers for
 * something the platform already knows.
 */
type Step = 'phone' | 'code' | 'name';

export const LoginScreen: React.FC<Props> = ({ initialApiUrl, onLoginSuccess }) => {
  // Sign-in is the one screen a customer sees before the app knows anything
  // about them, so it renders in whatever language the app is currently set to
  // rather than waiting for an account preference that does not exist yet.
  const { t } = useTranslation();
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [step, setStep] = useState<Step>('phone');

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');

  const [loading, setLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** False when the deployment has no SMS provider, so the screen can say so. */
  const [smsConfigured, setSmsConfigured] = useState(true);
  /** Seconds until the code can be requested again. Drives the resend link. */
  const [cooldown, setCooldown] = useState(0);

  // Held between verifying the code and naming a new account: the account
  // exists at that point, so the session is real and only the name is missing.
  const pendingSession = useRef<{ token: string; user: any } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const clearMessages = () => {
    setFieldErrors({});
    setFormError(null);
  };

  const requestCode = async (isResend = false) => {
    if (phone.length !== 10) {
      setFieldErrors({ phone: 'Enter your 10-digit mobile number.' });
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/auth/otp/${isResend ? 'resend' : 'request'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const configured = data.data?.deliveryConfigured !== false;
        setSmsConfigured(configured);
        setCooldown(data.data?.retryAfterSeconds || 30);
        setStep('code');
        setNotice(
          configured
            ? `We have sent a code to ${phone}.`
            : 'This test build does not send SMS. Enter the verification code you were given.'
        );
      } else {
        const parsed = parseApiError(data, 'Could not send a code. Try again in a moment.');
        setFieldErrors(parsed.fieldErrors);
        setFormError(Object.keys(parsed.fieldErrors).length ? null : parsed.message);
      }
    } catch {
      setFormError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (code.length < 4) {
      setFieldErrors({ code: 'Enter the code we sent you.' });
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      const data = await res.json();

      if (res.ok && data.success && data.data?.token) {
        const { token, user, isNewAccount } = data.data;
        if (isNewAccount) {
          // The account is already created and the session is valid; only the
          // name is missing, so this step can be skipped without losing it.
          pendingSession.current = { token, user };
          setNotice(null);
          setStep('name');
        } else {
          onLoginSuccess(token, user, apiUrl);
        }
      } else {
        const parsed = parseApiError(data, 'That code is not right. Check it and try again.');
        setFieldErrors(parsed.fieldErrors);
        setFormError(Object.keys(parsed.fieldErrors).length ? null : parsed.message);
      }
    } catch {
      setFormError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveName = async (skip = false) => {
    const session = pendingSession.current;
    if (!session) return;

    if (skip) {
      onLoginSuccess(session.token, session.user, apiUrl);
      return;
    }
    if (fullName.trim().length < 2) {
      setFieldErrors({ fullName: 'Tell us what to call you.' });
      return;
    }

    clearMessages();
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ fullName: fullName.trim() })
      });
      const data = await res.json();
      // A name that would not save is not worth blocking a new customer at the
      // door for: they are signed in either way and can change it in Profile.
      onLoginSuccess(session.token, data?.data?.user || session.user, apiUrl);
    } catch {
      onLoginSuccess(session.token, session.user, apiUrl);
    } finally {
      setLoading(false);
    }
  };

  const backToPhone = () => {
    setStep('phone');
    setCode('');
    setNotice(null);
    clearMessages();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <Image source={require('../../assets/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandName}>Quick Bites</Text>
          <Text style={styles.brandTag}>{t('auth.tagline')}</Text>
        </View>

        <Card style={styles.card}>
          {step === 'phone' && (
            <>
              <Text style={styles.stepTitle}>{t('auth.signInTitle')}</Text>
              <Text style={styles.stepBody}>{t('auth.signInBody')}</Text>

              <Text style={styles.label}>{t('auth.mobileNumber')}</Text>
              <View style={[styles.field, !!fieldErrors.phone && styles.fieldError]}>
                <Phone size={17} color={c.text.muted} />
                <Text style={styles.dialCode}>+91</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={v => setPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
                  maxLength={10}
                  placeholder={t('auth.mobilePlaceholder')}
                  placeholderTextColor={c.text.muted}
                  keyboardType="phone-pad"
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={() => requestCode()}
                />
              </View>
              {!!fieldErrors.phone && <Text style={styles.fieldErrorText}>{fieldErrors.phone}</Text>}

              {!!formError && (
                <View style={styles.formErrorBox}>
                  <Text style={styles.formErrorText}>{formError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={() => requestCode()}
                disabled={loading}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('auth.sendCode')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {step === 'code' && (
            <>
              <TouchableOpacity style={styles.backLink} onPress={backToPhone} activeOpacity={0.7}>
                <ArrowLeft size={16} color={c.text.secondary} />
                <Text style={styles.backLinkText}>+91 {phone}</Text>
              </TouchableOpacity>

              <Text style={styles.stepTitle}>{t('auth.enterCode')}</Text>
              {!!notice && (
                <View style={[styles.noticeBox, !smsConfigured && styles.noticeBoxWarn]}>
                  <Text style={[styles.noticeText, !smsConfigured && styles.noticeTextWarn]}>{notice}</Text>
                </View>
              )}

              <Text style={styles.label}>{t('auth.verificationCode')}</Text>
              <View style={[styles.field, !!fieldErrors.code && styles.fieldError]}>
                <ShieldCheck size={17} color={c.text.muted} />
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={v => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  maxLength={6}
                  placeholder="------"
                  placeholderTextColor={c.text.muted}
                  keyboardType="number-pad"
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={verifyCode}
                />
              </View>
              {!!fieldErrors.code && <Text style={styles.fieldErrorText}>{fieldErrors.code}</Text>}

              {!!formError && (
                <View style={styles.formErrorBox}>
                  <Text style={styles.formErrorText}>{formError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={verifyCode}
                disabled={loading}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('auth.verify')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.recoveryLink}
                onPress={() => requestCode(true)}
                disabled={cooldown > 0 || loading}
                activeOpacity={0.7}
              >
                <Text style={[styles.recoveryLinkText, cooldown > 0 && styles.recoveryLinkMuted]}>
                  {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'name' && (
            <>
              <Text style={styles.stepTitle}>{t('auth.welcome')}</Text>
              <Text style={styles.stepBody}>{t('auth.nameBody')}</Text>

              <Text style={styles.label}>{t('auth.yourName')}</Text>
              <View style={[styles.field, !!fieldErrors.fullName && styles.fieldError]}>
                <User size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t('auth.namePlaceholder')}
                  placeholderTextColor={c.text.muted}
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={() => saveName()}
                />
              </View>
              {!!fieldErrors.fullName && <Text style={styles.fieldErrorText}>{fieldErrors.fullName}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={() => saveName()}
                disabled={loading}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('auth.startOrdering')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.recoveryLink} onPress={() => saveName(true)} activeOpacity={0.7}>
                <Text style={styles.recoveryLinkText}>{t('auth.skip')}</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={styles.serverToggle}
            onPress={() => setShowServerConfig(s => !s)}
            activeOpacity={0.7}
          >
            <Server size={13} color={c.text.muted} />
            <Text style={styles.serverToggleText}>
              {showServerConfig ? 'Hide server settings' : 'Server settings'}
            </Text>
          </TouchableOpacity>

          {showServerConfig && (
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

  stepTitle: {
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    marginBottom: 6
  },
  stepBody: { fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 20 },

  backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  backLinkText: { fontSize: tokens.font.size.sm, color: c.text.secondary, fontWeight: '700' },

  noticeBox: {
    backgroundColor: c.dietary.vegBg,
    borderRadius: tokens.radii.md,
    padding: 12,
    marginTop: 12
  },
  noticeText: { color: c.dietary.veg, fontSize: 13, lineHeight: 18 },
  noticeBoxWarn: { backgroundColor: c.accent[50] },
  noticeTextWarn: { color: c.accent[600] },

  recoveryLink: { alignItems: 'center', paddingVertical: 14 },
  recoveryLinkText: { color: c.primary[500], fontSize: 14, fontWeight: '700' },
  recoveryLinkMuted: { color: c.text.muted },

  fieldError: { borderColor: c.semantic.error, backgroundColor: '#FDECEC' },
  fieldErrorText: {
    color: c.semantic.error,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 6
  },
  formErrorBox: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.semantic.error
  },
  formErrorText: { color: c.semantic.error, fontSize: 13, fontWeight: '600' },

  label: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    color: c.text.secondary,
    marginBottom: 6,
    marginTop: 16
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
  dialCode: { fontSize: tokens.font.size.base, color: c.text.secondary, fontWeight: '700' },
  input: { flex: 1, fontSize: tokens.font.size.base, color: c.text.primary, padding: 0 },
  codeInput: { letterSpacing: 8, fontWeight: '800' },

  primaryBtn: {
    height: 52,
    borderRadius: tokens.radii.md,
    backgroundColor: c.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#FFFFFF', fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.extrabold },

  serverToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  serverToggleText: { fontSize: tokens.font.size.xs, color: c.text.muted, fontWeight: tokens.font.weight.semibold },
  serverBox: { marginTop: 6 }
});
