import crypto from 'crypto';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { addressRepository } from '../../db/repositories/addressRepository.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { calculateDistanceKm } from '../../db/client.ts';
import { validateTransition } from './orderStateMachine.ts';
import { couponService } from './couponService.ts';
import { couponRepository } from '../../db/repositories/couponRepository.ts';
import { razorpayAdapter } from '../payments/razorpayAdapter.ts';
import { emitOrderCreated, emitOrderStatusUpdate, emitOrderAvailableForPickup } from '../../sockets/socketServer.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import { AppError } from '../../utils/AppError.ts';
import type { Order, OrderStatus, PaymentMethod } from '@quick-bites/shared-types';

export interface CreateOrderInput {
  customerId: string;
  restaurantId: string;
  deliveryAddressId: string;
  items: Array<{
    dishId: string;
    quantity: number;
    selectedOptions?: Array<{ groupId: string; optionId: string }>;
  }>;
  paymentMethod: PaymentMethod;
  couponCode?: string;
  idempotencyKey: string;
  distanceKm?: number;
}

export interface QuoteOrderInput {
  customerId: string;
  restaurantId: string;
  deliveryAddressId?: string;
  items: Array<{
    dishId: string;
    quantity: number;
    selectedOptions?: Array<{ groupId: string; optionId: string }>;
  }>;
  couponCode?: string;
  distanceKm?: number;
}

export const orderService = {
  /**
   * Prices a basket exactly the way checkout will, without creating anything.
   *
   * The cart used to compute its own bill: it hardcoded the two seeded promo
   * codes, assumed every shopper held a Gold subscription, and guessed the
   * packaging fee and the trip distance. So an administrator could create a
   * perfectly valid coupon and the app would still answer "not a valid coupon",
   * because it had never asked; and a customer without Gold was shown a waived
   * delivery fee and then charged for it, because the server priced the order
   * from the real account while the screen priced it from a guess.
   *
   * There is now one pricing authority and the cart reads from it. Anything the
   * quote cannot honour comes back as `couponError` — a sentence to show the
   * customer — rather than as a thrown error, because an unusable promo code
   * should not stop someone ordering their food.
   */
  async quoteOrder(input: QuoteOrderInput) {
    const restaurant = await restaurantRepository.findById(input.restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }

    const customer = await userRepository.findById(input.customerId);
    if (!customer) {
      throw new AppError('Customer account not found.', 404, 'CUSTOMER_NOT_FOUND');
    }

    const menu = await menuRepository.findByRestaurantId(input.restaurantId);
    if (!menu) {
      throw new AppError('Restaurant menu not found.', 404, 'MENU_NOT_FOUND');
    }

    const allDishes = new Map<string, any>();
    for (const cat of menu.categories) {
      for (const dish of cat.items) allDishes.set(dish.id, dish);
    }

    const pricedItems: Array<{
      dishId: string;
      name: string;
      unitPrice: number;
      quantity: number;
      addonsTotal: number;
      totalPrice: number;
      isAvailable: boolean;
    }> = [];

    for (const reqItem of input.items) {
      const dish = allDishes.get(reqItem.dishId);
      if (!dish) {
        throw new AppError(`Dish ID ${reqItem.dishId} does not exist in this restaurant menu.`, 400, 'INVALID_DISH_ID');
      }
      let addonsTotal = 0;
      if (reqItem.selectedOptions && dish.optionGroups) {
        for (const sel of reqItem.selectedOptions) {
          const group = dish.optionGroups.find((g: any) => g.id === sel.groupId);
          const opt = group?.options.find((o: any) => o.id === sel.optionId);
          if (opt) addonsTotal += opt.priceDelta;
        }
      }
      pricedItems.push({
        dishId: dish.id,
        name: dish.name,
        unitPrice: dish.price,
        quantity: reqItem.quantity,
        addonsTotal,
        totalPrice: Math.round((dish.price + addonsTotal) * reqItem.quantity * 100) / 100,
        // Reported rather than refused: the cart should be able to show which
        // line went out of stock while it was open, not just fail to price.
        isAvailable: Boolean(dish.isAvailable)
      });
    }

    // The same distance rule checkout uses, so the delivery fee quoted is the
    // delivery fee charged. Without a chosen address there is no second point to
    // measure to, and the client's estimate stands in.
    let address = null;
    if (input.deliveryAddressId) {
      address = await addressRepository.findById(input.deliveryAddressId);
      if (address && address.userId !== input.customerId) address = null;
    }
    const measuredDistanceKm =
      restaurant.coordinates && address?.coordinates
        ? calculateDistanceKm(
            restaurant.coordinates.latitude,
            restaurant.coordinates.longitude,
            address.coordinates.latitude,
            address.coordinates.longitude
          )
        : undefined;
    const tripDistanceKm = measuredDistanceKm ?? input.distanceKm ?? 3.5;

    let validatedCoupon = undefined;
    let couponError: string | undefined;
    let appliedCode: string | undefined;
    if (input.couponCode && String(input.couponCode).trim()) {
      const rawSubtotal = pricedItems.reduce((sum, i) => sum + i.totalPrice, 0);
      const check = couponService.validateCoupon(input.couponCode, rawSubtotal, {
        customerId: input.customerId,
        restaurantId: input.restaurantId
      });
      if (check.valid) {
        validatedCoupon = {
          discountType: check.discountType!,
          discountValue: check.discountValue!,
          maxDiscountCap: check.maxDiscountCap,
          minOrderValue: check.minOrderValue
        };
        appliedCode = String(input.couponCode).trim().toUpperCase();
      } else {
        couponError = check.reason || 'That coupon cannot be used on this order.';
      }
    }

    const bill = calculateOrderPricing({
      items: pricedItems.map(i => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        addonsTotal: i.addonsTotal
      })),
      packagingFee: Number(restaurant.packagingFee),
      distanceKm: tripDistanceKm,
      isGold: customer.isGold,
      coupon: validatedCoupon
    });

    return {
      bill,
      items: pricedItems,
      distanceKm: tripDistanceKm,
      isGold: Boolean(customer.isGold),
      appliedCouponCode: appliedCode,
      couponError,
      restaurantIsOpen: restaurant.isOpen !== false && restaurant.status === 'ACTIVE',
      unavailableItems: pricedItems.filter(i => !i.isAvailable).map(i => i.name)
    };
  },

  async createOrder(input: CreateOrderInput) {
    // 1. Check Idempotency Key (Rule 44 & 45)
    const existing = await orderRepository.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { order: existing, isDuplicate: true };
    }

    // 2. Validate Restaurant Exists & Open
    const restaurant = await restaurantRepository.findById(input.restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
    }
    if (restaurant.status !== 'ACTIVE') {
      throw new AppError('Restaurant is currently not accepting orders.', 409, 'RESTAURANT_INACTIVE');
    }
    // The comment above claimed "Exists & Open" but only status was checked, so a
    // kitchen that had switched itself offline still took orders — food ordered
    // from a closed kitchen, with nobody there to cook it.
    if (restaurant.isOpen === false) {
      throw new AppError(
        `${restaurant.name} is closed right now and is not taking orders.`,
        409,
        'RESTAURANT_CLOSED'
      );
    }

    // 3. Validate User Profile
    const customer = await userRepository.findById(input.customerId);
    if (!customer) {
      throw new AppError('Customer account not found.', 404, 'CUSTOMER_NOT_FOUND');
    }

    // 3b. The delivery address must exist AND belong to this customer —
    // otherwise anyone could post another user's address id and read it back.
    const address = await addressRepository.findById(input.deliveryAddressId);
    if (!address) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }
    if (address.userId !== input.customerId) {
      throw new AppError('That delivery address does not belong to you.', 403, 'ADDRESS_FORBIDDEN');
    }

    // 4. Verify & Fetch Live Dish Prices from Menu
    const menu = await menuRepository.findByRestaurantId(input.restaurantId);
    if (!menu) {
      throw new AppError('Restaurant menu not found.', 404, 'MENU_NOT_FOUND');
    }

    const allDishes = new Map<string, any>();
    for (const cat of menu.categories) {
      for (const dish of cat.items) {
        allDishes.set(dish.id, dish);
      }
    }

    const orderItems: Array<{
      dishId: string;
      name: string;
      unitPrice: number;
      quantity: number;
      isVeg: boolean;
      addonsTotal: number;
      selectedOptions: any[];
      totalPrice: number;
    }> = [];

    for (const reqItem of input.items) {
      const dish = allDishes.get(reqItem.dishId);
      if (!dish) {
        throw new AppError(`Dish ID ${reqItem.dishId} does not exist in this restaurant menu.`, 400, 'INVALID_DISH_ID');
      }
      if (!dish.isAvailable) {
        throw new AppError(`Item "${dish.name}" is currently out of stock.`, 409, 'DISH_OUT_OF_STOCK');
      }

      let addonsTotal = 0;
      const selectedOptionsDetails: any[] = [];

      if (reqItem.selectedOptions && dish.optionGroups) {
        for (const sel of reqItem.selectedOptions) {
          const group = dish.optionGroups.find((g: any) => g.id === sel.groupId);
          if (group) {
            const opt = group.options.find((o: any) => o.id === sel.optionId);
            if (opt) {
              addonsTotal += opt.priceDelta;
              selectedOptionsDetails.push({
                groupId: group.id,
                groupTitle: group.title,
                optionId: opt.id,
                optionName: opt.name,
                priceDelta: opt.priceDelta
              });
            }
          }
        }
      }

      const itemTotal = (dish.price + addonsTotal) * reqItem.quantity;
      orderItems.push({
        dishId: dish.id,
        name: dish.name,
        unitPrice: dish.price,
        quantity: reqItem.quantity,
        isVeg: Boolean(dish.isVeg),
        addonsTotal,
        selectedOptions: selectedOptionsDetails,
        totalPrice: Math.round(itemTotal * 100) / 100
      });
    }

    // 5. Validate Coupon
    let validatedCoupon = undefined;
    if (input.couponCode) {
      const rawSubtotal = orderItems.reduce((sum, i) => sum + i.totalPrice, 0);
      const couponCheck = couponService.validateCoupon(input.couponCode, rawSubtotal, {
        customerId: input.customerId,
        restaurantId: input.restaurantId
      });
      if (couponCheck.valid) {
        validatedCoupon = {
          discountType: couponCheck.discountType!,
          discountValue: couponCheck.discountValue!,
          maxDiscountCap: couponCheck.maxDiscountCap,
          minOrderValue: couponCheck.minOrderValue
        };
      }
    }

    // 6. Calculate Pricing Engine Bill Breakdown
    //
    // Prefer a distance measured between the two real points over whatever the
    // client claimed, falling back to the client's figure (and then to a nominal
    // 3.5 km) only when either end has no coordinates recorded.
    const measuredDistanceKm =
      restaurant.coordinates && address.coordinates
        ? calculateDistanceKm(
            restaurant.coordinates.latitude,
            restaurant.coordinates.longitude,
            address.coordinates.latitude,
            address.coordinates.longitude
          )
        : undefined;
    const tripDistanceKm = measuredDistanceKm ?? input.distanceKm ?? 3.5;

    const bill = calculateOrderPricing({
      items: orderItems.map(i => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        addonsTotal: i.addonsTotal
      })),
      packagingFee: Number(restaurant.packagingFee),
      distanceKm: tripDistanceKm,
      isGold: customer.isGold,
      coupon: validatedCoupon
    });

    // 7. Generate Delivery OTP (Rule 40)
    const deliveryOtp = crypto.randomInt(1000, 10000).toString();
    const orderNumber = 'QB-' + crypto.randomInt(100000, 1000000).toString();
    const orderId = 'ord_' + crypto.randomUUID();

    const order: Order = {
      id: orderId,
      idempotencyKey: input.idempotencyKey,
      orderNumber,
      customerId: input.customerId,
      customerName: customer.fullName,
      restaurantId: input.restaurantId,
      restaurantName: restaurant.name,
      deliveryAddressId: input.deliveryAddressId,
      deliveryAddressText: [address.addressLine, address.landmark, address.city, address.pincode]
        .filter(Boolean)
        .join(', '),
      // Carried onto the order so live tracking has a destination to measure against.
      deliveryCoordinates: address.coordinates,
      // Where the rider collects. Without these the rider app had nothing to show
      // for the pickup beyond the restaurant's name, and no coordinates to hand to
      // a maps app — "navigate to the restaurant" had nowhere to navigate to.
      restaurantAddressText: [restaurant.addressLine, restaurant.city, restaurant.pincode]
        .filter(Boolean)
        .join(', '),
      restaurantCoordinates: restaurant.coordinates,
      restaurantPhone: restaurant.phone,
      distanceKm: tripDistanceKm,
      status: input.paymentMethod === 'CASH_ON_DELIVERY' ? 'ORDER_PLACED' : 'PAYMENT_PENDING',
      paymentStatus: input.paymentMethod === 'CASH_ON_DELIVERY' ? 'PENDING' : 'PENDING',
      paymentMethod: input.paymentMethod,
      items: orderItems,
      bill,
      // Recorded only when it actually applied: a code that was typed but
      // rejected did not pay for anything, and showing it on the order would
      // make the campaign look as though it had.
      couponCode: validatedCoupon ? String(input.couponCode).trim().toUpperCase() : undefined,
      deliveryOtp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await orderRepository.create(order);

    // Counted once the order exists, so a usage limit reflects codes that were
    // actually spent rather than every checkout that looked at one.
    if (order.couponCode) {
      await couponRepository.recordRedemption(order.couponCode);
    }

    // 8. Payment is started separately, by POST /payments/start.
    //
    // This used to create the gateway order inline. That was harmless while the
    // adapter was a mock returning a fabricated id; with the real Orders API it
    // put a third-party network call inside order placement, so Razorpay being
    // slow or unreachable would take down the ability to place an order — and
    // it made the test suite depend on Razorpay being up.
    //
    // It was also not awaited. The mock was synchronous and the real one is
    // not, so the promise escaped and its rejection took the process with it.
    //
    // Creating the order first and starting payment against it explicitly is
    // also the only order of operations that lets a failed payment be retried
    // without placing a second order.
    const paymentParams = null;

    // Broadcast Real-Time Order Creation to Kitchen & Dispatch FCM Push if placed
    if (order.status === 'ORDER_PLACED') {
      emitOrderCreated(order.restaurantId, order);
      await fcmDispatcher.notifyOrderPlaced(order.customerId, order.id, order.orderNumber);
    }

    return {
      order,
      paymentParams,
      isDuplicate: false
    };
  },

  async confirmPayment(orderId: string, razorpayPaymentId: string, signature: string) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    // Against Razorpay's order id, not our order number. Razorpay signs what
    // it issued and has never seen "QB-000123"; verifying against the order
    // number matched only because the adapter used to be a mock that signed
    // whatever it was handed.
    if (!order.razorpayOrderId) {
      throw new AppError('No payment was started for this order.', 409, 'NO_PAYMENT_STARTED');
    }

    const isValid = razorpayAdapter.verifySignature({
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signature
    });

    if (!isValid) {
      throw new AppError('Invalid Razorpay payment signature.', 400, 'INVALID_PAYMENT_SIGNATURE');
    }

    order.paymentStatus = 'PAID';
    order.status = 'ORDER_PLACED';
    order.razorpayPaymentId = razorpayPaymentId;
    order.updatedAt = new Date().toISOString();

    // Broadcast to kitchen terminal and notify customer
    emitOrderCreated(order.restaurantId, order);
    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'ORDER_PLACED',
      updatedAt: order.updatedAt
    });
    await fcmDispatcher.notifyOrderPlaced(order.customerId, order.id, order.orderNumber);

    return order;
  },

  /**
   * Marks an order paid because Razorpay said so, over a verified webhook.
   *
   * Separate from confirmPayment, which is driven by the customer's device
   * returning from a checkout. This path is the authoritative one: a phone can
   * fail to come back — the app is killed, the network drops, the customer
   * closes it — and the money still moved. Without this, a paid order would sit
   * unpaid and the kitchen would never see it.
   *
   * The caller has already verified the webhook signature; this does not
   * re-check it, and must never be reachable from an unverified path.
   */
  async markPaidByGateway(
    orderId: string,
    detail: { razorpayPaymentId: string; amountPaise?: number }
  ) {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    if (order.paymentStatus === 'PAID') return order;

    order.paymentStatus = 'PAID';
    order.status = 'ORDER_PLACED';
    order.razorpayPaymentId = detail.razorpayPaymentId;
    order.updatedAt = new Date().toISOString();

    emitOrderCreated(order.restaurantId, order);
    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'ORDER_PLACED',
      updatedAt: order.updatedAt,
      restaurantId: order.restaurantId
    });
    await fcmDispatcher.notifyOrderPlaced(order.customerId, order.id, order.orderNumber);

    return order;
  },

  async transitionStatus(orderId: string, nextStatus: OrderStatus, prepMinutes?: number, otp?: string) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    validateTransition(order.status, nextStatus);

    if (nextStatus === 'DELIVERED') {
      if (!otp || otp !== order.deliveryOtp) {
        throw new AppError('Invalid delivery confirmation OTP. Handover failed.', 400, 'INVALID_OTP');
      }
    }

    const updated = await orderRepository.updateStatus(orderId, nextStatus, prepMinutes);
    if (!updated) {
      throw new AppError(`Failed to update order status for order ID: ${orderId}`, 500, 'STATUS_UPDATE_FAILED');
    }

    // 1. Emit Socket.IO real-time event to the customer, the kitchen and admin
    emitOrderStatusUpdate(orderId, {
      orderId,
      status: nextStatus,
      prepMinutes,
      updatedAt: updated.updatedAt,
      restaurantId: updated.restaurantId
    });

    // Packed food is offered to every rider waiting for work, rather than
    // sitting in a list until one of them refreshes.
    if (nextStatus === 'READY_FOR_PICKUP') {
      emitOrderAvailableForPickup({
        id: updated.id,
        orderNumber: updated.orderNumber,
        restaurantId: updated.restaurantId,
        restaurantName: (updated as any).restaurantName
      });
    }

    // 2. Dispatch FCM push notifications per status
    if (nextStatus === 'PREPARING') {
      await fcmDispatcher.notifyOrderPreparing(updated.customerId, updated.id, updated.orderNumber, prepMinutes || 20);
    } else if (nextStatus === 'READY_FOR_PICKUP') {
      await fcmDispatcher.notifyReadyForPickup(updated.customerId, updated.id, updated.orderNumber, updated.deliveryOtp || '');
    } else if (nextStatus === 'OUT_FOR_DELIVERY') {
      await fcmDispatcher.notifyOutForDelivery(updated.customerId, updated.id, updated.orderNumber);
    } else if (nextStatus === 'DELIVERED') {
      await fcmDispatcher.notifyDelivered(updated.customerId, updated.id, updated.orderNumber);
    }

    return updated;
  }
};


