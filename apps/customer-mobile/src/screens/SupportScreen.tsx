import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, Alert } from 'react-native';
import { ArrowLeft, Phone, Mail, MessageCircle, ChevronRight, ShieldCheck } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card } from '../components/ui';
import { useTranslation } from '../lib/i18n';

const c = tokens.colors;

/**
 * Customer care.
 *
 * Every route here opens something the phone can actually complete - a dialler,
 * a mail composer, WhatsApp - rather than a form that posts into a queue nobody
 * is watching. Account deletion is listed as a support request on purpose: the
 * app no longer offers a delete button, and Google Play still expects a route to
 * deletion for an app with sign-up, so this is that route.
 */
const SUPPORT_PHONE = '+918048123456';
const SUPPORT_EMAIL = 'support@quickbite.app';
const SUPPORT_WHATSAPP = '918048123456';

interface Props {
  onBack: () => void;
  customerEmail?: string;
}

export const SupportScreen: React.FC<Props> = ({ onBack, customerEmail }) => {
  const { t } = useTranslation();

  const open = async (url: string, fallback: string) => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        Alert.alert('Not available on this device', fallback);
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open', fallback);
    }
  };

  const rows = [
    {
      icon: <Phone size={18} color={c.dietary.veg} />,
      title: t('support.callUs'),
      sub: SUPPORT_PHONE,
      onPress: () => open(`tel:${SUPPORT_PHONE}`, `Dial ${SUPPORT_PHONE}`)
    },
    {
      icon: <MessageCircle size={18} color={c.dietary.veg} />,
      title: t('support.whatsapp'),
      sub: 'Usually replies within minutes',
      onPress: () =>
        open(
          `whatsapp://send?phone=${SUPPORT_WHATSAPP}&text=${encodeURIComponent('Hi Quick Bites, I need help with an order.')}`,
          'WhatsApp is not installed on this phone.'
        )
    },
    {
      icon: <Mail size={18} color={c.primary[500]} />,
      title: t('support.emailUs'),
      sub: SUPPORT_EMAIL,
      onPress: () =>
        open(
          `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Quick Bites support')}`,
          `Write to ${SUPPORT_EMAIL}`
        )
    }
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <ArrowLeft size={18} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('support.title')}</Text>
      </View>

      <Card style={styles.hero}>
        <Text style={styles.heroTitle}>We're here to help</Text>
        <Text style={styles.heroSub}>{t('support.hours')}</Text>
      </Card>

      <Card style={styles.block}>
        {rows.map((row, i) => (
          <TouchableOpacity
            key={row.title}
            style={[styles.row, i < rows.length - 1 && styles.rowDivider]}
            onPress={row.onPress}
            activeOpacity={0.75}
          >
            <View style={styles.rowIcon}>{row.icon}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSub}>{row.sub}</Text>
            </View>
            <ChevronRight size={17} color={c.text.muted} />
          </TouchableOpacity>
        ))}
      </Card>

      <Text style={styles.sectionLabel}>Common requests</Text>
      <Card style={styles.block}>
        <Text style={styles.faqQ}>My order is late</Text>
        <Text style={styles.faqA}>
          Open the order from Order history and use Call or Chat to reach your delivery partner directly.
        </Text>
        <View style={styles.faqDivider} />
        <Text style={styles.faqQ}>Something was missing or wrong</Text>
        <Text style={styles.faqA}>
          Call customer care with your order number. Refunds go back to your Quick Bites wallet the same day.
        </Text>
        <View style={styles.faqDivider} />
        <Text style={styles.faqQ}>I want my account deleted</Text>
        <Text style={styles.faqA}>
          Email {SUPPORT_EMAIL} from {customerEmail ? customerEmail : 'your registered address'} with the subject
          “Delete my account”. We remove your addresses and wallet, and detach your name from past orders, within 7 days.
        </Text>
      </Card>

      <View style={styles.trust}>
        <ShieldCheck size={15} color={c.text.muted} />
        <Text style={styles.trustText}>Quick Bites never asks for your password, card PIN or OTP.</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  title: { fontSize: 20, fontWeight: '800', color: c.text.primary },
  hero: { backgroundColor: c.primary[500], marginBottom: 14 },
  heroTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },
  block: { marginBottom: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: c.text.primary },
  rowSub: { fontSize: 12, color: c.text.muted, marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4
  },
  faqQ: { fontSize: 14, fontWeight: '700', color: c.text.primary, marginTop: 12 },
  faqA: { fontSize: 13, color: c.text.secondary, lineHeight: 19, marginTop: 4, marginBottom: 4 },
  faqDivider: { height: 1, backgroundColor: c.border.subtle, marginTop: 12 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 },
  trustText: { fontSize: 11.5, color: c.text.muted, flex: 1, lineHeight: 16 }
});
