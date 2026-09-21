import { apiFetch } from './apiFetch';
import { authHeaders, clearSession } from './session';

// Imported AND re-exported. A bare `export ... from` forwards the name to
// importers without binding it in this module, so every `${API_BASE}` below was a
// reference to nothing — the portal threw before it could reach the API at all.
import { DEFAULT_API_URL as API_BASE } from '../config';

export { API_BASE };

/**
 * The console's single door to the admin API.
 *
 * Every section goes through `adminGet` / `adminSend`, so there is one place that
 * attaches the session, one that turns a rejection into a sentence, and one that
 * recognises an expired session. A 403 here is a permission answer, not a fault:
 * the console hides what a role cannot use, but the server is what enforces it.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

function messageFrom(payload: any, fallback: string): string {
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

async function call<T>(path: string, init: RequestInit = {}, fallback = 'Something went wrong.'): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as any), ...authHeaders() }
  });

  const payload = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearSession();
    throw new SessionExpiredError();
  }
  if (res.status === 403) {
    throw new PermissionError(messageFrom(payload, 'Your role does not allow this.'));
  }
  if (!res.ok || payload?.success === false) {
    throw new Error(messageFrom(payload, fallback));
  }
  return payload.data as T;
}

export const adminGet = <T>(path: string) => call<T>(path);
export const adminSend = <T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) =>
  call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Who am I, and what may I do
// ---------------------------------------------------------------------------

export interface AdminAccess {
  user: { id: string; email: string; fullName: string; role: string };
  role: { id: string; key: string; name: string; isSystem: boolean } | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

export const fetchAccess = () => adminGet<AdminAccess>('/admin/me');

/** A Super Admin holds every permission implicitly, which mirrors the server. */
export function can(access: AdminAccess | null, ...permissions: string[]): boolean {
  if (!access) return false;
  if (access.isSuperAdmin) return true;
  return permissions.some(p => access.permissions.includes(p));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const fetchDashboard = () => adminGet<any>('/admin/dashboard');
export const fetchLiveBoard = () => adminGet<any>('/admin/live');
export const fetchOrderAnalytics = () => adminGet<any>('/admin/analytics/orders');

export const fetchOrders = (query = '') => adminGet<any>(`/admin/orders${query}`);
export const fetchOrderDetail = (id: string) => adminGet<any>(`/admin/orders/${id}`);
export const fetchOrderEconomics = (id: string) => adminGet<any>(`/admin/orders/${id}/economics`);
export const fetchLiveDeliveries = () => adminGet<any>('/admin/deliveries/live');

export const fetchPayments = (query = '') => adminGet<any>(`/admin/payments${query}`);
export const fetchRevenue = () => adminGet<any>('/admin/revenue');
export const fetchPayouts = (query = '') => adminGet<any>(`/admin/payouts${query}`);

export const fetchMenuRequests = (status = 'PENDING') =>
  adminGet<any>(`/admin/menu-requests?status=${status}`);
export const reviewMenuRequest = (
  id: string,
  body: { action: 'APPROVE' | 'REJECT'; rejectionReason?: string; overrides?: Record<string, unknown> }
) => adminSend<any>(`/admin/menu-requests/${id}/review`, 'POST', body);

export const fetchDocuments = (status = 'PENDING') => adminGet<any>(`/admin/documents?status=${status}`);

/** Partner-submitted changes to how a restaurant appears to customers. */
export const fetchProfileEdits = (status = 'PENDING') =>
  adminGet<any>(`/admin/profile-edits?status=${status}`);

/**
 * Settles one submission FIELD BY FIELD.
 *
 * Every changed field must appear in `approve` or in `reject`. The server
 * refuses a review that leaves one undecided, because a submission closed with
 * a change neither live nor refused leaves the partner waiting on a decision
 * that was already made without it.
 */
export const reviewProfileEdit = (
  id: string,
  body: { approve: string[]; reject: Array<{ field: string; reason: string }> }
) => adminSend<any>(`/admin/profile-edits/${id}/review`, 'POST', body);

export const fetchSupportTickets = (query = '') => adminGet<any>(`/admin/support/tickets${query}`);
export const fetchSupportTicket = (id: string) => adminGet<any>(`/admin/support/tickets/${id}`);

export const fetchRoles = () => adminGet<any>('/admin/roles');
export const fetchAdmins = () => adminGet<any>('/admin/admins');
export const fetchAuditLog = () => adminGet<any>('/admin/audit-log');

export const fetchCustomers = (query = '') => adminGet<any>(`/admin/customers${query}`);
export const fetchDrivers = (query = '') => adminGet<any>(`/admin/drivers${query}`);
export const fetchRestaurants = (query = '') => adminGet<any>(`/admin/restaurants${query}`);

/** Live service health. The probe sits outside the /api prefix and needs no session. */
export async function fetchSystemHealth() {
  const base = API_BASE.replace(/\/api(\/v1)?$/, '');
  const res = await apiFetch(`${base}/health`);
  return res.json();
}

// ---------------------------------------------------------------------------
// The payments rebuild: rates, the ledger-backed dues queue, payee accounts,
// cash in from riders, and tax.
//
// These are the SAME endpoints the operations app uses. Not a parallel set —
// two implementations of "what is owed" is the one thing this whole plan exists
// to avoid, and a console that showed a different figure to the app would be
// worse than a console with no payments screen at all.
// ---------------------------------------------------------------------------

export const fetchPricingConfig = () => adminGet<any>('/admin/pricing/config');
export const updatePricingConfig = (body: { changes: Record<string, number>; note: string }) =>
  adminSend<any>('/admin/pricing/config', 'PUT', body);
export const fetchPricingHistory = () => adminGet<any>('/admin/pricing/config/history');

export const fetchDues = () => adminGet<any>('/admin/payouts/dues');
export const fetchPayoutList = () => adminGet<any>('/admin/payouts/list');
export const fetchPayoutStatement = (ownerType: string, ownerId: string) =>
  adminGet<any>(`/admin/payouts/statement/${ownerType}/${ownerId}`);
export const draftPayout = (body: { ownerType: string; ownerId: string; rail: string }) =>
  adminSend<any>('/admin/payouts', 'POST', body);
export const approvePayout = (id: string) => adminSend<any>(`/admin/payouts/${id}/approve`, 'POST', {});
export const sendPayout = (id: string, body: { manualReference?: string }) =>
  adminSend<any>(`/admin/payouts/${id}/send`, 'POST', body);
export const cancelPayout = (id: string, body: { reason: string }) =>
  adminSend<any>(`/admin/payouts/${id}/cancel`, 'POST', body);

export const fetchPayoutRequests = () => adminGet<any>('/admin/payouts/requests');
export const declinePayoutRequest = (id: string, body: { reason: string }) =>
  adminSend<any>(`/admin/payouts/requests/${id}/decline`, 'POST', body);

export const fetchPayeeReviewQueue = () => adminGet<any>('/admin/payee-accounts/review');
export const fetchPayeeCoverage = () => adminGet<any>('/admin/payee-accounts/coverage');
export const reviewPayeeAccount = (id: string, body: { decision: string; note?: string }) =>
  adminSend<any>(`/admin/payee-accounts/${id}/review`, 'POST', body);

export const fetchCashDeposits = () => adminGet<any>('/admin/cash/deposits');
export const confirmCashDeposit = (id: string, body: { receivedAmount: number; varianceNote?: string }) =>
  adminSend<any>(`/admin/cash/deposits/${id}/confirm`, 'POST', body);

export const fetchTaxIdentity = () => adminGet<any>('/admin/tax/identity');
export const updateTaxIdentity = (body: Record<string, unknown>) =>
  adminSend<any>('/admin/tax/identity', 'PUT', body);
export const fetchTaxSummary = (month: string) => adminGet<any>(`/admin/tax/summary?month=${month}`);
export const fetchGrievanceContact = () => adminGet<any>('/admin/policies/grievance');
export const updateGrievanceContact = (body: Record<string, unknown>) =>
  adminSend<any>('/admin/policies/grievance', 'PUT', body);

export const runPaymentsHealthCheck = () => adminSend<any>('/admin/payments/health-check', 'POST', {});
