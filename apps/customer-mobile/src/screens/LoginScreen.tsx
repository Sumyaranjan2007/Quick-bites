import { HeroSlideshow } from '../components/HeroSlideshow';
import { CodeBoxes } from '../components/CodeBoxes';
import { haptic } from '../lib/haptics';
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
  Image,
  useWindowDimensions
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Phone, Mail, Server, ShieldCheck, User, ArrowLeft } from 'lucide-react-native';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';
import { useTranslation } from '../lib/i18n';
import { useHiddenSettings } from '../lib/useHiddenSettings';

const c = tokens.colors;

interface Props {
  initialApiUrl: string;
  onLoginSuccess: (token: string, user: any, apiUrl: string) => void;
  /** iPhone only: back to browsing without signing in. */
  onCancel?: () => void;
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

export const LoginScreen: React.FC<Props> = ({ initialApiUrl, onLoginSuccess, onCancel }) => {
  // Sign-in is the one screen a customer sees before the app knows anything
  // about them, so it renders in whatever language the app is currently set to
  // rather than waiting for an account preference that does not exist yet.
  const { t } = useTranslation();
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [step, setStep] = useState<Step>('phone');

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [codeValue, setCode] = useState('');
  const code = codeValue;
  const [shakeKey, setShakeKey] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const [fullName, setFullName] = useState('');

  const [loading, setLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const { unlocked, registerTap } = useHiddenSettings();
  // Not on an iPhone store build: Apple rejects hidden switches (guideline 2.3.1),
  // and the App Store app must only ever talk to the live server.
  const serverSettingsAllowed = Platform.OS === 'android' || __DEV__;
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
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFieldErrors({ email: 'Enter your email address. We send the code there.' });
      return;
    }
    clearMessages();
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/auth/otp/${isResend ? 'resend' : 'request'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, email: email.trim() })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const configured = data.data?.deliveryConfigured !== false;
        setSmsConfigured(configured);
        setCooldown(data.data?.retryAfterSeconds || 30);
        setStep('code');
        setNotice(
          configured
            // An account that already has an email gets the code there, which may
            // differ from what was typed, so the address is not repeated back.
            ? 'We have sent a code to your email. Check your inbox and spam folder.'
            : 'This test build does not send codes. Enter the verification code you were given.'
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

  const verifyCode = async (typed?: string) => {
    const code = typed ?? codeValue;
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
        haptic.success();
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
        haptic.warning();
        setShakeKey(k => k + 1);
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Real food from our partner kitchens, fading into the form (D2). */}
        <HeroSlideshow
          apiUrl={apiUrl}
          height={Math.round(windowHeight * 0.42)}
          logo={require('../../assets/logo-mark.png')}
          tagline={t('auth.tagline')}
          onTouchEnd={serverSettingsAllowed ? registerTap : undefined}
        />
        {!!onCancel && (
          <TouchableOpacity style={styles.notNow} onPress={onCancel} hitSlop={10} accessibilityRole="button">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>
        )}
        <View style={styles.content}>

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
                  returnKeyType="next"
                />
              </View>
              {!!fieldErrors.phone && <Text style={styles.fieldErrorText}>{fieldErrors.phone}</Text>}

              <Text style={styles.label}>{t('auth.email')}</Text>
              <View style={[styles.field, !!fieldErrors.email && styles.fieldError]}>
                <Mail size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('auth.emailPlaceholder')}
                  placeholderTextColor={c.text.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={() => requestCode()}
                />
              </View>
              {!!fieldErrors.email && <Text style={styles.fieldErrorText}>{fieldErrors.email}</Text>}

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
              <TouchableOpacity hitSlop={10} style={styles.backLink} onPress={backToPhone} activeOpacity={0.7}>
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
              {/* Six boxes; checks itself at the sixth digit; a wrong code shakes them (D2). */}
              <CodeBoxes value={code} onChange={setCode} onComplete={v => void verifyCode(v)} shakeKey={shakeKey} hasError={!!fieldErrors.code} />
              {!!fieldErrors.code && <Text style={styles.fieldErrorText}>{fieldErrors.code}</Text>}

              {!!formError && (
                <View style={styles.formErrorBox}>
                  <Text style={styles.formErrorText}>{formError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={() => void verifyCode()}
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

          {unlocked && (
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
          )}

          {unlocked && showServerConfig && (
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
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  scroll: { flexGrow: 1 },
  content: { padding: 20, marginTop: -24, paddingBottom: 40 },
  notNow: { position: 'absolute', top: 44, right: 20, minHeight: 44, justifyContent: 'center' },
  notNowText: { fontFamily: tokens.font.family, fontSize: 16, fontWeight: '600', color: '#FFFFFF' },

  brand: { alignItems: 'center', marginBottom: 26 },
  /**
   * The mark sits in a frame, the way the partner, rider and operations apps
   * already present theirs.
   *
   * It used to be a bare 128px image. The artwork is not optically centred
   * inside its own bounding box — the swoosh extends to the upper right — so
   * centring the box left the mark looking pushed off to one side, and it was
   * the only one of the four apps without a container to sit in. A fixed frame
   * with the image contained inside it aligns the mark and makes the four
   * sign-in screens look like one product.
   */
  logoFrame: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: c.primary[50],
    alignItems: 'center',
    justifyContent: 'center'
  },
  logo: { width: 68, height: 68 },
  brandName: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size['2xl'],
    fontWeight: tokens.font.weight.extrabold,
    color: c.primary[500],
    marginTop: 10,
    letterSpacing: -0.6
  },
  brandTag: { fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 5 },

  card: { padding: 20 },

  stepTitle: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    marginBottom: 6
  },
  stepBody: { fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 20 },

  backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  backLinkText: { fontFamily: tokens.font.family, fontSize: tokens.font.size.sm, color: c.text.secondary, fontWeight: '700' },

  noticeBox: {
    backgroundColor: c.dietary.vegBg,
    borderRadius: tokens.radii.md,
    padding: 12,
    marginTop: 12
  },
  noticeText: { color: c.dietary.veg, fontFamily: tokens.font.family, fontSize: 13, lineHeight: 18 },
  noticeBoxWarn: { backgroundColor: c.accent[50] },
  noticeTextWarn: { color: c.accent[600] },

  recoveryLink: { alignItems: 'center', paddingVertical: 14 },
  recoveryLinkText: { color: c.primary[500], fontFamily: tokens.font.family, fontSize: 14, fontWeight: '700' },
  recoveryLinkMuted: { color: c.text.muted },

  fieldError: { borderColor: c.semantic.error, backgroundColor: '#FDECEC' },
  fieldErrorText: {
    color: c.semantic.error,
    fontFamily: tokens.font.family, fontSize: 12.5,
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
  formErrorText: { color: c.semantic.error, fontFamily: tokens.font.family, fontSize: 13, fontWeight: '600' },

  label: {
    fontFamily: tokens.font.family, fontSize: tokens.font.size.xs,
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
  dialCode: { fontFamily: tokens.font.family, fontSize: tokens.font.size.base, color: c.text.secondary, fontWeight: '700' },
  input: { flex: 1, fontFamily: tokens.font.family, fontSize: tokens.font.size.base, color: c.text.primary, padding: 0 },
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
  primaryBtnText: { color: '#FFFFFF', fontFamily: tokens.font.family, fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.extrabold },

  serverToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  serverToggleText: { fontFamily: tokens.font.family, fontSize: tokens.font.size.xs, color: c.text.muted, fontWeight: tokens.font.weight.semibold },
  serverBox: { marginTop: 6 }
});
