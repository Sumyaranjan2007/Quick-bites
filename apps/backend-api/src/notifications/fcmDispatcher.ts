import { config } from '../config/env.ts';

export interface PushNotificationPayload {
  userId: string;
  orderId: string;
  orderNumber: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sentAt: string;
}

class FcmNotificationDispatcher {
  private dispatchHistory: PushNotificationPayload[] = [];

  async sendPushNotification(payload: Omit<PushNotificationPayload, 'sentAt'>): Promise<PushNotificationPayload> {
    const record: PushNotificationPayload = {
      ...payload,
      sentAt: new Date().toISOString()
    };

    this.dispatchHistory.push(record);

    // In demo mode or offline, structured JSON logging is used
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: record.sentAt,
      event: 'FCM_PUSH_DISPATCHED',
      userId: record.userId,
      orderNumber: record.orderNumber,
      title: record.title,
      body: record.body,
      demoMode: config.DEMO_MODE
    }));

    return record;
  }

  async notifyOrderPlaced(userId: string, orderId: string, orderNumber: string) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Order Confirmed',
      body: `Your order #${orderNumber} has been received by the kitchen.`,
      data: { type: 'ORDER_PLACED', orderId, orderNumber }
    });
  }

  /**
   * Sent to a RIDER, not a customer: everything else here goes the other way.
   *
   * The nudge before a trip is taken back. Worded as a question rather than an
   * accusation, because the common cause is a kitchen that has not finished
   * bagging it, and telling that rider off is how you lose them.
   */
  async notifyRiderNoShowWarning(riderId: string, orderId: string, orderNumber: string, restaurantName: string) {
    return this.sendPushNotification({
      userId: riderId,
      orderId,
      orderNumber,
      title: 'Still collecting?',
      body: `Order #${orderNumber} is waiting at ${restaurantName}. It will be offered to another rider shortly.`,
      data: { type: 'NO_SHOW_WARNING', orderId, orderNumber }
    });
  }

  async notifyOrderPreparing(userId: string, orderId: string, orderNumber: string, prepMins: number = 20) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Kitchen Started Cooking',
      body: `The chef is preparing your meal (Est. ${prepMins} mins).`,
      data: { type: 'PREPARING', orderId, orderNumber, prepTime: String(prepMins) }
    });
  }

  async notifyReadyForPickup(userId: string, orderId: string, orderNumber: string, otp: string) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Food Packed & Ready',
      body: `Your order is ready. Share OTP ${otp} with your delivery partner on arrival.`,
      data: { type: 'READY_FOR_PICKUP', orderId, orderNumber, otp }
    });
  }

  async notifyOutForDelivery(userId: string, orderId: string, orderNumber: string, riderName: string = 'Delivery Partner') {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Out for Delivery',
      body: `${riderName} is on the way with your hot meal.`,
      data: { type: 'OUT_FOR_DELIVERY', orderId, orderNumber }
    });
  }

  async notifyDelivered(userId: string, orderId: string, orderNumber: string) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Order Delivered',
      body: `Your order #${orderNumber} was successfully delivered. Enjoy your meal!`,
      data: { type: 'DELIVERED', orderId, orderNumber }
    });
  }

  async notifyOrderCancelled(userId: string, orderId: string, orderNumber: string, reason: string) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'Order Cancelled',
      // The reason is included rather than left to the app to look up. A
      // cancellation notice that does not say why is the one that produces a
      // support call.
      body: `Your order #${orderNumber} was cancelled. ${reason}`,
      data: { type: 'CANCELLED', orderId, orderNumber, reason }
    });
  }

  getSentNotifications(): PushNotificationPayload[] {
    return [...this.dispatchHistory];
  }

  clearHistory(): void {
    this.dispatchHistory = [];
  }
}

export const fcmDispatcher = new FcmNotificationDispatcher();
