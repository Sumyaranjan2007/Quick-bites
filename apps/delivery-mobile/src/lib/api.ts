/**
 * Every call the rider app makes to Quick Bites.
 *
 * Wrapped in one place so that error handling is uniform: the server answers
 * with `{ success, data, error }`, and a rider should never be shown a raw
 * status code. `ApiError` carries the server's own message, which is written
 * for the rider ("Finish your profile before going online: Profile photo"),
 * so screens can surface it directly.
 */
import { apiFetch } from './apiFetch';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'REQUEST_FAILED', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiContext {
  apiUrl: string;
  token?: string;
}

async function request<T>(
  ctx: ApiContext,
  path: string,
  init: RequestInit = {},
  timeoutMs?: number
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {})
  };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;

  let res: Response;
  try {
    res = await apiFetch(`${ctx.apiUrl}${path}`, { ...init, headers }, timeoutMs);
  } catch (err: any) {
    throw new ApiError(
      err?.name === 'TimeoutError'
        ? err.message
        : 'Could not reach Quick Bites. Check your mobile data and try again.',
      'NETWORK',
      0
    );
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('The server sent a reply the app could not read.', 'BAD_RESPONSE', res.status);
  }

  if (!res.ok || body?.success === false) {
    const message =
      body?.error?.message ||
      (typeof body?.error === 'string' ? body.error : null) ||
      body?.message ||
      'Something went wrong. Please try again.';
    throw new ApiError(message, body?.error?.code || 'REQUEST_FAILED', res.status);
  }

  return body.data as T;
}

export const api = {
  login(apiUrl: string, email: string, password: string) {
    return request<{ token: string; user: { id: string; email: string; fullName: string } }>(
      { apiUrl },
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password, role: 'rider' }) }
    );
  },

  me(ctx: ApiContext) {
    return request<MeResponse>(ctx, '/riders/me');
  },

  updateProfile(ctx: ApiContext, patch: Record<string, unknown>) {
    return request<{ rider: Rider; profile: ProfileCompletion }>(ctx, '/riders/me', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    // A profile photo is a few hundred kilobytes over mobile data; the default
    // 15-second budget is not always enough for it.
    }, 45000);
  },

  dashboard(ctx: ApiContext) {
    return request<DashboardResponse>(ctx, '/riders/dashboard');
  },

  setShift(ctx: ApiContext, isOnline: boolean) {
    return request<{ rider: Rider; isOnline: boolean }>(ctx, '/riders/shift', {
      method: 'POST',
      body: JSON.stringify({ isOnline })
    });
  },

  logout(ctx: ApiContext) {
    return request<unknown>(ctx, '/riders/logout', { method: 'POST', body: '{}' });
  },

  broadcasts(ctx: ApiContext) {
    return request<{ broadcasts: Trip[]; offline?: boolean; busy?: boolean }>(ctx, '/riders/orders/broadcast');
  },

  activeTrip(ctx: ApiContext) {
    return request<{ order: Trip | null }>(ctx, '/riders/orders/active');
  },

  claim(ctx: ApiContext, orderId: string) {
    return request<{ order: Trip }>(ctx, `/riders/orders/${orderId}/claim`, { method: 'POST', body: '{}' });
  },

  decline(ctx: ApiContext, orderId: string) {
    return request<unknown>(ctx, `/riders/orders/${orderId}/decline`, { method: 'POST', body: '{}' });
  },

  setStage(ctx: ApiContext, orderId: string, stage: TripStage) {
    return request<{ stage: TripStage }>(ctx, `/riders/orders/${orderId}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stage })
    });
  },

  verifyPickup(ctx: ApiContext, orderId: string, pickupCode: string) {
    return request<{ order: Trip }>(ctx, `/riders/orders/${orderId}/verify-pickup`, {
      method: 'POST',
      body: JSON.stringify({ pickupCode })
    });
  },

  verifyDelivery(ctx: ApiContext, orderId: string, deliveryOtp: string) {
    return request<DeliveryResult>(ctx, `/riders/orders/${orderId}/verify-otp`, {
      method: 'POST',
      body: JSON.stringify({ deliveryOtp })
    });
  },

  cancelTrip(ctx: ApiContext, orderId: string, reason: string) {
    return request<unknown>(ctx, `/riders/orders/${orderId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  telemetry(ctx: ApiContext, body: { orderId: string; lat: number; lng: number; bearing?: number }) {
    return request<{ updatedAt: string }>(ctx, '/riders/telemetry', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  documents(ctx: ApiContext) {
    return request<{ documents: DocumentRequirement[] }>(ctx, '/riders/documents');
  },

  uploadDocument(ctx: ApiContext, body: { documentType: string; documentNumber: string; fileUrl: string }) {
    return request<{ profile: ProfileCompletion }>(ctx, '/riders/documents', {
      method: 'POST',
      body: JSON.stringify(body)
    }, 45000);
  },

  ratings(ctx: ApiContext) {
    return request<RatingsResponse>(ctx, '/riders/ratings');
  },

  /**
   * What the platform owes this rider, and what it has already paid.
   *
   * The earnings screen could show what had been earned but never whether it had
   * been settled; a rider could not answer "have I been paid for Tuesday?".
   * Reads the same payout records the admin console drafts from.
   */
  settlements(ctx: ApiContext) {
    return request<SettlementsResponse>(ctx, '/riders/settlements');
  },

  /** The conversation with the customer on the trip in hand. */
  orderMessages(ctx: ApiContext, orderId: string) {
    return request<{ messages: OrderMessage[] }>(ctx, `/orders/${orderId}/messages`);
  },

  sendOrderMessage(ctx: ApiContext, orderId: string, body: string) {
    return request<{ message: OrderMessage }>(ctx, `/orders/${orderId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  },

  incentives(ctx: ApiContext) {
    return request<{ incentives: Incentive[]; earnedThisPeriod: number; nextTarget: Incentive | null }>(
      ctx,
      '/riders/incentives'
    );
  },

  trips(ctx: ApiContext, range: 'week' | 'all' = 'week') {
    return request<TripsResponse>(ctx, `/riders/trips?range=${range}`);
  },

  policies(ctx: ApiContext) {
    return request<{ policies: PolicySummary[] }>(ctx, '/riders/policies');
  },

  policy(ctx: ApiContext, id: string) {
    return request<{ policy: Policy }>(ctx, `/riders/policies/${id}`);
  },

  raiseSos(ctx: ApiContext, body: { category: string; note?: string; orderId?: string; lat?: number; lng?: number }) {
    return request<{ alert: SosAlert }>(ctx, '/riders/sos', { method: 'POST', body: JSON.stringify(body) });
  },

  sosHistory(ctx: ApiContext) {
    return request<{ alerts: SosAlert[] }>(ctx, '/riders/sos');
  },

  /* ---------------------------- Password ------------------------------- *
   * A rider who forgets their password is locked out of their own shift, so
   * these do not require being signed in — only `changePassword` does. The
   * reset code is delivered by the server; where no mail provider is wired up
   * it comes back in the response and the screen says so.
   * --------------------------------------------------------------------- */

  forgotPassword(apiUrl: string, email: string) {
    return request<{ sent: boolean; resetCode?: string; expiresInMinutes: number }>(
      { apiUrl },
      '/auth/forgot-password',
      { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) }
    );
  },

  resetPassword(apiUrl: string, input: { email: string; code: string; newPassword: string }) {
    return request<{ reset: boolean; token: string }>({ apiUrl }, '/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        code: input.code.trim(),
        newPassword: input.newPassword
      })
    });
  },

  changePassword(ctx: ApiContext, currentPassword: string, newPassword: string) {
    return request<{ changed: boolean }>(ctx, '/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  /** Raises a complaint from the rider's Safety or Help screen. */
  raiseSupportTicket(
    ctx: ApiContext,
    input: { subject: string; category: string; message: string; orderId?: string }
  ) {
    return request<{ ticket: any }>(ctx, '/support/tickets', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  /** Opens a refund/return case, e.g. a rider reporting a spilled order. */
  raiseRefundRequest(
    ctx: ApiContext,
    input: { orderId: string; reasonCode: string; description: string; requestedAmount?: number }
  ) {
    return request<{ request: any }>(ctx, '/support/refund-requests', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }
};

/* ------------------------------- Shapes ---------------------------------- */

export type TripStage = 'HEADING_TO_RESTAURANT' | 'AT_RESTAURANT' | 'OUT_FOR_DELIVERY' | 'AT_DOORSTEP';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Rider {
  id: string;
  userId: string;
  driverCode?: string;
  fullName: string;
  phone: string;
  email?: string;
  profilePhotoUrl?: string;
  vehicleType: 'BIKE' | 'EV' | 'CYCLE';
  licenseNumber?: string;
  vehicleRcNumber?: string;
  kycStatus: string;
  isOnline: boolean;
  codCashInHand?: number;
  onlineSince?: string;
}

export interface ProfileCompletion {
  complete: boolean;
  missing: string[];
  requirements: Array<{ key: string; label: string; satisfied: boolean; detail?: string }>;
}

export interface Trip {
  id: string;
  orderNumber: string;
  status: string;
  stage: TripStage;
  restaurantId: string;
  restaurantName: string;
  pickupAddress: string;
  pickupCoordinates?: Coordinates;
  pickupPhone?: string;
  customerName?: string;
  customerPhone?: string;
  dropAddress: string;
  dropCoordinates?: Coordinates;
  distanceKm?: number;
  itemCount: number;
  items: Array<{ name: string; quantity: number }>;
  estimatedEarnings: number;
  paymentMode: 'COD' | 'PREPAID';
  cashToCollect: number;
  orderTotal: number;
  placedAt: string;
  assignedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

export interface Metrics {
  todayEarnings: number;
  todayTrips: number;
  todayCashCollected: number;
  weekEarnings: number;
  weekTrips: number;
  totalEarnings: number;
  totalTrips: number;
  acceptanceRate: number;
  offersReceived: number;
  offersAccepted: number;
  averageRating: number | null;
  ratedTripCount: number;
  incentivesEarned: number;
  onlineMinutesToday: number;
  walletBalance: number;
  codCashInHand: number;
}

export interface Incentive {
  code: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unit: 'trips' | 'rating';
  reward: number;
  period: 'DAY' | 'WEEK';
  achieved: boolean;
  paid: boolean;
  paidAt?: string;
}

export interface TripSummary {
  orderId: string;
  orderNumber: string;
  restaurantName?: string;
  dropAddress?: string;
  deliveredAt?: string;
  payout: number;
  distanceKm?: number;
  paymentMode: string;
  cashCollected: number;
  rating?: number;
  ratingComment?: string;
}

export interface DashboardResponse {
  rider: Rider;
  wallet: { balance: number; currency: string };
  profile: ProfileCompletion;
  metrics: Metrics;
  incentives: Incentive[];
  activeOrder: Trip | null;
  recentTrips: TripSummary[];
  generatedAt: string;
}

export interface MeResponse {
  rider: Rider;
  wallet: { balance: number; currency: string };
  profile: ProfileCompletion;
  documents: Array<{ documentType: string; status: string; documentNumber?: string }>;
}

export interface DocumentRequirement {
  documentType: string;
  label: string;
  required: boolean;
  instructions: string;
  status: 'NOT_UPLOADED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  documentNumber?: string;
  rejectionReason?: string;
  submittedAt?: string;
  reviewedAt?: string;
  canReupload: boolean;
}

export interface RatingsResponse {
  average: number | null;
  total: number;
  distribution: Array<{ stars: number; count: number }>;
  reviews: Array<{
    orderId: string;
    orderNumber: string;
    rating: number;
    comment: string | null;
    customerName?: string;
    restaurantName?: string;
    ratedAt?: string;
  }>;
}

export interface TripsResponse {
  range: string;
  trips: TripSummary[];
  totals: { trips: number; earnings: number; distanceKm: number; cashCollected: number };
  byDay: Array<{ day: string; trips: number; earnings: number }>;
}

export interface DeliveryResult {
  payout: number;
  walletBalance: number | null;
  cashCollected: number;
  codCashInHand: number;
  metrics: Metrics;
  incentivesAwarded: Incentive[];
}

export interface PolicySummary {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface Policy extends PolicySummary {
  sections: Array<{ heading: string; body: string }>;
}

export interface SosAlert {
  id: string;
  category: string;
  note?: string;
  status: string;
  raisedAt: string;
}


/** One message in the customer/rider conversation about an order. */
export interface OrderMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  body: string;
  sentAt: string;
}

export interface SettlementsResponse {
  summary: {
    tripsAllTime: number;
    tripsAwaitingSettlement: number;
    tripEarningsPending: number;
    incentivesPending: number;
    cashInHand: number;
    netPending: number;
    paidToDate: number;
    lastSettledAt: string | null;
  };
  history: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    tripsCompleted: number;
    tripEarnings: number;
    incentives: number;
    bonuses: number;
    deductions: number;
    netAmount: number;
    status: string;
    createdAt: string;
    paidAt?: string;
    reference?: string;
    note?: string;
  }>;
  pendingTrips: Array<{
    orderId: string;
    orderNumber: string;
    deliveredAt: string;
    earning: number;
    paymentMethod: string;
    cashCollected: number;
  }>;
}
