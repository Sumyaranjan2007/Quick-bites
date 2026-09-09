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
  ScrollView
} from 'react-native';
import { tokens } from '@quick-bites/design-system';
import { Utensils, Lock, Mail, User, Phone, Server, Sparkles } from 'lucide-react-native';

interface Props {
  initialApiUrl: string;
  onLoginSuccess: (token: string, user: any, apiUrl: string) => void;
}

export const LoginScreen: React.FC<Props> = ({ initialApiUrl, onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [email, setEmail] = useState('customer@quickbite.app');
  const [password, setPassword] = useState('pass123');
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Brand Header */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Utensils size={36} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>Quick Bite</Text>
          <Text style={styles.subtitle}>Superfast food delivery to your doorstep</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, !isRegistering && styles.tabActive]}
              onPress={() => setIsRegistering(false)}
            >
              <Text style={[styles.tabText, !isRegistering && styles.tabTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, isRegistering && styles.tabActive]}
              onPress={() => setIsRegistering(true)}
            >
              <Text style={[styles.tabText, isRegistering && styles.tabTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {isRegistering && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <User size={18} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Rahul Sharma"
                    value={fullName}
                    onChangeText={setFullName}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Phone</Text>
                <View style={styles.inputWrapper}>
                  <Phone size={18} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="10-digit number"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>
            </>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <Mail size={18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="customer@quickbite.app"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputWrapper}>
              <Lock size={18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isRegistering ? 'Create Account & Claim ₹100' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Quick Demo Button */}
          <TouchableOpacity
            style={styles.demoButton}
            onPress={handleQuickDemoLogin}
            disabled={loading}
          >
            <Sparkles size={16} color={tokens.colors.primary[500]} />
            <Text style={styles.demoButtonText}>One-Tap Demo Login (Rahul Sharma)</Text>
          </TouchableOpacity>

          {/* Server Config Toggle */}
          <TouchableOpacity
            style={styles.serverToggle}
            onPress={() => setShowServerConfig(!showServerConfig)}
          >
            <Server size={14} color="#64748B" />
            <Text style={styles.serverToggleText}>
              {showServerConfig ? 'Hide Server Configuration' : 'Configure Server Endpoint'}
            </Text>
          </TouchableOpacity>

          {showServerConfig && (
            <View style={styles.serverConfigBox}>
              <Text style={styles.serverConfigLabel}>Backend API Endpoint URL</Text>
              <TextInput
                style={styles.serverConfigInput}
                value={apiUrl}
                onChangeText={setApiUrl}
                placeholder="http://10.0.2.2:5000/api"
                autoCapitalize="none"
                placeholderTextColor="#94A3B8"
              />
              <Text style={styles.serverConfigHint}>
                Use http://10.0.2.2:5000/api for Android emulator or public tunnel for physical device.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  scrollContent: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
    alignItems: 'center'
  },
  header: {
    alignItems: 'center',
    marginBottom: 28
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    elevation: 4,
    shadowColor: tokens.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center'
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B'
  },
  tabTextActive: {
    color: tokens.colors.primary[500],
    fontWeight: '800'
  },
  inputGroup: {
    marginBottom: 14
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12
  },
  inputIcon: {
    marginRight: 8
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A'
  },
  submitButton: {
    backgroundColor: tokens.colors.primary[500],
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    elevation: 2
  },
  submitButtonDisabled: {
    opacity: 0.6
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800'
  },
  demoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: tokens.colors.primary[100],
    backgroundColor: tokens.colors.primary[50],
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12
  },
  demoButtonText: {
    color: tokens.colors.primary[600],
    fontSize: 13,
    fontWeight: '700'
  },
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    paddingVertical: 6
  },
  serverToggleText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600'
  },
  serverConfigBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 10
  },
  serverConfigLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4
  },
  serverConfigInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#0F172A'
  },
  serverConfigHint: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 4
  }
});
