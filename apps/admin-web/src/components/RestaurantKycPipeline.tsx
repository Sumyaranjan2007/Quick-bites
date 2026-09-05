import React, { useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { FileCheck, ShieldAlert, Check, X, MapPin } from 'lucide-react';

interface KycApplication {
  id: string;
  restaurantName: string;
  ownerName: string;
  phone: string;
  city: string;
  address: string;
  fssaiNumber: string;
  gstin: string;
  submittedAt: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
}

const INITIAL_APPLICATIONS: KycApplication[] = [
  {
    id: 'kyc_app_01',
    restaurantName: 'Punjabi Chaap Corner',
    ownerName: 'Harpreet Singh',
    phone: '+91-98765-11223',
    city: 'Bengaluru',
    address: 'Kalyan Nagar 2nd Block',
    fssaiNumber: '11223344557799',
    gstin: '29AABCP1234E1Z1',
    submittedAt: '1 hour ago',
    status: 'PENDING_APPROVAL'
  },
  {
    id: 'kyc_app_02',
    restaurantName: 'Madras Filter Coffee & Tiffin',
    ownerName: 'Venkatesh Raman',
    phone: '+91-98765-44556',
    city: 'Bengaluru',
    address: 'Jayanagar 4th Block',
    fssaiNumber: '11223344558800',
    gstin: '29AABCM5678F1Z2',
    submittedAt: '3 hours ago',
    status: 'PENDING_APPROVAL'
  }
];

export const RestaurantKycPipeline: React.FC = () => {
  const [applications, setApplications] = useState<KycApplication[]>(INITIAL_APPLICATIONS);
  const [uiState, setUiState] = useState<ComponentState>('success');

  const handleApprove = (id: string) => {
    setApplications(prev =>
      prev.map(app => (app.id === id ? { ...app, status: 'ACTIVE' } : app))
    );
  };

  const handleReject = (id: string) => {
    setApplications(prev =>
      prev.map(app => (app.id === id ? { ...app, status: 'REJECTED' } : app))
    );
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
