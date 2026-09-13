import { apiFetch } from './lib/apiFetch';
import { authHeaders, clearSession, getSession, setSession, type PartnerSession } from './lib/session';

export const API_BASE = ((import.meta as any).env?.VITE_API_URL as string) || 'https://quick-bites-production-9f45.up.railway.app/api';

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/**
 * Signs the partner in with credentials they type, then resolves which restaurant the
 * account actually owns. The portal used to assume `rst_bbh_01`; the server now rejects
 * any request for a restaurant the caller does not own, so the id has to come from the
 * account rather than from a constant.
 */
export async function login(email: string, password: string): Promise<PartnerSession> {
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
  if (role !== 'restaurant_owner' && role !== 'admin' && role !== 'super_admin') {
    throw new Error('This account is not registered as a restaurant partner.');
  }

  const session: PartnerSession = { token: data.data.token, user: data.data.user };

  try {
    const owned = await apiFetch(`${API_BASE}/restaurants/owner/${data.data.user.id}`, {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    const ownedData = await owned.json();
    const first = ownedData?.data?.restaurants?.[0] ?? ownedData?.data?.restaurant;
    if (first?.id) session.restaurantId = first.id;
  } catch {
    // Not fatal — the console will report that no restaurant is linked.
  }

  setSession(session);
  return session;
}

export function logout(): void {
  clearSession();
}

/** The restaurant this session manages. Callers should handle the empty case. */
export function currentRestaurantId(): string {
  return getSession()?.restaurantId ?? '';
}

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

export async function fetchRestaurantOrders(restaurantId = currentRestaurantId()) {
  const res = await authedFetch(`${API_BASE}/restaurants/${restaurantId}/orders`);
  return res.json();
}

export async function fetchRestaurantDetails(restaurantId = currentRestaurantId()) {
  const res = await apiFetch(`${API_BASE}/restaurants/${restaurantId}`);
  return res.json();
}

export async function toggleDishStock(restaurantId: string, dishId: string, isAvailable: boolean) {
  const res = await authedFetch(`${API_BASE}/restaurants/${restaurantId}/menu/toggle-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dishId, isAvailable })
  });
  return res.json();
}

export async function updateOrderStatus(orderId: string, status: string, prepTimeMinutes?: number) {
  const res = await authedFetch(`${API_BASE}/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      prepTimeMinutes !== undefined ? { status, preparationMinutes: prepTimeMinutes } : { status }
    )
  });
  return res.json();
}

export async function addMenuItem(
  restaurantId: string,
  item: { name: string; price: number; isVeg: boolean; description?: string; category?: string }
) {
  const res = await authedFetch(`${API_BASE}/restaurants/${restaurantId}/menu/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  return res.json();
}

/** The socket server lives at the origin; API_BASE carries an /api suffix. */
export function socketOrigin(): string {
  return API_BASE.replace(/\/api(\/v1)?\/?$/, '');
}
