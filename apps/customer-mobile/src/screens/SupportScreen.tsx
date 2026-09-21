import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  Modal,
  ActivityIndicator
} from 'react-native';
import {
  ArrowLeft,
  Phone,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  ChevronRight,
  ShieldCheck,
  X
} from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';
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
  apiUrl?: string;
  token?: string;
}

/** Must match the server's TicketSchema enum exactly — an unknown value is a 400. */
const CATEGORIES = [
  { key: 'ORDER', label: 'An order' },
  { key: 'DELIVERY', label: 'Delivery' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'RESTAURANT', label: 'The restaurant' },
  { key: 'ACCOUNT', label: 'My account' },
  { key: 'OTHER', label: 'Something else' }
];

export const SupportScreen: React.FC<Props> = ({ onBack, customerEmail, apiUrl, token }) => {
  const { t } = useTranslation();

  // Tickets the customer has raised, and the replies support left on them. The
  // phone and email routes below still exist; this is the one that reaches an
  // administrator's queue directly rather than an inbox.
  const [tickets, setTickets] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('ORDER');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const authed = Boolean(apiUrl && token);

  const loadTickets = useCallback(async () => {
    if (!authed) return;
    setLoadingTickets(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [ticketRes, caseRes] = await Promise.all([
        apiFetch(`${apiUrl}/support/tickets`, { headers }),
        apiFetch(`${apiUrl}/support/refund-requests`, { headers })
      ]);
      const ticketData = await ticketRes.json().catch(() => ({}));
      const caseData = await caseRes.json().catch(() => ({}));
      if (ticketData?.success) setTickets(ticketData.data?.tickets || []);
      if (caseData?.success) setCases(caseData.data?.requests || []);
    } catch {
      // The contact routes below still work offline, so a failed fetch here
      // leaves the screen usable rather than replacing it with an error.
    } finally {
      setLoadingTickets(false);
    }
  }, [apiUrl, token, authed]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const sendTicket = async () => {
    setComposerError(null);
    if (subject.trim().length < 3) {
      setComposerError('Give your message a short subject.');
      return;
    }
    if (message.trim().length < 10) {
      setComposerError('Tell us what happened, so support can act on it.');
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch(`${apiUrl}/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject: subject.trim(), category, message: message.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setComposerError(parseApiError(data, 'Your message could not be sent.').message);
        return;
      }
      setSubject('');
      setMessage('');
      setComposerOpen(false);
      await loadTickets();
      Alert.alert('Message sent', 'Our support team has your request and will reply here.');
    } catch {
      setComposerError('Could not reach Quick Bites. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

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

      {authed && (
        <>
          <Text style={styles.sectionLabel}>Message support</Text>
          <Card style={styles.block}>
            <TouchableOpacity style={styles.row} onPress={() => setComposerOpen(true)} activeOpacity={0.75}>
              <View style={styles.rowIcon}>
                <MessageSquarePlus size={18} color={c.primary[500]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Raise a request</Text>
                <Text style={styles.rowSub}>Goes straight to the Quick Bites support desk</Text>
              </View>
              <ChevronRight size={17} color={c.text.muted} />
            </TouchableOpacity>

            {loadingTickets && tickets.length === 0 ? (
              <View style={styles.ticketLoading}>
                <ActivityIndicator color={c.primary[500]} />
              </View>
            ) : null}

            {tickets.map(ticket => (
              <View key={ticket.id} style={styles.ticket}>
                <View style={styles.ticketHead}>
                  <Text style={styles.ticketSubject} numberOfLines={1}>
                    {ticket.subject}
                  </Text>
                  <Text style={[styles.ticketStatus, ticket.status === 'RESOLVED' && styles.ticketStatusDone]}>
                    {String(ticket.status).replace(/_/g, ' ').toLowerCase()}
                  </Text>
                </View>
                <Text style={styles.ticketBody} numberOfLines={2}>
                  {ticket.message}
                </Text>
                {(ticket.replies || []).map((reply: any, index: number) => (
                  <View key={index} style={styles.reply}>
                    <Text style={styles.replyWho}>{reply.byName}</Text>
                    <Text style={styles.replyBody}>{reply.body}</Text>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        </>
      )}

      {cases.length > 0 && (
        <>
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
        </>
      )}

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
          Email {SUPPORT_EMAIL} from {customerEmail ? customerEmail : 'your registered address'} with the subject
          “Delete my account”. We remove your addresses and detach your name from past orders, within 7 days.
        </Text>
      </Card>

      <View style={styles.trust}>
        <ShieldCheck size={15} color={c.text.muted} />
        <Text style={styles.trustText}>Quick Bites never asks for your password, card PIN or OTP.</Text>
      </View>

      <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Raise a request</Text>
              <TouchableOpacity onPress={() => setComposerOpen(false)} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>What is this about?</Text>
              <View style={styles.categoryWrap}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.category, category === cat.key && styles.categoryActive]}
                    onPress={() => setCategory(cat.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.categoryText, category === cat.key && styles.categoryTextActive]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Subject</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="Order arrived cold"
                placeholderTextColor={c.text.muted}
              />

              <Text style={styles.label}>What happened?</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={message}
                onChangeText={setMessage}
                placeholder="Tell us what went wrong and what you would like us to do."
                placeholderTextColor={c.text.muted}
                multiline
                textAlignVertical="top"
              />

              {!!composerError && <Text style={styles.error}>{composerError}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, sending && { opacity: 0.5 }]}
                onPress={sendTicket}
                disabled={sending}
                activeOpacity={0.88}
              >
                {sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Send to support</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  ticketLoading: { paddingVertical: 18, alignItems: 'center' },
  ticket: { borderTopWidth: 1, borderTopColor: c.border.subtle, paddingVertical: 12 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  ticketSubject: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text.primary },
  ticketStatus: { fontSize: 11, fontWeight: '800', color: c.semantic.warning, textTransform: 'capitalize' },
  ticketStatusDone: { color: c.dietary.veg },
  ticketStatusRejected: { color: c.semantic.error },
  ticketBody: { fontSize: 13, color: c.text.secondary, marginTop: 4, lineHeight: 18 },
  ticketMeta: { fontSize: 11, color: c.text.muted, marginTop: 6 },
  reply: {
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.sm,
    padding: 10,
    marginTop: 8
  },
  replyWho: { fontSize: 11, color: c.text.muted, fontWeight: '700' },
  replyBody: { fontSize: 13, color: c.text.primary, marginTop: 3, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,10,14,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '86%'
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text.primary },
  label: { fontSize: 12, fontWeight: '700', color: c.text.secondary, marginBottom: 7, marginTop: 10 },
  input: {
    backgroundColor: c.surface.sunken,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 15,
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
  categoryText: { fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  categoryTextActive: { color: '#FFFFFF', fontWeight: '700' },
  error: { color: c.semantic.error, fontSize: 13, marginTop: 12, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: c.primary[500],
    height: 50,
    borderRadius: tokens.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
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
