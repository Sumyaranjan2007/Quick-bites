import crypto from 'crypto';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { addressRepository } from '../../db/repositories/addressRepository.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { getActiveRates } from '../payments/pricingConfig.ts';
import { effectiveCharges, customerDishPrice } from '../payments/restaurantCharges.ts';
import { recordOrderEarnings } from '../payments/earnings.ts';
import { calculateDistanceKm } from '../../db/client.ts';
import { roadDistance } from '../places/routingService.ts';
import { isGoldActive, goldDiscountPercent, goldDiscountCap, goldFreeDeliveryMinOrder } from '../membership/membershipService.ts';
import { validateTransition } from './orderStateMachine.ts';
import { couponService } from './couponService.ts';
import { couponRepository } from '../../db/repositories/couponRepository.ts';
import { razorpayAdapter } from '../payments/razorpayAdapter.ts';
import {
  emitOrderCreated,
  emitOrderStatusUpdate,
  emitOrderAvailableForPickup,
  emitOpsAlert
} from '../../sockets/socketServer.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import { refundRepository } from '../../db/repositories/refundRepository.ts';
import { walletRepository } from '../../db/repositories/walletRepository.ts';
import { config } from '../../config/env.ts';
import { findCancellationReason, actorForRole } from './cancellationReasons.ts';
import { assertEnabled } from '../platform/featureFlags.ts';
import { AppError } from '../../utils/AppError.ts';
import type { Order, OrderStatus, PaymentMethod, UserRole } from '@quick-bites/shared-types';
import { isKitchenServing, nextOpensAt } from '../restaurants/openingHours.ts';

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
  /** Voluntary, paid to the rider in full. Clamped server-side; see clampTip. */
  tipAmount?: number;
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
  tipAmount?: number;
}

/**
 * The tip the server will honour, whatever the client sent.
 *
 * The tip is the only line on the bill the customer names outright, so it is the
 * only one where the client's number reaches the total. Everything else is
 * looked up — the dish price from the menu, the delivery fee from the distance —
 * and an unvalidated tip would be a way to push any amount through checkout,
 * whether by a hostile client or by a fat-fingered `50000`.
 */
function clampTip(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 100) / 100, config.MAX_TIP_AMOUNT);
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

    let partnerItemsTotal = 0;
    const pricedItems: Array<{
      dishId: string;
      name: string;
      unitPrice: number;
      quantity: number;
      partnerUnitPrice: number;
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
      /*
       * Two prices per line, and the customer pays the second.
       *
       * The kitchen set the dish price; an administrator may add a percentage
       * on top for this restaurant, and that addition is ours. Both are kept:
       * the inflated one is what the customer is charged and what their receipt
       * must show, and the raw one is what the settlement is computed from.
       *
       * Priced HERE from the stored menu rather than trusted from the request,
       * as it always was. A client that can name its own price eventually will.
       */
      const foodMarkup = effectiveCharges(restaurant.id).foodMarkupPercent;
      const customerUnitPrice = customerDishPrice(dish.price, foodMarkup);
      const customerAddons = customerDishPrice(addonsTotal, foodMarkup);

      partnerItemsTotal +=
        Math.round((dish.price + addonsTotal) * reqItem.quantity * 100) / 100;

      pricedItems.push({
        dishId: dish.id,
        name: dish.name,
        unitPrice: customerUnitPrice,
        partnerUnitPrice: dish.price,
        quantity: reqItem.quantity,
        addonsTotal: customerAddons,
        totalPrice: Math.round((customerUnitPrice + customerAddons) * reqItem.quantity * 100) / 100,
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
    // Measured along real roads, not as the crow flies. A straight line between
    // a kitchen and a door understates the ride by roughly a third in a city
    // with a river or a railway in it, and the customer was being charged for
    // the short version of a journey the rider actually rides.
    const measured =
      restaurant.coordinates && address?.coordinates
        ? await roadDistance(restaurant.coordinates, address.coordinates)
        : undefined;
    const tripDistanceKm = measured?.distanceKm ?? input.distanceKm ?? 3.5;

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

    const charges = effectiveCharges(restaurant.id, getActiveRates());
    const bill = calculateOrderPricing({
      items: pricedItems.map(i => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        addonsTotal: i.addonsTotal
      })),
      /*
       * Per-restaurant charges, from the Rates screen.
       *
       * Two packaging figures, not one: the customer pays what an
       * administrator set, the restaurant earns what it declared, and the
       * difference is platform revenue. Both are frozen onto the bill.
       */
      packagingFee: charges.customerPackagingFee,
      partnerPackagingFee: charges.partnerPackagingFee,
      partnerItemsTotal,
      gstFoodPercent: charges.gstFoodPercent,
      platformFeeBase: charges.platformFee,
      deliveryBaseFee: charges.deliveryBaseFee,
      extraCharge: charges.extraCharge,
      extraChargeLabel: charges.extraChargeLabel,
      distanceKm: tripDistanceKm,
      // Expiry-aware. `customer.isGold` alone honours a lapsed membership
      // forever, which is what `goldExpiresAt` existing and being read by
      // nothing actually meant.
      isGold: isGoldActive(customer),
      membershipDiscountPercent: goldDiscountPercent(customer),
      membershipMaxDiscount: goldDiscountCap(customer),
      memberFreeDeliveryMinOrder: goldFreeDeliveryMinOrder(customer),
      coupon: validatedCoupon,
      tipAmount: clampTip(input.tipAmount),
      // The rates an administrator has set, and this kitchen's own commission
      // where it has negotiated one. Passed in rather than left to the engine's
      // defaults so a rate change takes effect on the next order priced without
      // a deploy — and so the figure frozen onto the order is the one its
      // settlement will later be defended with.
      rates: getActiveRates(),
      commissionPercent: charges.commissionPercent
    });

    return {
      bill,
      items: pricedItems,
      /** So the cart can show the tip it will actually be charged, not the one it asked for. */
      tipAmount: bill.tipAmount,
      maxTipAmount: config.MAX_TIP_AMOUNT,
      distanceKm: tripDistanceKm,
      isGold: isGoldActive(customer),
      appliedCouponCode: appliedCode,
      couponError,
      restaurantIsOpen: isKitchenServing(restaurant) && restaurant.status === 'ACTIVE',
      unavailableItems: pricedItems.filter(i => !i.isAvailable).map(i => i.name)
    };
  },

  async createOrder(input: CreateOrderInput) {
    // Checked before the idempotency lookup so that a retry of a request sent
    // while ordering was still open is refused too: the switch is thrown to
    // stop orders reaching the kitchens now, and a replay would put one there.
    assertEnabled('ordering');
    if (input.paymentMethod === 'CASH_ON_DELIVERY') assertEnabled('cash_on_delivery');
    if (input.paymentMethod === 'RAZORPAY_SANDBOX') assertEnabled('online_payments');
    if (input.couponCode) assertEnabled('coupons');

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
    /*
     * Closed means closed, whether the partner pressed the button or their own
     * opening hours say so.
     *
     * This asked only about the manual switch, which is fine until somebody
     * forgets to press it - and then a kitchen that shut at eleven is still
     * accepting orders at two in the morning. The customer pays, waits, and is
     * refunded a meal they wanted. It is the most common complaint a food
     * platform gets, and it is not a bad dish.
     *
     * `isKitchenServing` is the one place that resolves the switch, the
     * partner's own late-night override and the declared hours against each
     * other. A restaurant that has never declared hours is unaffected.
     */
    if (!isKitchenServing(restaurant)) {
      const opensAt = nextOpensAt(restaurant.openingHours);
      throw new AppError(
        // "Closed" invites a customer to try again in five minutes. "Opens at
        // 18:00" does not, so it is said whenever it can be.
        opensAt
          ? `${restaurant.name} is closed right now. They open again at ${opensAt}.`
          : `${restaurant.name} is closed right now and is not taking orders.`,
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

    let partnerItemsTotal = 0;
    const orderItems: Array<{
      dishId: string;
      name: string;
      unitPrice: number;
      partnerUnitPrice: number;
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

      /*
       * The same two prices as the quote path, and they must agree with it.
       *
       * A quote that inflates and an order that does not would show a customer
       * one total on the cart screen and charge another at checkout — the exact
       * complaint this markup is most likely to produce if it is applied in one
       * place and not the other.
       */
      const foodMarkup = effectiveCharges(restaurant.id).foodMarkupPercent;
      const customerUnitPrice = customerDishPrice(dish.price, foodMarkup);
      const customerAddons = customerDishPrice(addonsTotal, foodMarkup);

      partnerItemsTotal += Math.round((dish.price + addonsTotal) * reqItem.quantity * 100) / 100;

      const itemTotal = (customerUnitPrice + customerAddons) * reqItem.quantity;
      orderItems.push({
        dishId: dish.id,
        name: dish.name,
        unitPrice: customerUnitPrice,
        partnerUnitPrice: dish.price,
        quantity: reqItem.quantity,
        isVeg: Boolean(dish.isVeg),
        addonsTotal: customerAddons,
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
    const measured =
      restaurant.coordinates && address.coordinates
        ? await roadDistance(restaurant.coordinates, address.coordinates)
        : undefined;
    const tripDistanceKm = measured?.distanceKm ?? input.distanceKm ?? 3.5;

    const charges = effectiveCharges(restaurant.id, getActiveRates());
    const bill = calculateOrderPricing({
      items: orderItems.map(i => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        addonsTotal: i.addonsTotal
      })),
      /*
       * Per-restaurant charges, from the Rates screen.
       *
       * Two packaging figures, not one: the customer pays what an
       * administrator set, the restaurant earns what it declared, and the
       * difference is platform revenue. Both are frozen onto the bill.
       */
      packagingFee: charges.customerPackagingFee,
      partnerPackagingFee: charges.partnerPackagingFee,
      partnerItemsTotal,
      gstFoodPercent: charges.gstFoodPercent,
      platformFeeBase: charges.platformFee,
      deliveryBaseFee: charges.deliveryBaseFee,
      extraCharge: charges.extraCharge,
      extraChargeLabel: charges.extraChargeLabel,
      distanceKm: tripDistanceKm,
      // Expiry-aware. `customer.isGold` alone honours a lapsed membership
      // forever, which is what `goldExpiresAt` existing and being read by
      // nothing actually meant.
      isGold: isGoldActive(customer),
      membershipDiscountPercent: goldDiscountPercent(customer),
      membershipMaxDiscount: goldDiscountCap(customer),
      memberFreeDeliveryMinOrder: goldFreeDeliveryMinOrder(customer),
      coupon: validatedCoupon,
      tipAmount: clampTip(input.tipAmount),
      // The rates an administrator has set, and this kitchen's own commission
      // where it has negotiated one. Passed in rather than left to the engine's
      // defaults so a rate change takes effect on the next order priced without
      // a deploy — and so the figure frozen onto the order is the one its
      // settlement will later be defended with.
      rates: getActiveRates(),
      commissionPercent: charges.commissionPercent
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

  /**
   * Rebuilds a past order's basket against today's menu.
   *
   * It deliberately does not place the order. A repeat order is placed minutes
   * or months later, and in between a dish can have been delisted, gone out of
   * stock, changed price, or the whole kitchen can have closed. Re-submitting
   * the old lines blind would either fail at checkout with an unhelpful error or
   * — worse — succeed at a price the customer did not agree to.
   *
   * So this answers the only question worth asking: of what you had last time,
   * what can you have now, and at what price. The client fills the cart from
   * `items` and shows `unavailableItems` and `removedItems` as the reason the
   * basket is smaller than the one being repeated.
   */
  async buildReorderBasket(customerId: string, orderId: string) {
    const previous = await orderRepository.findById(orderId);
    if (!previous) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    if (previous.customerId !== customerId) {
      throw new AppError('You can only reorder your own orders.', 403, 'NOT_ORDER_OWNER');
    }

    const restaurant = await restaurantRepository.findById(previous.restaurantId);
    const menu = await menuRepository.findByRestaurantId(previous.restaurantId);

    const restaurantAvailable =
      Boolean(restaurant) && restaurant!.status === 'ACTIVE' && isKitchenServing(restaurant!);

    // Reported rather than thrown: a customer looking at their history should be
    // told the kitchen is shut, not handed an error. The basket is still built,
    // so the screen can show what the repeat would contain and say why it cannot
    // be ordered yet.
    let restaurantMessage: string | undefined;
    if (!restaurant) {
      restaurantMessage = 'This restaurant is no longer on Quick Bites.';
    } else if (restaurant.status !== 'ACTIVE') {
      restaurantMessage = `${restaurant.name} is not currently accepting orders.`;
    } else if (!isKitchenServing(restaurant)) {
      const opensAt = nextOpensAt(restaurant.openingHours);
      restaurantMessage = opensAt
        ? `${restaurant.name} is closed right now. They open again at ${opensAt}.`
        : `${restaurant.name} is closed right now.`;
    }

    const liveDishes = new Map<string, any>();
    for (const cat of menu?.categories || []) {
      for (const dish of cat.items) liveDishes.set(dish.id, dish);
    }

    const items: Array<{
      dishId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      previousUnitPrice: number;
      priceChanged: boolean;
      isAvailable: boolean;
      isVeg: boolean;
      imageUrl?: string;
      selectedOptions: Array<{ groupId: string; optionId: string }>;
    }> = [];
    const removedItems: string[] = [];
    const unavailableItems: string[] = [];

    for (const line of previous.items || []) {
      const dish = liveDishes.get(line.dishId);
      if (!dish) {
        removedItems.push(line.name);
        continue;
      }
      if (!dish.isAvailable) {
        unavailableItems.push(dish.name);
      }

      // Options are re-checked against the live dish for the same reason the
      // dish is: an option group can have been edited, and carrying a stale
      // option id forward would silently drop the surcharge it used to add.
      const selectedOptions: Array<{ groupId: string; optionId: string }> = [];
      for (const sel of (line as any).selectedOptions || []) {
        const group = (dish.optionGroups || []).find((g: any) => g.id === sel.groupId);
        const option = group?.options.find((o: any) => o.id === sel.optionId);
        if (group && option) {
          selectedOptions.push({ groupId: group.id, optionId: option.id });
        }
      }

      items.push({
        dishId: dish.id,
        name: dish.name,
        quantity: line.quantity,
        unitPrice: dish.price,
        previousUnitPrice: line.unitPrice,
        priceChanged: Math.abs(Number(dish.price) - Number(line.unitPrice)) >= 0.01,
        isAvailable: Boolean(dish.isAvailable),
        isVeg: Boolean(dish.isVeg),
        imageUrl: dish.imageUrl,
        selectedOptions
      });
    }

    return {
      sourceOrderId: previous.id,
      sourceOrderNumber: previous.orderNumber,
      restaurantId: previous.restaurantId,
      restaurantName: restaurant?.name ?? previous.restaurantName,
      restaurantAvailable,
      restaurantMessage,
      items,
      removedItems,
      unavailableItems,
      /** True when every line came back at the same price and is in stock. */
      isExactRepeat:
        removedItems.length === 0 &&
        unavailableItems.length === 0 &&
        items.every(i => !i.priceChanged)
    };
  },

  /**
   * Cancels an order, records why in a form that can be counted, and returns
   * the money in the same step when money was taken.
   *
   * The refund is not a separate follow-up action. A cancellation that leaves a
   * paid customer to open a support ticket is one of the fastest ways a food
   * platform loses someone, so every path that cancels a paid order goes through
   * here and none of them can forget.
   *
   * A refund case is opened even when the gateway call succeeds immediately.
   * The case is the record that the money was owed and what happened to it, with
   * the gateway's own refund id inside it. When the gateway fails, the case
   * survives as work in the operations queue rather than the refund evaporating
   * with the failed HTTP call.
   */
  async cancelOrder(
    orderId: string,
    actor: { userId: string; name: string; role: UserRole },
    reasonCode: string,
    note?: string
  ) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    validateTransition(order.status, 'CANCELLED');

    const reason = findCancellationReason(reasonCode);
    if (!reason) {
      throw new AppError('That is not a cancellation reason we recognise.', 400, 'UNKNOWN_CANCELLATION_REASON');
    }
    const audience = actorForRole(actor.role);
    if (!reason.actors.includes(audience)) {
      throw new AppError('That cancellation reason is not available to you.', 403, 'CANCELLATION_REASON_FORBIDDEN');
    }

    // The note is kept only where the catalogue allows one. Accepting free text
    // against a specific code would let the countable reason be contradicted by
    // the sentence sitting beside it.
    const trimmedNote = reason.allowsNote ? String(note || '').trim().slice(0, 300) : '';
    const reasonText = trimmedNote ? `${reason.label.en} — ${trimmedNote}` : reason.label.en;

    const wasPaid = order.paymentStatus === 'PAID';
    const refundable = wasPaid ? Number(order.bill?.totalAmount) || 0 : 0;

    const updated = await orderRepository.recordCancellation(orderId, {
      reason: reasonText,
      reasonCode: reason.code,
      byUserId: actor.userId,
      byRole: actor.role
    });
    if (!updated) {
      throw new AppError('Failed to cancel this order.', 500, 'CANCELLATION_FAILED');
    }

    let refund: { requestId: string; amount: number; status: string; gatewayRefundId?: string } | null = null;

    if (wasPaid && refundable > 0) {
      const request = await refundRepository.create({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        raisedByUserId: actor.userId,
        raisedByRole: actor.role as any,
        raisedByName: actor.name,
        customerId: updated.customerId,
        customerName: updated.customerName,
        customerPhone: updated.customerPhone,
        restaurantId: updated.restaurantId,
        restaurantName: updated.restaurantName,
        riderId: updated.riderId,
        riderName: updated.riderName,
        reasonCode: 'ORDER_CANCELLED',
        description: `Order cancelled before delivery: ${reasonText}`,
        attachments: [],
        requestedAmount: refundable,
        orderTotal: refundable
      });

      updated.refundRequestId = request.id;

      // Money goes back the way it came. An online payment is refunded at the
      // gateway so it reaches the card or the bank the customer actually used;
      // a wallet payment is credited back to the wallet. Crediting a wallet for
      // a card payment would be handing out store credit instead of a refund,
      // which is not the same thing and is not what was agreed.
      let gatewayRefundId: string | undefined;
      let settled = false;

      if (updated.razorpayPaymentId) {
        const result = await razorpayAdapter
          .refund(updated.razorpayPaymentId, Math.round(refundable * 100))
          .catch(() => null);
        if (result) {
          gatewayRefundId = result.id;
          settled = true;
        }
      } else if (updated.paymentMethod === 'WALLET') {
        /*
         * An order paid from the customer wallet, which no longer exists.
         *
         * The wallet is gone: refunds return down the rail the money arrived
         * on, and there is nothing to credit. Orders placed from a wallet
         * balance before it was removed can still reach here, so rather than
         * crediting a balance nobody can spend, this leaves the case OPEN for
         * an administrator to settle by payout link.
         *
         * Deliberately not marked settled. Money that has not moved must never
         * be displayed as refunded — that is the one lie that stops anybody
         * looking for it.
         */
        settled = false;
      }

      if (settled) {
        await refundRepository.transition(
          request.id,
          'REFUNDED',
          { userId: 'system', name: 'Quick Bites' },
          {
            note: 'Refunded automatically on cancellation.',
            approvedAmount: refundable,
            refundTransactionId: gatewayRefundId
          }
        );
        updated.paymentStatus = 'REFUNDED';
        updated.status = 'REFUNDED';
      } else {
        // Deliberately left open rather than reported as refunded. The
        // customer's money has not moved, and the queue is where that gets
        // noticed; a green tick here would hide it.
        await refundRepository.transition(
          request.id,
          'PROCESSING',
          { userId: 'system', name: 'Quick Bites' },
          { note: 'Automatic refund could not be completed. Needs manual settlement.' }
        );
      }

      await orderRepository.save(updated);

      refund = {
        requestId: request.id,
        amount: refundable,
        status: settled ? 'REFUNDED' : 'PROCESSING',
        gatewayRefundId
      };
    }

    emitOrderStatusUpdate(updated.id, {
      orderId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
      restaurantId: updated.restaurantId
    });

    await fcmDispatcher.notifyOrderCancelled(
      updated.customerId,
      updated.id,
      updated.orderNumber,
      reasonText
    );

    return { order: updated, refund };
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

    // Saved rather than mutated in place. The object here is the same reference
    // the store holds, so memory was already correct — but nothing scheduled a
    // write, and a restart between the payment and the next unrelated write
    // would have brought the order back as unpaid with the customer's money
    // already taken.
    await orderRepository.save(order);

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

    /*
     * THE KITCHEN CAN FINISH AFTER A RIDER HAS ALREADY CLAIMED.
     *
     * The rider broadcast deliberately offers orders that are only ACCEPTED or
     * PREPARING, so a rider can set off while the food cooks. But claiming
     * moves the order to RIDER_ASSIGNED, and the state machine allows only
     * OUT_FOR_DELIVERY or CANCELLED from there - so the kitchen pressing
     * "Ready" was refused with INVALID_STATUS_TRANSITION.
     *
     * That was harmless while nothing depended on knowing the food was cooked.
     * It stopped being harmless the moment pickup started requiring it: a
     * rider who claimed early could never collect, because the kitchen could
     * never record that it had finished. A guard that can never be satisfied
     * is worse than the missing guard it replaced.
     *
     * Readiness is a FACT, not a position in a sequence. So it is recorded
     * without moving the order backwards: `readyAt` is stamped, the order
     * stays RIDER_ASSIGNED, and the rider app keeps seeing it as theirs.
     */
    if (nextStatus === 'READY_FOR_PICKUP' && order.status === 'RIDER_ASSIGNED') {
      const stamped = await orderRepository.markReadyWithoutTransition(orderId);
      emitOrderStatusUpdate(orderId, {
        orderId,
        status: stamped!.status,
        updatedAt: stamped!.updatedAt,
        restaurantId: stamped!.restaurantId
      });
      return stamped;
    }

    validateTransition(order.status, nextStatus);

    if (nextStatus === 'DELIVERED') {
      if (!otp || otp !== order.deliveryOtp) {
        throw new AppError('Invalid delivery confirmation OTP. Handover failed.', 400, 'INVALID_OTP');
      }
    }

    // Where the rider was standing when they said the food had been handed over.
    //
    // The OTP above proves the customer was involved; it does not prove the
    // rider was there, because a customer can read four digits down a phone.
    // That is the shape of the most common delivery fraud there is: mark it
    // delivered from a mile away, keep the food, tell the customer it was left
    // at the door. The distance is recorded rather than enforced — a genuine
    // handover at the gate of a gated complex looks identical from here, and
    // refusing the transition would strand an honest rider mid-trip. What it
    // gives operations is the one thing that distinguishes the two: whether the
    // same rider does it on every single order.
    if (nextStatus === 'DELIVERED' && order.riderCoordinates && order.deliveryCoordinates) {
      const distanceMetres = Math.round(
        calculateDistanceKm(
          order.riderCoordinates.latitude,
          order.riderCoordinates.longitude,
          order.deliveryCoordinates.latitude,
          order.deliveryCoordinates.longitude
        ) * 1000
      );

      if (distanceMetres > config.DELIVERY_PROXIMITY_METRES) {
        const flaggedAt = new Date().toISOString();
        await orderRepository.flagDeliveryProximity(orderId, {
          distanceMetres,
          thresholdMetres: config.DELIVERY_PROXIMITY_METRES,
          flaggedAt
        });
        emitOpsAlert({
          kind: 'DELIVERY_LOCATION_MISMATCH',
          orderId,
          orderNumber: order.orderNumber,
          restaurantId: order.restaurantId,
          detail:
            `Marked delivered ${distanceMetres} m from the delivery address ` +
            `(threshold ${config.DELIVERY_PROXIMITY_METRES} m), rider ${order.riderId || 'unknown'}.`,
          raisedAt: flaggedAt
        });
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

      /*
       * The order is complete, so the money it earned is now owed.
       *
       * Posted here rather than computed later by whoever opens a settlement
       * screen. A figure re-derived from an order changes when that order is
       * refunded, re-rated or archived — underneath a settlement that has
       * already been paid — and then nobody can say what the number was when
       * the decision was taken.
       *
       * Keyed on the order id, so the sweeper, a retried request and this call
       * all produce one posting between them.
       *
       * Deliberately not awaited into the transition's own failure path: a
       * ledger problem must not un-deliver a delivered order. It is logged, and
       * `backfillEarnings` finds anything this misses.
       */
      try {
        recordOrderEarnings(updated);
      } catch (error) {
        console.log(
          JSON.stringify({
            level: 'ERROR',
            timestamp: new Date().toISOString(),
            event: 'ORDER_EARNINGS_POST_FAILED',
            orderId: updated.id,
            reason: error instanceof Error ? error.message : String(error)
          })
        );
      }
    }

    return updated;
  }
};


