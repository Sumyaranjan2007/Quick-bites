import React, { useState, useEffect } from 'react';
import { Card, Badge, Button, StateView, ComponentState, useTranslation } from '@quick-bites/design-system';
import { Activity, Server, Users, ShoppingBag, TrendingUp, RefreshCw } from 'lucide-react';
import { fetchAdminMetrics, fetchSystemHealth } from '../api';

export const OperationsControlTower: React.FC = () => {
  const { t } = useTranslation();
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>({
    grossMerchandiseValue: 0,
    activeOrdersCount: 0,
    totalRestaurantsCount: 0,
    onlineRidersCount: 0,
    pendingKycCount: 0
  });

  const loadMetrics = async () => {
    setIsRefreshing(true);
    try {
      fetchSystemHealth()
        .then(h => setHealth(h?.status ? h : null))
        .catch(() => setHealth(null));

      const res = await fetchAdminMetrics();
      if (res.success && res.data) {
        setMetrics({
          grossMerchandiseValue: Number(res.data.grossMerchandiseValue) || 0,
          activeOrdersCount: Number(res.data.activeOrdersCount) || 0,
          totalOrdersCount: Number(res.data.totalOrdersCount) || 0,
          totalRestaurantsCount: Number(res.data.totalRestaurantsCount) || 0,
          onlineRidersCount: Number(res.data.onlineRidersCount) || 0,
          pendingKycCount: Number(res.data.pendingKycCount) || 0
        });
        setUiState('success');
      } else {
        setUiState('error');
      }
    } catch (e) {
      console.warn('Could not reach the metrics endpoint', e);
      setUiState('error');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const handleRefresh = () => {
    loadMetrics();
  };

  return (
    <div>
      {/* Header */}
      <div className="page-head">
        <div>
          <h2 className="page-title">{t('admin.controlTowerHeading')}</h2>
          <p className="page-subtitle">{t('admin.controlTowerDescription')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} isLoading={isRefreshing} leftIcon={<RefreshCw size={16} />}>
          {t('admin.refreshMetrics')}
        </Button>
      </div>

      <StateView
        state={uiState}
        errorMessage="Could not reach the Quick Bites server. Metrics are unavailable."
        onRetry={loadMetrics}
      >
        {/* Core KPI Grid */}
        <div className="grid-auto" style={{ marginBottom: 'var(--space-6)' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                {t('admin.gmvToday')}
              </span>
              <TrendingUp size={18} color="var(--color-veg)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              Rs {Number(metrics.grossMerchandiseValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              {t('admin.gmvCaption')}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                {t('admin.liveOrdersTransit')}
              </span>
              <Activity size={18} color="var(--color-accent-500)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)', color: 'var(--color-accent-500)' }}>
              {metrics.activeOrdersCount} {t('common.active')}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
              {t('admin.totalOrdersProcessed')}: {metrics.totalOrdersCount ?? metrics.activeOrdersCount}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                {t('admin.activePartnerRestaurants')}
              </span>
              <ShoppingBag size={18} color="var(--color-primary-500)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              {metrics.totalRestaurantsCount} {t('admin.verifiedLabel')}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              {metrics.pendingKycCount} {t('admin.kycApprovalsPendingReview')}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)' }}>
                {t('admin.activeDeliveryFleet')}
              </span>
              <Users size={18} color="var(--color-info)" />
            </div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>
              {metrics.onlineRidersCount} {t('admin.ridersOnline')}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)', marginTop: 'var(--space-1)' }}>
              {t('admin.liveTelemetryConnected')}
            </div>
          </Card>
        </div>

        {/* System & Free Tier Infrastructure Health */}
        <Card style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Server size={20} color="var(--color-primary-500)" />
              <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
                {t('admin.infraHealthTitle')}
              </h3>
            </div>
            <Badge
              variant={health?.status === 'HEALTHY' ? 'status-active' : 'status-pending'}
              label={health?.status === 'HEALTHY' ? t('admin.allSystemsHealthy') : 'STATUS UNKNOWN'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
            {health?.services ? (
              Object.entries(health.services).map(([name, svc]: [string, any]) => (
                <div key={name} style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--font-weight-bold)' }}>
                    {name}
                  </div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', color: svc.status === 'UP' ? 'var(--color-veg)' : 'var(--color-error)', marginTop: '4px' }}>
                    {svc.status === 'UP' ? 'Operational' : 'Unavailable'}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{svc.provider}</div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                Service health is unavailable — the server did not respond to the health probe.
              </div>
            )}
          </div>
        </Card>
      </StateView>
    </div>
  );
};
