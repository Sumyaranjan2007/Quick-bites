import { DEFAULT_API_URL } from '../config';
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

let apiUrl = DEFAULT_API_URL;
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
 * Registers the restaurant and its owner, both pending approval.
 *
 * This used to POST to /auth/register, which hardcodes the customer role — so a
 * restaurant owner filling in this form received a CUSTOMER account and could
 * not sign into their own app. The server now has a partner registration that
 * creates the login and the restaurant together, in a pending state that an
 * administrator approves before the kitchen can take a single order.
 */
export function createAccount(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  restaurantName: string;
  addressLine: string;
  city: string;
  pincode: string;
  fssaiLicenseNumber: string;
  isPureVeg?: boolean;
}) {
  return request<{ token: string; user: any; restaurant: any; awaitingApproval: boolean }>(
    '/auth/register/partner',
    {
      method: 'POST',
      body: JSON.stringify({
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        password: input.password,
        restaurantName: input.restaurantName.trim(),
        addressLine: input.addressLine.trim(),
        city: input.city.trim(),
        pincode: input.pincode.trim(),
        fssaiLicenseNumber: input.fssaiLicenseNumber.trim(),
        isPureVeg: Boolean(input.isPureVeg)
      })
    },
    'We could not register your restaurant.'
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

export function updateOrderStatus(
  orderId: string,
  status: string,
  preparationMinutes?: number,
  cancellation?: { reasonCode: string; note?: string }
) {
  return request<{ order: any }>(
    `/orders/${orderId}/status`,
    {
      method: 'PUT',
      body: JSON.stringify({
        status,
        ...(preparationMinutes === undefined ? {} : { preparationMinutes }),
        // The server refuses a cancellation with no reason, so rejecting an
        // order without one is not a thing this app can do.
        ...(cancellation
          ? {
              cancellationReasonCode: cancellation.reasonCode,
              ...(cancellation.note ? { cancellationNote: cancellation.note } : {})
            }
          : {})
      })
    },
    'Could not update the order.'
  );
}

/**
 * The reasons this kitchen may give for rejecting an order.
 *
 * Served by the API and scoped to the caller's role, so the partner app cannot
 * offer "I changed my mind" and the list stays the same one operations reports
 * on.
 */
export function fetchCancellationReasons() {
  return request<{ reasons: Array<{ code: string; label: string; allowsNote: boolean }> }>(
    '/orders/cancellation-reasons'
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

/**
 * Emailed reset codes are gone: no mail provider was ever configured, so the
 * old screen told partners to check an inbox for a message that was never
 * sent. A partner who is locked out telephones operations and an administrator
 * sets a temporary password, which is recorded against the administrator who
 * did it. changePassword below still applies once they are signed in.
 */
export const PASSWORD_RECOVERY_GUIDANCE =
  'Call Quick Bites operations and an administrator will set a temporary password for you. Change it from Settings once you are back in.';

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
