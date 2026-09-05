import React, { useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { Activity, Server, Users, ShoppingBag, TrendingUp, RefreshCw } from 'lucide-react';

export const OperationsControlTower: React.FC = () => {
  const [uiState, setUiState] = useState<ComponentState>('success');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Operations Control Tower
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            System health telemetry, live order metrics, and cloud resource counters.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} isLoading={isRefreshing} leftIcon={<RefreshCw size={16} />}>
          Refresh Metrics
        </Button>
      </div>

      <StateView state={uiState} onRetry={() => setUiState('success')}>
        {/* Core KPI Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                PLATFORM GMV (TODAY)
              </span>
              <TrendingUp size={18} color="var(--color-veg)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              Rs 1,48,250.00
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              +22.4% vs yesterday
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                LIVE ORDERS IN TRANSIT
              </span>
              <Activity size={18} color="var(--color-accent-500)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)', color: 'var(--color-accent-500)' }}>
              24 Active
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
              18 Kitchen Prep • 6 Out for Delivery
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                ACTIVE PARTNER RESTAURANTS
              </span>
              <ShoppingBag size={18} color="var(--color-primary-500)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              42 Verified
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              2 KYC approvals pending review
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                ACTIVE DELIVERY FLEET
              </span>
              <Users size={18} color="var(--color-info)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              68 Riders
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              Average pickup time: 4.8 mins
            </div>
          </Card>
        </div>

        {/* System & Free Tier Infrastructure Health */}
        <Card style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Server size={20} color="var(--color-primary-500)" />
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
                Infrastructure & Free Tier Health Monitor
              </h3>
            </div>
            <Badge variant="status-active" label="ALL SYSTEMS HEALTHY" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
            <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>POSTGRESQL + POSTGIS</div>
              <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--color-veg)', marginTop: '4px' }}>Connected (0ms lag)</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Spatial indexes operational</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>MEILISEARCH SEARCH ENGINE</div>
              <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--color-veg)', marginTop: '4px' }}>Synchronized (0.2ms avg)</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Typo tolerance active</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>UPSTASH REDIS CACHE</div>
              <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--color-veg)', marginTop: '4px' }}>Operational</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Hit ratio: 91.2%</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>RAZORPAY PAYMENT GATEWAY</div>
              <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--color-veg)', marginTop: '4px' }}>Sandbox Connected</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>HMAC SHA256 verified</div>
            </div>
          </div>
        </Card>
      </StateView>
    </div>
  );
};
