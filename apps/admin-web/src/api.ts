export const API_BASE = ((import.meta as any).env?.VITE_API_URL as string) || 'https://quick-bites-production-9f45.up.railway.app/api';

let adminToken = '';

export async function getAdminToken(): Promise<string> {
  if (adminToken) return adminToken;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@quickbite.app', password: 'pass123' })
    });
    const data = await res.json();
    if (data.success && data.data?.token) {
      adminToken = data.data.token;
      return adminToken;
    }
  } catch (err) {
    console.warn('[AdminAPI] Failed auto-login, continuing with mock fallback', err);
  }
  return '';
}

export async function fetchAdminMetrics() {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/admin/metrics`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return res.json();
}

export async function fetchPendingKyc() {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/admin/kyc/pending`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return res.json();
}

export async function reviewKycApplication(documentId: string, action: 'APPROVE' | 'REJECT', rejectionReason?: string) {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/admin/kyc/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ documentId, action, rejectionReason })
  });
  return res.json();
}

export async function fetchAllOrders() {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/orders`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return res.json();
}

export async function processDisputeRefund(orderId: string, refundAmount: number, reason: string) {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/admin/orders/${orderId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ amount: refundAmount, reason })
  });
  return res.json();
}
