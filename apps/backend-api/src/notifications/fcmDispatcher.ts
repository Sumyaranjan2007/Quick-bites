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

  getSentNotifications(): PushNotificationPayload[] {
    return [...this.dispatchHistory];
  }

  clearHistory(): void {
    this.dispatchHistory = [];
  }
}

export const fcmDispatcher = new FcmNotificationDispatcher();
