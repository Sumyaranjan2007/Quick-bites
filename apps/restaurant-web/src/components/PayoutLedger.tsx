import React, { useEffect, useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { ArrowDownRight, ShieldCheck, Download } from 'lucide-react';
import { fetchRestaurantOrders } from '../api';

interface LedgerRow {
  orderNumber: string;
  deliveredAt: string;
  itemsTotal: number;
  gstAmount: number;
  platformCommission: number;
  netPayout: number;
}

function downloadCsv(filename: string, rows: LedgerRow[]) {
  const header = ['Order Number', 'Delivered At', 'Items Total (Rs)', 'GST (Rs)', 'Platform Commission (Rs)', 'Net Payout (Rs)'];
  const lines = [
    header.join(','),
    ...rows.map(r =>
      [r.orderNumber, r.deliveredAt, r.itemsTotal.toFixed(2), r.gstAmount.toFixed(2), r.platformCommission.toFixed(2), r.netPayout.toFixed(2)].join(',')
    )
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const PayoutLedger: React.FC = () => {
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [rows, setRows] = useState<LedgerRow[]>([]);

  const loadLedger = async () => {
    setUiState('loading');
    try {
      const res = await fetchRestaurantOrders('rst_bbh_01');
      if (!res.success || !Array.isArray(res.data?.orders)) {
        setUiState('error');
        return;
      }
      const delivered = res.data.orders.filter((o: any) => o.status === 'DELIVERED' && o.bill);
      const mapped: LedgerRow[] = delivered.map((o: any) => {
        const platformCommission = o.bill.itemsTotal * 0.15;
        return {
          orderNumber: o.orderNumber,
          deliveredAt: o.deliveredAt ? new Date(o.deliveredAt).toLocaleString('en-IN') : '—',
          itemsTotal: o.bill.itemsTotal,
          gstAmount: o.bill.gstAmount,
          platformCommission,
          netPayout: typeof o.bill.restaurantNetPayout === 'number' ? o.bill.restaurantNetPayout : o.bill.itemsTotal - platformCommission
        };
      });
      setRows(mapped);
      setUiState('success');
    } catch (err) {
      console.warn('[PayoutLedger] Failed to load orders', err);
      setUiState('error');
    }
  };

  useEffect(() => {
    loadLedger();
  }, []);

  const gmv = rows.reduce((sum, r) => sum + r.itemsTotal, 0);
  const platformCommission = rows.reduce((sum, r) => sum + r.platformCommission, 0);
  const netPayout = rows.reduce((sum, r) => sum + r.netPayout, 0);

  const handleExport = () => {
    downloadCsv(`quickbite-gst-ledger-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Financials & Payout Ledger
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Automated T+1 daily settlement and transparent commission ledger.
          </p>
        </div>
        <Button variant="outline" size="sm" leftIcon={<Download size={16} />} onClick={handleExport} disabled={rows.length === 0}>
          Export GST Invoice
        </Button>
      </div>

      <StateView
        state={uiState === 'success' && rows.length === 0 ? 'empty' : uiState}
        emptyTitle="No Delivered Orders Yet"
        emptyDescription="Your payout ledger will populate once orders are delivered."
        errorMessage="Could not reach the Quick Bites server. Check your connection and try again."
        onRetry={loadLedger}
      >
        {/* Metric Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <Card>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
              GROSS FOOD SALES (GMV)
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              Rs {gmv.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              From {rows.length} delivered order{rows.length === 1 ? '' : 's'}
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
              COMMISSION DEDUCTIONS (15%)
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)', color: 'var(--color-primary-500)' }}>
              -Rs {platformCommission.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              15% Quick Bites Standard Rate
            </div>
          </Card>

          <Card style={{ backgroundColor: 'var(--color-veg-bg)', borderColor: 'var(--color-veg)' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginBottom: 'var(--space-1)', fontWeight: 'var(--font-weight-bold)' }}>
              NET PAYOUT (DELIVERED ORDERS)
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)', color: 'var(--color-veg)' }}>
              Rs {netPayout.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              Settlement scheduled: Tomorrow 06:00 AM
            </div>
          </Card>
        </div>

        {/* Compliance and Banking Info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <ShieldCheck size={20} color="var(--color-veg)" />
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
                FSSAI & Regulatory Compliance
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>FSSAI License:</span>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-semibold)' }}>11223344556677</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>GSTIN Registration:</span>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-semibold)' }}>29ABCDE1234F1Z5</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Compliance Status:</span>
                <Badge variant="status-active" label="VERIFIED ACTIVE" />
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <ArrowDownRight size={20} color="var(--color-primary-500)" />
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
                Direct Bank Transfer Account
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Bank Name:</span>
                <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>HDFC Bank Ltd.</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Account Number:</span>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-semibold)' }}>•••• •••• 8821</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>IFSC Code:</span>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-semibold)' }}>HDFC0001234</span>
              </div>
            </div>
          </Card>
        </div>
      </StateView>
    </div>
  );
};
