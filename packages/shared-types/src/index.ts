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
}

export type RestaurantStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type KycStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface Coordinates {
  latitude: number;
  longitude: number;
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
  isOpen: boolean;
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
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItemPayload[];
  bill: OrderBillBreakdown;
  preparationMinutes?: number;
  pickupCode?: string;
  deliveryOtp?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface DeliveryRider {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  vehicleType: 'BIKE' | 'EV' | 'CYCLE';
  licenseNumber: string;
  vehicleRcNumber?: string;
  kycStatus: KycStatus;
  isOnline: boolean;
  currentCoordinates?: Coordinates;
  lastPingAt?: string;
}

export interface KycDocument {
  id: string;
  entityType: 'RESTAURANT' | 'RIDER';
  entityId: string;
  entityName?: string;
  documentType: 'FSSAI' | 'GSTIN' | 'DRIVING_LICENSE' | 'PAN' | 'VEHICLE_RC';
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
