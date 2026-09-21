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

/**
 * What the app does when the server says this account may no longer act.
 *
 * Registered by the shell rather than imported from it, so this module goes on
 * knowing nothing about the screens.
 */
type SessionEndedReason = { code: 'ACCOUNT_BLOCKED' | 'ACCOUNT_NOT_FOUND'; message: string };
let onSessionEnded: ((reason: SessionEndedReason) => void) | null = null;

export function setSessionEndedHandler(handler: ((reason: SessionEndedReason) => void) | null): void {
  onSessionEnded = handler;
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
    // Field issues before the generic wrapper. The server names the field and
    // says what is wrong with it; showing only 'Request payload validation
    // failed.' hides the one piece of information a rider needs to fix it.
    const details = body?.error?.details;
    const fieldIssues =
      Array.isArray(details) && details.length
        ? details
            .filter((d: any) => d?.issue)
            .map((d: any) => (d.field ? `${d.field}: ${d.issue}` : d.issue))
            .join('\n')
        : '';

    const message =
      fieldIssues ||
      body?.error?.message ||
      (typeof body?.error === 'string' ? body.error : null) ||
      body?.message ||
      'Something went wrong. Please try again.';
    const code = body?.error?.code || 'REQUEST_FAILED';
    /*
     * The account was blocked, or removed, while the app was open.
     *
     * A block now applies to the session a rider already holds rather than to
     * a next sign-in that a blocked account is never going to make, so the
     * refusal arrives on whatever call happens next — a shift toggle, a
     * telemetry ping, an offer. Left alone, the rider stays on a dashboard
     * that refuses everything with no explanation of why.
     */
    if (code === 'ACCOUNT_BLOCKED' || code === 'ACCOUNT_NOT_FOUND') {
      onSessionEnded?.({ code, message });
    }
    throw new ApiError(message, code, res.status);
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

  /**
   * Where this rider is while waiting for work.
   *
   * Separate from `telemetry`, which reports a position during a delivery and
   * is broadcast to the customer watching it. This one is never shown to a
   * customer; it exists so offers can be sorted by how far the rider actually
   * has to ride to collect.
   */
  shiftLocation(ctx: ApiContext, body: { lat: number; lng: number }) {
    return request<{ recorded: boolean }>(ctx, '/riders/location', {
      method: 'POST',
      body: JSON.stringify(body)
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

  /**
   * Registers a rider, pending approval.
   *
   * A rider could not previously get onto the platform at all: the only rider
   * account was seeded, sharing one password held in a single deployment's
   * environment. Registration creates the login and the delivery-partner record
   * together, both pending — the rider can sign in and upload documents, but
   * cannot start a shift until an administrator approves them.
   */
  register(
    apiUrl: string,
    input: {
      fullName: string;
      email: string;
      phone: string;
      password: string;
      vehicleType: 'BIKE' | 'EV' | 'CYCLE';
      licenseNumber: string;
      vehicleRegistrationNumber?: string;
    }
  ) {
    return request<{ token: string; user: any; rider: any; awaitingApproval: boolean }>(
      { apiUrl },
      '/auth/register/rider',
      {
        method: 'POST',
        body: JSON.stringify({
          fullName: input.fullName.trim(),
          email: input.email.trim().toLowerCase(),
          phone: input.phone.trim(),
          password: input.password,
          vehicleType: input.vehicleType,
          licenseNumber: input.licenseNumber.trim(),
          vehicleRegistrationNumber: input.vehicleRegistrationNumber?.trim() || undefined
        })
      }
    );
  },

  /* ---------------------------- Password ------------------------------- *
   * Emailed reset codes are gone: no mail provider was ever configured, so
   * that screen told riders to check an inbox for a message that was never
   * sent. A rider who is locked out telephones operations and an
   * administrator sets a temporary password, which is recorded against the
   * administrator who did it. `changePassword` below still requires being
   * signed in.
   * --------------------------------------------------------------------- */


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
  },

  /* --------------------------- Payout account ---------------------------- *
   * Where this rider's earnings are actually sent.
   *
   * No rider id in any of these paths. The server resolves which rider is
   * asking from the token, so there is no id to change in a request in order to
   * read or replace somebody else's bank details.
   * ----------------------------------------------------------------------- */

  payeeAccounts(ctx: ApiContext) {
    return request<PayeeAccountsResponse>(ctx, '/payee-accounts/me');
  },

  addPayeeAccount(
    ctx: ApiContext,
    input: {
      method: 'BANK' | 'VPA';
      holderName: string;
      accountNumber?: string;
      accountNumberConfirm?: string;
      ifsc?: string;
      vpa?: string;
    }
  ) {
    // A penny drop is a real round trip to a bank. The default budget is not
    // always enough, and a timeout here reads to the rider as a refusal.
    return request<{ account: PayeeAccount }>(
      ctx,
      '/payee-accounts/me',
      { method: 'POST', body: JSON.stringify(input) },
      45000
    );
  },

  removePayeeAccount(ctx: ApiContext, accountId: string) {
    return request<Record<string, never>>(ctx, `/payee-accounts/me/${accountId}`, { method: 'DELETE' });
  }
};

export interface PayeeAccount {
  id: string;
  method: 'BANK' | 'VPA';
  holderName: string;
  accountLast4?: string;
  ifsc?: string;
  vpa?: string;
  validationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'NAME_MISMATCH' | 'INVALID';
  validationMessage?: string;
  /** The name the bank holds. Shown on a mismatch so the rider can act on it. */
  registeredName?: string;
  nameMatchScore?: number;
  validatedAt?: string;
  isDefault: boolean;
  createdAt: string;
  isPayable: boolean;
}

export interface PayeeAccountsResponse {
  accounts: PayeeAccount[];
  verificationAvailable: boolean;
  /** What the bank's answer is checked against. */
  registeredName: string;
}

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

/* --------------------------- Cash and the door ---------------------------- *
 * No rider id in any path: the server resolves who is asking from the token,
 * so there is nothing to change in a request to collect against somebody
 * else's order or deposit against somebody else's cash.
 * -------------------------------------------------------------------------- */

export interface DoorQrView {
  qrId: string;
  imageUrl: string;
  amount: number;
  amountLabel: string;
  expiresAt: string;
  orderNumber: string;
}

export interface CashStandingView {
  cashInHand: number;
  ceiling: number;
  canTakeCod: boolean;
  shouldWarn: boolean;
  message: string | null;
  pendingDeposit: CashDepositView | null;
  history: CashDepositView[];
}

export interface CashDepositView {
  id: string;
  declaredPaise: number;
  receivedPaise?: number;
  status: 'DECLARED' | 'CONFIRMED' | 'VARIANCE' | 'CANCELLED';
  declaredAt: string;
  confirmedAt?: string;
  varianceNote?: string;
}

export const cashApi = {
  /** Creates the QR the rider shows at the door. */
  collectOnline(ctx: ApiContext, orderId: string) {
    return request<{ qr: DoorQrView }>(ctx, `/cash/orders/${orderId}/collect-online`, { method: 'POST' });
  },

  /**
   * Has it been paid?
   *
   * Asked of the GATEWAY, not of this app. The rider's phone can ask; it can
   * never assert that an order was paid.
   */
  doorPaymentStatus(ctx: ApiContext, orderId: string) {
    return request<{ paid: boolean; status?: string; alreadySettled?: boolean; message: string }>(
      ctx,
      `/cash/orders/${orderId}/door-payment`
    );
  },

  /** Customer would rather pay cash after all. */
  cancelOnline(ctx: ApiContext, orderId: string) {
    return request<Record<string, never>>(ctx, `/cash/orders/${orderId}/cancel-online`, { method: 'POST' });
  },

  standing(ctx: ApiContext) {
    return request<CashStandingView>(ctx, '/cash/me');
  },

  declareDeposit(ctx: ApiContext, amount: number) {
    return request<{ deposit: CashDepositView }>(ctx, '/cash/deposits', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
  },

  cancelDeposit(ctx: ApiContext, depositId: string) {
    return request<{ deposit: CashDepositView }>(ctx, `/cash/deposits/${depositId}`, { method: 'DELETE' });
  }
};
