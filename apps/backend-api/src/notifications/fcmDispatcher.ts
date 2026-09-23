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
  /**
   * Which Android channel rings, declared by the method that knows who is
   * being written to.
   *
   * This used to be derived from `data.type`, which cannot work: the channel
   * belongs to the RECIPIENT'S APP, and two apps can both care about the same
   * event. A customer's ORDER_PLACED and a kitchen's new order are the same
   * moment and must ring in different places, or not ring at all.
   */
  androidChannelId?: string;
  sentAt: string;
}

/*
 * The channel ids, spelled exactly as the apps create them.
 *
 * These were wrong in three different ways at once and nobody could have seen
 * it from here: the server sent `new_orders`, the rider app creates
 * `new-orders`, and the partner app creates `kitchen-orders`. A message naming
 * a channel the app never created does not fall back to a quiet notification
 * on Android 8 and above — it is dropped. So the loud alert that exists to wake
 * a kitchen at 11pm was addressed to a channel that has never existed on any
 * phone.
 *
 * If either app renames its channel, this must change with it. That is the
 * cost of a contract expressed as two matching strings in two repositories,
 * and it is why the constant is here with the reason attached rather than
 * inline at the call site.
 */
const CHANNEL = {
  /** apps/restaurant-mobile/src/lib/orderAlert.ts — MAX importance, new_order.wav. */
  KITCHEN: 'kitchen-orders',
  /** apps/delivery-mobile/src/lib/orderAlert.ts. */
  RIDER: 'new-orders',
  /** The customer app creates no channel of its own and does not need one. */
  DEFAULT: 'default'
} as const;

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
          // Declared by the method that built the record, because only it
          // knows which app is being written to. See CHANNEL above.
          androidChannelId: record.androidChannelId || CHANNEL.DEFAULT
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
      data: { type: 'NO_SHOW_WARNING', orderId, orderNumber },
      androidChannelId: CHANNEL.RIDER
    });
  }

  /* ---------------------------------------------------------------------
   * THE KITCHEN
   *
   * Everything above this line writes to a customer, with one exception for a
   * rider. Nothing has ever been sent to a restaurant.
   *
   * That was not a misconfiguration to debug. The partner app registers its
   * token correctly and `deviceTokenRepository` has been storing those tokens
   * with a role on them all along; there was simply no code that addressed
   * them. A kitchen with the app closed has never been told anything.
   *
   * Every method here takes the restaurant owner's USER id. Not the restaurant
   * id — device tokens are keyed by user, and a restaurant id passed here
   * matches no device and fails silently, which is indistinguishable from the
   * bug being fixed.
   * ------------------------------------------------------------------- */

  /**
   * The one that matters: an order is waiting and the app is closed.
   *
   * This is a second, independent channel from the in-app alarm. The socket
   * path rings a tablet that is awake and on the orders screen; this reaches a
   * phone in somebody's pocket. Neither replaces the other, and adding this
   * must not change the sound.
   */
  async notifyRestaurantNewOrder(
    ownerUserId: string,
    orderId: string,
    orderNumber: string,
    itemCount: number
  ) {
    return this.sendPushNotification({
      userId: ownerUserId,
      orderId,
      orderNumber,
      title: 'New order',
      /*
       * Deliberately no money in this line.
       *
       * The obvious body is "3 items, Rs 450" — but the only total on the
       * order is the CUSTOMER'S, which includes our markup. Printing it to a
       * kitchen makes the markup derivable by subtracting their own menu
       * prices, and a notification body lands on a lock screen where anybody
       * standing near the pass can read it. The item count is what decides
       * whether to walk to the tablet; the money is on the ticket.
       */
      body: `#${orderNumber} — ${itemCount} ${itemCount === 1 ? 'item' : 'items'}. Accept it to start the clock.`,
      data: { type: 'RESTAURANT_NEW_ORDER', orderId, orderNumber },
      androidChannelId: CHANNEL.KITCHEN
    });
  }

  /**
   * Cancelled while the kitchen may already be cooking it.
   *
   * Loud on purpose. Food already on the pass is the cost of finding this out
   * late, and it is the one kitchen notification where seconds are money.
   */
  async notifyRestaurantOrderCancelled(
    ownerUserId: string,
    orderId: string,
    orderNumber: string,
    reason: string
  ) {
    return this.sendPushNotification({
      userId: ownerUserId,
      orderId,
      orderNumber,
      title: 'Order cancelled',
      body: `#${orderNumber} was cancelled. ${reason} Stop preparing it if you have started.`,
      data: { type: 'RESTAURANT_ORDER_CANCELLED', orderId, orderNumber, reason },
      androidChannelId: CHANNEL.KITCHEN
    });
  }

  /** A rider is at the counter for an order that may not be bagged yet. */
  async notifyRestaurantRiderArrived(
    ownerUserId: string,
    orderId: string,
    orderNumber: string,
    riderName: string
  ) {
    return this.sendPushNotification({
      userId: ownerUserId,
      orderId,
      orderNumber,
      title: 'Rider here',
      body: `${riderName} has arrived to collect #${orderNumber}.`,
      data: { type: 'RESTAURANT_RIDER_ARRIVED', orderId, orderNumber },
      androidChannelId: CHANNEL.KITCHEN
    });
  }

  /**
   * Still waiting, some minutes later.
   *
   * Worded as information rather than a complaint. The usual cause is a busy
   * pass, and a kitchen that feels told off by the platform stops reading the
   * notifications entirely — which costs more than the wait did.
   */
  async notifyRestaurantRiderWaiting(
    ownerUserId: string,
    orderId: string,
    orderNumber: string,
    riderName: string,
    waitingMinutes: number
  ) {
    return this.sendPushNotification({
      userId: ownerUserId,
      orderId,
      orderNumber,
      title: 'Rider still waiting',
      body: `${riderName} has been waiting ${waitingMinutes} ${waitingMinutes === 1 ? 'minute' : 'minutes'} for #${orderNumber}.`,
      data: { type: 'RESTAURANT_RIDER_WAITING', orderId, orderNumber },
      androidChannelId: CHANNEL.KITCHEN
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
