/**
 * Quick Bites - Shared Universal Types
 * Version 2.0.0
 */

export type UserRole = 'customer' | 'restaurant_owner' | 'rider' | 'admin' | 'super_admin';

export type LanguageCode = 'en' | 'hi' | 'kn';

export interface UserProfile {
  id: string;
  email: string;
  phone?: string;
  fullName: string;
  role: UserRole;
  isGold: boolean;
  goldExpiresAt?: string;
  preferredLanguage: LanguageCode;
  createdAt: string;
  /**
   * Set when an administrator blocks the account. A blocked user keeps their
   * history — orders, wallet, addresses — but cannot sign in, which is the
   * difference between suspending someone and deleting them.
   */
  isBlocked?: boolean;
  blockReason?: string;
  /**
   * The admin role this staff account holds. Absent on every customer, partner
   * and rider, and on staff accounts provisioned before roles existed.
   */
  adminRoleId?: string;
  /**
   * Profile photo, held as a data URI because this platform has no object
   * store. Absent means "show the initials", which is what every avatar did
   * before a photo could be set at all.
   */
  avatarUrl?: string;
  /**
   * Restaurants the customer has saved. Kept on the account rather than in the
   * screen's state so the list survives leaving the screen, signing out, and
   * moving to another device.
   */
  favouriteRestaurantIds?: string[];
}

export type RestaurantStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type KycStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Where a menu change is in the review cycle. */
export type MenuRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** What the partner is asking to do to their menu. */
export type MenuRequestKind = 'ADD_ITEM' | 'EDIT_ITEM';

/**
 * A partner's request to change their own menu, held for admin review.
 *
 * Partners do not write to the live menu directly: a dish is what the customer is
 * charged for and what the kitchen is committed to cooking, so price and
 * availability changes go through the same queue as the rest of onboarding. The
 * requested values are kept whole in `payload`, and only copied onto the menu when
 * an administrator approves.
 */
export interface MenuChangeRequest {
  id: string;
  restaurantId: string;
  restaurantName?: string;
  requestedByUserId: string;
  kind: MenuRequestKind;
  /** Present for EDIT_ITEM: the dish the partner wants changed. */
  dishId?: string;
  payload: {
    name: string;
    description?: string;
    price: number;
    isVeg: boolean;
    categoryName: string;
    imageUrl?: string;
  };
  status: MenuRequestStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  rejectionReason?: string;
  /** Set once approved, so the partner can see what the request produced. */
  resultingDishId?: string;
}

export interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  phone: string;
  addressLine: string;
  city: string;
  pincode: string;
  coordinates: Coordinates;
  fssaiLicenseNumber: string;
  gstin?: string;
  isPureVeg: boolean;
  packagingFee: number;
  status: RestaurantStatus;
  kycStatus: KycStatus;
  ratingAverage: number;
  ratingCount: number;
  cuisineTags: string[];
  bannerUrl?: string;
  costForTwo?: number;
  highlightTag?: string;
  /** Whether the kitchen is currently accepting orders. Partner-controlled. */
  isOpen: boolean;
  /** When the kitchen was last opened or closed, for the partner's own reference. */
  kitchenStatusChangedAt?: string;
}

export interface OptionItem {
  id: string;
  name: string;
  priceDelta: number;
}

export interface OptionGroup {
  id: string;
  title: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: OptionItem[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
  imageUrl?: string;
  optionGroups?: OptionGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItem[];
}

export interface RestaurantMenu {
  restaurantId: string;
  categories: MenuCategory[];
}

export type OrderStatus = 
  | 'PAYMENT_PENDING'
  | 'ORDER_PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'RIDER_ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'RAZORPAY_SANDBOX' | 'CASH_ON_DELIVERY' | 'WALLET' | 'SPLIT';

export interface OrderItemPayload {
  dishId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  isVeg?: boolean;
  addonsTotal?: number;
  selectedOptions?: Array<{ groupId: string; optionId: string; priceDelta: number }>;
  totalPrice: number;
}

export interface OrderBillBreakdown {
  itemsTotal: number;
  gstAmount: number;
  packagingFee: number;
  deliveryFee: number;
  platformFee: number;
  couponDiscount: number;
  /**
   * The rider's tip. Untaxed, uncommissioned, and paid to the rider in full on
   * top of the trip payout. Absent on every order placed before tipping existed.
   */
  tipAmount?: number;
  totalAmount: number;
  walletAmountUsed?: number;
  restaurantNetPayout: number;
}

export interface Order {
  id: string;
  idempotencyKey: string;
  orderNumber: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  restaurantId: string;
  restaurantName?: string;
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  deliveryAddressId: string;
  deliveryAddressText?: string;
  deliveryCoordinates?: Coordinates;
  /** Last known rider position for this trip, so the customer can follow it. */
  riderCoordinates?: Coordinates;
  riderBearing?: number;
  riderLocationUpdatedAt?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItemPayload[];
  bill: OrderBillBreakdown;
  preparationMinutes?: number;
  /**
   * When the kitchen took the order on. The preparation time it promised is a
   * duration, and a duration with no start cannot be counted down — without
   * this the ETA would say the same twenty minutes twenty minutes later.
   */
  acceptedAt?: string;
  pickupCode?: string;
  deliveryOtp?: string;
  /**
   * Razorpay's own order id (`order_xxx`).
   *
   * Kept because Razorpay signs what IT issued. Our order number is ours and
   * Razorpay has never seen it, so verifying a signature against the order
   * number can only pass against a mock that signs whatever it is handed.
   */
  razorpayOrderId?: string;
  /** Razorpay's payment id once captured — needed to issue a refund. */
  razorpayPaymentId?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  /** Customer's rating of the completed order, 1-5, set once after delivery. */
  rating?: number;
  ratingComment?: string;
  ratedAt?: string;
  /**
   * The customer's rating of the rider who brought it, kept apart from the
   * rating of the food so a slow kitchen does not drag a rider's score down.
   */
  riderRating?: number;
  riderRatingComment?: string;
  /** Where the rider collects the food. Copied onto the order so a rider can be
   *  routed to the kitchen without a second lookup, and so the address survives
   *  even if the restaurant later moves. */
  restaurantAddressText?: string;
  restaurantCoordinates?: Coordinates;
  restaurantPhone?: string;
  /** Kitchen-to-doorstep distance in km, used for the rider's payout and ETA. */
  distanceKm?: number;
  /** What the rider is paid for this trip, fixed when the trip is claimed. */
  riderPayout?: number;
  riderAssignedAt?: string;
  pickedUpAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  /**
   * Which reason was chosen, as a stable code rather than the sentence shown
   * on screen. The sentence is translated and will be reworded; the code is
   * what a report counts, so counting sentences would break the moment someone
   * improved the wording or the customer switched language.
   */
  cancellationReasonCode?: string;
  /** Who cancelled: the customer, the kitchen, or operations. */
  cancelledByRole?: UserRole;
  cancelledByUserId?: string;
  /**
   * The refund case opened automatically when a paid order was cancelled. A
   * cancellation that took money and opened no case is the failure this makes
   * visible.
   */
  refundRequestId?: string;
  /**
   * How far along the rider is between claiming and handing over. Held on the
   * order rather than in the app's memory, so a rider who reinstalls or reboots
   * mid-trip comes back to the stage they were actually at.
   */
  riderStage?: RiderTripStage;
  /** Riders who passed on this trip; they are not offered it again. */
  declinedByRiderIds?: string[];
  /** Riders this trip has been put in front of, counted once each, so a rider's
   *  acceptance rate can be measured against what they were actually shown. */
  offeredToRiderIds?: string[];
  /** The promo code applied at checkout, kept so support and finance can see
   *  which campaign paid for the discount on the bill. */
  couponCode?: string;
  /** Set when this trip has been included in a rider settlement, so the next
   *  payout cannot pay for it a second time. */
  payoutId?: string;
  /**
   * Set when this order's restaurant share has been drafted into a settlement,
   * so the next settlement run cannot pay for the same trading twice.
   */
  settlementId?: string;
}

/** How far along a claimed trip the rider is. */
export type RiderTripStage =
  | 'HEADING_TO_RESTAURANT'
  | 'AT_RESTAURANT'
  | 'OUT_FOR_DELIVERY'
  | 'AT_DOORSTEP';

/** A message between the customer and the rider about one order. */
export interface OrderMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderRole: 'customer' | 'rider' | 'restaurant_owner' | 'admin' | 'super_admin';
  senderName: string;
  body: string;
  sentAt: string;
}

export interface DeliveryRider {
  id: string;
  userId: string;
  /** Short human-readable partner ID, e.g. QB-RID-0042. Shown on the rider's
   *  badge and quoted to support; stable for the life of the account. */
  driverCode?: string;
  fullName: string;
  phone: string;
  /** Data URI of the rider's photo. Mandatory before going on shift, because
   *  the customer handing over cash needs to know who is at the door. */
  profilePhotoUrl?: string;
  vehicleType: 'BIKE' | 'EV' | 'CYCLE';
  licenseNumber: string;
  vehicleRcNumber?: string;
  kycStatus: KycStatus;
  isOnline: boolean;
  currentCoordinates?: Coordinates;
  lastPingAt?: string;
  /** When the rider last went on shift, so today's hours can be reported. */
  onlineSince?: string;
  lastShiftChangeAt?: string;
  /** Cash collected on COD trips and not yet deposited. */
  codCashInHand?: number;
  /**
   * Offer counters behind the acceptance rate. Derived numbers would be nicer,
   * but a declined offer leaves no trace on the order itself once another rider
   * takes it, so the count has to be kept as it happens.
   */
  offersReceived?: number;
  offersAccepted?: number;
  /** Set once name, photo, driver ID and the mandatory documents are all in. */
  profileCompletedAt?: string;
}

/** A rider's emergency alert, raised from the Safety & SOS screen. */
export interface SosAlert {
  id: string;
  riderId: string;
  riderName: string;
  riderPhone?: string;
  userId: string;
  orderId?: string;
  category: 'ACCIDENT' | 'UNSAFE_LOCATION' | 'MEDICAL' | 'VEHICLE_BREAKDOWN' | 'HARASSMENT' | 'OTHER';
  note?: string;
  coordinates?: Coordinates;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  raisedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface KycDocument {
  id: string;
  entityType: 'RESTAURANT' | 'RIDER';
  entityId: string;
  entityName?: string;
  documentType:
    | 'FSSAI'
    | 'GSTIN'
    | 'DRIVING_LICENSE'
    | 'PAN'
    | 'VEHICLE_RC'
    | 'AADHAAR'
    | 'INSURANCE'
    /** Cancelled cheque or statement header: the account payouts are sent to. */
    | 'BANK_PROOF';
  /** The number printed on the document. Reviewers must never see an invented value. */
  documentNumber?: string;
  entityAddress?: string;
  entityCity?: string;
  entityPhone?: string;
  fileUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  orderId?: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  description: string;
  createdAt: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    correlationId: string;
  };
}

/* ========================================================================== *
 *                      ADMIN CONSOLE: ACCESS CONTROL                         *
 * ========================================================================== */

/**
 * Every distinct thing an administrator can be allowed to do.
 *
 * Written out one by one rather than derived from a resource/action grid,
 * because the grid would imply combinations that do not exist — there is no
 * "create order" for staff — and a permission a screen checks for but the server
 * has never heard of fails open when it is only a string.
 *
 * The backend is the authority: `requirePermission` gates the route, and the
 * admin app hides what the signed-in account cannot use. Hiding alone was never
 * enough, since the API is reachable from anything that can hold a token.
 */
export type AdminPermission =
  // Users
  | 'users.customers.view'
  | 'users.customers.manage'
  | 'users.drivers.view'
  | 'users.drivers.manage'
  | 'users.restaurants.view'
  | 'users.restaurants.manage'
  // Orders
  | 'orders.view'
  | 'orders.detail.view'
  | 'orders.deliveries.manage'
  | 'orders.status.update'
  | 'orders.cancel'
  | 'orders.refunds.handle'
  // Restaurant & menu
  | 'catalog.restaurants.approve'
  | 'catalog.menus.view'
  | 'catalog.menus.review'
  | 'catalog.menus.edit'
  | 'catalog.categories.manage'
  // Payments & finance
  | 'finance.payments.view'
  | 'finance.revenue.view'
  | 'finance.refunds.manage'
  | 'finance.payouts.view'
  | 'finance.payouts.manage'
  | 'finance.settlements.view'
  | 'finance.settlements.manage'
  | 'finance.reports.view'
  // Marketing
  | 'marketing.coupons.manage'
  | 'marketing.promotions.manage'
  // Reviews
  | 'reviews.view'
  | 'reviews.moderate'
  // Documents
  | 'documents.view'
  | 'documents.review'
  // Support
  | 'support.tickets.view'
  | 'support.tickets.manage'
  // Analytics
  | 'analytics.dashboard.view'
  | 'analytics.orders.view'
  | 'analytics.performance.view'
  // Platform administration
  | 'admin.roles.manage'
  | 'admin.accounts.manage'
  | 'admin.audit.view'
  | 'admin.settings.manage';

/** Display grouping for the permission picker, in the order it is shown. */
export const ADMIN_PERMISSION_GROUPS: Array<{
  key: string;
  label: string;
  permissions: Array<{ id: AdminPermission; label: string; description: string }>;
}> = [
  {
    key: 'users',
    label: 'Users',
    permissions: [
      { id: 'users.customers.view', label: 'View customers', description: 'Browse customer accounts and order history.' },
      { id: 'users.customers.manage', label: 'Manage customers', description: 'Edit, block or restore a customer account.' },
      { id: 'users.drivers.view', label: 'View drivers', description: 'Browse delivery partner profiles and status.' },
      { id: 'users.drivers.manage', label: 'Manage drivers', description: 'Create, edit, suspend or reinstate a driver.' },
      { id: 'users.restaurants.view', label: 'View restaurants', description: 'Browse restaurant partners.' },
      { id: 'users.restaurants.manage', label: 'Manage restaurants', description: 'Edit, activate or suspend a restaurant.' }
    ]
  },
  {
    key: 'orders',
    label: 'Orders',
    permissions: [
      { id: 'orders.view', label: 'View all orders', description: 'See every order placed on the platform.' },
      { id: 'orders.detail.view', label: 'View order details', description: 'Open the full bill, timeline and parties.' },
      { id: 'orders.deliveries.manage', label: 'Manage live deliveries', description: 'Watch and intervene in active trips.' },
      { id: 'orders.status.update', label: 'Update order status', description: 'Move an order forward on the partner’s behalf.' },
      { id: 'orders.cancel', label: 'Handle cancellations', description: 'Cancel an order and record the reason.' },
      { id: 'orders.refunds.handle', label: 'Handle return/refund requests', description: 'Work the refund queue.' }
    ]
  },
  {
    key: 'catalog',
    label: 'Restaurant & Menu',
    permissions: [
      { id: 'catalog.restaurants.approve', label: 'Approve/reject restaurants', description: 'Decide restaurant onboarding.' },
      { id: 'catalog.menus.view', label: 'View menus', description: 'Read any partner’s catalogue.' },
      { id: 'catalog.menus.review', label: 'Approve/reject menu requests', description: 'Decide partner menu changes.' },
      { id: 'catalog.menus.edit', label: 'Add/edit/delete menu items', description: 'Write directly to a live menu.' },
      { id: 'catalog.categories.manage', label: 'Manage categories', description: 'Create and curate platform categories.' }
    ]
  },
  {
    key: 'finance',
    label: 'Payments & Finance',
    permissions: [
      { id: 'finance.payments.view', label: 'View payments', description: 'See payment transactions per order.' },
      { id: 'finance.revenue.view', label: 'View revenue analytics', description: 'Revenue, commission and trends.' },
      { id: 'finance.refunds.manage', label: 'Manage refunds', description: 'Approve and execute refunds.' },
      { id: 'finance.payouts.view', label: 'View driver payouts', description: 'See what each driver is owed.' },
      { id: 'finance.payouts.manage', label: 'Process driver payouts', description: 'Mark a payout as paid.' },
      { id: 'finance.settlements.view', label: 'View restaurant settlements', description: 'See what each restaurant is owed.' },
      { id: 'finance.settlements.manage', label: 'Process restaurant settlements', description: 'Draft and pay a restaurant settlement.' },
      { id: 'finance.reports.view', label: 'View financial reports', description: 'Period summaries and exports.' }
    ]
  },
  {
    key: 'marketing',
    label: 'Marketing',
    permissions: [
      { id: 'marketing.coupons.manage', label: 'Create/edit/delete coupons', description: 'Full control of promo codes.' },
      { id: 'marketing.promotions.manage', label: 'Manage offers & promotions', description: 'Run campaigns and banners.' }
    ]
  },
  {
    key: 'reviews',
    label: 'Reviews',
    permissions: [
      { id: 'reviews.view', label: 'View reviews', description: 'Read customer ratings and comments.' },
      { id: 'reviews.moderate', label: 'Moderate reviews', description: 'Hide or restore a published review.' }
    ]
  },
  {
    key: 'documents',
    label: 'Documents',
    permissions: [
      { id: 'documents.view', label: 'View uploaded documents', description: 'Open partner and rider KYC files.' },
      { id: 'documents.review', label: 'Approve/reject documents', description: 'Decide KYC and request re-uploads.' }
    ]
  },
  {
    key: 'support',
    label: 'Support',
    permissions: [
      { id: 'support.tickets.view', label: 'Access support requests', description: 'Read complaints raised in the apps.' },
      { id: 'support.tickets.manage', label: 'Manage complaints', description: 'Reply, escalate and close tickets.' }
    ]
  },
  {
    key: 'analytics',
    label: 'Analytics',
    permissions: [
      { id: 'analytics.dashboard.view', label: 'View dashboard', description: 'The platform overview screen.' },
      { id: 'analytics.orders.view', label: 'View order analytics', description: 'Volume, completion and cancellation.' },
      { id: 'analytics.performance.view', label: 'Driver/restaurant performance', description: 'Per-partner scorecards.' }
    ]
  },
  {
    key: 'admin',
    label: 'Platform Administration',
    permissions: [
      { id: 'admin.roles.manage', label: 'Manage admin roles', description: 'Create roles and set their permissions.' },
      { id: 'admin.accounts.manage', label: 'Manage admin accounts', description: 'Invite admins and assign roles.' },
      { id: 'admin.audit.view', label: 'View audit log', description: 'See who changed what, and when.' },
      { id: 'admin.settings.manage', label: 'Manage platform settings', description: 'Fees, radius and switches.' }
    ]
  }
];

/** Flat list of every permission, derived so the two can never disagree. */
export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = ADMIN_PERMISSION_GROUPS.flatMap(g =>
  g.permissions.map(p => p.id)
);

/**
 * A named set of permissions an admin account can be assigned.
 *
 * `isSystem` marks the roles shipped with the platform: they can be inspected
 * and assigned but not deleted, so it is impossible to lock everybody out by
 * removing the role that grants role management.
 */
export interface AdminRole {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: AdminPermission[];
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  createdByUserId?: string;
}

/**
 * One recorded administrative action.
 *
 * Written by the route that performed the change, after it succeeded, so the log
 * never claims something happened that did not. Entries are never edited.
 */
export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  before?: any;
  after?: any;
  ipAddress?: string;
  createdAt: string;
}

/* ========================================================================== *
 *                    RETURNS, REFUNDS AND SUPPORT CASES                      *
 * ========================================================================== */

/**
 * Where a refund case has got to.
 *
 * REQUESTED and PROCESSING are distinct on purpose: a case someone has picked up
 * looks different to the customer, and to the next administrator, from one still
 * sitting in the queue. REFUNDED is only reached by money actually moving.
 */
export type RefundRequestStatus =
  | 'REQUESTED'
  | 'PROCESSING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REFUNDED';

export type RefundReasonCode =
  | 'ITEM_MISSING'
  | 'WRONG_ITEM'
  | 'FOOD_QUALITY'
  | 'SPILLED_DAMAGED'
  | 'LATE_DELIVERY'
  | 'NEVER_ARRIVED'
  | 'RIDER_ISSUE'
  | 'PAYMENT_ISSUE'
  /** Raised automatically when a paid order is cancelled before it arrives. */
  | 'ORDER_CANCELLED'
  | 'OTHER';

/** One step in a refund case's history, kept so the whole file can be read back. */
export interface RefundCaseEvent {
  at: string;
  status: RefundRequestStatus;
  byUserId?: string;
  byName?: string;
  note?: string;
}

export interface RefundRequest {
  id: string;
  orderId: string;
  orderNumber: string;
  /** Who raised it — a customer disputing food, or a rider reporting a problem. */
  raisedByUserId: string;
  raisedByRole: 'customer' | 'rider' | 'restaurant_owner' | 'admin' | 'super_admin';
  raisedByName: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  restaurantId: string;
  restaurantName?: string;
  riderId?: string;
  riderName?: string;
  reasonCode: RefundReasonCode;
  description: string;
  /** Data URIs of photos the customer attached, e.g. a spilled bag. */
  attachments: string[];
  requestedAmount: number;
  approvedAmount?: number;
  orderTotal: number;
  status: RefundRequestStatus;
  timeline: RefundCaseEvent[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  handledByUserId?: string;
  handledByName?: string;
  decisionNote?: string;
  /** Set once the wallet credit has actually been written. */
  refundTransactionId?: string;
}

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/** A complaint or question raised from any of the apps. */
export interface SupportTicket {
  id: string;
  raisedByUserId: string;
  raisedByRole: UserRole;
  raisedByName: string;
  contactPhone?: string;
  orderId?: string;
  orderNumber?: string;
  subject: string;
  category: 'ORDER' | 'PAYMENT' | 'DELIVERY' | 'ACCOUNT' | 'RESTAURANT' | 'OTHER';
  message: string;
  attachments?: string[];
  status: SupportTicketStatus;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  replies: Array<{ at: string; byUserId: string; byName: string; byRole: string; body: string }>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  assignedToUserId?: string;
}

/* ========================================================================== *
 *                        MARKETING AND CATALOGUE                             *
 * ========================================================================== */

export type CouponDiscountType = 'PERCENTAGE' | 'FLAT' | 'FREE_DELIVERY';

export interface Coupon {
  code: string;
  title?: string;
  description?: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderValue?: number;
  maxDiscountCap?: number;
  startsAt?: string;
  expiresAt?: string;
  /** Total redemptions allowed across everybody. Absent means unlimited. */
  usageLimit?: number;
  /** Redemptions allowed per customer. Absent means unlimited. */
  perUserLimit?: number;
  timesUsed: number;
  /** Empty means every restaurant; otherwise only these. */
  applicableRestaurantIds?: string[];
  applicableCategories?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  createdByUserId?: string;
}

/** A platform-wide food category, used for discovery and coupon targeting. */
export interface PlatformCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

/* ========================================================================== *
 *                             DRIVER PAYOUTS                                 *
 * ========================================================================== */

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';

/**
 * One settlement to one rider for one period.
 *
 * Earnings are recomputed from delivered orders when a payout is drafted, rather
 * than read from a running total, so a trip corrected after the fact is reflected
 * in what is actually paid.
 */
/**
 * A payment from the platform to a restaurant for a period of trading.
 *
 * Deliberately the same shape of record as a rider payout: amounts computed
 * from delivered orders at the moment the settlement is drafted and then frozen,
 * so the figure that was actually transferred survives later corrections to the
 * underlying orders. A restaurant is owed the food value of what it sold, less
 * the platform's commission and the tax withheld on it.
 */
export interface RestaurantSettlement {
  id: string;
  restaurantId: string;
  restaurantName: string;
  periodStart: string;
  periodEnd: string;
  ordersCount: number;
  /** Food value of the settled orders, before any platform deduction. */
  grossSales: number;
  /** Platform commission on those orders. */
  commission: number;
  /** Tax withheld at source on the commission. */
  tds: number;
  /** Anything else withheld — refunds recovered, penalties, adjustments. */
  adjustments: number;
  /** What the restaurant is actually paid: gross less every deduction. */
  netAmount: number;
  status: PayoutStatus;
  createdAt: string;
  paidAt?: string;
  processedByUserId?: string;
  reference?: string;
  note?: string;
}

export interface RiderPayout {
  id: string;
  riderId: string;
  riderName: string;
  driverCode?: string;
  periodStart: string;
  periodEnd: string;
  tripsCompleted: number;
  tripEarnings: number;
  incentives: number;
  bonuses: number;
  /** Cash collected on COD trips that the rider still owes the platform. */
  deductions: number;
  netAmount: number;
  status: PayoutStatus;
  createdAt: string;
  paidAt?: string;
  processedByUserId?: string;
  reference?: string;
  note?: string;
}
