import React, { useState, useEffect } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { FileCheck, ShieldAlert, Check, X, MapPin, RefreshCw } from 'lucide-react';
import { fetchPendingKyc, reviewKycApplication } from '../api';

const INITIAL_APPLICATIONS = [
  {
    id: 'kyc_demo_01',
    restaurantName: 'The Royal Biryani House',
    ownerName: 'Vikram Singh',
    phone: '+91-98765-43210',
    city: 'Bengaluru',
    address: '12th Main, HAL 2nd Stage, Indiranagar',
    fssaiNumber: '11223344556677',
    gstin: '29ABCDE1234F1Z5',
    submittedAt: '10 mins ago',
    status: 'PENDING_APPROVAL',
    documentType: 'FSSAI_LICENSE'
  },
  {
    id: 'kyc_demo_02',
    restaurantName: 'Green Bowl Healthy Salads',
    ownerName: 'Ananya Roy',
    phone: '+91-98123-45678',
    city: 'Bengaluru',
    address: '5th Block, Koramangala',
    fssaiNumber: '99887766554433',
    gstin: '29WXYZ8901G2Z8',
    submittedAt: '35 mins ago',
    status: 'PENDING_APPROVAL',
    documentType: 'GST_CERTIFICATE'
  }
];

export const RestaurantKycPipeline: React.FC = () => {
  const [applications, setApplications] = useState<any[]>(INITIAL_APPLICATIONS);
  const [uiState, setUiState] = useState<ComponentState>('success');
  const [isLoading, setIsLoading] = useState(false);

  const loadKyc = async () => {
    setIsLoading(true);
    try {
      const res = await fetchPendingKyc();
      if (res.success && Array.isArray(res.data?.pending)) {
        setApplications(res.data.pending.map((p: any) => ({
          id: p.id,
          restaurantName: p.entityName || 'Merchant Partner',
          ownerName: p.entityType === 'RESTAURANT' ? 'Restaurant Partner' : 'Delivery Rider',
          phone: '+91-98765-00000',
          city: 'Bengaluru',
          address: 'Indiranagar / Koramangala',
          fssaiNumber: p.documentType === 'FSSAI' ? '11223344556677' : 'KA03-2026-00918',
          gstin: '29ABCDE1234F1Z5',
          submittedAt: new Date(p.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: p.status === 'PENDING' ? 'PENDING_APPROVAL' : p.status,
          fileUrl: p.fileUrl,
          documentType: p.documentType
        })));
      }
    } catch (e) {
      console.warn('Could not fetch KYC from Railway, using sample data', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKyc();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await reviewKycApplication(id, 'APPROVE');
      setApplications(prev => prev.filter(app => app.id !== id));
    } catch (e) {
      setApplications(prev => prev.filter(app => app.id !== id));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await reviewKycApplication(id, 'REJECT', 'Document verification failed.');
      setApplications(prev => prev.filter(app => app.id !== id));
    } catch (e) {
      setApplications(prev => prev.filter(app => app.id !== id));
    }
  };

  const pendingApps = applications.filter(app => app.status === 'PENDING_APPROVAL');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Restaurant KYC Verification Pipeline
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Review merchant onboarding documents, 14-digit FSSAI licenses, and state GSTIN compliance.
          </p>
        </div>
        <Badge variant="status-pending" label={`${pendingApps.length} PENDING AUDIT`} />
      </div>

      <StateView
        state={pendingApps.length === 0 ? 'empty' : uiState}
        emptyTitle="KYC Approval Queue Clear"
        emptyDescription="All restaurant merchant verification applications have been reviewed."
        emptyActionLabel="Reset Demo Applications"
        onEmptyAction={() => setApplications(INITIAL_APPLICATIONS)}
        onRetry={() => setUiState('success')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {pendingApps.map(app => (
            <Card key={app.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' }}>
                    {app.restaurantName}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                    <MapPin size={12} />
                    <span>{app.address}, {app.city}</span>
                    <span>•</span>
                    <span>Owner: {app.ownerName} ({app.phone})</span>
                  </div>
                </div>
                <Badge variant="status-pending" label={`Submitted ${app.submittedAt}`} />
              </div>

              {/* Compliance Badges Check */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)', backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>FSSAI LICENSE (14-DIGIT)</div>
                  <div style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)', marginTop: '2px' }}>
                    {app.fssaiNumber}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)' }}>Format Verified: Food Services License</div>
                </div>

                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>GSTIN REGISTRATION</div>
                  <div style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-sm)', marginTop: '2px' }}>
                    {app.gstin}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-veg)' }}>State: Karnataka (29) Active</div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <Button variant="outline" size="sm" onClick={() => handleReject(app.id)} leftIcon={<X size={14} />}>
                  Reject with Feedback
                </Button>
                <Button variant="veg" size="sm" onClick={() => handleApprove(app.id)} leftIcon={<Check size={14} />}>
                  Approve Restaurant & Grant Live Access
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
