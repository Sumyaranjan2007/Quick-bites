import { Card, Badge, Button, StateView } from '@quick-bites/design-system';
import { ArrowDownRight, ShieldCheck, Download } from 'lucide-react';

export const PayoutLedger: React.FC = () => {
  const gmv = 38450.00;
  const platformCommission = gmv * 0.15; // 15% canonical platform commission
  const gstOnCommission = platformCommission * 0.18; // 18% GST on platform fee
  const netPayout = gmv - platformCommission - gstOnCommission;

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
        <Button variant="outline" size="sm" leftIcon={<Download size={16} />}>
          Export GST Invoice
        </Button>
      </div>

      <StateView state="success">
        {/* Metric Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <Card>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
              GROSS FOOD SALES (GMV)
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              Rs {gmv.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              +14.2% from last week
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
              15% Quick Bite Standard Rate
            </div>
          </Card>

          <Card style={{ backgroundColor: 'var(--color-veg-bg)', borderColor: 'var(--color-veg)' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginBottom: 'var(--space-1)', fontWeight: 'var(--font-weight-bold)' }}>
              ESTIMATED NET PAYOUT
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
