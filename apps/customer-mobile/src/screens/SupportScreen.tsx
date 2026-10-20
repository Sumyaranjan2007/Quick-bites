import { HelpChat } from '../components/HelpChat';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert
} from 'react-native';
import {
  ArrowLeft,
  Phone,
  Mail,
  MessageCircle,
  ShieldCheck
} from 'lucide-react-native';
import { tokens, iosLargeTitle } from '../theme/tokens';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { useTranslation } from '../lib/i18n';
import { useLiveSync } from '../lib/liveSync';

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
/*
 * THE CONTACT DETAILS COME FROM THE SERVER (QA v10, V10-1).
 *
 * These were placeholders written into the app ("+91 80481 23456",
 * "support@quickbite.app"), so a customer who tapped "Call customer care" rang a
 * number that is not the platform's. The real ones are the business identity an
 * administrator keeps in Settings — the same figures printed on every receipt —
 * served by GET /policies/business. Changing them there changes them here,
 * without a new app.
 */
interface SupportContact {
  phone: string;
  whatsapp: string;
  email: string;
}

function contactFrom(identity: any): SupportContact | null {
  const digits = String(identity?.contactPhone || '').replace(/\D/g, '');
  const email = String(identity?.contactEmail || '').trim();
  if (digits.length < 10 && !email) return null;
  const national = digits.slice(-10);
  return {
    phone: national.length === 10 ? `+91${national}` : '',
    whatsapp: national.length === 10 ? `91${national}` : '',
    email
  };
}

interface Props {
  onBack: () => void;
  customerEmail?: string;
  apiUrl?: string;
  token?: string;
  /** Opened from an order ("Ask support to cancel"): the chat is about it (R3-9). */
  orderId?: string | null;
}

/** Must match the server's TicketSchema enum exactly — an unknown value is a 400. */
export const SupportScreen: React.FC<Props> = ({ onBack, customerEmail, apiUrl, token, orderId }) => {
  const { t } = useTranslation();

  // Refund requests the customer has raised (the chat itself lives in HelpChat).
  const [cases, setCases] = useState<any[]>([]);

  const authed = Boolean(apiUrl && token);

  const [contact, setContact] = useState<SupportContact | null>(null);
  const [contactFailed, setContactFailed] = useState(false);
  useEffect(() => {
    if (!apiUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${apiUrl}/policies/business`);
        const data = await res.json();
        const next = contactFrom(data?.data?.identity);
        if (!cancelled) {
          setContact(next);
          setContactFailed(!next);
        }
      } catch {
        if (!cancelled) setContactFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);
  const SUPPORT_PHONE = contact?.phone || '';
  const SUPPORT_EMAIL = contact?.email || '';
  const SUPPORT_WHATSAPP = contact?.whatsapp || '';

  const loadTickets = useCallback(async () => {
    if (!authed) return;
    try {
      const res = await apiFetch(`${apiUrl}/support/refund-requests`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (data?.success) setCases(data.data?.requests || []);
    } catch {
      // The chat and the contact buttons still work offline.
    }
  }, [apiUrl, token, authed]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);
  useLiveSync(loadTickets);

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
    SUPPORT_PHONE && {
      icon: <Phone size={18} color={c.dietary.veg} />,
      title: t('support.callUs'),
      sub: SUPPORT_PHONE,
      onPress: () => open(`tel:${SUPPORT_PHONE}`, `Dial ${SUPPORT_PHONE}`)
    },
    SUPPORT_WHATSAPP && {
      icon: <MessageCircle size={18} color={c.dietary.veg} />,
      title: t('support.whatsapp'),
      sub: SUPPORT_PHONE,
      onPress: () =>
        open(
          `whatsapp://send?phone=${SUPPORT_WHATSAPP}&text=${encodeURIComponent('Hi Quick Bites, I need help with an order.')}`,
          'WhatsApp is not installed on this phone.'
        )
    },
    SUPPORT_EMAIL && {
      icon: <Mail size={18} color={c.primary[500]} />,
      title: t('support.emailUs'),
      sub: SUPPORT_EMAIL,
      onPress: () =>
        open(
          `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Quick Bites support')}`,
          `Write to ${SUPPORT_EMAIL}`
        )
    }
  ].filter(Boolean) as Array<{ icon: React.ReactNode; title: string; sub: string; onPress: () => void }>;

  // Refund requests sit under History, beside the solved chats (owner, 20 Oct).
  const refunds =
    cases.length > 0 ? (
      <View style={{ marginTop: 16 }}>
        <Text style={styles.sectionLabel}>Your refund requests</Text>
        <Card style={styles.block}>
            {cases.map(request => (
              <View key={request.id} style={styles.ticket}>
                <View style={styles.ticketHead}>
                  <Text style={styles.ticketSubject} numberOfLines={1}>
                    Order #{request.orderNumber}
                  </Text>
                  <Text
                    style={[
                      styles.ticketStatus,
                      request.status === 'REFUNDED' && styles.ticketStatusDone,
                      request.status === 'REJECTED' && styles.ticketStatusRejected
                    ]}
                  >
                    {String(request.status).toLowerCase()}
                  </Text>
                </View>
                <Text style={styles.ticketBody} numberOfLines={2}>
                  {request.description}
                </Text>
                <Text style={styles.ticketMeta}>
                  Asked for ₹{Math.round(request.requestedAmount)}
                  {request.status === 'REFUNDED' && request.approvedAmount
                    ? ` · ₹${Math.round(request.approvedAmount)} refunded to the way you paid`
                    : ''}
                </Text>
              </View>
            ))}
        </Card>
      </View>
    ) : null;

  // Help is one chat, like the Rider app's (owner, 20 Oct): no separate "Raise a request".
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: 16 }]}>
        <TouchableOpacity hitSlop={10} style={styles.backBtn} onPress={onBack} activeOpacity={0.8}>
          <ArrowLeft size={18} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('support.title')}</Text>
      </View>

      {rows.length > 0 && (
        // flexGrow 0: a horizontal ScrollView in a column grows to fill it, and the chips stretched to 40 % of the screen (R3-4).
        <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contactRow}>
          {rows.map(row => (
            <TouchableOpacity key={row.title} style={styles.contactChip} onPress={row.onPress} activeOpacity={0.75} accessibilityRole="button">
              {row.icon}
              <Text style={styles.contactText}>{row.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {authed ? (
        <View style={{ flex: 1 }}>
          <HelpChat apiUrl={apiUrl} token={token} onSent={() => void loadTickets()} historyFooter={refunds} orderId={orderId} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>Common requests</Text>
          <Card style={styles.block}>
            <Text style={styles.faqQ}>My order is late</Text>
            <Text style={styles.faqA}>
              Open the order from Order history and use Call or Chat to reach your delivery partner directly.
            </Text>
            <View style={styles.faqDivider} />
            <Text style={styles.faqQ}>Something was missing or wrong</Text>
            <Text style={styles.faqA}>
              Call customer care with your order number. An approved refund goes back the way you paid: to your
              card or UPI app, which your bank takes 3 to 7 working days to show, or by a link you claim with any
              UPI id if you paid cash.
            </Text>
            <View style={styles.faqDivider} />
            <Text style={styles.faqQ}>I want my account deleted</Text>
            <Text style={styles.faqA}>
              Open Profile and tap “Delete my account” at the bottom. We remove your profile and addresses and detach
              your name from past orders.
            </Text>
          </Card>

          <View style={styles.trust}>
            <ShieldCheck size={15} color={c.text.muted} />
            <Text style={styles.trustText}>Quick Bites never asks for your password, card PIN or OTP.</Text>
          </View>

        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  contactRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, alignItems: 'center' },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.card
  },
  contactText: { fontFamily: tokens.font.family, fontSize: 13, fontWeight: '600', color: c.text.primary },
  ticketLoading: { paddingVertical: 18, alignItems: 'center' },
  ticket: { borderTopWidth: 1, borderTopColor: c.border.subtle, paddingVertical: 12 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  ticketSubject: { flex: 1, fontFamily: tokens.font.family, fontSize: 14, fontWeight: '700', color: c.text.primary },
  ticketStatus: { fontFamily: tokens.font.family, fontSize: 11, fontWeight: '800', color: c.semantic.warning, textTransform: 'capitalize' },
  ticketStatusDone: { color: c.dietary.veg },
  ticketStatusRejected: { color: c.semantic.error },
  ticketBody: { fontFamily: tokens.font.family, fontSize: 13, color: c.text.secondary, marginTop: 4, lineHeight: 18 },
  ticketMeta: { fontFamily: tokens.font.family, fontSize: 11, color: c.text.muted, marginTop: 6 },
  reply: {
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.sm,
    padding: 10,
    marginTop: 8
  },
  replyWho: { fontFamily: tokens.font.family, fontSize: 11, color: c.text.muted, fontWeight: '700' },
  replyBody: { fontFamily: tokens.font.family, fontSize: 13, color: c.text.primary, marginTop: 3, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,10,14,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '86%'
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontFamily: tokens.font.family, fontSize: 18, fontWeight: '800', color: c.text.primary },
  label: { fontFamily: tokens.font.family, fontSize: 12, fontWeight: '700', color: c.text.secondary, marginBottom: 7, marginTop: 10 },
  input: {
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 14,
    height: 46,
    fontFamily: tokens.font.family, fontSize: 15,
    color: c.text.primary
  },
  inputMultiline: { height: 108, paddingTop: 12 },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  category: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tokens.radii.full,
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  categoryActive: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  categoryText: { fontFamily: tokens.font.family, fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  categoryTextActive: { color: '#FFFFFF', fontWeight: '700' },
  error: { color: c.semantic.error, fontFamily: tokens.font.family, fontSize: 13, marginTop: 12, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: c.primary[500],
    height: 50,
    borderRadius: tokens.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18
  },
  primaryBtnText: { color: '#FFFFFF', fontFamily: tokens.font.family, fontSize: 15, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12, ...iosLargeTitle.header },
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
  title: { fontFamily: tokens.font.family, fontSize: 20, fontWeight: '800', color: c.text.primary, ...iosLargeTitle.title },
  hero: { backgroundColor: c.primary[500], marginBottom: 14 },
  heroTitle: { color: '#FFFFFF', fontFamily: tokens.font.family, fontSize: 17, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontFamily: tokens.font.family, fontSize: 13, marginTop: 4 },
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
  rowTitle: { fontFamily: tokens.font.family, fontSize: 14.5, fontWeight: '700', color: c.text.primary },
  rowSub: { fontFamily: tokens.font.family, fontSize: 12, color: c.text.muted, marginTop: 2 },
  sectionLabel: {
    fontFamily: tokens.font.family, fontSize: 12,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4
  },
  faqQ: { fontFamily: tokens.font.family, fontSize: 14, fontWeight: '700', color: c.text.primary, marginTop: 12 },
  faqA: { fontFamily: tokens.font.family, fontSize: 13, color: c.text.secondary, lineHeight: 19, marginTop: 4, marginBottom: 4 },
  faqDivider: { height: 1, backgroundColor: c.border.subtle, marginTop: 12 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 },
  trustText: { fontFamily: tokens.font.family, fontSize: 11.5, color: c.text.muted, flex: 1, lineHeight: 16 }
});
