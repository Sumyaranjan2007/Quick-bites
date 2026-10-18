import { FONT_FAMILY } from '../theme';
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, TextInput } from 'react-native';
import { ChefHat, CheckCircle2, ChevronDown, ChevronUp, MapPin } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Button, Field, PasswordField, ErrorNote } from '../components/ui';
import { KitchenLocationPicker } from '../components/KitchenLocationPicker';
import {
  login,
  createAccount,
  PASSWORD_RECOVERY_GUIDANCE,
  forgotPassword,
  resetPassword,
  configureApi,
  currentApiUrl,
} from '../lib/partnerApi';
import { useHiddenSettings } from '../lib/useHiddenSettings';
import { useBlockHardwareBack } from '../lib/useHardwareBack';

interface Props {
  onSignedIn: (token: string, user: any) => void;
}

/**
 * Sign in, or create the owner's login.
 *
 * Registration creates the person's account; it does not grant partner access.
 * The server only ever issues a customer role to self-registration — a partner
 * account is granted once the restaurant's documents are verified — so this
 * screen says that plainly instead of dropping the new owner into an app that
 * would then refuse every request.
 */
export const SignInScreen: React.FC<Props> = ({ onSignedIn }) => {
  const [mode, setMode] = useState<'signin' | 'create' | 'forgot' | 'reset'>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');

  // The restaurant itself, not just the person signing up. Registration creates
  // both: an owner login is worthless without the kitchen it manages, and the
  // approval queue reviews a restaurant, not a person.
  const [restaurantName, setRestaurantName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [fssai, setFssai] = useState('');
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const [busy, setBusy] = useState(false);

  /**
   * Back is refused while a sign-in or a registration is in flight. Registering
   * a restaurant creates an account on the server; backing out mid-request
   * leaves the owner unsure whether it worked, and their second attempt hits a
   * duplicate-email error they cannot explain.
   */
  useBlockHardwareBack(busy, 'One moment — finishing that off.');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registered, setRegistered] = useState(false);

  // Which server this app talks to. The other three apps each expose this; the
  // kitchen app did not, which left it the only one that could not be pointed at
  // a staging or on-device backend for testing without rebuilding the APK.
  const [showServer, setShowServer] = useState(false);
  const { unlocked, registerTap } = useHiddenSettings();
  const [apiUrl, setApiUrl] = useState(currentApiUrl());

  // Password recovery. The code is delivered by the server; on a deployment
  // without a mail provider it comes straight back in the response, and this
  // screen says which happened rather than telling the owner to check an inbox
  // nothing was sent to.
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const validateCreate = (): boolean => {
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 2) errs.fullName = 'Enter the name the business is registered under.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (phone.replace(/\D/g, '').length < 10) errs.phone = 'Enter a 10-digit mobile number.';
    if (password.length < 8) errs.password = 'Use at least 8 characters.';
    if (confirm !== password) errs.confirm = 'Both passwords must match.';
    if (restaurantName.trim().length < 2) errs.restaurantName = 'Enter the name customers will see.';
    if (addressLine.trim().length < 5) errs.addressLine = 'Enter the kitchen address.';
    if (city.trim().length < 2) errs.city = 'Enter the city.';
    if (!/^\d{6}$/.test(pincode.trim())) errs.pincode = 'Enter a 6-digit pincode.';
    // Required by law to sell food in India, and the first thing the approval
    // queue looks for - so it is collected at registration rather than chased.
    if (fssai.trim().length < 6) errs.fssai = 'Enter your FSSAI licence number.';
    // A kitchen with no pin is placed at the centre of Bengaluru by the server,
    // which makes it invisible to its real neighbours and offers it to people
    // thirty kilometres away. Required here rather than chased later.
    if (!pin) errs.pin = 'Place your kitchen on the map so nearby customers can find you.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const doSignIn = async () => {
    setFormError(null);
    setFieldErrors({});
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return;
    }
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);

    if (!res.ok || !res.data?.token) {
      setFormError(res.message || 'Sign-in failed.');
      return;
    }
    onSignedIn(res.data.token, res.data.user);
  };

  const doForgot = async () => {
    setFormError(null);
    if (!email.trim()) {
      setFormError('Enter the email you signed up with.');
      return;
    }
    setBusy(true);
    const res = await forgotPassword(email);
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message || 'Could not send the code.');
      return;
    }
    setNotice('If that email has a partner account, a 6-digit code is on its way. It works for 10 minutes.');
    setMode('reset');
  };

  const doReset = async () => {
    setFormError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setFormError('Enter the 6-digit code from the email.');
      return;
    }
    if (password.length < 8) {
      setFormError('Choose a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    const res = await resetPassword(email, code, password);
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message || 'That code did not work.');
      return;
    }
    setCode('');
    setPassword('');
    setNotice('Password changed. Sign in with the new one.');
    setMode('signin');
  };

  const doCreate = async () => {
    setFormError(null);
    if (!validateCreate()) return;

    setBusy(true);
    const res = await createAccount({
      fullName,
      email,
      phone,
      password,
      restaurantName,
      addressLine,
      city,
      pincode,
      fssaiLicenseNumber: fssai,
      ...(pin ? { latitude: pin.latitude, longitude: pin.longitude } : {})
    });
    setBusy(false);

    if (!res.ok) {
      setFormError(res.message || 'We could not create your account.');
      return;
    }
    setRegistered(true);
  };

  if (registered) {
    return (
      <View style={styles.screen}>
        <View style={styles.doneCard}>
          <CheckCircle2 size={44} color={c.success} />
          <Text style={styles.doneTitle}>Account created</Text>
          <Text style={styles.doneBody}>
            Your restaurant is registered and waiting for approval. Sign in now to upload your FSSAI
            licence and PAN — an administrator reviews them, and your kitchen becomes visible to customers
            the moment they are approved. Until then you will not receive orders.
          </Text>
          <Text style={styles.doneBody}>
            Sign in now to upload those documents and track their progress.
          </Text>
          <Button
            label="Sign in"
            onPress={() => {
              setRegistered(false);
              setMode('signin');
              setPassword('');
            }}
            style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header} onTouchEnd={registerTap}>
          <View style={styles.logo}>
            <ChefHat size={34} color={c.brand} />
          </View>
          <Text style={styles.title}>Quick Bites Partner</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Sign in to your kitchen'
              : mode === 'create'
                ? 'Register your restaurant'
                : 'Locked out of your kitchen'}
          </Text>
        </View>

        {mode !== 'forgot' && mode !== 'reset' && (
        <View style={styles.switcher}>
          <TouchableOpacity
            style={[styles.switchTab, mode === 'signin' && styles.switchTabActive]}
            onPress={() => {
              setMode('signin');
              setFormError(null);
              setFieldErrors({});
            }}
          >
            <Text style={[styles.switchText, mode === 'signin' && styles.switchTextActive]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchTab, mode === 'create' && styles.switchTabActive]}
            onPress={() => {
              setMode('create');
              setFormError(null);
              setFieldErrors({});
            }}
          >
            <Text style={[styles.switchText, mode === 'create' && styles.switchTextActive]}>Create account</Text>
          </TouchableOpacity>
        </View>
        )}

        {!!formError && <ErrorNote message={formError} />}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}

        {mode === 'create' && (
          <>
            <Field
              label="Owner or business name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Bangalore Biryani House"
              error={fieldErrors.fullName}
            />
            <Field
              label="Mobile number"
              value={phone}
              onChangeText={setPhone}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              error={fieldErrors.phone}
            />
            <Field
              label="Restaurant name"
              value={restaurantName}
              onChangeText={setRestaurantName}
              placeholder="Bangalore Biryani House"
              error={fieldErrors.restaurantName}
              hint="This is the name customers will see."
            />
            <Field
              label="Kitchen address"
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="14 Residency Road"
              error={fieldErrors.addressLine}
            />
            <Field
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder="Bengaluru"
              error={fieldErrors.city}
            />
            <Field
              label="Pincode"
              value={pincode}
              onChangeText={v => setPincode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="560025"
              keyboardType="number-pad"
              error={fieldErrors.pincode}
            />
            <Field
              label="FSSAI licence number"
              value={fssai}
              onChangeText={setFssai}
              placeholder="12345678901234"
              error={fieldErrors.fssai}
              hint="Required by law to sell food in India. Operations check this first."
            />

            <TouchableOpacity
              style={[styles.pinButton, pin && styles.pinButtonDone]}
              onPress={() => setMapOpen(true)}
              activeOpacity={0.85}
            >
              <MapPin size={16} color={pin ? c.success : c.brand} />
              <Text style={[styles.pinButtonText, pin && { color: c.success }]}>
                {pin
                  ? `Pinned at ${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)} · tap to adjust`
                  : 'Place your kitchen on the map'}
              </Text>
            </TouchableOpacity>
            {!!fieldErrors.pin && <Text style={styles.pinError}>{fieldErrors.pin}</Text>}
          </>
        )}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@restaurant.com"
          keyboardType="email-address"
          autoCapitalize="none"
          error={fieldErrors.email}
        />

        {mode !== 'forgot' && mode !== 'reset' && (
          <PasswordField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'create' ? 'At least 8 characters' : 'Your password'}
            hint={mode === 'create' ? 'Use at least 8 characters.' : undefined}
            error={fieldErrors.password}
            textContentType={mode === 'create' ? 'newPassword' : 'password'}
          />
        )}

        {mode === 'forgot' && <Text style={styles.subtitle}>{PASSWORD_RECOVERY_GUIDANCE}</Text>}

        {mode === 'reset' && (
          <>
            <Field
              label="Code from the email"
              value={code}
              onChangeText={v => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="6 digits"
              keyboardType="number-pad"
            />
            <PasswordField label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
          </>
        )}

        {mode === 'create' && (
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Type it again"
            error={fieldErrors.confirm}
          />
        )}

        <Button
          label={
            mode === 'signin'
              ? 'Sign in'
              : mode === 'create'
                ? 'Create account'
                : mode === 'forgot'
                  ? 'Email me a code'
                  : 'Set new password'
          }
          onPress={
            mode === 'signin' ? doSignIn : mode === 'create' ? doCreate : mode === 'forgot' ? doForgot : doReset
          }
          busy={busy}
          style={{ marginTop: spacing.sm }}
        />

        {mode === 'signin' && (
          <TouchableOpacity
            onPress={() => {
              setMode('forgot');
              setFormError(null);
              setNotice(null);
              setFieldErrors({});
            }}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Trouble signing in?</Text>
          </TouchableOpacity>
        )}

        {(mode === 'forgot' || mode === 'reset') && (
          <TouchableOpacity
            onPress={() => {
              setMode('signin');
              setFormError(null);
              setFieldErrors({});
            }}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Back to sign in</Text>
          </TouchableOpacity>
        )}

        {mode === 'create' && (
          <Text style={styles.legal}>
            Creating an account does not yet let you take orders. We verify every kitchen's licence before it
            goes live.
          </Text>
        )}

        {unlocked && (
        <TouchableOpacity
          onPress={() => setShowServer(v => !v)}
          style={styles.serverToggle}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.serverToggleText}>Server settings</Text>
          {showServer ? (
            <ChevronUp size={14} color={c.textMuted} />
          ) : (
            <ChevronDown size={14} color={c.textMuted} />
          )}
        </TouchableOpacity>
        )}

        {unlocked && showServer && (
          <TextInput
            style={styles.serverInput}
            value={apiUrl}
            onChangeText={value => {
              setApiUrl(value);
              // Applied as it is typed so the next sign-in uses it; the token is
              // cleared with it, because a token from one server is meaningless
              // to another.
              configureApi(value.trim(), '');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://api.quickbites.app/api"
            placeholderTextColor={c.textMuted}
          />
        )}
      </ScrollView>

      <KitchenLocationPicker
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={point => {
          setPin(point);
          setMapOpen(false);
        }}
        initial={pin}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.brand,
    backgroundColor: c.surface
  },
  pinButtonDone: { borderColor: c.success, backgroundColor: c.successSoft },
  pinButtonText: { flex: 1, fontFamily: FONT_FAMILY, fontSize: 13, fontWeight: '700', color: c.brand },
  pinError: { fontFamily: FONT_FAMILY, fontSize: 12, color: c.danger, marginTop: -spacing.xs },
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: spacing.xxl, paddingTop: 64, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: c.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg
  },
  title: { fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: '800', color: c.text },
  subtitle: { fontFamily: FONT_FAMILY, fontSize: 14, color: c.textMuted, marginTop: 4 },
  switcher: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: radii.md,
    padding: 4,
    marginBottom: spacing.xl
  },
  switchTab: { flex: 1, paddingVertical: 11, borderRadius: radii.sm, alignItems: 'center' },
  switchTabActive: { backgroundColor: c.border },
  switchText: { fontFamily: FONT_FAMILY, fontSize: 14, color: c.textMuted, fontWeight: '700' },
  switchTextActive: { color: c.brand },
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  serverToggleText: {
    color: c.textMuted,
    fontFamily: FONT_FAMILY, fontSize: 13,
  },
  serverInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.text,
    fontFamily: FONT_FAMILY, fontSize: 14,
    marginTop: spacing.xs,
  },
  legal: { fontFamily: FONT_FAMILY, fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
  linkRow: { alignItems: 'center', paddingVertical: spacing.lg },
  link: { color: c.brand, fontFamily: FONT_FAMILY, fontSize: 14, fontWeight: '700' },
  notice: {
    color: c.success,
    backgroundColor: c.successSoft,
    borderRadius: radii.sm,
    padding: spacing.md,
    fontFamily: FONT_FAMILY, fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.lg
  },
  doneCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl
  },
  doneTitle: { fontFamily: FONT_FAMILY, fontSize: 22, fontWeight: '800', color: c.text, marginTop: spacing.lg },
  doneBody: {
    fontFamily: FONT_FAMILY, fontSize: 14,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 21
  }
});
