import React, { useState, useEffect } from 'react';
import { Card, Badge, Button, StateView, ComponentState, useTranslation } from '@quick-bites/design-system';
import { FileCheck, ShieldAlert, Check, X, MapPin, RefreshCw } from 'lucide-react';
import { fetchPendingKyc, reviewKycApplication } from '../api';

export const RestaurantKycPipeline: React.FC = () => {
  const { t } = useTranslation();
  const [applications, setApplications] = useState<any[]>([]);
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [isLoading, setIsLoading] = useState(false);

  const loadKyc = async () => {
    setIsLoading(true);
    try {
      const res = await fetchPendingKyc();
      if (!res.success || !Array.isArray(res.data?.pending)) {
        setUiState('error');
      } else {
        setApplications(res.data.pending.map((p: any) => ({
          id: p.id,
          entityName: p.entityName || 'Merchant partner',
          entityType: p.entityType,
          ownerLabel: p.entityType === 'RESTAURANT' ? 'Restaurant partner' : 'Delivery rider',
          phone: p.entityPhone || null,
          city: p.entityCity || null,
          address: p.entityAddress || null,
          documentNumber: p.documentNumber || null,
          documentType: p.documentType,
          submittedAt: p.submittedAt
            ? new Date(p.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : 'Unknown',
          status: p.status === 'PENDING' ? 'PENDING_APPROVAL' : p.status,
          fileUrl: p.fileUrl
        })));
        setUiState('success');
      }
    } catch (e) {
      console.warn('Could not fetch the KYC queue', e);
      setUiState('error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKyc();
  }, []);

  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setActionError(null);
    try {
      const res = await reviewKycApplication(id, 'APPROVE');
      if (!res.success) throw new Error(res.error?.message || 'Approval failed.');
      setApplications(prev => prev.filter(app => app.id !== id));
    } catch (e: any) {
      setActionError(e.message || 'Could not reach the server. The application was not approved — please retry.');
    }
  };

  const handleReject = async (id: string) => {
    setActionError(null);
    try {
      const res = await reviewKycApplication(id, 'REJECT', 'Document verification failed.');
      if (!res.success) throw new Error(res.error?.message || 'Rejection failed.');
      setApplications(prev => prev.filter(app => app.id !== id));
    } catch (e: any) {
      setActionError(e.message || 'Could not reach the server. The application was not rejected — please retry.');
    }
  };

  const pendingApps = applications.filter(app => app.status === 'PENDING_APPROVAL');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            {t('admin.kycPipelineHeading')}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {t('admin.kycPipelineDescription')}
          </p>
        </div>
        <Badge variant="status-pending" label={`${pendingApps.length} ${t('admin.pendingAudit')}`} />
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
        state={uiState === 'success' && pendingApps.length === 0 ? 'empty' : uiState}
        emptyTitle="KYC Approval Queue Clear"
        emptyDescription="All restaurant merchant verification applications have been reviewed."
        emptyActionLabel="Refresh queue"
        onEmptyAction={loadKyc}
        errorMessage="Could not reach the Quick Bites server. The review queue is unavailable."
        onRetry={loadKyc}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {pendingApps.map(app => (
            <Card key={app.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
                    {app.entityName}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>{app.ownerLabel}</span>
                    {app.address && (<><span>•</span><MapPin size={12} /><span>{app.address}{app.city ? `, ${app.city}` : ''}</span></>)}
                    {!app.address && app.city && (<><span>•</span><MapPin size={12} /><span>{app.city}</span></>)}
                    {app.phone && (<><span>•</span><span>{app.phone}</span></>)}
                  </div>
                </div>
                <Badge variant="status-pending" label={`${t('admin.submittedLabel')} ${app.submittedAt}`} />
              </div>

              {/* Submitted document — only what the record actually contains */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)', backgroundColor: 'var(--bg-app)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--font-weight-bold)' }}>
                    Document type
                  </div>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                    {String(app.documentType || 'Unknown').replace(/_/g, ' ')}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--font-weight-bold)' }}>
                    Document number
                  </div>
                  {app.documentNumber ? (
                    <div style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                      {app.documentNumber}
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning)', marginTop: '4px', fontWeight: 'var(--font-weight-semibold)' }}>
                      Not provided — verify from the uploaded file
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--font-weight-bold)' }}>
                    Uploaded file
                  </div>
                  {app.fileUrl ? (
                    <a
                      href={app.fileUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-info)', fontWeight: 'var(--font-weight-semibold)', marginTop: '4px', display: 'inline-block', textDecoration: 'underline' }}
                    >
                      Open document
                    </a>
                  ) : (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning)', marginTop: '4px' }}>No file attached</div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <Button variant="outline" size="sm" onClick={() => handleReject(app.id)} leftIcon={<X size={14} />}>
                  {t('admin.rejectWithFeedback')}
                </Button>
                <Button variant="veg" size="sm" onClick={() => handleApprove(app.id)} leftIcon={<Check size={14} />}>
                  {app.entityType === 'RIDER' ? t('admin.approveRider') : t('admin.approveGrantAccess')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
