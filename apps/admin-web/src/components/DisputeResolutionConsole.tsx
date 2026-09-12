import React, { useEffect, useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState, useTranslation } from '@quick-bites/design-system';
import { AlertCircle, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { fetchAllOrders, processDisputeRefund } from '../api';

interface DisputeTicket {
  id: string;
  orderNumber: string;
  customerName: string;
  restaurantName: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export const DisputeResolutionConsole: React.FC = () => {
  const { t } = useTranslation();
  const [disputes, setDisputes] = useState<DisputeTicket[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDisputes = async () => {
    setUiState('loading');
    try {
      const res = await fetchAllOrders();
      if (!res.success || !Array.isArray(res.data?.orders)) {
        setUiState('error');
        return;
      }
      // Delivered orders are eligible for a post-delivery dispute/refund review.
      const eligible = res.data.orders
        .filter((o: any) => o.status === 'DELIVERED')
        .map((o: any) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName || 'Customer',
          restaurantName: o.restaurantName || 'Restaurant Partner',
          amount: o.bill?.totalAmount ?? 0,
          reason: 'Flagged for delivery quality / order accuracy review.',
          createdAt: o.deliveredAt ? new Date(o.deliveredAt).toLocaleString('en-IN') : '—'
        }));
      setDisputes(eligible);
      setUiState('success');
    } catch (e) {
      console.warn('[Disputes] Failed to load orders', e);
      setUiState('error');
    }
  };

  useEffect(() => {
    loadDisputes();
  }, []);

  const handleRefund = async (dispute: DisputeTicket) => {
    setActionError(null);
    try {
      const res = await processDisputeRefund(dispute.id, dispute.amount, dispute.reason);
      if (!res.success) throw new Error(res.error?.message || res.error || 'Refund failed.');
      setDisputes(prev => prev.filter(d => d.id !== dispute.id));
    } catch (e: any) {
      setActionError(e.message || 'Could not process the refund. Please try again.');
    }
  };

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => new Set(prev).add(id));
  };

  const openDisputes = disputes.filter(d => !dismissedIds.has(d.id));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            {t('admin.disputesHeading')}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {t('admin.disputesDescription')}
          </p>
        </div>
        <Badge variant="status-error" label={`${openDisputes.length} ${t('admin.openDisputes')}`} />
      </div>

      {actionError && (
        <div
          style={{
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-danger-50, #FEF2F2)',
            color: 'var(--color-danger-600, #DC2626)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          {actionError}
        </div>
      )}

      <StateView
        state={uiState === 'success' && openDisputes.length === 0 ? 'empty' : uiState}
        emptyTitle="All Customer Disputes Resolved"
        emptyDescription="Zero open complaints or pending refund requests in the queue."
        errorMessage="Could not reach the Quick Bites server. Check your connection and try again."
        onRetry={loadDisputes}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {openDisputes.map(dispute => (
            <Card key={dispute.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)' }}>
                      {dispute.orderNumber}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                      • {dispute.customerName} vs {dispute.restaurantName}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Delivered {dispute.createdAt}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-primary-500)', fontSize: 'var(--font-size-md)' }}>
                  Claim: Rs {dispute.amount.toFixed(2)}
                </span>
              </div>

              <div style={{ backgroundColor: 'var(--color-primary-50)', borderLeft: '3px solid var(--color-primary-500)', padding: 'var(--space-3)', margin: 'var(--space-3) 0', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-primary-700)', marginBottom: '2px' }}>
                  {t('admin.customerComplaint')}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dispute.reason}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <Button variant="outline" size="sm" onClick={() => handleDismiss(dispute.id)} leftIcon={<XCircle size={14} />}>
                  {t('admin.dismissDispute')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleRefund(dispute)} leftIcon={<RotateCcw size={14} />}>
                  {t('admin.approveRefund')} (Rs {dispute.amount.toFixed(2)})
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
