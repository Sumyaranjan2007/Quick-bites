import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
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
  NoAccess
} from '../components/ui';
import { tokens, humanise, formatDateTime, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

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

const TicketsTab: React.FC = () => {
  const { api } = useSession();
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useResource(() => api.get<any>(`/admin/support/tickets${query({ status })}`), [status]);
  const tickets = list.data?.tickets || [];
  const counts = list.data?.counts;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'OPEN', label: 'New' },
            { key: 'IN_PROGRESS', label: 'In progress' },
            { key: 'RESOLVED', label: 'Resolved' },
            { key: 'CLOSED', label: 'Closed' }
          ]}
          value={status}
          onChange={setStatus}
        />
        {counts ? (
          <Text style={s.summary}>
            {counts.open} new · {counts.inProgress} in progress · {counts.resolved} resolved
          </Text>
        ) : null}
      </View>

      {list.loading && tickets.length === 0 ? <Loading /> : null}
      {!list.loading && tickets.length === 0 ? (
        <EmptyState title="No complaints" message={list.error || 'Nothing has been raised from the apps.'} icon={<LifeBuoy size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {tickets.map((ticket: any) => (
          <Card key={ticket.id} onPress={() => setOpenId(ticket.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {ticket.subject}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {ticket.raisedByName} · {humanise(ticket.raisedByRole)}
                  {ticket.orderNumber ? ` · #${ticket.orderNumber}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge label={ticket.status} />
                {ticket.priority === 'HIGH' ? <Badge label="High" tone="danger" /> : null}
              </View>
            </View>
            <Text style={s.body} numberOfLines={2}>
              {ticket.message}
            </Text>
            <Text style={s.meta}>
              {timeAgo(ticket.createdAt)} · {ticket.replies?.length || 0} repl{ticket.replies?.length === 1 ? 'y' : 'ies'}
            </Text>
          </Card>
        ))}
      </ScrollView>

      <TicketSheet id={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} />
    </View>
  );
};

const TicketSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { api, can } = useSession();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const resource = useResource(() => api.get<any>(`/admin/support/tickets/${id}`), [id], { enabled: Boolean(id) });
  const ticket = resource.data?.ticket;
  const order = resource.data?.order;
  const canManage = can('support.tickets.manage');

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

  return (
    <Sheet
      visible={Boolean(id)}
      onClose={onClose}
      title={ticket?.subject || 'Complaint'}
      subtitle={ticket ? `${ticket.raisedByName} · ${humanise(ticket.status)}` : undefined}
      footer={
        ticket && canManage ? (
          <>
            {ticket.status !== 'RESOLVED' ? (
              <Button label="Mark resolved" variant="success" full loading={busy} onPress={() => setStatus('RESOLVED')} />
            ) : (
              <Button label="Close" variant="secondary" full loading={busy} onPress={() => setStatus('CLOSED')} />
            )}
          </>
        ) : undefined
      }
    >
      {resource.loading && !resource.data ? <Loading /> : null}
      {resource.data ? (
        <>
          <Card>
            <Text style={s.cardHeading}>What they said</Text>
            <Text style={s.message}>{ticket.message}</Text>
            <Divider />
            <KeyValue label="Category" value={humanise(ticket.category)} />
            <KeyValue label="Raised by" value={`${ticket.raisedByName} (${humanise(ticket.raisedByRole)})`} />
            <KeyValue label="Contact" value={ticket.contactPhone} />
            <KeyValue label="Raised" value={formatDateTime(ticket.createdAt)} />
          </Card>

          {order ? (
            <Card>
              <Text style={s.cardHeading}>The order it is about</Text>
              <KeyValue label="Order" value={`#${order.order?.orderNumber}`} tone="strong" />
              <KeyValue label="Status" value={humanise(order.order?.status)} />
              <KeyValue label="Restaurant" value={order.restaurant?.name} />
              <KeyValue label="Delivery partner" value={order.rider?.fullName || 'Not assigned'} />
              <KeyValue label="Placed" value={formatDateTime(order.order?.createdAt)} />
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardHeading}>Conversation</Text>
            {(ticket.replies || []).length === 0 ? <Text style={s.muted}>No replies yet.</Text> : null}
            {(ticket.replies || []).map((entry: any, index: number) => (
              <View key={index} style={[s.replyRow, entry.byRole !== 'customer' && s.replyRowStaff]}>
                <Text style={s.replyWho}>
                  {entry.byName} · {timeAgo(entry.at)}
                </Text>
                <Text style={s.replyBody}>{entry.body}</Text>
              </View>
            ))}

            {canManage ? (
              <>
                <Divider />
                <Field label="Reply" value={reply} onChangeText={setReply} placeholder="Sorry about that — we have credited your wallet." multiline />
                <Button label="Send reply" loading={busy} onPress={send} />
              </>
            ) : null}
          </Card>
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
    <ScrollView
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
    </ScrollView>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2], paddingBottom: tokens.space[8] },
  summary: { fontSize: tokens.font.size.xs, color: c.text.muted, marginBottom: tokens.space[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  body: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: tokens.space[3], lineHeight: 19 },
  meta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: tokens.space[3] },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  message: { fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 20 },
  muted: { fontSize: tokens.font.size.sm, color: c.text.muted },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  replyRow: {
    backgroundColor: c.bg.sunken,
    borderRadius: tokens.radius.md,
    padding: tokens.space[3],
    marginTop: tokens.space[2]
  },
  replyRowStaff: { backgroundColor: c.brand.amberSoft },
  replyWho: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  replyBody: { fontSize: tokens.font.size.sm, color: c.text.primary, marginTop: 4, lineHeight: 19 }
});
