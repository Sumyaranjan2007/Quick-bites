import crypto from 'crypto';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../../db/repositories/menuRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { calculateOrderPricing } from '@quick-bites/pricing-engine';
import { validateTransition } from './orderStateMachine.ts';
import { couponService } from './couponService.ts';
import { razorpayAdapter } from '../payments/razorpayAdapter.ts';
import { emitOrderCreated, emitOrderStatusUpdate } from '../../sockets/socketServer.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
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

export const orderService = {
  async createOrder(input: CreateOrderInput) {
    // 1. Check Idempotency Key (Rule 44 & 45)
    const existing = await orderRepository.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { order: existing, isDuplicate: true };
    }

    // 2. Validate Restaurant Exists & Open
    const restaurant = await restaurantRepository.findById(input.restaurantId);
    if (!restaurant) {
      throw new Error('Restaurant not found.');
    }
    if (restaurant.status !== 'ACTIVE') {
      throw new Error('Restaurant is currently not accepting orders.');
    }

    // 3. Validate User Profile
    const customer = await userRepository.findById(input.customerId);
    if (!customer) {
      throw new Error('Customer account not found.');
    }

    // 4. Verify & Fetch Live Dish Prices from Menu
    const menu = await menuRepository.findByRestaurantId(input.restaurantId);
    if (!menu) {
      throw new Error('Restaurant menu not found.');
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
      addonsTotal: number;
      selectedOptions: any[];
      totalPrice: number;
    }> = [];

    for (const reqItem of input.items) {
      const dish = allDishes.get(reqItem.dishId);
      if (!dish) {
        throw new Error(`Dish ID ${reqItem.dishId} does not exist in this restaurant menu.`);
      }
      if (!dish.isAvailable) {
        throw new Error(`Item "${dish.name}" is currently out of stock.`);
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
        addonsTotal,
        selectedOptions: selectedOptionsDetails,
        totalPrice: Math.round(itemTotal * 100) / 100
      });
    }

    // 5. Validate Coupon
    let validatedCoupon = undefined;
    if (input.couponCode) {
      const rawSubtotal = orderItems.reduce((sum, i) => sum + i.totalPrice, 0);
      const couponCheck = couponService.validateCoupon(input.couponCode, rawSubtotal);
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
    const bill = calculateOrderPricing({
      items: orderItems.map(i => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        addonsTotal: i.addonsTotal
      })),
      packagingFee: Number(restaurant.packagingFee),
      distanceKm: input.distanceKm || 3.5,
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
      restaurantId: input.restaurantId,
      deliveryAddressId: input.deliveryAddressId,
      status: input.paymentMethod === 'CASH_ON_DELIVERY' ? 'ORDER_PLACED' : 'PAYMENT_PENDING',
      paymentStatus: input.paymentMethod === 'CASH_ON_DELIVERY' ? 'PENDING' : 'PENDING',
      paymentMethod: input.paymentMethod,
      items: orderItems,
      bill,
      deliveryOtp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await orderRepository.create(order);

    // 8. Payment Initiation
    let paymentParams = null;
    if (input.paymentMethod === 'RAZORPAY_SANDBOX') {
      paymentParams = razorpayAdapter.createOrder({
        amountInPaise: Math.round(bill.totalAmount * 100),
        orderNumber: order.orderNumber
      });
    }

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
    if (!order) throw new Error('Order not found.');

    const isValid = razorpayAdapter.verifySignature({
      razorpayOrderId: order.orderNumber,
      razorpayPaymentId,
      razorpaySignature: signature
    });

    if (!isValid) {
      throw new Error('Invalid Razorpay payment signature.');
    }

    order.paymentStatus = 'PAID';
    order.status = 'ORDER_PLACED';
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

  async transitionStatus(orderId: string, nextStatus: OrderStatus, prepMinutes?: number, otp?: string) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new Error('Order not found.');

    validateTransition(order.status, nextStatus);

    if (nextStatus === 'DELIVERED') {
      if (!otp || otp !== order.deliveryOtp) {
        throw new Error('Invalid delivery confirmation OTP. Handover failed.');
      }
    }

    const updated = await orderRepository.updateStatus(orderId, nextStatus, prepMinutes);
    if (!updated) {
      throw new Error(`Failed to update order status for order ID: ${orderId}`);
    }

    // 1. Emit Socket.IO real-time event to order room and admin control tower
    emitOrderStatusUpdate(orderId, {
      orderId,
      status: nextStatus,
      prepMinutes,
      updatedAt: updated.updatedAt
    });

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


