import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch
} from 'react-native';
import { tokens } from '../theme/tokens';

const c = tokens.colors;
import { User, Sparkles, Globe, MapPin, History, Shield, ArrowLeft, CreditCard, Cloud } from 'lucide-react-native';

interface Props {
  onBack: () => void;
  apiUrl?: string;
  token?: string;
  onUpdateApiUrl?: (url: string) => void;
  onLogout?: () => void;
}

export const ProfileScreen: React.FC<Props> = ({ onBack, apiUrl, token, onUpdateApiUrl, onLogout }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'kn'>('kn');
  const [vegOnlyDefault, setVegOnlyDefault] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(500.00);
  const [customServerUrl, setCustomServerUrl] = useState<string>(apiUrl || 'https://quick-bites-production-9f45.up.railway.app/api');

  React.useEffect(() => {
    if (!apiUrl) return;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${apiUrl}/wallets/usr_customer_01`, { headers })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data?.wallet?.balance !== undefined) {
          setWalletBalance(data.data.wallet.balance);
        }
      })
      .catch(() => {});
  }, [apiUrl, token]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <ArrowLeft size={20} color={c.text.primary} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      {/* User Card */}
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <User size={28} color={c.surface.card} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.userName}>Rahul Sharma</Text>
          <Text style={styles.userContact}>+91-98765-43210 • customer@quickbite.app</Text>
          <View style={styles.goldBadge}>
            <Sparkles size={12} color="#D97706" />
            <Text style={styles.goldText}>QUICK BITE GOLD ACTIVE</Text>
          </View>
        </View>
      </View>

      {/* Quick Bites Cash Wallet Card */}
      <View style={styles.walletCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CreditCard size={18} color="#16A34A" />
            <Text style={styles.walletHeader}>QUICK BITE CASH WALLET</Text>
          </View>
          <Text style={styles.walletBalance}>Rs {walletBalance.toFixed(2)}</Text>
        </View>
        <Text style={styles.walletSubtitle}>Preloaded instant checkout balance. Fast 1-tap ordering.</Text>
      </View>

      {/* Cloud & Public Tunnel Configuration */}
      <View style={styles.sectionCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Cloud size={18} color={tokens.colors.primary[500]} />
          <Text style={styles.sectionHeader}>Backend Server & Tunnel URL</Text>
        </View>
        <Text style={{ fontSize: 12, color: c.text.secondary, marginBottom: 8 }}>
          Connects to your local or public Cloudflare tunnel endpoint across 4 physical devices.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={styles.serverInput}
            value={customServerUrl}
            onChangeText={setCustomServerUrl}
            placeholder="http://10.0.2.2:5000/api"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.saveServerBtn}
            onPress={() => onUpdateApiUrl && onUpdateApiUrl(customServerUrl)}
          >
            <Text style={styles.saveServerText}>SAVE</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Preferences Section */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionHeader}>Preferences & Localization</Text>

        {/* Language Selection */}
        <View style={styles.row}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Globe size={18} color={c.text.secondary} />
            <Text style={styles.rowLabel}>App Language</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['en', 'hi', 'kn'] as const).map(lang => (
              <TouchableOpacity
                key={lang}
                style={[styles.langChip, selectedLanguage === lang && styles.langChipActive]}
                onPress={() => setSelectedLanguage(lang)}
              >
                <Text style={[styles.langChipText, selectedLanguage === lang && styles.langChipTextActive]}>
                  {lang === 'en' ? 'EN' : lang === 'hi' ? 'HI' : 'KN'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Veg-Only Mode Switch */}
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: c.surface.sunken, paddingTop: 12, marginTop: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.vegDot} />
            <Text style={styles.rowLabel}>Always Show Pure Veg First</Text>
          </View>
          <Switch
            value={vegOnlyDefault}
            onValueChange={setVegOnlyDefault}
            trackColor={{ false: c.border.medium, true: tokens.colors.dietary.veg }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* Saved Addresses */}
      <View style={styles.sectionCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MapPin size={18} color={c.text.secondary} />
          <Text style={styles.sectionHeader}>Saved Addresses</Text>
        </View>
        <View style={styles.addressBox}>
          <Text style={styles.addressTitle}>Home</Text>
          <Text style={styles.addressText}>100 Feet Road, Indiranagar, Bengaluru, 560038</Text>
        </View>
      </View>

      {/* Log Out Button */}
      {onLogout && (
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutButtonText}>Log Out of Quick Bites</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.surface.app
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16
  },
  backText: {
    fontSize: 14,
    color: c.text.primary,
    fontWeight: '600'
  },
  userCard: {
    backgroundColor: c.surface.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: c.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: c.text.primary
  },
  userContact: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2
  },
  goldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 8
  },
  goldText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#D97706'
  },
  sectionCard: {
    backgroundColor: c.surface.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: 14
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12
  },
  rowLabel: {
    fontSize: 13,
    color: c.text.primary,
    fontWeight: '500'
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.border.medium,
    backgroundColor: c.surface.app
  },
  langChipActive: {
    borderColor: tokens.colors.primary[500],
    backgroundColor: tokens.colors.primary[50]
  },
  langChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary
  },
  langChipTextActive: {
    color: tokens.colors.primary[500]
  },
  vegDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: tokens.colors.dietary.veg
  },
  addressBox: {
    backgroundColor: c.surface.app,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: c.surface.sunken
  },
  addressTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary
  },
  addressText: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2
  },
  complianceText: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 16
  },
  walletCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16
  },
  walletHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.5
  },
  walletBalance: {
    fontSize: 18,
    fontWeight: '800',
    color: '#166534'
  },
  walletSubtitle: {
    fontSize: 11,
    color: '#15803D',
    marginTop: 2
  },
  serverInput: {
    flex: 1,
    backgroundColor: c.surface.app,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: c.text.primary
  },
  saveServerBtn: {
    backgroundColor: tokens.colors.primary[500],
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center'
  },
  saveServerText: {
    color: c.surface.card,
    fontWeight: '800',
    fontSize: 12
  },
  logoutButton: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20
  },
  logoutButtonText: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: 14
  }
});
