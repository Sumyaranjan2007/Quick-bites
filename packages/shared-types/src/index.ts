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
  /**
   * The role this account acts as by default.
   *
   * Kept as a single value because every token, every screen and every
   * existing record already reads it. It is the PRIMARY role - what the app
   * opens as - and it is no longer the whole answer to what somebody may do.
   * Ask `roles` for that.
   */
  role: UserRole;
  /**
   * Every role this person holds.
   *
   * A phone number identifies a PERSON, and one person is routinely more than
   * one thing: a rider orders their own dinner, a restaurant owner orders from
   * somebody else's kitchen. Before this, roles were exclusive, so signing up
   * to deliver with the number already on your customer account was refused
   * outright - "an account with this mobile number already exists" - with
   * nothing to do about it but find a second SIM.
   *
   * Making the rider registration simply overwrite `role` would have been
   * worse than refusing: placing an order requires the customer role, so the
   * moment somebody became a rider they would have lost the ability to order
   * food, and nothing would have told them why.
   *
   * Absent on every account created before this existed, which is why nothing
   * reads it directly - `rolesOf()` in userRepository falls back to `[role]`,
   * so an old account behaves exactly as it always did.
   */
  roles?: UserRole[];
  /**
   * Whether this customer holds a Gold membership.
   *
   * Never read this directly where money is decided — a flag with no regard for
   * `goldExpiresAt` honours an expired membership forever. `isGoldActive()` in
   * modules/membership/membershipService.ts is the question to ask.
   */
  isGold: boolean;
  /** When the membership lapses. Absent means it does not. */
  goldExpiresAt?: string;
  /** Which plan was bought, which is what sets the extra discount. */
  goldPlanId?: string;
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
    /** F05: each size's real price; the cheapest becomes the dish price. */
    sizes?: Array<{ name: string; price: number }>;
    /** F05: optional extras, each with its own price. */
    extras?: Array<{ name: string; price: number }>;
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
  /**
   * Absent until the partner supplies it. Optional to REGISTER, and checked
   * against the public register at approval — a kitchen cannot trade without
   * one, but it can sign up while the application is still in progress.
   */
  fssaiLicenseNumber?: string;
  gstin?: string;
  isPureVeg: boolean;
  packagingFee: number;
  /**
   * What the partner says their packaging costs them, in rupees.
   *
   * THEIR figure, and only theirs. An administrator approves it and may set a
   * markup on top, and the customer pays the sum — but this number is never
   * edited by the platform, because it is the partner's own declaration and
   * overwriting it would destroy the only record of what they actually asked
   * for.
   *
   * Absent on every restaurant that has not declared one, which falls back to
   * `packagingFee` and then to the platform default. Reading absent as zero
   * would quietly make packaging free for every existing restaurant.
   */
  partnerPackagingFee?: number;
  /**
   * When riders are offered this restaurant's trips.
   *
   * Dispatch offered every order from ACCEPTED onwards, hardcoded, so a rider
   * could be riding over while the food had not been started. That suits a
   * kitchen whose dishes take twenty minutes and wastes a rider's evening at
   * one whose dishes take three.
   *
   * READY_FOR_PICKUP by default: the owner's choice, and the safe one, because
   * food that is ready stays ready and a rider cannot be left waiting on it. A
   * restaurant with long cook times sets it earlier.
   *
   * A status rather than a lead time, deliberately. You cannot know in advance
   * when "ready" will happen, so a countdown to it gets a rider to the counter
   * at the wrong moment; a status is a fact.
   */
  riderOfferAtStatus?: 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP';
  /**
   * When they last changed that figure.
   *
   * Stamped on EVERY change, not just the first, so an administrator can tell
   * a declaration they have already approved from one that has moved since.
   * Without it, a partner could raise their packaging fee after approval and
   * nothing would mark it as needing another look.
   */
  partnerPackagingSubmittedAt?: string;
  status: RestaurantStatus;
  kycStatus: KycStatus;
  ratingAverage: number;
  ratingCount: number;
  cuisineTags: string[];
  bannerUrl?: string;
  costForTwo?: number;
  highlightTag?: string;
  /**
   * How far this kitchen will actually deliver, in kilometres.
   *
   * The area a restaurant serves is a property of the restaurant — a small
   * kitchen with one rider covers two kilometres, a chain with a fleet covers
   * eight — and listing every restaurant inside one platform-wide circle showed
   * customers kitchens that would never accept their order, and hid kitchens a
   * street away from a customer just outside the circle's edge.
   *
   * Optional because restaurants onboarded before this existed have no value
   * recorded; those fall back to the platform default rather than vanishing.
   */
  serviceRadiusKm?: number;

  /**
   * The commission rate this kitchen negotiated, as a percentage.
   *
   * Absent on almost every restaurant, and absent means the platform default
   * from the pricing configuration. Set by an administrator — never by the
   * partner, who would otherwise be naming the platform's own margin — and a
   * change never reaches an order that has already been priced.
   */
  commissionPercent?: number;

  /** Whether the kitchen is currently accepting orders. Partner-controlled. */
  isOpen: boolean;
  /** When the kitchen was last opened or closed, for the partner's own reference. */
  kitchenStatusChangedAt?: string;

  /**
   * What the kitchen says about itself, in its own words. Up to 400 characters.
   *
   * Optional, and absent on every restaurant onboarded before this existed.
   * Those keep trading and simply show no description, which is why this is not
   * defaulted to an empty string somewhere in the middle of the stack: absent
   * and blank mean different things to the partner editing it.
   */
  description?: string;

  /**
   * Up to four photographs of the place, beyond the cover.
   *
   * The cover (`bannerUrl`) is what a customer sees on a card. These are what
   * they see on the detail page, and when a kitchen has supplied neither, the
   * detail page falls back to photographs of the food.
   */
  galleryUrls?: string[];

  /**
   * The week, as the kitchen has declared it.
   *
   * Absent means never declared, which is NOT the same as closed: a restaurant
   * with no declared hours is governed entirely by `isOpen`, exactly as the
   * platform behaved before hours existed. Treating absent as closed would shut
   * every restaurant onboarded before today.
   */
  openingHours?: OpeningHours;

  /**
   * An ISO timestamp until which `isOpen` beats the declared hours.
   *
   * Hours close a kitchen the partner forgot to close. This is the partner
   * saying "I know, we are serving anyway" — a late night, a private booking,
   * a delivery-only hour after the counter shuts. It expires by itself, so
   * an override can never quietly become permanent, which is exactly the
   * failure the declared hours were introduced to fix.
   */
  forceOpenUntil?: string;
}

/* ------------------------------------------------------- opening hours */

export const DAYS_OF_WEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/**
 * One continuous serving period, as minutes from midnight, local time.
 *
 * Minutes rather than "HH:MM" because every question worth asking of this is
 * arithmetic — is now inside it, does it overlap the next one — and doing
 * arithmetic on strings is where the off-by-one lives. The apps send and render
 * "HH:MM"; it is parsed at the edge.
 *
 * A window whose `closesAt` is at or before its `opensAt` runs past midnight.
 * 22:00-02:00 is a real and common kitchen.
 */
export interface ServingWindow {
  opensAt: number;
  closesAt: number;
}

export interface OpeningHours {
  /** An absent day was never declared. An empty array is declared closed. */
  week: Partial<Record<DayOfWeek, ServingWindow[]>>;
  timezone: string;
}

/* -------------------------------------------------------- profile edits */

/** Exactly what a partner may change about themselves. Nothing outside this list. */
export const EDITABLE_PROFILE_FIELDS = [
  'name',
  'description',
  'phone',
  'addressLine',
  'city',
  'pincode',
  'coordinates',
  'cuisineTags',
  'costForTwo',
  // What the partner says packaging costs them. Reviewed like everything else
  // here, because it reaches a customer's bill.
  'partnerPackagingFee',
  'bannerUrl',
  'galleryUrls',
  'openingHours'
] as const;

export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

export interface EditableProfile {
  name: string;
  description: string;
  phone: string;
  addressLine: string;
  city: string;
  pincode: string;
  coordinates: Coordinates;
  cuisineTags: string[];
  costForTwo: number;
  partnerPackagingFee: number;
  bannerUrl: string;
  galleryUrls: string[];
  openingHours: OpeningHours;
}

/**
 * `PARTIALLY_APPROVED` is a real outcome, not a rounding of the other two.
 *
 * A reviewer can accept the hours and refuse the photograph in one pass.
 * Recording that as APPROVED or REJECTED makes the partner's own history lie to
 * them about what is live.
 */
export type ProfileEditStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIALLY_APPROVED'
  | 'SUPERSEDED';

export interface ProfileFieldRejection {
  field: EditableProfileField;
  reason: string;
}

export interface ProfileEdit {
  id: string;
  restaurantId: string;
  submittedByUserId: string;
  submittedAt: string;
  status: ProfileEditStatus;
  /** Only the fields that actually changed. Never a whole-record overwrite. */
  changes: Partial<EditableProfile>;
  /** What each changed field was at submission, so a reviewer sees before and after. */
  previous: Partial<EditableProfile>;
  approvedFields?: EditableProfileField[];
  rejections?: ProfileFieldRejection[];
  reviewedByUserId?: string;
  reviewedAt?: string;
  supersededByEditId?: string;
}

/* -------------------------------------------------------- device tokens */

export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';

/**
 * Where a push notification is actually delivered.
 *
 * One row per installed app, not per user: a partner with a phone by the pass
 * and a tablet in the office must be reached on both, and a rider who changes
 * handset must stop being reached on the old one. Keyed by the token itself,
 * because that is what the push service deduplicates on.
 */
export interface DeviceToken {
  id: string;
  userId: string;
  role: UserRole;
  token: string;
  platform: DevicePlatform;
  /** Distinguishes two installs by the same user on two devices. */
  deviceId?: string;
  appVersion?: string;
  createdAt: string;
  lastSeenAt: string;
  /**
   * Set when the push service reports the token dead. Kept rather than deleted
   * so a token that fails once in a network blip is not immediately discarded.
   */
  invalidatedAt?: string;
}

export interface OptionItem {
  id: string;
  name: string;
  priceDelta: number;
}

export interface OptionGroup {
  id: string;
  /** Set on groups built from a partner's sizes or extras (F05). */
  kind?: 'SIZE' | 'EXTRAS';
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

/*
 * WHERE THE FOOD IS. Not where the rider is - that is `riderStage`.
 *
 * `RIDER_ASSIGNED` used to live here, and it was the defect behind the bug the
 * owner reported as "the rider accepts and everything marks itself done". A
 * rider accepting is not a thing that happens to the food, but it was written
 * into the food's status, and the only transitions out of it were
 * OUT_FOR_DELIVERY and CANCELLED. So the moment a rider accepted, PREPARING and
 * READY_FOR_PICKUP became unreachable: the kitchen's buttons did nothing, and
 * pickup was then refused - correctly - because the food had never
 * legitimately passed "prepared".
 *
 * Two tracks, because two independent things are happening at once. The food
 * is cooked, finished and handed over. The rider is offered a trip, accepts,
 * rides, collects and delivers. Either can be ahead of the other, and every
 * attempt to express both as one sequence eventually has to answer "which
 * came first" for a pair that has no order.
 *
 * Persisted orders written before this change still carry 'RIDER_ASSIGNED'.
 * `normaliseLoadedStore()` rewrites them at boot, on BOTH hydration paths.
 */
export type OrderStatus =
  | 'PAYMENT_PENDING'
  | 'ORDER_PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  /**
   * The kitchen says the food physically left their counter.
   *
   * Half of a two-sided handover: the rider confirms the other half by moving
   * to OUT_FOR_DELIVERY. Both sides recording it is what settles "he never
   * collected it" - the dispute that has no answer when only one party is
   * asked.
   */
  | 'HANDED_TO_RIDER'
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
  /**
   * The delivery fee before the platform's markup. Absent on every order placed
   * before the markup existed, which is why it is optional rather than zero --
   * zero would claim those orders had no partner-side delivery fee at all.
   */
  partnerDeliveryFee?: number;
  /** What the membership took off the delivery fee. Absent on older orders. */
  membershipDeliverySaving?: number;
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
  /**
   * The commission rate this order was actually charged at, and what it came
   * to, frozen at the moment of pricing.
   *
   * A settlement drafted weeks later has to be able to say why a kitchen was
   * charged what it was charged, and a rate that has since been renegotiated
   * cannot answer that. Absent on every order placed before rates were
   * configurable; those fall back to the platform default, which is the closest
   * honest answer available for an order that never recorded one.
   */
  commissionPercent?: number;
  commissionAmount?: number;
  /** TDS withheld from the partner's share, as its own line. */
  tdsAmount?: number;
  /**
   * What the RESTAURANT earns of the packaging charge.
   *
   * `packagingFee` above is what the customer paid. Where an administrator has
   * marked packaging up for this restaurant, the two differ and the gap is
   * platform revenue. Both are frozen onto the bill so a settlement drafted
   * weeks later can prove what the markup was at the time, rather than
   * re-deriving it from a figure that may since have changed.
   *
   * Absent on orders placed before per-restaurant charges existed; those are
   * read as "no markup", which is what was true then.
   */
  partnerPackagingFee?: number;
  /** Anything else the platform charged on this order, and its name on the bill. */
  extraCharge?: number;
  extraChargeLabel?: string;
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
  /**
   * Set when an order was handed to the customer while its payment was still
   * unresolved, on a method where delivery is NOT the payment event.
   *
   * Delivery used to write `paymentStatus = 'PAID'` for every order, so a
   * prepaid order whose payment never completed was recorded as paid the
   * moment the food arrived - and settlement selects on DELIVERED without
   * consulting `paymentStatus`, so it became a payout. The food moved; the
   * money did not.
   *
   * Delivery no longer invents the payment. It records this instead, because
   * "food delivered, money not received" is a real condition somebody must
   * look at, and overwriting it is how it stops being visible to anyone.
   */
  paymentUnresolvedAt?: string;
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
  /**
   * When the kitchen said the food was ready.
   *
   * Recorded as its own fact because the STATUS cannot carry it: assigning a
   * rider overwrites `status` with RIDER_ASSIGNED, so by the time the rider
   * arrives there is nothing left to say whether the food was ever cooked.
   *
   * That is not academic. Pickup verification checked only the rider's code,
   * so a rider could confirm collection mid-cook and the order jumped to
   * OUT_FOR_DELIVERY - telling the customer their food was on its way while
   * it was still in the pan. Reported by the owner.
   */
  readyAt?: string;
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
  /**
   * When operations were told that nobody had picked this order up.
   *
   * Present so the sweeper alerts once rather than once every thirty seconds.
   * A control room that receives the same alert two hundred times stops reading
   * alerts, which is worse than having none.
   */
  riderSearchAlertedAt?: string;
  /**
   * When the customer was told the kitchen had taken this order on.
   *
   * ONE message for whichever of ACCEPTED and PREPARING arrives first. A kitchen
   * that accepts and then taps "start cooking" ten seconds later has done one
   * thing as far as the customer is concerned, and two notifications about it
   * reads as a glitch rather than as attentiveness.
   *
   * Stored on the order rather than inferred from the status, because by the time
   * PREPARING arrives the status no longer remembers that ACCEPTED happened.
   */
  customerToldKitchenHasItAt?: string;
  /** When the customer was told their delivery was in trouble. */
  customerToldLateAt?: string;
  /**
   * WHICH kind of trouble they were told about.
   *
   * Stored, because it is what decides whether there is anything new to say. A
   * customer told "running late" and then told nothing more, while the platform
   * has since lost contact with the rider entirely, has been left with the
   * reassuring version of a situation that got worse.
   *
   * The reverse is not news: a rider who starts transmitting again after going
   * silent is good news arriving as a second alarm, so it is never sent. That
   * asymmetry is the whole reason this is a tier and not a counter.
   */
  customerToldLateTier?: 'SILENT' | 'OVERDUE';
  /**
   * Set when the handover was confirmed from somewhere that is not the delivery
   * address. Not an accusation and not a block — the food may genuinely have
   * been handed over at the gate of a large complex — but the distance is
   * recorded so a rider who does it on every order can be found.
   */
  deliveryProximityFlag?: {
    /** Absent when there was no recent position to measure from. */
    distanceMetres?: number;
    thresholdMetres: number;
    flaggedAt: string;
    /**
     * FAR: the rider's recent position was further than the threshold.
     * NO_RECENT_POSITION: the last position was older than the silent-rider
     * threshold (or there was none), so no distance means anything. Absent on
     * flags written before this field existed, which were all FAR.
     */
    proximity?: 'FAR' | 'NO_RECENT_POSITION';
    /** Minutes between the rider's last position and the handover. */
    positionAgeMinutes?: number;
    /** Marked delivered by operations, whose recorded reason is the record. */
    byOperations?: boolean;
  };
  pickedUpAt?: string;
  /**
   * Wrong guesses at this order's handover codes, and when the code stops
   * being accepted. A four-digit code is proof of a handover only if it cannot
   * be guessed: without a count, 10,000 tries is an afternoon.
   */
  codeAttempts?: {
    pickupFailures?: number;
    deliveryFailures?: number;
    lockedUntil?: string;
  };
  /**
   * Riders who took this trip and handed it back before collecting, and why.
   * Kept apart from the cancellation fields: a released trip is still a live
   * order, and stamping `cancelledAt` on it made it read as cancelled.
   */
  riderReleases?: Array<{ riderId: string; reason: string; at: string }>;
  /**
   * Operations moved this trip from one rider to another (A1 takes it off,
   * A2 hands it to a named rider). After pickup the new rider has to collect
   * the bag from the old one, which is what `handoverNote` tells them.
   */
  riderReassignments?: Array<{
    fromRiderId?: string;
    toRiderId?: string;
    byUserId: string;
    reason: string;
    handoverNote?: string;
    afterPickup: boolean;
    at: string;
  }>;
  /**
   * Operations closed this order at the door because the customer could not
   * read their code (A3). `cashCollectedBy` says whether the rider took the
   * cash on a cash order; NONE means it was refused and the order was not
   * delivered, so this is only set with RIDER or on a prepaid order.
   */
  deliveredByOperations?: {
    byUserId: string;
    byName: string;
    reason: string;
    cashCollectedBy?: 'RIDER';
    at: string;
  };
  cancelledAt?: string;
  cancellationReason?: string;
  /**
   * Which reason was chosen, as a stable code rather than the sentence shown
   * on screen. The sentence is translated and will be reworded; the code is
   * what a report counts, so counting sentences would break the moment someone
   * improved the wording or the customer switched language.
   */
  cancellationReasonCode?: string;
  /**
   * True while this order holds one use of its coupon. Released when the order
   * is cancelled, so an abandoned or cancelled checkout does not burn a limited
   * campaign (or the customer's own single use).
   */
  couponRedeemed?: boolean;
  /** The food's status at the moment of cancellation. Decides the fee, and counts cash cancels. */
  cancelledFromStatus?: OrderStatus;
  /** What was kept of the bill when the customer cancelled, and what the kitchen got of it. */
  cancellationFee?: { amount: number; percent: number; kitchenShare: number };
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
  /**
   * Whether both sides of the handover were recorded, or only the rider's.
   *
   * 'BOTH'       the kitchen tapped "handed to rider" AND the rider quoted the
   *              pickup code. Neither party has to be believed.
   * 'RIDER_ONLY' the rider quoted the code and the kitchen never tapped. The
   *              collection still went through - blocking it would strand a
   *              rider holding the food because a busy kitchen forgot an
   *              button that costs them nothing to skip - but the difference
   *              is kept, because it is the whole of the evidence in a
   *              "he never collected it" dispute.
   */
  handoverWitnessedBy?: 'BOTH' | 'RIDER_ONLY';
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
   * When the cash a rider collected at the door was added to what they are
   * holding. Absent on every non-cash order, and on any cash order where it has
   * not happened yet.
   *
   * A marker rather than a derived fact, because crediting cash-in-hand is a
   * DELTA on the rider record and deltas are not idempotent. Earnings are keyed
   * on the order id and can be posted twice harmlessly; this cannot, and the
   * two delivery paths could otherwise both credit the same collection.
   */
  codCashRecordedAt?: string;
  /**
   * Set when this order's restaurant share has been drafted into a settlement,
   * so the next settlement run cannot pay for the same trading twice.
   */
  settlementId?: string;
}

/*
 * WHERE THE RIDER IS, which is a different question from where the food is.
 *
 * Runs alongside `OrderStatus`, not inside it. A rider can be at the
 * restaurant while the food is still cooking, and the food can be ready with
 * no rider yet assigned; neither is an error, and neither can be expressed if
 * the two are one sequence.
 *
 * `PICKED_UP` was called `OUT_FOR_DELIVERY`, borrowing the food status's name
 * for a different fact. Now that the tracks are separate the names should be
 * too: this one says what the RIDER did.
 *
 * Persisted orders still carry the old name; `normaliseLoadedStore()` rewrites
 * it at boot on both hydration paths.
 */
export type RiderTripStage =
  | 'UNASSIGNED'
  | 'OFFERED'
  | 'HEADING_TO_RESTAURANT'
  | 'AT_RESTAURANT'
  | 'PICKED_UP'
  | 'AT_DOORSTEP'
  | 'DELIVERED';

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
  /**
   * Trips accepted and then never collected.
   *
   * Counted, not punished. One is a puncture or a dead phone; a pattern is
   * somebody protecting their acceptance rate by taking trips they then drop,
   * which costs a customer their dinner each time. The count is what makes the
   * difference visible to operations.
   */
  noShowCount?: number;
  lastNoShowAt?: string;
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
  /**
   * The balance immediately after this entry was applied.
   *
   * Redundant by design: it can be derived by replaying every earlier entry.
   * That is exactly what makes it useful — when the stored balance and the
   * replayed one disagree, this pins the disagreement to the single entry where
   * they diverged, instead of leaving a year of history to bisect by hand.
   *
   * Optional because entries written before this field existed do not have it.
   */
  balanceAfter?: number;
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
  | 'finance.config.edit'
  | 'finance.ledger.view'
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
      { id: 'finance.reports.view', label: 'View financial reports', description: 'Period summaries and exports.' },
      { id: 'finance.config.edit', label: 'Edit rates and fees', description: 'Commission, GST, delivery, platform fee and every payout threshold.' },
      { id: 'finance.ledger.view', label: 'View the ledger', description: 'Every money movement, and the audit that proves the books balance.' }
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
  /**
   * A case returning a SECOND gateway payment on an order that was already paid.
   * That money was never part of the order, so the case does not count against
   * what the order can still have refunded.
   */
  duplicatePaymentId?: string;
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
  /**
   * Only for customers with no delivered order yet. Without it a "welcome"
   * code works for every existing customer too.
   */
  newCustomersOnly?: boolean;
  /**
   * The most this campaign may cost the platform in discounts, in rupees.
   * A usage limit counts redemptions; this caps the money. Absent = no budget.
   */
  budget?: number;
  /** Discount given so far against `budget`. Maintained by redemption and release. */
  spent?: number;
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

/* ------------------------------------------------------------------------- *
 * PRICING CONFIGURATION
 *
 * Every rate the platform charges or withholds, in one versioned record.
 *
 * Before this existed the numbers lived in source: 15% commission in the
 * pricing engine and again in the analytics module, 5% GST, a Rs 5.90 platform
 * fee, a Rs 30 delivery base. Changing any of them meant a deploy, and the two
 * copies of the commission rate could drift apart without anything noticing —
 * the revenue screen and the settlements would simply stop agreeing.
 *
 * A configuration is NEVER edited in place. An administrator changing a rate
 * creates a new version, and every order records the version it was priced
 * under. That is what makes a settlement defensible months later: "why was this
 * order commissioned at 18%" is answered by the order itself, not by whatever
 * the configuration happens to say today.
 * ------------------------------------------------------------------------- */

export interface PricingRates {
  /** GST on food. 5% for restaurant service without input tax credit. */
  gstFoodPercent: number;
  /** Charged per order unless the restaurant sets its own. */
  packagingFeeDefault: number;
  /** Delivery fee up to `deliveryBaseKm`. */
  deliveryBaseFee: number;
  deliveryBaseKm: number;
  /** Added per whole kilometre beyond the base distance. */
  deliveryPerKmBeyond: number;
  /** A member pays no delivery fee on a food total at or above this. */
  memberFreeDeliveryMinOrder: number;
  /** The flat fee, before GST is added to it. */
  platformFeeBase: number;
  /** GST on the platform fee. 18%, giving the familiar Rs 5.90 on Rs 5.00. */
  platformFeeGstPercent: number;
  /**
   * Commission taken from a restaurant, when that restaurant has no rate of its
   * own. A per-restaurant rate overrides this and is set by an administrator at
   * approval.
   */
  defaultCommissionPercent: number;
  /** GST the platform owes on its own commission. */
  commissionGstPercent: number;
  /** Income tax withheld from a partner's payout under section 194-O. */
  tdsPercent: number;
  /** Tax collected at source under GST section 52. */
  tcsPercent: number;
  /** What a rider earns for a trip before distance is counted. */
  riderBaseFeePerTrip: number;
  riderBaseKm: number;
  riderPerKmFee: number;
  /** No trip pays a rider less than this, whatever the distance. */
  riderMinEarningPerTrip: number;
  /**
   * What the CUSTOMER is charged on top of the delivery fee, as a percentage.
   *
   * The rider's earnings are computed separately and are not affected by this.
   * That is the whole point of it: the owner asked to charge more for delivery
   * than the rider is paid, and the difference is the platform's. A change here
   * must never move a rider's payout, and there is a test that asserts the
   * payout is byte-identical across a change to this number.
   *
   * Platform-wide rather than per rider, as agreed -- one number, applied to
   * every trip.
   */
  riderDeliveryMarkupPercent: number;
  /** Cash a rider may hold before the platform stops offering them COD orders. */
  codCashCeiling: number;
  /**
   * How long dispatch waits before offering a waiting trip to the NEXT group of
   * riders.
   *
   * Three minutes by default: long enough that somebody looks at their phone,
   * short enough that cooked food is not waiting on six riders who have all gone
   * to sleep.
   */
  riderOfferWaveMinutes: number;
  /**
   * How long a rider carrying food may go without sending a position before
   * operations are alerted.
   *
   * Ten minutes by default. Low enough that a rider who has come off their bike is
   * found quickly, high enough that riding through an underpass does not ring an
   * urgent alarm — and an urgent channel that cries wolf is one somebody mutes.
   */
  riderLocationSilentMinutes: number;
  /** Minutes a rider may be carrying food before the delivery is flagged late. */
  deliveryOverdueMinutes: number;
  /**
   * Days money may sit at the payment gateway before it is treated as a problem.
   *
   * Razorpay settles in about two working days. Money older than that means one of
   * two things and both need a person: a settlement arrived and nobody recorded
   * it, so the books understate the bank; or it never arrived, and somebody needs
   * to ask the gateway why.
   *
   * Three by default, which is T+2 plus a day of slack so an ordinary weekend does
   * not raise an alarm.
   */
  gatewaySettlementOverdueDays: number;
  /** Percentage of the ceiling at which the rider is warned to deposit. */
  codCashWarnPercent: number;
  /** Days after delivery before a restaurant's money becomes payable. */
  partnerHoldDays: number;
  riderHoldDays: number;
  /**
   * How often payouts are actually run, in days. 7 means a weekly payday.
   *
   * Distinct from the hold period, which is how long one order's money waits
   * before it may be paid at all. A partner can be told both honestly: when
   * their money is released, and when the next run that would send it happens.
   *
   * Cash a rider collects does NOT follow this. It comes in whenever they
   * approach the ceiling, because money in somebody's pocket for a week is a
   * float the platform is carrying and cannot see.
   */
  payoutCadenceDays: number;
  /** A payout below this carries to the next run rather than being sent. */
  minPayoutAmount: number;
  /** Payouts above this need a second administrator to approve them. */
  makerCheckerThreshold: number;
  /** Ceiling on everything the platform pays out in any 24 hours. */
  dailyPayoutCap: number;
  /** How long a refund payout link stays claimable. */
  payoutLinkExpiryHours: number;
  /** How long a door-collection QR code stays payable. Razorpay caps this at 120. */
  doorQrExpiryMinutes: number;

  /*
   * Day-one profit and abuse controls (deep-audit N2, N7, N9). Every one of
   * them defaults to "off", so adding them changes nobody's bill until the
   * owner sets a number.
   */
  /** Furthest a customer may be from the kitchen, by road. 0 = no limit. */
  maxDeliveryKm: number;
  /** Smallest food total the platform accepts. 0 = no minimum. */
  minOrderValue: number;
  /** Share of the bill kept when a customer cancels after the kitchen accepted. */
  cancelFeePercentAfterAccept: number;
  /** Share of the bill kept when a customer cancels once the food is ready or on its way. */
  cancelFeePercentAfterReady: number;
  /** Cash orders a customer may cancel or refuse before cash is switched off for them. 0 = never. */
  codCancelLimit: number;
  /**
   * Share of the GST on commission that is charged to the restaurant rather
   * than absorbed by the platform. 0 keeps today's behaviour; 100 is how Zomato
   * and Swiggy invoice it. A CA decides.
   */
  commissionGstChargedToPartnerPercent: number;
  /**
   * The least the platform must keep on an order (N11 / S6). Below it, a
   * coupon's discount is trimmed at checkout, never refused. 0 = off.
   */
  minPlatformMarginPerOrder: number;
  /**
   * A9: 1 once the customer app that shows the cancellation fee BEFORE the
   * customer confirms is on customers' phones. Until then no cancel fee can be
   * set, so nobody is charged a fee they were never shown.
   */
  cancelQuoteLiveOnPhones: number;
  /**
   * A6: staff are alerted when a restaurant rejects at least this share of its
   * recent orders. 0 = off.
   */
  rejectionAlertPercent: number;
  /** A6: 1 = also close the kitchen automatically at that rate. Off by default. */
  rejectionAutoPause: number;
}

export interface PricingConfig {
  id: string;
  /** Monotonic. Version 1 is the built-in defaults, written at first boot. */
  version: number;
  rates: PricingRates;
  /** When this version started being used to price orders. */
  effectiveFrom: string;
  createdAt: string;
  createdByUserId: string;
  /** Why the rate was changed. Required of an administrator, for the audit. */
  note?: string;
}

/* ------------------------------------------------------------------------- *
 * THE LEDGER
 *
 * Double-entry bookkeeping for every rupee the platform touches.
 *
 * Balances are NOT stored. They are derived by replaying the entries, which is
 * the only arrangement in which "the books are right" is a statement somebody
 * has checked rather than assumed. The wallet audit already worked this way and
 * this generalises it to every account on the platform.
 *
 * Amounts are integer paise. The pricing engine rounds floats at every step,
 * which is survivable for displaying a bill and is not survivable for books
 * that must sum to zero.
 * ------------------------------------------------------------------------- */

export type LedgerDirection = 'DEBIT' | 'CREDIT';

/**
 * What kind of account an entry touches. The full account id is this kind,
 * optionally followed by a colon and the id of the party it belongs to — so
 * `PARTNER_PAYABLE:rst_12` and `RIDER_CASH:rdr_4` are distinct accounts that
 * share a kind.
 */
export type LedgerAccountKind =
  /** The platform's own bank. Money genuinely in our possession. */
  | 'PLATFORM_BANK'
  /** Taken by the gateway and not yet settled to us. */
  | 'GATEWAY_RECEIVABLE'
  /** Owed to a restaurant for trading it has completed. */
  | 'PARTNER_PAYABLE'
  /** Owed to a rider for trips completed. */
  | 'RIDER_PAYABLE'
  /** Platform money a rider is physically holding after a cash delivery. */
  | 'RIDER_CASH'
  /**
   * Platform money in the office, handed over by a rider and not yet banked.
   *
   * A third location, because there are three. The rider's pocket, the office
   * drawer, and the bank are different places with different risks, and the
   * ledger previously modelled two: a cash handover posted straight to
   * PLATFORM_BANK, so from the moment a rider reached the desk the platform
   * believed it held bank money that was physically in a drawer, for however
   * many days passed before somebody walked to the branch.
   *
   * That is not a bookkeeping nicety. `rail.available()` checks whether a
   * payout gateway is configured; nothing checks whether PLATFORM_BANK holds
   * the money. A payout run funded by cash still sitting in the office is
   * marked sent, bounces at the gateway, and our own books say the funds were
   * there.
   *
   * The code already names this mistake one step earlier, about a rider's
   * pocket. The sentence applies just as well to an office.
   */
  | 'PLATFORM_CASH'
  /** Owed to a customer where the money cannot go back the way it came. */
  | 'CUSTOMER_REFUND_PAYABLE'
  | 'TAX_GST_PAYABLE'
  | 'TAX_TCS_PAYABLE'
  | 'TDS_WITHHELD'
  | 'REVENUE_COMMISSION'
  | 'REVENUE_FEES'
  /**
   * What the payment gateway keeps out of every online payment.
   *
   * Roughly 2% plus GST, deducted before the money is settled to the bank — and
   * recorded NOWHERE before this account existed. So the ledger believed the
   * platform received the full amount a customer paid, and the gap between the
   * books and the real bank statement grew with every online order.
   *
   * That gap is not a rounding error anybody could reconcile away. The owner
   * would read their statement, find it short, and have nothing in the system
   * that explains why. "Genuinely ours" overstated by the fee on every order.
   *
   * An EXPENSE, so it grows with a debit: the money left the platform, it is not
   * owed to anybody, and it is never coming back.
   */
  | 'EXPENSE_GATEWAY_FEE'
  /**
   * Money a customer has paid for food that has not been delivered yet.
   *
   * A LIABILITY, so it grows with a credit. Until the food arrives, that money
   * is not the platform's in any sense that matters: the customer can cancel and
   * it goes straight back to them.
   *
   * It exists because online money used to enter the books only at DELIVERY. An
   * order that was paid and then cancelled had its refund recorded with no
   * payment ever recorded against it, so the refund read as a pure loss — and
   * once `GATEWAY_RECEIVABLE` came into use, worse: the refund drove the
   * receivable BELOW what the gateway was really holding, and the day's
   * settlement could then never be recorded at all, because it looked larger
   * than the outstanding balance.
   *
   * So the payment is booked when the payment happens, which is also simply the
   * truthful order of events.
   */
  | 'CUSTOMER_PREPAID'
  /**
   * Bonuses promised to riders for hitting a target.
   *
   * An EXPENSE, so it grows with a debit: the platform chose to pay it, it is not
   * coming back, and it is a real cost of running the fleet that belonged in the
   * books from the start.
   *
   * It exists because incentives were credited to the customer WALLET — a balance
   * nothing on this platform can spend and that no payout has ever read. The
   * rider's Earnings screen showed the bonus as paid. So every incentive any rider
   * had ever "earned" was money they were told they had and would never receive,
   * and the only trace was a wallet row nobody looked at.
   */
  | 'EXPENSE_RIDER_INCENTIVE'
  | 'REFUNDS_PAID';

export type LedgerEvent =
  /**
   * The gateway took the customer's money, before any food moved.
   *
   * Distinct from ORDER_PAID_ONLINE, which is the moment the platform EARNS it
   * at delivery and splits it between the kitchen, the rider, the taxes and the
   * platform. These are two different events about the same money and the books
   * used to record only the second.
   */
  | 'PAYMENT_CAPTURED'
  | 'ORDER_PAID_ONLINE'
  | 'ORDER_PAID_AT_DOOR'
  | 'COD_COLLECTED'
  | 'CASH_DEPOSIT_CONFIRMED'
  /** The office cash reached the bank. */
  | 'CASH_BANKED'
  /**
   * The gateway paid us. Money moves from what they owed us into the bank, and
   * their fee is recognised as the expense it has always silently been.
   */
  | 'GATEWAY_SETTLED'
  | 'CASH_RETURNED_AT_DOOR'
  | 'PARTNER_EARNED'
  | 'RIDER_EARNED'
  | 'COMMISSION_TAKEN'
  | 'TAX_ACCRUED'
  | 'TDS_WITHHELD'
  | 'PAYOUT_SENT'
  | 'PAYOUT_FAILED'
  | 'PAYOUT_REVERSED'
  | 'REFUND_TO_SOURCE'
  | 'REFUND_BY_LINK'
  /** A rider hit an incentive target, so the platform owes them the bonus. */
  | 'RIDER_INCENTIVE_AWARDED'
  | 'SETTLEMENT_ADJUSTMENT'
  | 'MEMBERSHIP_PURCHASED'
  /** Part of a cancelled order's bill kept as a cancellation fee. */
  | 'CANCELLATION_FEE_KEPT'
  | 'CORRECTION';

export interface LedgerEntry {
  id: string;
  /**
   * Groups the postings that balance against each other.
   *
   * One transaction is one movement of money and always writes at least two
   * rows. A report that sums one side without the other is wrong, and this is
   * what lets the audit check them as a set rather than as loose rows.
   */
  transactionId: string;
  /** When the money moved, which is not always when the row was written. */
  occurredAt: string;
  event: LedgerEvent;
  /** `KIND` or `KIND:partyId`. See LedgerAccountKind. */
  account: string;
  direction: LedgerDirection;
  /** Integer paise. Never a float, never negative. */
  amountPaise: number;
  orderId?: string;
  payoutId?: string;
  refundCaseId?: string;
  cashDepositId?: string;
  /**
   * What makes this movement unique.
   *
   * Shared by every posting in one transaction, and no two TRANSACTIONS may
   * carry the same one. That is what stops a retried request, a replayed
   * webhook or a double-tapped button posting the same money twice.
   */
  idempotencyKey: string;
  /** The administrator who caused it, or 'system' for anything automatic. */
  actorUserId: string;
  /** Human-readable, and read by humans — it appears on statements. */
  narration: string;
  createdAt: string;
}

/** One side of a balanced pair, before it is written. */
export interface LedgerPosting {
  account: string;
  direction: LedgerDirection;
  amountPaise: number;
}

/** What `ledger.post` takes: an event, and the postings it balances across. */
export interface LedgerTransaction {
  event: LedgerEvent;
  occurredAt?: string;
  postings: LedgerPosting[];
  idempotencyKey: string;
  actorUserId: string;
  narration: string;
  orderId?: string;
  payoutId?: string;
  refundCaseId?: string;
  cashDepositId?: string;
}

/**
 * What the platform charged before any of this was configurable.
 *
 * Lives here, in the package both the pricing engine and the backend depend on,
 * because the previous arrangement had the commission rate written out twice —
 * once in the pricing engine and once in the analytics module — and nothing
 * would have noticed the two drifting apart. One copy, imported by both.
 *
 * Each line records where the number used to live, so "installing the
 * configuration system changed no bill" is checkable rather than asserted.
 */
export const DEFAULT_PRICING_RATES: PricingRates = {
  // pricing-engine: "GST on Food (5% for standard restaurant services without ITC)"
  gstFoodPercent: 5,
  // pricing-engine: `input.packagingFee !== undefined ? input.packagingFee : 20.00`
  packagingFeeDefault: 20,
  // pricing-engine: "Base Rs 30 for <=3km, +Rs 10/km beyond"
  deliveryBaseFee: 30,
  deliveryBaseKm: 3,
  deliveryPerKmBeyond: 10,
  /*
   * The food total at which a member's DELIVERY DISCOUNT starts applying.
   *
   * It used to gate free delivery outright -- the engine read
   * `if (input.isGold && itemsTotal >= 199) deliveryFee = 0`. That branch is
   * gone: the benefit is a percentage per plan now, and this only decides
   * whether the percentage applies. The default plans set their own floor of
   * zero, so this is the fallback for a member whose plan does not say.
   */
  memberFreeDeliveryMinOrder: 199,
  // pricing-engine: "Platform Fee: Fixed Rs 5.00 (+ 18% GST = Rs 5.90)"
  platformFeeBase: 5,
  platformFeeGstPercent: 18,
  // pricing-engine `itemsTotal * 0.15`, and analytics.ts `COMMISSION_RATE = 0.15`
  defaultCommissionPercent: 15,
  commissionGstPercent: 18,
  // pricing-engine: `const tds = itemsTotal * 0.01`
  tdsPercent: 1,
  // New: accrued by law, and previously recorded nowhere.
  tcsPercent: 1,

  // Rider earnings. Defaults agreed for the payouts rebuild.
  riderBaseFeePerTrip: 25,
  riderBaseKm: 2,
  riderPerKmFee: 6,
  riderMinEarningPerTrip: 30,
  // Starts at zero, so this lands changing nothing until somebody sets it.
  riderDeliveryMarkupPercent: 0,

  // New controls. Nothing enforced any of these before, because until the
  // payouts rebuild nothing on this platform could pay anybody.
  codCashCeiling: 3000,
  /** Minutes before a waiting trip is offered to the next group of riders. */
  riderOfferWaveMinutes: 3,
  /** Minutes of silence from a rider carrying food before operations are alerted. */
  riderLocationSilentMinutes: 10,
  /** Minutes a rider may be carrying food before the delivery is flagged late. */
  deliveryOverdueMinutes: 15,
  /** Days money may sit at the gateway before it is a problem. Razorpay is T+2. */
  gatewaySettlementOverdueDays: 3,
  codCashWarnPercent: 80,
  partnerHoldDays: 1,
  riderHoldDays: 0,
  payoutCadenceDays: 7,
  minPayoutAmount: 100,
  makerCheckerThreshold: 10000,
  dailyPayoutCap: 200000,
  payoutLinkExpiryHours: 72,
  // Razorpay closes a single-use QR at two hours whatever we ask for.
  doorQrExpiryMinutes: 15,

  maxDeliveryKm: 0,
  minOrderValue: 0,
  cancelFeePercentAfterAccept: 0,
  cancelFeePercentAfterReady: 0,
  codCancelLimit: 0,
  commissionGstChargedToPartnerPercent: 0,
  minPlatformMarginPerOrder: 0,
  cancelQuoteLiveOnPhones: 0,
  rejectionAlertPercent: 0,
  rejectionAutoPause: 0
};

/* ------------------------------------------------------------------------- *
 * PAYEE ACCOUNTS
 *
 * Where a partner's or a rider's money is actually sent.
 *
 * Before this existed there was no bank account anywhere in this platform. The
 * only banking detail it held was a PHOTOGRAPH of a bank proof in the KYC
 * queue, which a human read with their eyes, and a payout was a record of a
 * decision rather than a transfer — an administrator marked one paid and typed
 * a UTR by hand.
 *
 * -------------------------------------------------------------------------
 * THE PLATFORM STOPS HOLDING BANK NUMBERS
 * -------------------------------------------------------------------------
 * An account is verified by a penny drop, which returns a `fund_account_id`.
 * That id is what money is sent to afterwards, so the raw account number is
 * DISCARDED and only the last four digits are kept, for a human to recognise
 * the row by.
 *
 * Together with customer refunds going out by payout link — where the customer
 * types their own UPI into Razorpay's page and we never see it — the result is
 * that Quick Bites stores no full bank account number for anybody. The safest
 * data is the data you do not have.
 * ------------------------------------------------------------------------- */

export type PayeeOwnerType = 'RESTAURANT' | 'RIDER';

/** How money reaches them. A UPI id is an account for this purpose. */
export type PayeeMethod = 'BANK' | 'VPA';

export type PayeeValidationStatus =
  /** Entered, nothing checked yet. Cannot be paid to. */
  | 'UNVERIFIED'
  /** A penny drop is in flight. Cannot be paid to. */
  | 'PENDING'
  /** The bank confirmed it exists and the name matches. Payable. */
  | 'VERIFIED'
  /**
   * The account exists, but the name on it is not close enough to the name on
   * the KYC. Not payable, and queued for a human — this is the shape both an
   * honest married-name mismatch and an attempt to be paid into somebody
   * else's account arrive in, and only a person can tell them apart.
   */
  | 'NAME_MISMATCH'
  /** The bank says no such account, or the name is nothing like it. */
  | 'INVALID';

export interface PayeeAccount {
  id: string;
  ownerType: PayeeOwnerType;
  /** The restaurant id or the rider id. Never the user id. */
  ownerId: string;
  /** The user account behind them, which is who a payout is audited against. */
  ownerUserId: string;
  method: PayeeMethod;
  /** As the payee typed it, for comparison against what the bank returns. */
  holderName: string;
  /** Display only. The full number is discarded once verification succeeds. */
  accountLast4?: string;
  ifsc?: string;
  /** `name@bank`. Held whole: a VPA is not secret and is needed to pay. */
  vpa?: string;
  bankName?: string;

  validationStatus: PayeeValidationStatus;
  /** The name the BANK holds against the account. The authority, not our copy. */
  registeredName?: string;
  /** Razorpay's own 0–100 comparison of the two names. */
  nameMatchScore?: number;
  /** Why it is not verified, in words a payee can act on. */
  validationMessage?: string;
  validatedAt?: string;
  /** Which id Razorpay gave us, and what we actually pay to. */
  razorpayContactId?: string;
  razorpayFundAccountId?: string;

  /**
   * Whether this is the account payouts go to. Exactly one per owner, and the
   * platform enforces it — two defaults is a payout going somewhere nobody
   * chose.
   */
  isDefault: boolean;

  /**
   * When an administrator decided this account may receive money, and who.
   *
   * Separate from `validationStatus` because the two answer different
   * questions. Verification is the bank confirming the account exists and whose
   * name is on it; applying is a person at the platform deciding to pay it.
   * An automatic check passing is not that decision, and the owner asked
   * explicitly that nothing be payable until they have looked at it.
   *
   * Absent means not payable, whatever the validation says.
   */
  appliedAt?: string;
  appliedByAdminId?: string;

  createdAt: string;
  createdByUserId: string;
  /** Set when replaced. Kept, because a past payout points at it. */
  archivedAt?: string;
}

/* ------------------------------------------------------------------------- *
 * CASH A RIDER IS CARRYING
 * ------------------------------------------------------------------------- */

export type CashDepositStatus =
  /** The rider says they are bringing this much. Nothing has moved. */
  | 'DECLARED'
  /** An administrator counted it and it matched. */
  | 'CONFIRMED'
  /** An administrator counted it and it did not match what was declared. */
  | 'VARIANCE'
  /** The rider withdrew the declaration before bringing it in. */
  | 'CANCELLED';

export interface CashDeposit {
  id: string;
  riderId: string;
  riderUserId: string;
  riderName?: string;
  /** What the rider said they were bringing, in paise. */
  declaredPaise: number;
  /** What an administrator actually counted, in paise. */
  receivedPaise?: number;
  status: CashDepositStatus;
  /** A photo of the cash or a deposit slip, as a data URI. Optional. */
  proofUrl?: string;
  declaredAt: string;
  confirmedAt?: string;
  confirmedByUserId?: string;
  /** Required when the counted amount differs from the declared one. */
  varianceNote?: string;
  /** What the rider was holding when they declared, for the audit. */
  cashInHandAtDeclarationPaise: number;
}

/* ------------------------------------------------------------------------- *
 * PAYOUT RAILS
 *
 * How money physically leaves the platform. Multiple, deliberately: the owner
 * asked to be able to pay in any situation, and a gateway that is down at nine
 * on a Friday must not mean a rider goes unpaid for the weekend.
 *
 * Every rail writes the SAME ledger entries. Only the reference format differs.
 * That is what makes several rails safe rather than a way to lose track of
 * money.
 * ------------------------------------------------------------------------- */

export type PayoutRailId =
  /** RazorpayX API, to a verified fund account. The default. */
  | 'RAZORPAYX'
  /**
   * A link the recipient opens and enters their own account into. Used for
   * customer refunds on cash orders, where storing their bank details would be
   * the most dangerous data this platform holds.
   */
  | 'PAYOUT_LINK'
  /** An administrator transferred it by net banking and recorded the UTR. */
  | 'MANUAL_BANK'
  /** An administrator paid by UPI and recorded the reference. */
  | 'UPI_MANUAL';

export type RailResultStatus =
  | 'SENT'
  | 'QUEUED'
  | 'FAILED'
  /**
   * The request left this process and its outcome is not known — a timeout, a
   * crash mid-flight. NEVER retried blind; reconciliation asks the gateway what
   * actually happened before anything else may touch it.
   */
  | 'UNCERTAIN';
