import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, Linking, RefreshControl } from 'react-native';
import { ChevronDown, ChevronUp, LifeBuoy, Phone, Mail, MessageSquare, LogOut } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Button, Field, Pill, ErrorNote, EmptyState } from '../components/ui';
import { raiseSupportTicket, fetchSupportTickets } from '../lib/partnerApi';

interface Props {
  restaurantName: string;
  ownerEmail?: string;
  onSignOut: () => void;
}

const SUPPORT_EMAIL = 'partners@quickbite.app';
const SUPPORT_PHONE = '+918000123456';

/** Must match the server's TicketSchema enum exactly — an unknown value is a 400. */
const CATEGORIES = [
  { key: 'ORDER', label: 'An order' },
  { key: 'PAYMENT', label: 'Payments' },
  { key: 'DELIVERY', label: 'Delivery' },
  { key: 'ACCOUNT', label: 'My account' },
  { key: 'RESTAURANT', label: 'My kitchen' },
  { key: 'OTHER', label: 'Something else' }
];

const FAQS = [
  {
    q: 'Why can I not take orders?',
    a: 'Two things must both be true: your documents are verified, and your kitchen is switched on. Check the Documents tab for anything outstanding, then use the toggle at the top of the screen to go online. A closed kitchen is hidden from customers and cannot receive orders.'
  },
  {
    q: 'When do I get paid, and how is the amount worked out?',
    a: 'Your earnings are the order total minus the platform commission and taxes, shown per order in Order History and totalled on the Dashboard. Payouts are released to the bank account on your Bank account proof document.'
  },
  {
    q: 'Why does adding a dish need approval?',
    a: 'A dish is what a customer is charged and what your kitchen commits to cooking, so new dishes and price changes are checked before they go live. Taking a dish out of stock is instant and needs no approval.'
  },
  {
    q: 'A customer says their order never arrived.',
    a: 'Open the order in Order History and raise it with us from this screen. Do not refund directly — refunds are issued centrally so the amount is deducted correctly and the customer is notified.'
  },
  {
    q: 'Why is there a 10 minute minimum preparation time?',
    a: 'The time you enter is shown to the customer as a promise and is used to decide when a rider is dispatched. Anything under ten minutes causes riders to arrive before the food is ready.'
  },
  {
    q: 'My document was rejected. What now?',
    a: 'The Documents tab shows the reason. Correct whatever was wrong — usually an unreadable scan or an expired licence — and send it again from the same screen.'
  }
];

/**
 * Help, and a way to reach a person.
 *
 * The app had no support route at all, so a partner with a problem had nowhere
 * to go. Answers to the common questions come first because most are answerable
 * without us; the contact routes are underneath for when they are not.
 */
export const HelpCentreScreen: React.FC<Props> = ({ restaurantName, ownerEmail, onSignOut }) => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('ORDER');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    const res = await fetchSupportTickets();
    if (res.ok) setTickets(res.data?.tickets || []);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  const send = async () => {
    setFormError(null);
    if (subject.trim().length < 4) {
      setFormError('Give your message a short subject.');
      return;
    }
    if (body.trim().length < 10) {
      setFormError('Tell us what happened, so we can help without a round trip.');
      return;
    }

    setBusy(true);
    const res = await raiseSupportTicket({ subject: subject.trim(), category, message: body.trim() });
    setBusy(false);

    if (!res.ok) {
      setFormError(res.message || 'Could not send your message.');
      return;
    }
    setComposerOpen(false);
    setSubject('');
    setBody('');
    setSent(true);
    setTimeout(() => setSent(false), 4000);
    load('initial');
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />}
      >
        {sent && (
          <View style={styles.sentNote}>
            <Text style={styles.sentNoteText}>Sent. Our team replies within a few hours during trading time.</Text>
          </View>
        )}

        <Card>
          <View style={styles.head}>
            <LifeBuoy size={22} color={c.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.headTitle}>Help Centre</Text>
              <Text style={styles.headBody}>{restaurantName}</Text>
            </View>
          </View>
          <Button label="Message support" onPress={() => setComposerOpen(true)} />
          <View style={styles.contactRow}>
            <TouchableOpacity style={styles.contact} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
              <Phone size={16} color={c.textSoft} />
              <Text style={styles.contactText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contact} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
              <Mail size={16} color={c.textSoft} />
              <Text style={styles.contactText}>Email</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {tickets.length > 0 && (
          <Card>
            <SectionHeading title="Your messages" />
            {tickets.slice(0, 5).map(t => (
              <View key={t.id} style={styles.ticketRow}>
                <MessageSquare size={15} color={c.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.ticketSubject} numberOfLines={1}>
                    {t.subject}
                  </Text>
                  <Text style={styles.ticketMeta}>
                    {new Date(t.createdAt).toLocaleDateString('en-IN')}
                    {t.replies?.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''}
                  </Text>
                </View>
                <Pill
                  label={String(t.status).replace(/_/g, ' ')}
                  tone={t.status === 'RESOLVED' ? 'success' : t.status === 'OPEN' ? 'warning' : 'muted'}
                />
              </View>
            ))}
          </Card>
        )}

        <SectionHeading title="Common questions" />
        {FAQS.map((faq, i) => (
          <TouchableOpacity
            key={faq.q}
            style={styles.faq}
            onPress={() => setExpanded(expanded === i ? null : i)}
            activeOpacity={0.8}
          >
            <View style={styles.faqHead}>
              <Text style={styles.faqQ}>{faq.q}</Text>
              {expanded === i ? (
                <ChevronUp size={17} color={c.textMuted} />
              ) : (
                <ChevronDown size={17} color={c.textMuted} />
              )}
            </View>
            {expanded === i && <Text style={styles.faqA}>{faq.a}</Text>}
          </TouchableOpacity>
        ))}

        <Card style={{ marginTop: spacing.xl }}>
          <SectionHeading title="Account" sub={ownerEmail} />
          <Button label="Sign out" variant="ghost" onPress={onSignOut} />
        </Card>
      </ScrollView>

      <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Message support</Text>

              {!!formError && <ErrorNote message={formError} />}

              <Text style={styles.catLabel}>What is this about?</Text>
              <View style={styles.catWrap}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.cat, category === cat.key && styles.catActive]}
                    onPress={() => setCategory(cat.key)}
                  >
                    <Text style={[styles.catText, category === cat.key && styles.catTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Order QB-399998 never arrived" />
              <Field
                label="What happened?"
                value={body}
                onChangeText={setBody}
                placeholder="Include the order number and anything the customer told you."
                multiline
              />

              <Button label="Send" onPress={send} busy={busy} />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setComposerOpen(false)}
                style={{ marginTop: spacing.md, marginBottom: spacing.xl }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: spacing.xl, paddingBottom: 48 },
  sentNote: { backgroundColor: c.successSoft, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  sentNoteText: { color: c.success, fontSize: 13, lineHeight: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  headBody: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  contactRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  contact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border
  },
  contactText: { fontSize: 13, color: c.textSoft, fontWeight: '700' },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  ticketSubject: { fontSize: 14, color: c.text, fontWeight: '600' },
  ticketMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  faq: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    marginBottom: spacing.sm
  },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  faqQ: { flex: 1, fontSize: 14, color: c.text, fontWeight: '700', lineHeight: 20 },
  faqA: { fontSize: 13, color: c.textMuted, lineHeight: 20, marginTop: spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xxl,
    maxHeight: '88%'
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: c.text, marginBottom: spacing.xl },
  catLabel: { fontSize: 13, color: c.textSoft, fontWeight: '700', marginBottom: spacing.md },
  catWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  cat: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border
  },
  catActive: { backgroundColor: c.border, borderColor: c.brand },
  catText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  catTextActive: { color: c.brand }
});
