import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { ChefHat, CheckCircle2 } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Button, Field, PasswordField, ErrorNote } from '../components/ui';
import { login, createAccount } from '../lib/partnerApi';

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
  const [mode, setMode] = useState<'signin' | 'create'>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirm, setConfirm] = useState('');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registered, setRegistered] = useState(false);

  const validateCreate = (): boolean => {
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 2) errs.fullName = 'Enter the name the business is registered under.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (phone.replace(/\D/g, '').length < 10) errs.phone = 'Enter a 10-digit mobile number.';
    if (password.length < 8) errs.password = 'Use at least 8 characters.';
    if (confirm !== password) errs.confirm = 'Both passwords must match.';
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

  const doCreate = async () => {
    setFormError(null);
    if (!validateCreate()) return;

    setBusy(true);
    const res = await createAccount({ fullName, email, phone, password });
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
            Your login is ready. Before you can take orders, our team needs to verify your restaurant —
            send us your FSSAI licence and PAN, and we will activate partner access, usually within one
            working day.
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
        <View style={styles.header}>
          <View style={styles.logo}>
            <ChefHat size={34} color={c.brand} />
          </View>
          <Text style={styles.title}>Quick Bites Partner</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin' ? 'Sign in to your kitchen' : 'Register your restaurant'}
          </Text>
        </View>

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

        {!!formError && <ErrorNote message={formError} />}

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

        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'create' ? 'At least 8 characters' : 'Your password'}
          hint={mode === 'create' ? 'Use at least 8 characters.' : undefined}
          error={fieldErrors.password}
          textContentType={mode === 'create' ? 'newPassword' : 'password'}
        />

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
          label={mode === 'signin' ? 'Sign in' : 'Create account'}
          onPress={mode === 'signin' ? doSignIn : doCreate}
          busy={busy}
          style={{ marginTop: spacing.sm }}
        />

        {mode === 'create' && (
          <Text style={styles.legal}>
            Creating an account does not yet let you take orders. We verify every kitchen's licence before it
            goes live.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
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
  title: { fontSize: 24, fontWeight: '800', color: c.text },
  subtitle: { fontSize: 14, color: c.textMuted, marginTop: 4 },
  switcher: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: radii.md,
    padding: 4,
    marginBottom: spacing.xl
  },
  switchTab: { flex: 1, paddingVertical: 11, borderRadius: radii.sm, alignItems: 'center' },
  switchTabActive: { backgroundColor: c.border },
  switchText: { fontSize: 14, color: c.textMuted, fontWeight: '700' },
  switchTextActive: { color: c.brand },
  legal: { fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
  doneCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl
  },
  doneTitle: { fontSize: 22, fontWeight: '800', color: c.text, marginTop: spacing.lg },
  doneBody: {
    fontSize: 14,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 21
  }
});
