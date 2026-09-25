import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking } from 'react-native';
import { Sheet, Card, KeyValue, Divider, Badge, Button, Field, Loading, EmptyState, Segmented, CheckRow } from './ui';
import { tokens, formatMoney, formatDateTime, humanise, toneForStatus } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

/**
 * One order, whole.
 *
 * This is the screen the console exists for: the customer, the restaurant, the
 * delivery partner, every line of the bill, the timeline, and anything raised
 * against it afterwards — in one place, so nobody has to hold four screens in
 * their head to answer "what happened to this order?".
 *
 * Used from Orders, Live Deliveries and a refund case, because all three
 * ultimately want the same view.
 */
const CLOSED = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

export const OrderDetailSheet: React.FC<{
  orderId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ orderId, onClose, onChanged }) => {
  const { api, can } = useSession();
  const [action, setAction] = useState<'none' | 'refund' | 'cancel' | 'unassign' | 'reassign' | 'deliver' | 'kitchen'>('none');
  const [handoverNote, setHandoverNote] = useState('');
  const [pickedRiderId, setPickedRiderId] = useState<string | null>(null);
  const [cashCollectedBy, setCashCollectedBy] = useState<'RIDER' | 'NONE' | ''>('');
  const [countAsNoShow, setCountAsNoShow] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const resource = useResource(
    () => api.get<any>(`/admin/orders/${orderId}`),
    [orderId],
    { enabled: Boolean(orderId) }
  );

  // Free, approved, on-shift riders: the only ones the server will accept.
  const riders = useResource(
    () => api.get<any>('/admin/drivers?status=ONLINE&pageSize=100'),
    [action],
    { enabled: action === 'reassign' }
  );
  const freeRiders = ((riders.data?.drivers || []) as any[]).filter(
    r => r.kycStatus === 'ACTIVE' && !r.isBlocked && !r.activeOrderId && r.id !== resource.data?.order?.riderId
  );

  const resetForms = () => {
    setAction('none');
    setReason('');
    setAmount('');
    setHandoverNote('');
    setPickedRiderId(null);
    setCashCollectedBy('');
    setCountAsNoShow(false);
  };

  const close = () => {
    resetForms();
    onClose();
  };

  /** One path for the three road actions: send, tell staff the server's words, refresh. */
  const rescue = async (send: () => Promise<any>, done: string) => {
    setBusy(true);
    try {
      const result = await send();
      const refused = result?.outcome === 'REFUSED_AT_DOOR';
      Alert.alert(
        refused ? 'Closed as refused' : 'Done',
        refused ? 'Nothing was booked to the rider. A case was opened in Support for the kitchen\'s loss.' : done
      );
      resetForms();
      await resource.reload();
      onChanged?.();
    } catch (err: any) {
      Alert.alert('Not changed', err?.message || 'The order was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const submitUnassign = () => {
    if (reason.trim().length < 3) {
      Alert.alert('A reason is required', 'Record why the trip is being taken off the rider.');
      return;
    }
    void rescue(
      () => api.post<any>(`/admin/orders/${orderId}/unassign-rider`, { reason: reason.trim(), countAsNoShow }),
      'The trip is back on offer to nearby riders.');
  };

  const submitReassign = () => {
    const afterPickup = Boolean(resource.data?.order?.pickedUpAt);
    if (!pickedRiderId) {
      Alert.alert('Choose a rider', 'Pick the rider who will take this trip.');
      return;
    }
    if (reason.trim().length < 3) {
      Alert.alert('A reason is required', 'Record why the trip is being moved.');
      return;
    }
    if (afterPickup && handoverNote.trim().length < 5) {
      Alert.alert('Where is the food?', 'Write where the new rider should collect the bag from the first rider.');
      return;
    }
    void rescue(
      () =>
        api.post<any>(`/admin/orders/${orderId}/reassign-rider`, {
          riderId: pickedRiderId,
          reason: reason.trim(),
          ...(afterPickup ? { handoverNote: handoverNote.trim() } : {})
        }),
      'Both riders have been told.'
    );
  };

  /** A4: the next kitchen step, for a kitchen that forgot to tap. */
  const KITCHEN_NEXT: Record<string, { status: string; label: string }> = {
    ORDER_PLACED: { status: 'ACCEPTED', label: 'Accept for the kitchen' },
    ACCEPTED: { status: 'PREPARING', label: 'Mark as cooking' },
    PREPARING: { status: 'READY_FOR_PICKUP', label: 'Mark food ready' }
  };
  const submitKitchenStep = () => {
    const next = KITCHEN_NEXT[resource.data?.order?.status];
    if (!next) return;
    if (reason.trim().length < 3) {
      Alert.alert('A reason is required', 'Record why you are doing this for the kitchen, e.g. "Kitchen confirmed on call".');
      return;
    }
    void rescue(
      () =>
        api.put<any>(`/admin/orders/${orderId}/status`, {
          status: next.status,
          reason: reason.trim(),
          ...(next.status === 'ACCEPTED' ? { preparationMinutes: 20 } : {})
        }),
      'Done. The customer and any waiting rider are told.'
    );
  };

  const submitDeliver = () => {
    const isCash = resource.data?.order?.paymentMethod === 'CASH_ON_DELIVERY';
    if (reason.trim().length < 5) {
      Alert.alert('A reason is required', 'Record how you confirmed the customer has the food.');
      return;
    }
    if (isCash && !cashCollectedBy) {
      Alert.alert('Who has the cash?', 'Say whether the rider collected the cash from the customer.');
      return;
    }
    void rescue(
      () =>
        api.post<any>(`/admin/orders/${orderId}/mark-delivered`, {
          reason: reason.trim(),
          ...(isCash ? { cashCollectedBy } : {})
        }),
      'Marked delivered. Earnings and the rider\'s cash are recorded.'
    );
  };

  const submitRefund = async () => {
    if (!resource.data) return;
    setBusy(true);
    try {
      const result = await api.post<any>(`/admin/orders/${orderId}/refund`, {
        ...(amount ? { amount: Number(amount) } : {}),
        reason: reason || 'Admin dispute resolution'
      });
      Alert.alert('Refund issued', `${formatMoney(result.refundAmount)} credited to the customer's wallet.`);
      setAction('none');
      await resource.reload();
      onChanged?.();
    } catch (err: any) {
      Alert.alert('Refund failed', err?.message || 'Nothing was refunded.');
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async () => {
    if (!reason.trim()) {
      Alert.alert('A reason is required', 'Record why this order is being cancelled.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/orders/${orderId}/cancel`, { reason, refund: true });
      Alert.alert('Order cancelled', 'The customer and the restaurant have been told.');
      setAction('none');
      setReason('');
      await resource.reload();
      onChanged?.();
    } catch (err: any) {
      Alert.alert('Could not cancel', err?.message || 'The order was not changed.');
    } finally {
      setBusy(false);
    }
  };

  const data = resource.data;
  const order = data?.order;

  return (
    <Sheet
      visible={Boolean(orderId)}
      onClose={close}
      title={order ? `Order #${order.orderNumber}` : 'Order'}
      subtitle={order ? `${humanise(order.status)} · ${formatDateTime(order.createdAt)}` : undefined}
      footer={
        order && action === 'none' ? (
          <>
            {can('orders.deliveries.manage') && order.riderId && !order.pickedUpAt && !CLOSED.includes(order.status) ? (
              <Button label="Take trip off rider" variant="secondary" full onPress={() => setAction('unassign')} />
            ) : null}
            {can('orders.deliveries.manage') && !CLOSED.includes(order.status) ? (
              <Button
                label={order.riderId ? 'Give to another rider' : 'Give to a rider'}
                variant="secondary"
                full
                onPress={() => setAction('reassign')}
              />
            ) : null}
            {can('orders.status.update') && ['ORDER_PLACED', 'ACCEPTED', 'PREPARING'].includes(order.status) ? (
              <Button label="Kitchen step" variant="secondary" full onPress={() => setAction('kitchen')} />
            ) : null}
            {can('orders.status.update') && order.status === 'OUT_FOR_DELIVERY' ? (
              <Button label="Mark delivered" full onPress={() => setAction('deliver')} />
            ) : null}
            {can('orders.cancel') && !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status) ? (
              <Button label="Cancel order" variant="danger" full onPress={() => setAction('cancel')} />
            ) : null}
            {can('finance.refunds.manage', 'orders.refunds.handle') && order.status !== 'REFUNDED' ? (
              <Button
                label="Issue refund"
                full
                onPress={() => {
                  setAmount(String(order.bill?.totalAmount ?? ''));
                  setAction('refund');
                }}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {resource.loading && !data ? <Loading label="Opening the order…" /> : null}
      {!resource.loading && !data ? (
        <EmptyState
          title={resource.denied ? 'Not available on your role' : 'Could not open this order'}
          message={resource.error || undefined}
        />
      ) : null}

      {data && action === 'refund' ? (
        <Card>
          <Text style={s.blockTitle}>Issue a refund</Text>
          <Text style={s.blockBody}>
            The amount is credited to the customer's Quick Bites wallet immediately and recorded against this order.
          </Text>
          <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" hint={`Order total ${formatMoney(order.bill?.totalAmount)}`} />
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Missing item, spilled food, late delivery…" multiline />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button label="Credit the wallet" full loading={busy} onPress={submitRefund} />
          </View>
        </Card>
      ) : null}

      {data && action === 'unassign' ? (
        <Card>
          <Text style={s.blockTitle}>Take this trip off {order.riderName || 'the rider'}</Text>
          <Text style={s.blockBody}>
            Use this when the rider cannot collect: a dead phone, a breakdown, no answer. The trip goes back on offer to
            nearby riders straight away and the kitchen carries on cooking.
          </Text>
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Phone switched off, bike broke down…" multiline />
          <CheckRow
            title="Count this as a no-show for the rider"
            checked={countAsNoShow}
            onToggle={() => setCountAsNoShow(v => !v)}
          />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button label="Take it off" variant="danger" full loading={busy} onPress={submitUnassign} />
          </View>
        </Card>
      ) : null}

      {data && action === 'reassign' ? (
        <Card>
          <Text style={s.blockTitle}>Give this trip to a rider</Text>
          <Text style={s.blockBody}>
            {order.pickedUpAt
              ? 'The food is already with the first rider. The new rider collects it from them, so say where. The first rider gets a no-show.'
              : 'The new rider goes to the restaurant. Only free, approved riders who are on shift are listed.'}
            {order.paymentMethod === 'CASH_ON_DELIVERY' ? ' This is a cash order: a rider holding too much cash will be refused.' : ''}
          </Text>
          {riders.loading ? <Loading label="Finding free riders…" /> : null}
          {!riders.loading && riders.error ? (
            <EmptyState title="Could not load riders" message={riders.error} action={<Button label="Try again" variant="secondary" onPress={() => void riders.reload()} />} />
          ) : null}
          {!riders.loading && !riders.error && freeRiders.length === 0 ? (
            <EmptyState title="No free rider on shift" message="Every approved rider on shift is busy or offline. Try again in a minute." />
          ) : null}
          {freeRiders.map(r => (
            <CheckRow
              key={r.id}
              title={`${r.fullName}${r.driverCode ? ` · ${r.driverCode}` : ''}`}
              description={`${r.phone || ''} · holding ${formatMoney(r.codCashInHand)} cash`}
              checked={pickedRiderId === r.id}
              onToggle={() => setPickedRiderId(r.id)}
            />
          ))}
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="First rider's bike broke down…" multiline />
          {order.pickedUpAt ? (
            <Field
              label="Where to collect the bag"
              value={handoverNote}
              onChangeText={setHandoverNote}
              placeholder="Outside the petrol pump on 5th Main, first rider waiting"
              multiline
            />
          ) : null}
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button label="Give the trip" full loading={busy} onPress={submitReassign} />
          </View>
        </Card>
      ) : null}

      {data && action === 'kitchen' && KITCHEN_NEXT[order.status] ? (
        <Card>
          <Text style={s.blockTitle}>{KITCHEN_NEXT[order.status].label}</Text>
          <Text style={s.blockBody}>
            For when the kitchen has done it but forgot to tap, for example the rider is waiting and the food is on the
            counter. Confirm with the kitchen first. Your name and reason are recorded.
          </Text>
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Kitchen confirmed on call" multiline />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button label={KITCHEN_NEXT[order.status].label} full loading={busy} onPress={submitKitchenStep} />
          </View>
        </Card>
      ) : null}

      {data && action === 'deliver' ? (
        <Card>
          <Text style={s.blockTitle}>Mark delivered</Text>
          <Text style={s.blockBody}>
            Only when the customer cannot read out their code and you have confirmed they have the food, for example on a
            call. Your name and reason are recorded.
          </Text>
          <Field label="How you confirmed it" value={reason} onChangeText={setReason} placeholder="Called the customer, they have the food" multiline />
          {order.paymentMethod === 'CASH_ON_DELIVERY' ? (
            <>
              <Text style={s.blockBody}>This is a cash order. Did the rider collect the cash?</Text>
              <Segmented
                options={[
                  { key: 'RIDER', label: 'Yes, rider has the cash' },
                  { key: 'NONE', label: 'No, customer refused' }
                ]}
                value={cashCollectedBy}
                onChange={key => setCashCollectedBy(key as 'RIDER' | 'NONE')}
              />
              {cashCollectedBy === 'NONE' ? (
                <Text style={s.blockBody}>
                  The order is closed as refused, not delivered. Nothing is booked to the rider, and a Support case is
                  opened to decide the kitchen's loss.
                </Text>
              ) : null}
            </>
          ) : null}
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button
              label={cashCollectedBy === 'NONE' ? 'Close as refused' : 'Mark delivered'}
              variant={cashCollectedBy === 'NONE' ? 'danger' : undefined}
              full
              loading={busy}
              onPress={submitDeliver}
            />
          </View>
        </Card>
      ) : null}

      {data && action === 'cancel' ? (
        <Card>
          <Text style={s.blockTitle}>Cancel this order</Text>
          <Text style={s.blockBody}>
            The customer and the restaurant are told straight away. If the order was paid for, the money is returned in
            the same step.
          </Text>
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Restaurant closed, rider unavailable…" multiline />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setAction('none')} />
            <Button label="Cancel and refund" variant="danger" full loading={busy} onPress={submitCancel} />
          </View>
        </Card>
      ) : null}

      {data && action === 'none' ? (
        <>
          <View style={s.badgeRow}>
            <Badge label={order.status} tone={toneForStatus(order.status)} />
            <Badge label={order.paymentStatus} tone={toneForStatus(order.paymentStatus)} />
            <Badge label={order.paymentMethod} tone="neutral" />
            {order.couponCode ? <Badge label={order.couponCode} tone="amber" /> : null}
          </View>

          {/* The relationship, in one card */}
          <Card>
            <Text style={s.cardHeading}>Who was involved</Text>
            <KeyValue label="Customer" value={data.customer?.fullName} tone="strong" />
            <KeyValue label="Phone" value={data.customer?.phone} />
            <KeyValue label="Email" value={data.customer?.email} />
            <Divider />
            <KeyValue label="Restaurant" value={data.restaurant?.name} tone="strong" />
            <KeyValue label="Restaurant phone" value={data.restaurant?.phone} />
            <KeyValue label="Kitchen" value={data.restaurant ? `${humanise(data.restaurant.status)}${data.restaurant.isOpen ? ' · open' : ' · closed'}` : '—'} />
            <Divider />
            <KeyValue label="Delivery partner" value={data.rider?.fullName || 'Not yet assigned'} tone="strong" />
            <KeyValue label="Partner ID" value={data.rider?.driverCode} />
            <KeyValue label="Partner phone" value={data.rider?.phone} />
            {/* A5: one tap to call whoever the problem is with. */}
            <View style={s.callRow}>
              {[
                { label: 'Call customer', phone: data.customer?.phone },
                { label: 'Call kitchen', phone: data.restaurant?.phone },
                { label: 'Call rider', phone: data.rider?.phone }
              ]
                .filter(x => x.phone)
                .map(x => (
                  <Button
                    key={x.label}
                    label={x.label}
                    variant="secondary"
                    onPress={() =>
                      void Linking.openURL(`tel:${String(x.phone).replace(/[^0-9+]/g, '')}`).catch(() =>
                        Alert.alert('Could not start the call', String(x.phone))
                      )
                    }
                  />
                ))}
            </View>
          </Card>

          {/* Items */}
          <Card>
            <Text style={s.cardHeading}>Items</Text>
            {(order.items || []).map((item: any, index: number) => (
              <View key={`${item.dishId}-${index}`} style={s.itemRow}>
                <View style={s.itemQty}>
                  <Text style={s.itemQtyText}>{item.quantity}×</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.selectedOptions?.length ? (
                    <Text style={s.itemUnit}>{item.selectedOptions.map((o: any) => o.optionName).join(' · ')}</Text>
                  ) : null}
                  <Text style={s.itemUnit}>{formatMoney(item.unitPrice, true)} each</Text>
                </View>
                <Text style={s.itemTotal}>{formatMoney(item.totalPrice, true)}</Text>
              </View>
            ))}
          </Card>

          {/* Bill */}
          <Card>
            <Text style={s.cardHeading}>Bill</Text>
            <KeyValue label="Items total" value={formatMoney(order.bill?.itemsTotal, true)} />
            <KeyValue label="GST" value={formatMoney(order.bill?.gstAmount, true)} />
            <KeyValue label="Packaging" value={formatMoney(order.bill?.packagingFee, true)} />
            <KeyValue label="Delivery fee" value={formatMoney(order.bill?.deliveryFee, true)} />
            <KeyValue label="Platform fee" value={formatMoney(order.bill?.platformFee, true)} />
            {order.bill?.couponDiscount ? (
              <KeyValue
                label={order.couponCode ? `Discount (${order.couponCode})` : 'Discount'}
                value={`− ${formatMoney(order.bill.couponDiscount, true)}`}
              />
            ) : null}
            {order.bill?.walletAmountUsed ? (
              <KeyValue label="Paid from wallet" value={formatMoney(order.bill.walletAmountUsed, true)} />
            ) : null}
            <Divider />
            <KeyValue label="Total charged" value={formatMoney(order.bill?.totalAmount, true)} tone="money" />
          </Card>

          {/* Money split */}
          <Card>
            <Text style={s.cardHeading}>Where the money went</Text>
            <KeyValue label="Restaurant payout" value={formatMoney(data.economics?.restaurantPayout, true)} />
            <KeyValue label="Rider payout" value={formatMoney(data.economics?.riderPayout, true)} />
            <KeyValue label="Commission" value={formatMoney(data.economics?.commission, true)} />
            <KeyValue label="GST collected" value={formatMoney(data.economics?.tax, true)} />
            <Divider />
            <KeyValue label="Platform net" value={formatMoney(data.economics?.netRevenue, true)} tone="money" />
          </Card>

          {/* Delivery */}
          <Card>
            <Text style={s.cardHeading}>Delivery</Text>
            <KeyValue label="Address" value={data.delivery?.addressText} />
            <KeyValue label="Distance" value={data.delivery?.distanceKm ? `${data.delivery.distanceKm} km` : '—'} />
            <KeyValue label="Rider stage" value={data.delivery?.riderStage ? humanise(data.delivery.riderStage) : '—'} />
            {data.delivery?.riderCoordinates ? (
              <KeyValue
                label="Last rider position"
                value={`${data.delivery.riderCoordinates.latitude.toFixed(4)}, ${data.delivery.riderCoordinates.longitude.toFixed(4)}`}
              />
            ) : null}
            <KeyValue label="Position updated" value={formatDateTime(data.delivery?.locationUpdatedAt)} />
          </Card>

          {/* Timeline */}
          <Card>
            <Text style={s.cardHeading}>Timeline</Text>
            {(data.timeline || []).map((step: any, index: number) => (
              <View key={`${step.label}-${index}`} style={s.timelineRow}>
                <View style={s.timelineMarker}>
                  <View style={[s.timelineDot, index === (data.timeline.length - 1) && s.timelineDotLast]} />
                  {index < data.timeline.length - 1 ? <View style={s.timelineLine} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: tokens.space[4] }}>
                  <Text style={s.timelineLabel}>{step.label}</Text>
                  <Text style={s.timelineTime}>{formatDateTime(step.at)}</Text>
                  {step.detail ? <Text style={s.timelineDetail}>{step.detail}</Text> : null}
                </View>
              </View>
            ))}
          </Card>

          {/* Rating */}
          {order.rating ? (
            <Card>
              <Text style={s.cardHeading}>Customer review</Text>
              <KeyValue label="Order rating" value={`${order.rating} / 5`} tone="strong" />
              {order.ratingComment ? <Text style={s.quote}>“{order.ratingComment}”</Text> : null}
              {order.riderRating ? <KeyValue label="Rider rating" value={`${order.riderRating} / 5`} /> : null}
            </Card>
          ) : null}

          {/* Anything raised against it */}
          {(data.refundRequests || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>Refund cases</Text>
              {data.refundRequests.map((request: any) => (
                <View key={request.id} style={s.caseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.caseTitle}>{humanise(request.reasonCode)}</Text>
                    <Text style={s.caseBody} numberOfLines={2}>
                      {request.description}
                    </Text>
                    <Text style={s.caseMeta}>
                      Asked for {formatMoney(request.requestedAmount)} · {formatDateTime(request.createdAt)}
                    </Text>
                  </View>
                  <Badge label={request.status} />
                </View>
              ))}
            </Card>
          ) : null}

          {(data.supportTickets || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>Complaints</Text>
              {data.supportTickets.map((ticket: any) => (
                <View key={ticket.id} style={s.caseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.caseTitle}>{ticket.subject}</Text>
                    <Text style={s.caseBody} numberOfLines={2}>
                      {ticket.message}
                    </Text>
                  </View>
                  <Badge label={ticket.status} />
                </View>
              ))}
            </Card>
          ) : null}

          {(data.walletCredits || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>Wallet credits against this order</Text>
              {data.walletCredits.map((tx: any) => (
                <KeyValue key={tx.id} label={formatDateTime(tx.createdAt)} value={formatMoney(tx.amount, true)} tone="money" />
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
};

const s = StyleSheet.create({
  callRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2], marginBottom: tokens.space[3] },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  blockTitle: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.heavy, color: c.text.primary },
  blockBody: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 4, marginBottom: tokens.space[4], lineHeight: 19 },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3], paddingVertical: tokens.space[2] },
  itemQty: {
    minWidth: 32,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: c.bg.sunken,
    alignItems: 'center'
  },
  itemQtyText: { color: c.brand.amberText, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.bold },
  itemName: { color: c.text.primary, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  itemUnit: { color: c.text.muted, fontSize: tokens.font.size.xxs, marginTop: 2 },
  itemTotal: { color: c.text.primary, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold },
  timelineRow: { flexDirection: 'row', gap: tokens.space[3] },
  timelineMarker: { width: 14, alignItems: 'center' },
  timelineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.border.strong, marginTop: 4 },
  timelineDotLast: { backgroundColor: c.brand.amber },
  timelineLine: { flex: 1, width: 1.5, backgroundColor: c.border.subtle, marginVertical: 3 },
  timelineLabel: { color: c.text.primary, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  timelineTime: { color: c.text.muted, fontSize: tokens.font.size.xxs, marginTop: 2 },
  timelineDetail: { color: c.text.secondary, fontSize: tokens.font.size.xs, marginTop: 3 },
  quote: {
    color: c.text.secondary,
    fontSize: tokens.font.size.sm,
    fontStyle: 'italic',
    marginTop: tokens.space[2],
    lineHeight: 20
  },
  caseRow: {
    flexDirection: 'row',
    gap: tokens.space[3],
    alignItems: 'flex-start',
    paddingVertical: tokens.space[2],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  caseTitle: { color: c.text.primary, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  caseBody: { color: c.text.secondary, fontSize: tokens.font.size.xs, marginTop: 3, lineHeight: 17 },
  caseMeta: { color: c.text.muted, fontSize: tokens.font.size.xxs, marginTop: 4 }
});
