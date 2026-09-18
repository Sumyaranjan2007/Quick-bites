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
