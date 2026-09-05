import React, { useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { AlertCircle, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

interface DisputeTicket {
  id: string;
  orderNumber: string;
  customerName: string;
  restaurantName: string;
  amount: number;
  reason: string;
  status: 'OPEN' | 'REFUNDED' | 'DISMISSED';
  createdAt: string;
}

const INITIAL_DISPUTES: DisputeTicket[] = [
  {
    id: 'disp_01',
    orderNumber: 'QB-551982',
    customerName: 'Ananya Deshmukh',
    restaurantName: 'Bangalore Biryani House',
    amount: 320.00,
    reason: 'Container lid was loose causing spill during delivery transit.',
    status: 'OPEN',
    createdAt: '15 mins ago'
  },
  {
    id: 'disp_02',
    orderNumber: 'QB-442190',
    customerName: 'Karthik Rao',
    restaurantName: 'Udupi Sri Krishna Bhavan',
    amount: 110.00,
    reason: 'Incorrect item received (Plain Dosa instead of Benne Masala Dosa).',
    status: 'OPEN',
    createdAt: '45 mins ago'
  }
];

export const DisputeResolutionConsole: React.FC = () => {
  const [disputes, setDisputes] = useState<DisputeTicket[]>(INITIAL_DISPUTES);
  const [uiState, setUiState] = useState<ComponentState>('success');

  const handleRefund = (id: string) => {
    setDisputes(prev =>
      prev.map(d => (d.id === id ? { ...d, status: 'REFUNDED' } : d))
    );
  };

  const handleDismiss = (id: string) => {
    setDisputes(prev =>
      prev.map(d => (d.id === id ? { ...d, status: 'DISMISSED' } : d))
    );
  };

  const openDisputes = disputes.filter(d => d.status === 'OPEN');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Dispute Resolution & Refund Console
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Arbitrate customer delivery complaints, issue automated UPI/Razorpay reversals, and manage refunds.
          </p>
        </div>
        <Badge variant="status-error" label={`${openDisputes.length} OPEN DISPUTES`} />
      </div>

      <StateView
        state={openDisputes.length === 0 ? 'empty' : uiState}
        emptyTitle="All Customer Disputes Resolved"
        emptyDescription="Zero open complaints or pending refund requests in the queue."
        emptyActionLabel="Reload Demo Tickets"
        onEmptyAction={() => setDisputes(INITIAL_DISPUTES)}
        onRetry={() => setUiState('success')}
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
                    Reported {dispute.createdAt}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-primary-500)', fontSize: 'var(--font-size-md)' }}>
                  Claim: Rs {dispute.amount.toFixed(2)}
                </span>
              </div>

              <div style={{ backgroundColor: 'var(--color-primary-50)', borderLeft: '3px solid var(--color-primary-500)', padding: 'var(--space-3)', margin: 'var(--space-3) 0', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-primary-700)', marginBottom: '2px' }}>
                  CUSTOMER COMPLAINT
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {dispute.reason}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <Button variant="outline" size="sm" onClick={() => handleDismiss(dispute.id)} leftIcon={<XCircle size={14} />}>
                  Dismiss Dispute
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleRefund(dispute.id)} leftIcon={<RotateCcw size={14} />}>
                  Approve UPI Instant Refund (Rs {dispute.amount.toFixed(2)})
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
