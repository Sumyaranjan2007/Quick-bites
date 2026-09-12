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
  const [fullName, setFullName] = useState('Rahul Sharma');
  const [phone, setPhone] = useState('9876543210');
  const [loading, setLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Required Fields', 'Please enter your email and password.');
      return;
    }

    if (isRegistering && !fullName) {
      Alert.alert('Required Field', 'Please enter your full name.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegistering ? `${apiUrl}/auth/register` : `${apiUrl}/auth/login`;
      const bodyPayload = isRegistering
        ? { email, password, fullName, phone, role: 'customer' }
        : { email, password, role: 'customer' };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (res.ok && data.success && data.data?.token) {
        onLoginSuccess(data.data.token, data.data.user, apiUrl);
      } else {
        const errorMsg = data.error?.message || data.error || 'Authentication failed.';
        Alert.alert('Login Error', errorMsg);
      }
    } catch (err: any) {
      Alert.alert(
        'Connection Error',
        `Unable to connect to backend server at ${apiUrl}.\n\nPlease ensure the backend server is running and the URL is correct for your device/emulator.`
      );
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
              onPress={() => setIsRegistering(false)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, !isRegistering && styles.tabTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, isRegistering && styles.tabActive]}
              onPress={() => setIsRegistering(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, isRegistering && styles.tabTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {isRegistering && (
            <>
              <Text style={styles.label}>Full Name</Text>
              <View style={styles.field}>
                <User size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  placeholderTextColor={c.text.muted}
                />
              </View>

              <Text style={styles.label}>Phone</Text>
              <View style={styles.field}>
                <Phone size={17} color={c.text.muted} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="10-digit mobile"
                  placeholderTextColor={c.text.muted}
                  keyboardType="phone-pad"
                />
              </View>
            </>
          )}

          <Text style={styles.label}>Email Address</Text>
          <View style={styles.field}>
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

          <Text style={styles.label}>Password</Text>
          <View style={styles.field}>
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

          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{isRegistering ? 'Create Account' : 'Sign In'}</Text>
            )}
          </TouchableOpacity>

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