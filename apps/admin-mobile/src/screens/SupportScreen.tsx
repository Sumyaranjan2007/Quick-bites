import { FONT_FAMILY } from '../theme/tokens';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert, Linking, TextInput, TouchableOpacity } from 'react-native';
import { LifeBuoy, TriangleAlert } from 'lucide-react-native';
import {
  Card,
  Segmented,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  ResourceError,
  NoAccess
} from '../components/ui';
import { tokens, humanise, formatDateTime, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PersonDocuments } from '../components/PersonDocuments';

const c = tokens.colors;

type Tab = 'tickets' | 'sos';

/** Complaints from the apps, and the emergency alerts riders raise on the road. */
export const SupportScreen: React.FC = () => {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('tickets');

  if (!can('support.tickets.view', 'users.drivers.view')) return <NoAccess permission="support.tickets.view" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented
          options={[
            { key: 'tickets', label: 'Complaints' },
            { key: 'sos', label: 'SOS alerts' }
          ]}
          value={tab}
          onChange={next => setTab(next as Tab)}
        />
      </View>
      {tab === 'tickets' ? <TicketsTab /> : <SosTab />}
    </View>
  );
};

/** Fills the reply box; Operations edits before sending (round 6). */
const QUICK_REPLIES = [
  "Hi, I'm looking into this now.",
  'Could you share your order number?',
  "Sorry about this — we've started your refund.",
  "Your issue is sorted. Anything else?",
  "We'll call you in a few minutes."
];

const minutesSince = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : 0);

/**
 * Help chats from the three apps, live (round 6): unread first, then the longest
 * waiting. A chat stays here until Operations or the person marks it solved.
 */
const TicketsTab: React.FC = () => {
  const { api } = useSession();
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useResource(() => api.get<any>(`/admin/support/tickets${query({ status })}`), [status]);
  const counts = list.data?.counts;
  const words = search.trim().toLowerCase();
  const tickets = (list.data?.tickets || []).filter(
    (t: any) =>
      !words ||
      [t.raisedByName, t.contactPhone, t.orderNumber, t.subject, ...(t.kitchens || []), t.riderCode]
        .filter(Boolean)
        .some((v: any) => String(v).toLowerCase().includes(words))
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <Segmented
          options={[
            { key: 'ACTIVE', label: counts?.unread ? `Active · ${counts.unread} new` : 'Active' },
            { key: 'RESOLVED', label: 'Solved' },
            { key: 'ALL', label: 'All' }
          ]}
          value={status}
          onChange={setStatus}
        />
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, order #, kitchen"
          placeholderTextColor={c.text.muted}
          autoCapitalize="none"
        />
      </View>

      {list.loading && tickets.length === 0 ? <Loading /> : null}
      {!list.loading && tickets.length === 0 ? (
        <EmptyState
          title={status === 'ACTIVE' ? 'No open chats' : 'Nothing here'}
          message={list.error || 'Help chats from the apps appear here the moment they are written.'}
          icon={<LifeBuoy size={34} color={c.text.muted} />}
        />
      ) : null}

      <KeyboardAwareScrollView bottomOffset={24}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {tickets.map((ticket: any) => {
          const waiting = ['OPEN', 'IN_PROGRESS'].includes(ticket.status) && ticket.lastMessageBy === 'USER';
          const waited = minutesSince(ticket.lastMessageAt);
          return (
            <Card key={ticket.id} onPress={() => setOpenId(ticket.id)}>
              <View style={s.rowTop}>
                <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                  <Text style={s.title} numberOfLines={1}>
                    {ticket.unreadForStaff ? '● ' : ''}
                    {ticket.raisedByName} · {humanise(ticket.raisedByRole === 'restaurant_owner' ? 'partner' : ticket.raisedByRole)}
                  </Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {[ticket.kitchens?.join(', '), ticket.riderCode, ticket.orderNumber ? `#${ticket.orderNumber}` : null, ticket.subject]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={s.meta}>{timeAgo(ticket.lastMessageAt || ticket.createdAt)}</Text>
                  {ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? <Badge label={ticket.status} /> : null}
                  {ticket.priority === 'HIGH' ? <Badge label="High" tone="danger" /> : null}
                </View>
              </View>
              <Text style={[s.body, ticket.unreadForStaff && { color: c.text.primary, fontWeight: tokens.font.weight.bold }]} numberOfLines={2}>
                {ticket.preview || ticket.message}
              </Text>
              {waiting ? (
                <Text style={[s.meta, waited >= 10 && { color: c.state.danger, fontWeight: tokens.font.weight.bold }]}>
                  Waiting for reply · {waited} min
                </Text>
              ) : null}
            </Card>
          );
        })}
      </KeyboardAwareScrollView>

      <TicketSheet id={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} />
    </View>
  );
};

/** One help chat, WhatsApp-like: the thread, a reply box pinned at the bottom, and the person's details. */
const TicketSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { api, can } = useSession();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const readUpTo = useRef('');
  const resource = useResource(() => api.get<any>(`/admin/support/tickets/${id}`), [id], { enabled: Boolean(id) });
  const ticket = resource.data?.ticket;
  const order = resource.data?.order;
  const raiser = resource.data?.raiser;
  const canManage = can('support.tickets.manage');
  const active = ticket && ['OPEN', 'IN_PROGRESS'].includes(ticket.status);

  // "Seen" for the person: once per new message of theirs while this chat is open.
  useEffect(() => {
    if (!id || !ticket?.unreadForStaff || readUpTo.current === `${id}|${ticket.lastMessageAt}`) return;
    readUpTo.current = `${id}|${ticket.lastMessageAt}`;
    void api.post(`/admin/support/tickets/${id}/read`, {}).then(onChanged, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ticket?.lastMessageAt, ticket?.unreadForStaff]);

  useEffect(() => {
    setReply('');
    setRecordOpen(false);
  }, [id]);

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/support/tickets/${id}/reply`, { body: reply.trim() });
      setReply('');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not send the reply', err?.message || 'Nothing was sent.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      await api.post(`/admin/support/tickets/${id}/status`, { status });
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  // Resolving moves the chat to the person's History: asked first, never one tap away from Send (round 6).
  const resolve = () =>
    Alert.alert('Mark this chat solved?', 'It moves to their History. They can write again any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark solved', onPress: () => void setStatus('RESOLVED') }
    ]);

  // Every message in order: the first one, then the replies; the person's on the left.
  const thread = ticket
    ? [{ at: ticket.createdAt, byUserId: ticket.raisedByUserId, byName: ticket.raisedByName, body: ticket.message }, ...(ticket.replies || [])]
    : [];
  const lastStaff = [...thread].reverse().find((m: any) => m.byUserId !== ticket?.raisedByUserId);

  return (
    <Sheet
      visible={Boolean(id)}
      onClose={onClose}
      scrollToEnd
      title={ticket ? `${ticket.raisedByName} · ${humanise(ticket.raisedByRole === 'restaurant_owner' ? 'partner' : ticket.raisedByRole)}` : 'Help chat'}
      subtitle={ticket ? `${ticket.subject} · ${humanise(ticket.status)}` : undefined}
      footer={
        ticket && canManage ? (
          active ? (
            <View style={{ gap: tokens.space[2] }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.quickRow}>
                {QUICK_REPLIES.map(text => (
                  <TouchableOpacity key={text} style={s.quick} onPress={() => setReply(text)} accessibilityRole="button">
                    <Text style={s.quickText}>{text}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={s.composer}>
                <TextInput
                  style={s.composerInput}
                  value={reply}
                  onChangeText={setReply}
                  placeholder="Write a reply"
                  placeholderTextColor={c.text.muted}
                  multiline
                  maxLength={2000}
                />
                <Button label="Send" loading={busy} disabled={!reply.trim()} onPress={send} />
              </View>
            </View>
          ) : (
            <View style={s.actionRow}>
              <Button label="Reopen" variant="secondary" full loading={busy} onPress={() => setStatus('IN_PROGRESS')} />
              {ticket.status !== 'CLOSED' ? (
                <Button label="Close for good" variant="ghost" full loading={busy} onPress={() => setStatus('CLOSED')} />
              ) : null}
            </View>
          )
        ) : undefined
      }
    >
      <ResourceError resource={resource} what="This chat" />
      {resource.loading && !resource.data ? <Loading /> : null}
      {resource.data ? (
        <>
          <View style={s.toolRow}>
            {ticket.contactPhone ? (
              <Button label="Call" variant="secondary" size="sm" onPress={() => void Linking.openURL(`tel:${ticket.contactPhone}`)} />
            ) : null}
            <Button label={recordOpen ? 'Hide profile' : 'Open profile'} variant="secondary" size="sm" onPress={() => setRecordOpen(v => !v)} />
            <Button label={aboutOpen ? 'Hide details' : 'Details'} variant="secondary" size="sm" onPress={() => setAboutOpen(v => !v)} />
            {canManage && active ? <Button label="Resolve" variant="success" size="sm" onPress={resolve} /> : null}
          </View>

          {recordOpen && raiser?.record ? <PersonDocuments kind={raiser.record.kind} id={raiser.record.id} /> : null}

          {aboutOpen ? (
            <Card>
              <KeyValue label="Category" value={humanise(ticket.category)} />
              <KeyValue label="Contact" value={ticket.contactPhone} />
              {raiser?.kitchens?.length ? <KeyValue label="Kitchen" value={raiser.kitchens.join(', ')} /> : null}
              {raiser?.riderCode ? <KeyValue label="Rider" value={raiser.riderCode} /> : null}
              <KeyValue label="Earlier requests" value={String(raiser?.earlierRequests ?? 0)} />
              <KeyValue label="Raised" value={formatDateTime(ticket.createdAt)} />
              {ticket.appVersion ? <KeyValue label="App version" value={ticket.appVersion} /> : null}
              {ticket.resolvedBy ? (
                <KeyValue label="Closed by" value={ticket.resolvedBy === 'USER' ? 'The person (marked solved)' : 'Operations'} />
              ) : null}
              {order ? (
                <>
                  <Divider />
                  <KeyValue label="Order" value={`#${order.order?.orderNumber}`} tone="strong" />
                  <KeyValue label="Status" value={humanise(order.order?.status)} />
                  <KeyValue label="Restaurant" value={order.restaurant?.name} />
                  <KeyValue label="Delivery partner" value={order.rider?.fullName || 'Not assigned'} />
                  <KeyValue label="Placed" value={formatDateTime(order.order?.createdAt)} />
                </>
              ) : null}
              {/* What they read in the help chat before asking for a person (B8). */}
              {(ticket.helpChat || []).length > 0 ? (
                <>
                  <Divider />
                  <Text style={s.cardHeading}>Before they asked</Text>
                  {(ticket.helpChat || []).map((step: any, index: number) => (
                    <View key={index} style={s.replyRow}>
                      <Text style={s.replyWho}>{step.question}</Text>
                      <Text style={s.replyBody}>{step.answer}</Text>
                    </View>
                  ))}
                </>
              ) : null}
            </Card>
          ) : null}

          {thread.map((entry: any, index: number) => {
            const theirs = entry.byUserId === ticket.raisedByUserId;
            return (
              <View key={index} style={[s.bubble, theirs ? s.bubbleTheirs : s.bubbleStaff]}>
                {!theirs ? <Text style={s.replyWho}>{entry.byName}</Text> : null}
                <Text style={s.replyBody}>{entry.body}</Text>
                <Text style={s.bubbleMeta}>
                  {timeAgo(entry.at)}
                  {entry === lastStaff && ticket.userReadAt && ticket.userReadAt >= entry.at ? '  ·  Seen' : ''}
                </Text>
              </View>
            );
          })}
        </>
      ) : null}
    </Sheet>
  );
};

const SosTab: React.FC = () => {
  const { api, can } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useResource(() => api.get<any>('/admin/sos'), []);
  const alerts = list.data?.alerts || [];
  const canManage = can('support.tickets.manage', 'users.drivers.manage');

  const update = async (alert: any, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    setBusyId(alert.id);
    try {
      await api.post(`/admin/sos/${alert.id}/status`, { status });
      await list.reload();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <KeyboardAwareScrollView bottomOffset={24}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
    >
      {list.loading && alerts.length === 0 ? <Loading /> : null}
      {!list.loading && alerts.length === 0 ? (
        <EmptyState title="No SOS alerts" message="Riders can raise one from the Safety screen in their app." icon={<TriangleAlert size={34} color={c.text.muted} />} />
      ) : null}

      {alerts.map((alert: any) => (
        <Card key={alert.id}>
          <View style={s.rowTop}>
            <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
              <Text style={s.title} numberOfLines={1}>
                {humanise(alert.category)}
              </Text>
              <Text style={s.sub} numberOfLines={1}>
                {alert.riderName} · {alert.riderPhone || 'no phone on file'}
              </Text>
            </View>
            <Badge label={alert.status} tone={alert.status === 'OPEN' ? 'danger' : alert.status === 'RESOLVED' ? 'success' : 'warning'} />
          </View>

          {alert.note ? <Text style={s.body}>{alert.note}</Text> : null}
          {alert.coordinates ? (
            <KeyValue label="Last position" value={`${alert.coordinates.latitude.toFixed(4)}, ${alert.coordinates.longitude.toFixed(4)}`} />
          ) : null}
          <KeyValue label="Raised" value={formatDateTime(alert.raisedAt)} />

          {canManage && alert.status !== 'RESOLVED' ? (
            <>
              <Divider />
              <View style={s.actionRow}>
                {alert.status === 'OPEN' ? (
                  <Button label="Acknowledge" variant="secondary" full loading={busyId === alert.id} onPress={() => update(alert, 'ACKNOWLEDGED')} />
                ) : null}
                <Button label="Mark resolved" variant="success" full loading={busyId === alert.id} onPress={() => update(alert, 'RESOLVED')} />
              </View>
            </>
          ) : null}
        </Card>
      ))}
    </KeyboardAwareScrollView>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2], paddingBottom: tokens.space[8] },
  summary: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs, color: c.text.muted, marginBottom: tokens.space[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  body: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: tokens.space[3], lineHeight: 19 },
  meta: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: tokens.space[3] },
  cardHeading: {
    fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  message: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 20 },
  muted: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.muted },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  replyRow: {
    backgroundColor: c.bg.sunken,
    borderRadius: tokens.radius.md,
    padding: tokens.space[3],
    marginTop: tokens.space[2]
  },
  replyRowStaff: { backgroundColor: c.brand.amberSoft },
  replyWho: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xxs, color: c.text.muted },
  replyBody: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.sm, color: c.text.primary, marginTop: 4, lineHeight: 19 },
  search: {
    fontFamily: FONT_FAMILY,
    fontSize: tokens.font.size.sm,
    color: c.text.primary,
    backgroundColor: c.bg.card,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space[3],
    paddingVertical: tokens.space[2],
    marginBottom: tokens.space[3]
  },
  bubble: { borderRadius: tokens.radius.lg, padding: tokens.space[3], marginTop: tokens.space[2], maxWidth: '86%' },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: c.bg.sunken, borderBottomLeftRadius: 4 },
  bubbleStaff: { alignSelf: 'flex-end', backgroundColor: c.brand.amberSoft, borderBottomRightRadius: 4 },
  bubbleMeta: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 4, alignSelf: 'flex-end' },
  quickRow: { gap: tokens.space[2] },
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2], marginBottom: tokens.space[2] },
  quick: {
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space[3],
    paddingVertical: 6,
    backgroundColor: c.bg.card
  },
  quickText: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs, color: c.text.secondary },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space[2] },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    fontFamily: FONT_FAMILY,
    fontSize: tokens.font.size.base,
    color: c.text.primary,
    backgroundColor: c.bg.card,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space[3],
    paddingVertical: 10
  }
});
