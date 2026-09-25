import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sheet, Card, KeyValue, Divider, Loading, EmptyState } from './ui';
import { tokens, formatMoney, formatDateTime, humanise } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

export interface StatementOwner {
  ownerType: 'RESTAURANT' | 'RIDER';
  ownerId: string;
  ownerName: string;
}

/**
 * A payee's statement, order by order (A32): the same figures the rider or
 * restaurant sees in their own app, from the same server function. It is what
 * staff read out on a "why was I paid this?" call.
 */
export const StatementSheet: React.FC<{ owner: StatementOwner | null; onClose: () => void }> = ({ owner, onClose }) => {
  const { api } = useSession();
  const resource = useResource<any>(
    () => api.get<any>(`/admin/payouts/statement/${owner?.ownerType}/${owner?.ownerId}`),
    [owner?.ownerType, owner?.ownerId],
    { enabled: Boolean(owner) }
  );
  const st = resource.data?.statement;

  return (
    <Sheet visible={Boolean(owner)} onClose={onClose} title={owner?.ownerName || 'Statement'} subtitle="Statement">
      {resource.loading && !resource.data ? <Loading label="Reading the books…" /> : null}
      {!resource.loading && !resource.data ? (
        <EmptyState title="Could not load the statement" message={resource.error || undefined} />
      ) : null}
      {st ? (
        <>
          <Card>
            <KeyValue label="Orders" value={st.summary.ordersCount} />
            <KeyValue label="Earned" value={formatMoney(st.summary.earned, true)} tone="money" />
            <KeyValue label="Deductions" value={formatMoney(st.summary.deductions, true)} />
            <KeyValue label="Adjustments" value={formatMoney(st.summary.adjustments, true)} />
            <KeyValue label="Already paid" value={formatMoney(st.summary.paid, true)} />
            <Divider />
            <KeyValue label="Payable now" value={formatMoney(st.summary.payable, true)} tone="strong" />
            <KeyValue label={`Held (${st.holdDays} day hold)`} value={formatMoney(st.summary.held, true)} />
            <KeyValue label="Outstanding in total" value={formatMoney(st.summary.outstanding, true)} tone="money" />
          </Card>

          {(st.payouts || []).length > 0 ? (
            <Card>
              <Text style={s.heading}>Payouts</Text>
              {st.payouts.map((p: any) => (
                <KeyValue
                  key={p.id}
                  label={`${humanise(p.state)} · ${humanise(p.rail)}${p.executedAt ? ` · ${formatDateTime(p.executedAt)}` : ''}`}
                  value={formatMoney(p.amount, true)}
                />
              ))}
            </Card>
          ) : null}

          {(st.adjustments || []).length > 0 ? (
            <Card>
              <Text style={s.heading}>Adjustments</Text>
              {st.adjustments.map((a: any) => (
                <View key={a.id}>
                  <KeyValue label={formatDateTime(a.occurredAt)} value={formatMoney(a.amount, true)} />
                  <Text style={s.note}>{a.narration}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          <Card>
            <Text style={s.heading}>Order by order</Text>
            {(st.orders || []).length === 0 ? <Text style={s.note}>No orders in this period.</Text> : null}
            {(st.orders || []).map((o: any) => (
              <View key={o.orderId} style={s.order}>
                <KeyValue label={`#${o.orderNumber} · ${formatDateTime(o.occurredAt)}`} value={formatMoney(o.net, true)} tone="strong" />
                {(o.lines || []).map((l: any, i: number) => (
                  <KeyValue key={`${o.orderId}-${i}`} label={`   ${l.label}`} value={formatMoney(l.amount, true)} />
                ))}
                {Number(o.unexplained) !== 0 ? (
                  <Text style={s.warn}>{formatMoney(o.unexplained, true)} on this order is not explained by the lines above.</Text>
                ) : null}
                <Divider />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Sheet>
  );
};

const s = StyleSheet.create({
  heading: { fontSize: 14, fontWeight: '800', color: c.text.primary, marginBottom: 6 },
  note: { fontSize: 12, color: c.text.secondary, marginBottom: 6, lineHeight: 17 },
  warn: { fontSize: 12, color: c.state.danger, marginTop: 4 },
  order: { marginBottom: 4 }
});
