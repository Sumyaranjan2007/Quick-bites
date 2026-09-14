import { apiFetch } from './apiFetch';

/**
 * Every call the partner app makes.
 *
 * Collected here rather than scattered through the screens so there is one place
 * that knows the request shapes, one place that attaches the token, and one place
 * that turns a failed response into a message a person can act on. The screens
 * previously built URLs inline and swallowed errors, which is how a failed write
 * ended up looking like a success.
 */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

let apiUrl = 'https://quick-bites-production-9f45.up.railway.app/api';
let token = '';

export function configureApi(nextUrl: string, nextToken: string): void {
  if (nextUrl) apiUrl = nextUrl;
  token = nextToken;
}

export function currentApiUrl(): string {
  return apiUrl;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Pulls a usable sentence out of whatever shape the server returned. */
function messageFrom(payload: any, fallback: string): string {
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  fallbackMessage = 'Something went wrong. Please try again.'
): Promise<ApiResult<T>> {
  try {
    const res = await apiFetch(`${apiUrl}${path}`, { ...init, headers: { ...headers(), ...(init.headers as any) } });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok || payload?.success === false) {
      return { ok: false, message: messageFrom(payload, fallbackMessage) };
    }
    return { ok: true, data: payload?.data as T, message: payload?.message };
  } catch (err: any) {
    const offline = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ok: false,
      message: offline
        ? 'Quick Bites is not responding. Check your connection and try again.'
        : 'Could not reach Quick Bites. Check your connection.'
    };
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function login(email: string, password: string) {
  return request<{ token: string; user: any }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password, role: 'restaurant_owner' })
    },
    'Sign-in failed. Check your email and password.'
  );
}

/**
 * Creates the owner's login.
 *
 * Registration deliberately only ever produces a customer account on the server —
 * a partner account is granted after the restaurant's documents are verified, so
 * a self-registered owner cannot give themselves partner access. The app explains
 * that rather than pretending the account is ready.
 */
export function createAccount(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}) {
  return request<{ token: string; user: any }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        password: input.password
      })
    },
    'We could not create your account.'
  );
}

// ---------------------------------------------------------------------------
// Restaurant
// ---------------------------------------------------------------------------

export function fetchOwnedRestaurant(ownerId: string) {
  return request<{ restaurant: any; menu: any }>(`/restaurants/owner/${ownerId}`);
}

export function fetchDashboard(restaurantId: string) {
  return request<{ dashboard: any; restaurant: any }>(`/restaurants/${restaurantId}/dashboard`);
}

export function setKitchenOpen(restaurantId: string, isKitchenActive: boolean) {
  return request<{ isOpen: boolean; changedAt?: string }>(
    `/restaurants/${restaurantId}/kitchen-status`,
    { method: 'POST', body: JSON.stringify({ isKitchenActive }) },
    'Could not change your kitchen status.'
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export function fetchLiveOrders(restaurantId: string) {
  return request<{ orders: any[] }>(`/restaurants/${restaurantId}/orders`);
}

export function fetchOrderHistory(restaurantId: string, scope: 'all' | 'completed' | 'cancelled') {
  return request<{ orders: any[]; counts: { all: number; completed: number; cancelled: number } }>(
    `/restaurants/${restaurantId}/orders/history?scope=${scope}`
  );
}

export function updateOrderStatus(orderId: string, status: string, preparationMinutes?: number) {
  return request<{ order: any }>(
    `/orders/${orderId}/status`,
    {
      method: 'PUT',
      body: JSON.stringify(
        preparationMinutes === undefined ? { status } : { status, preparationMinutes }
      )
    },
    'Could not update the order.'
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export function fetchMenu(restaurantId: string) {
  return request<{ menu: any }>(`/restaurants/${restaurantId}/menu`);
}

export function setDishStock(restaurantId: string, dishId: string, isAvailable: boolean) {
  return request<{ updated: boolean }>(
    `/restaurants/${restaurantId}/menu/toggle-stock`,
    { method: 'POST', body: JSON.stringify({ dishId, isAvailable }) },
    'Could not change availability for that dish.'
  );
}

export function submitMenuRequest(
  restaurantId: string,
  input: {
    kind?: 'ADD_ITEM' | 'EDIT_ITEM';
    dishId?: string;
    name: string;
    description?: string;
    price: number;
    isVeg: boolean;
    categoryName: string;
  }
) {
  return request<{ request: any }>(
    `/restaurants/${restaurantId}/menu/requests`,
    { method: 'POST', body: JSON.stringify(input) },
    'Could not send your menu request.'
  );
}

export function fetchMenuRequests(restaurantId: string) {
  return request<{ requests: any[] }>(`/restaurants/${restaurantId}/menu/requests`);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function fetchDocuments(restaurantId: string) {
  return request<{
    slots: any[];
    verified: boolean;
    outstanding: string[];
    rejected: string[];
    awaitingReview: string[];
    kycStatus: string;
    acceptedFormats: string[];
    maxSizeMb: number;
  }>(`/restaurants/${restaurantId}/documents`);
}

export function uploadDocument(
  restaurantId: string,
  input: { documentType: string; documentNumber: string; fileUrl: string }
) {
  return request<{ document: any }>(
    `/restaurants/${restaurantId}/documents`,
    { method: 'POST', body: JSON.stringify(input) },
    'Could not upload that document.'
  );
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export function raiseSupportTicket(input: { subject: string; category: string; message: string }) {
  return request<{ ticket: any }>(
    '/support/tickets',
    { method: 'POST', body: JSON.stringify(input) },
    'Could not send your message to support.'
  );
}

export function fetchSupportTickets() {
  return request<{ tickets: any[] }>('/support/tickets');
}

// ---------------------------------------------------------------------------
// Password and profile
//
// A partner who forgets their password had no way back in: the sign-in screen
// offered only "try again". These are the same endpoints every Quick Bites app
// uses, so a password changed here works everywhere the owner signs in.
// ---------------------------------------------------------------------------

export function requestPasswordReset(email: string) {
  return request<{ sent: boolean; resetCode?: string; emailDeliveryConfigured?: boolean; expiresInMinutes: number }>(
    '/auth/forgot-password',
    { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) },
    'Could not start a password reset.'
  );
}

export function resetPassword(input: { email: string; code: string; newPassword: string }) {
  return request<{ reset: boolean; token: string }>(
    '/auth/reset-password',
    {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        code: input.code.trim(),
        newPassword: input.newPassword
      })
    },
    'That reset code was not accepted.'
  );
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ changed: boolean }>(
    '/auth/change-password',
    { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
    'Your password could not be changed.'
  );
}

export function updateProfile(changes: { fullName?: string; phone?: string }) {
  return request<{ user: any }>(
    '/auth/me',
    { method: 'PATCH', body: JSON.stringify(changes) },
    'Your profile could not be saved.'
  );
}

export function signOut() {
  return request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }, 'Could not sign out cleanly.');
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/** What the platform owes this kitchen, and what it has already transferred. */
export function fetchSettlements(restaurantId: string) {
  return request<{ summary: any; pendingOrders: any[]; history: any[] }>(
    `/restaurants/${restaurantId}/settlements`,
    {},
    'Could not load your settlements.'
  );
}
