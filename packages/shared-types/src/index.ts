/**
 * Quick Bite - Shared Universal Types
 * Version 1.0.0
 */

export type UserRole = 'customer' | 'restaurant_owner' | 'rider' | 'super_admin';

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
  ratingAverage: number;
  ratingCount: number;
  cuisineTags: string[];
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
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'RAZORPAY_SANDBOX' | 'CASH_ON_DELIVERY';

export interface OrderItemPayload {
  dishId: string;
  name: string;
  unitPrice: number;
  quantity: number;
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
  restaurantNetPayout: number;
}

export interface Order {
  id: string;
  idempotencyKey: string;
  orderNumber: string;
  customerId: string;
  restaurantId: string;
  deliveryAddressId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItemPayload[];
  bill: OrderBillBreakdown;
  preparationMinutes?: number;
  deliveryOtp?: string;
  createdAt: string;
  updatedAt: string;
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
