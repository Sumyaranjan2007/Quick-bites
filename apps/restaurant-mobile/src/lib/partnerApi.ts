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

/*
 * What to do when the server says this account is no longer allowed in.
 *
 * A block now applies to the session the partner already has open rather than
 * to a next sign-in that will never happen, which means a signed-in partner can
 * be refused on the next request they make. Without this the app stays on the
 * dashboard showing stale figures, and every tap produces the same red banner
 * until they work out for themselves that they should sign out.
 *
 * Registered by the shell rather than imported from it, so this module keeps
 * knowing nothing about the screens.
 */
type SessionEndedReason = { code: 'ACCOUNT_BLOCKED' | 'ACCOUNT_NOT_FOUND'; message: string };
let onSessionEnded: ((reason: SessionEndedReason) => void) | null = null;

export function setSessionEndedHandler(handler: ((reason: SessionEndedReason) => void) | null): void {
  onSessionEnded = handler;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Pulls a usable sentence out of whatever shape the server returned. */
function messageFrom(payload: any, fallback: string): string {
  // The field issue FIRST, and this ordering is the whole point.
  //
  // The server already says exactly what is wrong and where:
  //   { error: { message: 'Request payload validation failed.',
  //              details: [{ field: 'pincode', issue: 'Enter a 6-digit pincode.' }] } }
  //
  // Reading only `message` showed a partner "Request payload validation
  // failed." and nothing else — every field looked equally guilty, and the
  // only way to find the real one was to read the server's source. The
  // detail is the useful half.
  const details = payload?.error?.details;
  if (Array.isArray(details) && details.length) {
    // Several fields can fail at once; listing them beats making someone
    // discover them one resubmission at a time.
    const issues = details
      .filter((d: any) => d?.issue)
      .map((d: any) => (d.field ? `${d.field}: ${d.issue}` : d.issue));
    if (issues.length) return issues.join('\n');
  }
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
      const message = messageFrom(payload, fallbackMessage);
      const code = payload?.error?.code;
      // Told once, and the session ends. The message is the server's own —
      // it carries the reason an administrator recorded, which is the only
      // part a partner can actually do something about.
      if (code === 'ACCOUNT_BLOCKED' || code === 'ACCOUNT_NOT_FOUND') {
        onSessionEnded?.({ code, message });
      }
      return { ok: false, message };
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
  /** The pin the owner placed on the map. */
  latitude?: number;
  longitude?: number;
  /** How far this kitchen delivers. Absent uses the platform default. */
  serviceRadiusKm?: number;
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
        isPureVeg: Boolean(input.isPureVeg),
        // Sent only when the owner actually placed a pin. Omitted, the server
        // falls back to the centre of Bengaluru and says so — which is a
        // recognisably wrong location rather than a plausible one, and that is
        // the point: a kitchen sitting in Cubbon Park is a visible fault, where
        // a quietly nudged coordinate would not be.
        ...(input.latitude !== undefined && input.longitude !== undefined
          ? { latitude: input.latitude, longitude: input.longitude }
          : {}),
        ...(input.serviceRadiusKm ? { serviceRadiusKm: input.serviceRadiusKm } : {})
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
    /** A data URI from photo.ts, already resized to fit the request body. */
    imageUrl?: string;
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

// ---------------------------------------------------------------------------
// Where settlements are paid
//
// The payee is resolved from the signed-in account on the server, never from an
// id the app sends, so there is no restaurant id in any of these paths. That is
// deliberate: a route shaped `/restaurants/:id/payee-accounts` invites exactly
// one attack, and the only defence against it is a check somebody has to
// remember to write.
// ---------------------------------------------------------------------------

export interface PayeeAccountView {
  id: string;
  method: 'BANK' | 'VPA';
  holderName: string;
  accountLast4?: string;
  ifsc?: string;
  vpa?: string;
  validationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'NAME_MISMATCH' | 'INVALID';
  validationMessage?: string;
  /** The name the bank holds. Shown on a mismatch so the partner can act on it. */
  registeredName?: string;
  nameMatchScore?: number;
  validatedAt?: string;
  isDefault: boolean;
  createdAt: string;
  isPayable: boolean;
}

export function fetchPayeeAccounts() {
  return request<{
    accounts: PayeeAccountView[];
    verificationAvailable: boolean;
    /** What the bank's answer is checked against. */
    registeredName: string;
  }>('/payee-accounts/me');
}

export function addPayeeAccount(input: {
  method: 'BANK' | 'VPA';
  holderName: string;
  accountNumber?: string;
  accountNumberConfirm?: string;
  ifsc?: string;
  vpa?: string;
}) {
  return request<{ account: PayeeAccountView }>(
    '/payee-accounts/me',
    { method: 'POST', body: JSON.stringify(input) },
    'Could not save that account.'
  );
}

export function removePayeeAccount(accountId: string) {
  return request<Record<string, never>>(
    `/payee-accounts/me/${accountId}`,
    { method: 'DELETE' },
    'Could not remove that account.'
  );
}

// ---------------------------------------------------------------------------
// The restaurant's own profile
//
// Two versions of one restaurant: what customers see, and what the partner has
// asked to change. The server never writes an edit to the live record until a
// reviewer approves it, so these calls submit intentions rather than values.
// ---------------------------------------------------------------------------

export interface OpeningHoursView {
  week: Record<string, Array<{ opensAt: number; closesAt: number }>>;
  timezone: string;
}

export interface EditableProfileView {
  name?: string;
  description?: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  pincode?: string;
  coordinates?: { latitude: number; longitude: number };
  cuisineTags?: string[];
  costForTwo?: number;
  bannerUrl?: string;
  galleryUrls?: string[];
  openingHours?: OpeningHoursView;
}

export interface ProfileRules {
  editableFields: string[];
  maxNameChars: number;
  maxDescriptionChars: number;
  maxCuisineTags: number;
  maxGalleryImages: number;
  maxImageChars: number;
  daysOfWeek: string[];
  maxWindowsPerDay: number;
  reviewNotice: string;
}

export interface ProfileResponse {
  published: EditableProfileView;
  pending: {
    id: string;
    submittedAt: string;
    changes: EditableProfileView;
    previous: EditableProfileView;
    fields: string[];
  } | null;
  kitchen: {
    status: string;
    isOpen: boolean;
    withinDeclaredHours: boolean | null;
    forceOpenUntil: string | null;
    canGoOnline: boolean;
  };
  rules: ProfileRules;
}

/**
 * The limits and the field list come from here, not from constants in this app.
 *
 * A rule changed on the server would otherwise stay stale in every APK already
 * installed, and the partner would be refused by a limit their own screen told
 * them they were within.
 */
export function fetchProfile(restaurantId: string) {
  return request<ProfileResponse>(`/restaurants/${restaurantId}/profile`);
}

export function submitProfileChanges(restaurantId: string, changes: EditableProfileView) {
  return request<{
    submitted: boolean;
    edit: { id: string; status: string; fields: string[] } | null;
    message: string;
  }>(
    `/restaurants/${restaurantId}/profile`,
    { method: 'PUT', body: JSON.stringify(changes) },
    'Could not send those changes for review.'
  );
}

export function fetchProfileEdits(restaurantId: string) {
  return request<{
    edits: Array<{
      id: string;
      submittedAt: string;
      status: string;
      fields: string[];
      changes: EditableProfileView;
      previous: EditableProfileView;
      approvedFields: string[];
      rejections: Array<{ field: string; reason: string }>;
      reviewedAt: string | null;
    }>;
  }>(`/restaurants/${restaurantId}/profile/edits`);
}

/** Minutes from now; 0 cancels. Capped server-side at twelve hours. */
export function setHoursOverride(restaurantId: string, minutes: number) {
  return request<{ forceOpenUntil: string | null; message: string }>(
    `/restaurants/${restaurantId}/hours-override`,
    { method: 'POST', body: JSON.stringify({ minutes }) },
    'Could not change your opening override.'
  );
}

// ---------------------------------------------------------------------------
// Earnings statements, and asking to be paid.
//
// The statement is the answer to "why is my settlement this much" — per order,
// with every deduction named at the rate that was frozen onto that order.
//
// The request carries NO amount. What is owed comes from the ledger when an
// administrator acts. A request that named a figure would be a partner-supplied
// number travelling towards a bank.
// ---------------------------------------------------------------------------

export interface StatementLineView {
  label: string;
  amountPaise: number;
  amount: number;
  detail?: string;
}

export interface OrderStatementView {
  orderId: string;
  orderNumber: string;
  occurredAt: string;
  lines: StatementLineView[];
  netPaise: number;
  net: number;
  /** Non-zero only when the lines cannot account for the ledger figure. */
  unexplainedPaise: number;
  settledByPayoutId?: string;
  released: boolean;
}

export interface StatementView {
  ownerName: string;
  period: { from: string; to: string };
  summary: {
    ordersCount: number;
    earned: number;
    deductions: number;
    adjustments: number;
    paid: number;
    payable: number;
    held: number;
    outstanding: number;
  };
  orders: OrderStatementView[];
  adjustments: Array<{ id: string; occurredAt: string; event: string; narration: string; amount: number }>;
  payouts: Array<{
    id: string;
    amount: number;
    state: string;
    rail: string;
    reference?: string;
    executedAt?: string;
  }>;
  holdDays: number;
}

export interface PayoutRequestView {
  id: string;
  status: 'OPEN' | 'SEEN' | 'SETTLED' | 'DECLINED' | 'WITHDRAWN';
  raisedAt: string;
  payableAtRequest: number;
  note?: string;
  declineReason?: string;
  settledAt?: string;
}

export function fetchStatement(range?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const query = params.toString();
  return request<{ statement: StatementView; openRequest: PayoutRequestView | null }>(
    `/earnings/statement${query ? `?${query}` : ''}`
  );
}

export function raisePayoutRequest(note?: string) {
  return request<{ request: PayoutRequestView }>(
    '/earnings/payout-requests',
    { method: 'POST', body: JSON.stringify(note ? { note } : {}) },
    'Could not raise that request.'
  );
}

export function withdrawPayoutRequest(requestId: string) {
  return request<{ request: PayoutRequestView }>(
    `/earnings/payout-requests/${requestId}`,
    { method: 'DELETE' },
    'Could not withdraw that request.'
  );
}

export function fetchPayoutRequests() {
  return request<{ requests: PayoutRequestView[] }>('/earnings/payout-requests');
}
