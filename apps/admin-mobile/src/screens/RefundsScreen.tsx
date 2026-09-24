import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image, Alert } from 'react-native';
import { Undo2 } from 'lucide-react-native';
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
  ResourceError,
  EmptyState
} from '../components/ui';
import { tokens, formatMoney, humanise, formatDateTime, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

const STAGES = [
  { key: 'ALL', label: 'All' },
  { key: 'REQUESTED', label: 'Requested' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REFUNDED', label: 'Refunded' },
  { key: 'REJECTED', label: 'Rejected' }
];

/**
 * Return and refund cases.
 *
 * A case is worked, not just toggled: the queue shows what was claimed and by
 * whom, the case opens the whole file including anything the customer
 * photographed, and each decision is a step on a record that stays with it.
 */
export const RefundsScreen: React.FC = () => {
  const { api } = useSession();
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useResource(() => api.get<any>(`/admin/refund-requests${query({ status })}`), [status]);
  const requests = list.data?.requests || [];
  const counts = list.data?.counts;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <Segmented options={STAGES} value={status} onChange={setStatus} />
        {counts ? (
          <Text style={s.summary}>
            {counts.requested} waiting · {counts.processing} in progress · {counts.approved} approved ·{' '}
            {counts.refunded} paid
          </Text>
        ) : null}
      </View>

      {list.loading && requests.length === 0 ? <Loading label="Loading refund cases…" /> : null}
      {!list.loading && requests.length === 0 ? (
        <EmptyState
          title={list.denied ? 'Refund cases are not on your role' : 'No refund cases'}
          message={list.error || 'Nothing has been raised against an order.'}
          icon={<Undo2 size={34} color={c.text.muted} />}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {requests.map((request: any) => (
          <Card key={request.id} onPress={() => setOpenId(request.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {humanise(request.reasonCode)}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  #{request.orderNumber} · {request.customerName}
                </Text>
              </View>
              <Badge label={request.status} />
            </View>
            <Text style={s.body} numberOfLines={2}>
              {request.description}
            </Text>
            <View style={s.rowBottom}>
              <Text style={s.amount}>
                {formatMoney(request.approvedAmount ?? request.requestedAmount)}
                <Text style={s.amountHint}> of {formatMoney(request.orderTotal)}</Text>
              </Text>
              <Text style={s.meta}>
                {request.raisedByRole === 'rider' ? 'Raised by the rider' : 'Raised by the customer'} ·{' '}
                {timeAgo(request.createdAt)}
              </Text>
            </View>
          </Card>
        ))}
      </ScrollView>

      <RefundCaseSheet id={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} />
    </View>
  );
};

const RefundCaseSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void }> = ({
  id,
  onClose,
  onChanged
}) => {
  const { api, can } = useSession();
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const resource = useResource(() => api.get<any>(`/admin/refund-requests/${id}`), [id], { enabled: Boolean(id) });
  const request = resource.data?.request;
  const order = resource.data?.order;

  const decide = async (action: 'PROCESSING' | 'APPROVE' | 'REJECT' | 'REFUND') => {
    if (action === 'REJECT' && !note.trim()) {
      Alert.alert('A reason is required', 'The customer is told why their request was rejected.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<any>(`/admin/refund-requests/${id}/decision`, {
        action,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(amount ? { amount: Number(amount) } : {})
      });
      setNote('');
      await resource.reload();
      onChanged();
      if (action === 'REFUND') {
        Alert.alert('Refund paid', `${formatMoney(result.refundedAmount)} credited to the customer's wallet.`);
      }
    } catch (err: any) {
      Alert.alert('Could not update the case', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const isClosed = request?.status === 'REFUNDED' || request?.status === 'REJECTED';

  return (
    <Sheet
      visible={Boolean(id)}
      onClose={onClose}
      title={request ? humanise(request.reasonCode) : 'Refund case'}
      subtitle={request ? `Order #${request.orderNumber} · ${humanise(request.status)}` : undefined}
      footer={
        request && !isClosed && can('finance.refunds.manage', 'orders.refunds.handle') ? (
          <>
            <Button label="Reject" variant="danger" full loading={busy} onPress={() => decide('REJECT')} />
            {request.status === 'APPROVED' ? (
              <Button label="Pay the refund" variant="success" full loading={busy} onPress={() => decide('REFUND')} />
            ) : (
              <Button label="Approve" full loading={busy} onPress={() => decide('APPROVE')} />
            )}
          </>
        ) : undefined
      }
    >
      <ResourceError resource={resource} what="This refund case" />
      {resource.loading && !resource.data ? <Loading /> : null}
      {resource.data ? (
        <>
          <Card>
            <Text style={s.cardHeading}>What was claimed</Text>
            <Text style={s.claim}>{request.description}</Text>
            <Divider />
            <KeyValue label="Requested" value={formatMoney(request.requestedAmount)} tone="money" />
            {request.approvedAmount !== undefined ? (
              <KeyValue label="Approved" value={formatMoney(request.approvedAmount)} tone="money" />
            ) : null}
            <KeyValue label="Order total" value={formatMoney(request.orderTotal)} />
            <KeyValue label="Raised by" value={`${request.raisedByName} (${humanise(request.raisedByRole)})`} />
            <KeyValue label="Raised" value={formatDateTime(request.createdAt)} />
          </Card>

          {(request.attachments || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>What they sent</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.attachments}>
                {request.attachments.map((uri: string, index: number) => (
                  <Image key={index} source={{ uri }} style={s.attachment} resizeMode="cover" />
                ))}
              </ScrollView>
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardHeading}>Everyone involved</Text>
            <KeyValue label="Customer" value={request.customerName} tone="strong" />
            <KeyValue label="Customer phone" value={request.customerPhone} />
            <KeyValue label="Restaurant" value={request.restaurantName} />
            <KeyValue label="Delivery partner" value={request.riderName || 'Not assigned'} />
            {order ? (
              <>
                <Divider />
                <KeyValue label="Order status" value={humanise(order.order?.status)} />
                <KeyValue label="Payment" value={`${humanise(order.order?.paymentStatus)} · ${humanise(order.order?.paymentMethod)}`} />
                <KeyValue label="Placed" value={formatDateTime(order.order?.createdAt)} />
                <KeyValue label="Delivered" value={formatDateTime(order.order?.deliveredAt)} />
              </>
            ) : null}
          </Card>

          <Card>
            <Text style={s.cardHeading}>Case history</Text>
            {(request.timeline || []).map((event: any, index: number) => (
              <View key={index} style={s.timelineRow}>
                <Badge label={event.status} />
                <View style={{ flex: 1 }}>
                  <Text style={s.timelineWho}>{event.byName || 'System'}</Text>
                  <Text style={s.timelineWhen}>{formatDateTime(event.at)}</Text>
                  {event.note ? <Text style={s.timelineNote}>{event.note}</Text> : null}
                </View>
              </View>
            ))}
          </Card>

          {!isClosed && can('finance.refunds.manage', 'orders.refunds.handle') ? (
            <Card>
              <Text style={s.cardHeading}>Your decision</Text>
              <Field
                label="Amount to refund (₹)"
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder={String(request.requestedAmount)}
                hint={`Leave blank to use ${formatMoney(request.approvedAmount ?? request.requestedAmount)}. A partial refund leaves the order delivered.`}
              />
              <Field
                label="Note"
                value={note}
                onChangeText={setNote}
                placeholder="Restaurant confirmed the item was missing."
                multiline
              />
              {request.status === 'REQUESTED' ? (
                <Button label="Mark as being looked into" variant="secondary" loading={busy} onPress={() => decide('PROCESSING')} />
              ) : null}
            </Card>
          ) : null}

          {isClosed ? (
            <Card>
              <Text style={s.cardHeading}>Closed</Text>
              <KeyValue label="Outcome" value={humanise(request.status)} tone="strong" />
              <KeyValue label="Handled by" value={request.handledByName} />
              <KeyValue label="Closed" value={formatDateTime(request.resolvedAt)} />
              {request.decisionNote ? <Text style={s.claim}>{request.decisionNote}</Text> : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
};

const s = StyleSheet.create({
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  summary: { fontSize: tokens.font.size.xs, color: c.text.muted, marginBottom: tokens.space[3] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  body: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: tokens.space[3], lineHeight: 19 },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: tokens.space[3],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: tokens.space[3]
  },
  amount: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.heavy, color: c.brand.amberText },
  amountHint: { fontSize: tokens.font.size.xxs, fontWeight: tokens.font.weight.regular, color: c.text.muted },
  meta: { flexShrink: 1, fontSize: tokens.font.size.xxs, color: c.text.muted, textAlign: 'right' },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  claim: { fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 20, marginTop: tokens.space[2] },
  attachments: { gap: tokens.space[3] },
  attachment: { width: 112, height: 112, borderRadius: tokens.radius.md, backgroundColor: c.bg.sunken },
  timelineRow: {
    flexDirection: 'row',
    gap: tokens.space[3],
    alignItems: 'flex-start',
    paddingVertical: tokens.space[2],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  timelineWho: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold },
  timelineWhen: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2 },
  timelineNote: { fontSize: tokens.font.size.xs, color: c.text.secondary, marginTop: 4, lineHeight: 17 }
});
