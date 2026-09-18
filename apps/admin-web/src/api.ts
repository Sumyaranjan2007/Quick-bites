import { apiFetch } from './lib/apiFetch';
import { authHeaders, clearSession, setSession, type AdminSession } from './lib/session';

export { DEFAULT_API_URL as API_BASE } from './config';

/** Raised when the server rejects our token, so the UI can send the operator back to sign in. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/**
 * Signs in with credentials the operator types. The portal holds no credentials of
 * its own; the server decides whether this account may use the admin console.
 */
export async function login(email: string, password: string): Promise<AdminSession> {
  const res = await apiFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();

  if (!res.ok || !data.success || !data.data?.token) {
    throw new Error(data?.error?.message || data?.error || 'Sign-in failed. Check your email and password.');
  }

  const role = data.data.user?.role;
  if (role !== 'admin' && role !== 'super_admin') {
    throw new Error('This account does not have access to the admin console.');
  }

  const session: AdminSession = { token: data.data.token, user: data.data.user };
  setSession(session);
  return session;
}

export function logout(): void {
  clearSession();
}

/** Wraps a call so an expired or rejected token clears the session instead of looking like a server fault. */
async function authedFetch(path: string, init: RequestInit = {}) {
  const res = await apiFetch(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() }
  });
  if (res.status === 401 || res.status === 403) {
    clearSession();
    throw new SessionExpiredError();
  }
  return res;
}

export async function fetchAdminMetrics() {
  const res = await authedFetch(`${API_BASE}/admin/metrics`);
  return res.json();
}

export async function fetchPendingKyc() {
  const res = await authedFetch(`${API_BASE}/admin/kyc/pending`);
  return res.json();
}

export async function reviewKycApplication(documentId: string, action: 'APPROVE' | 'REJECT', rejectionReason?: string) {
  const res = await authedFetch(`${API_BASE}/admin/kyc/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, action, rejectionReason })
  });
  return res.json();
}

export async function fetchAllOrders() {
  const res = await authedFetch(`${API_BASE}/orders`);
  return res.json();
}

export async function processDisputeRefund(orderId: string, refundAmount: number, reason: string) {
  const res = await authedFetch(`${API_BASE}/admin/orders/${orderId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: refundAmount, reason })
  });
  return res.json();
}

/** Live service health. The /health probe sits outside the /api prefix and needs no session. */
export async function fetchSystemHealth() {
  const base = API_BASE.replace(/\/api(\/v1)?$/, '');
  const res = await apiFetch(`${base}/health`);
  return res.json();
}
