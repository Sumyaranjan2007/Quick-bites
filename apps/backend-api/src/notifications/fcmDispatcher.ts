import { config } from '../config/env.ts';
import { deviceTokenRepository } from '../db/repositories/deviceTokenRepository.ts';
import { sendToTokens, pushIsConfigured } from './fcmTransport.ts';

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

    /*
     * THIS USED TO BE THE WHOLE NOTIFICATION SYSTEM.
     *
     * Nine call sites, a payload with a title and a body, and a line written
     * to standard output. Every notification this platform has ever "sent"
     * went to the log. Nothing reached a phone, and nothing ever could,
     * because there was no device token anywhere in the system.
     *
     * The delivery is deliberately not awaited by the caller's caller: an
     * order must not fail to be placed because a push service is slow, and it
     * must certainly not fail because a customer uninstalled the app. Errors
     * are caught and logged, never thrown.
     */
    void this.deliver(record);

    // The log line is kept, and kept unconditional. It is the only record of
    // what was sent on a deployment with no credential, and it is what makes
    // "did the customer get told" answerable at all.
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: record.sentAt,
      event: 'FCM_PUSH_DISPATCHED',
      userId: record.userId,
      orderNumber: record.orderNumber,
      title: record.title,
      body: record.body,
      delivery: pushIsConfigured() ? 'FCM' : 'LOG_ONLY',
      demoMode: config.DEMO_MODE
    }));

    return record;
  }

  /**
   * Delivers to every device this person has installed.
   *
   * A partner with a phone by the pass and a tablet in the office is reached
   * on both; a rider who changed handset is not reached on the old one,
   * because tokens the service rejects as dead are marked so and skipped next
   * time. Without that pruning a notification is "sent" successfully forever
   * to a phone that uninstalled the app months ago.
   */
  private async deliver(record: PushNotificationPayload): Promise<void> {
    try {
      const devices = await deviceTokenRepository.listForUser(record.userId);
      if (devices.length === 0) return;

      const outcome = await sendToTokens(
        devices.map(d => d.token),
        {
          title: record.title,
          body: record.body,
          data: { ...(record.data || {}), orderId: record.orderId, orderNumber: record.orderNumber },
          // The partner and rider apps create their own channels so a new
          // order can have its own sound. A message with no channel is
          // delivered silently, which for a kitchen alert is the same as not
          // delivering it.
          androidChannelId: record.data?.type === 'ORDER_PLACED' ? 'new_orders' : 'default'
        }
      );

      for (const dead of outcome.invalid) await deviceTokenRepository.invalidate(dead);
    } catch (err: any) {
      console.error(
        JSON.stringify({ level: 'ERROR', event: 'FCM_DELIVERY_FAILED', message: err?.message })
      );
    }
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
