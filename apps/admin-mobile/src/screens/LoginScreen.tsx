import { FONT_FAMILY } from '../theme/tokens';
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { ShieldCheck, Sparkles } from 'lucide-react-native';
import { Screen, Field, Button, Card } from '../components/ui';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import { createClient } from '../lib/api';
import { DEFAULT_API_URL, type SessionState } from '../lib/session';
import { useHiddenSettings } from '../lib/useHiddenSettings';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

const c = tokens.colors;

/**
 * Sign-in, and the two things that go with it: recovering a forgotten password,
 * and pointing the console at a different backend.
 *
 * The server is asked for the account's permissions immediately after the token
 * comes back, because the console's navigation is built from them — signing in
 * without them would briefly show an administrator every section, including the
 * ones they will be refused.
 */
export const LoginScreen: React.FC<{ onSignedIn: (session: SessionState) => void }> = ({ onSignedIn }) => {
  const [mode, setMode] = useState<'signin' | 'forgot' | 'reset'>('signin');
  const [email, setEmail] = useState(__DEV__ ? 'admin@quickbite.app' : '');
  const [password, setPassword] = useState(__DEV__ ? 'pass123' : '');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showServer, setShowServer] = useState(false);
  const { unlocked, registerTap } = useHiddenSettings();

  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, role: 'admin' })
      });
      const payload = await res.json();
      if (!payload?.success || !payload?.data?.token) {
        throw new Error(payload?.error?.message || payload?.error || 'Those credentials were not accepted.');
      }

      const token = payload.data.token as string;
      const client = createClient(apiUrl, token);
      const access = await client.get<any>('/admin/me');

      onSignedIn({
        token,
        apiUrl,
        user: access.user,
        roleName: access.role?.name || (access.isSuperAdmin ? 'Super Admin' : 'Unassigned'),
        roleId: access.role?.id || null,
        isSuperAdmin: Boolean(access.isSuperAdmin),
        permissions: access.permissions || [],
        permissionCatalogue: access.permissionCatalogue || []
      });
    } catch (err: any) {
      setError(err?.message || 'Could not reach the Quick Bites server.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Forgot password: a 6-digit code to the staff email, then a new password (owner H5, R2-9),
   * the same server flow as Partner and Rider. Email now goes out through Brevo.
   */
  // Literal paths and bodies, so the body-contract check can read each call.
  const expectOk = async (res: Response) => {
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error?.message || 'That did not go through. Try again.');
  };
  const sendCode = async () => {
    if (!email.trim()) return setError('Enter your staff email.');
    setBusy(true);
    setError('');
    try {
      await expectOk(
        await apiFetch(`${apiUrl}/auth/password/forgot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase() })
        })
      );
      setNotice('If that email has a staff account, a 6-digit code is on its way. It works for 10 minutes.');
      setMode('reset');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const resetWithCode = async () => {
    if (!/^\d{6}$/.test(resetCode.trim())) return setError('Enter the 6-digit code from the email.');
    if (newPassword.length < 8) return setError('Choose a password of at least 8 characters.');
    setBusy(true);
    setError('');
    try {
      await expectOk(
        await apiFetch(`${apiUrl}/auth/password/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase(), code: resetCode.trim(), newPassword })
        })
      );
      setResetCode('');
      setNewPassword('');
      setPassword('');
      setNotice('Password changed. Sign in with the new one.');
      setMode('signin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brandBlock} onTouchEnd={registerTap}>
            <View style={s.brandMark}>
              <ShieldCheck size={30} color={c.brand.amber} />
            </View>
            <Text style={s.brandTitle}>Quick Bites Ops</Text>
            <Text style={s.brandSubtitle}>Platform control &amp; moderation console</Text>
          </View>

          <Card>
            {mode === 'signin' ? (
              <>
                <Field
                  label="Admin email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@quickbite.app"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
                {error ? <Text style={s.error}>{error}</Text> : null}
                {notice ? <Text style={s.notice}>{notice}</Text> : null}
                <Button label="Enter the console" onPress={signIn} loading={busy} size="lg" />
                <TouchableOpacity
                  onPress={() => {
                    setMode('forgot');
                    setError('');
                    setNotice('');
                  }}
                  style={s.linkRow}
                >
                  <Text style={s.link}>Forgot password?</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.stepTitle}>{mode === 'forgot' ? 'Reset your password' : 'Enter the code'}</Text>
                {mode === 'forgot' ? (
                  <>
                    <Field label="Staff email" value={email} onChangeText={setEmail} placeholder="you@quickbite.app" keyboardType="email-address" autoCapitalize="none" />
                    {error ? <Text style={s.error}>{error}</Text> : null}
                    <Button label="Email me a code" onPress={sendCode} loading={busy} size="lg" />
                  </>
                ) : (
                  <>
                    {notice ? <Text style={s.notice}>{notice}</Text> : null}
                    <Field label="6-digit code" value={resetCode} onChangeText={setResetCode} placeholder="123456" keyboardType="numeric" />
                    <Field label="New password" value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters" secureTextEntry />
                    {error ? <Text style={s.error}>{error}</Text> : null}
                    <Button label="Set new password" onPress={resetWithCode} loading={busy} size="lg" />
                  </>
                )}
                <TouchableOpacity onPress={() => setMode('signin')} style={s.linkRow}>
                  <Text style={s.link}>Back to sign in</Text>
                </TouchableOpacity>
              </>
            )}
          </Card>

          {unlocked && (
            <TouchableOpacity onPress={() => setShowServer(v => !v)} style={s.serverToggle}>
              <Text style={s.serverToggleText}>{showServer ? 'Hide server settings' : 'Server settings'}</Text>
            </TouchableOpacity>
          )}

          {unlocked && showServer ? (
            <Card>
              <Field
                label="API base URL"
                value={apiUrl}
                onChangeText={setApiUrl}
                placeholder="https://your-server/api"
                autoCapitalize="none"
                hint="Point the console at a different Quick Bites backend. Include the /api suffix."
              />
            </Card>
          ) : null}

          {__DEV__ ? (
            <View style={s.devPill}>
              <Sparkles size={14} color={c.brand.amber} />
              <Text style={s.devPillText}>admin@quickbite.app / pass123</Text>
            </View>
          ) : null}
        </KeyboardAwareScrollView>
      </View>
    </Screen>
  );
};

const s = StyleSheet.create({
  scroll: { padding: tokens.space[5], paddingTop: tokens.space[8], paddingBottom: tokens.space[8] },
  brandBlock: { alignItems: 'center', marginBottom: tokens.space[6] },
  brandMark: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: c.brand.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.space[4],
    borderWidth: 1,
    borderColor: c.border.medium
  },
  brandTitle: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  brandSubtitle: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 5 },
  stepTitle: {
    fontFamily: FONT_FAMILY, fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.primary,
    marginBottom: 6
  },
  stepBody: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.muted, marginBottom: tokens.space[4], lineHeight: 19 },
  error: {
    color: c.state.danger,
    fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm,
    marginBottom: tokens.space[3],
    backgroundColor: c.state.dangerBg,
    padding: tokens.space[3],
    borderRadius: tokens.radius.sm,
    lineHeight: 18
  },
  notice: {
    color: c.state.success,
    fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm,
    marginBottom: tokens.space[3],
    backgroundColor: c.state.successBg,
    padding: tokens.space[3],
    borderRadius: tokens.radius.sm,
    lineHeight: 18
  },
  linkRow: { alignItems: 'center', paddingVertical: tokens.space[3] },
  link: { color: c.brand.amberText, fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  serverToggle: { alignItems: 'center', paddingVertical: tokens.space[3] },
  serverToggleText: { color: c.text.muted, fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs },
  devPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: c.bg.card,
    paddingHorizontal: tokens.space[3],
    paddingVertical: tokens.space[2],
    borderRadius: tokens.radius.pill,
    marginTop: tokens.space[3],
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  devPillText: { color: c.text.secondary, fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs }
});
