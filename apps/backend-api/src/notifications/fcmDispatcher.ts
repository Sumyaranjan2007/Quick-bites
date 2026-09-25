import { config } from '../config/env.ts';
import { deviceTokenRepository } from '../db/repositories/deviceTokenRepository.ts';
import { sendToTokens, pushIsConfigured } from './fcmTransport.ts';

export interface PushNotificationPayload {
  userId: string;
  /**
   * OPTIONAL, because not everything worth telling somebody is an order.
   *
   * Every notification on this platform used to be about an order, so these were
   * required and every method had one to pass. The admin notifications are about
   * a bank account, a document, a rider in trouble — and the shortest path to
   * making them fit was passing an empty string for both, which would have put
   * `orderId: ""` into the payload of every one of them and left a reader
   * wondering which order it meant.
   */
  orderId?: string;
  orderNumber?: string;
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
  /** Android's notification tag: a later message with the same tag REPLACES this one. */
  androidTag?: string;
  /** Data only, no visible notification. The only way to withdraw one. */
  dataOnly?: boolean;
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
  /**
   * apps/customer-mobile/src/lib/pushRegistration.ts (U5): the customer's order
   * updates, high importance, so they are not filed as "Miscellaneous".
   */
  ORDER_UPDATES: 'order-updates',
  /**
   * apps/delivery-mobile and apps/restaurant-mobile (R2): money news. Quiet,
   * normal importance, no alarm: a payout is not an order to rush to.
   */
  PAYMENTS: 'payments',
  /** An app that has not created a named channel falls back to this. */
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
          /*
           * The order fields are spread only when there IS an order. Sending
           * `orderId: undefined` to FCM is a type error at the transport and
           * sending `orderId: ""` is worse — an app reading it gets a falsy id
           * that looks like a real field somebody forgot to fill in.
           */
          data: {
            ...(record.data || {}),
            ...(record.orderId ? { orderId: record.orderId } : {}),
            ...(record.orderNumber ? { orderNumber: record.orderNumber } : {})
          },
          // Declared by the method that built the record, because only it
          // knows which app is being written to. See CHANNEL above.
          androidChannelId: record.androidChannelId || CHANNEL.DEFAULT,
          androidTag: record.androidTag,
          dataOnly: record.dataOnly
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
      userId,
      orderId,
      orderNumber,
      title: 'Order Confirmed',
      body: `Your order #${orderNumber} has been received by the kitchen.`,
      data: { type: 'ORDER_PLACED', orderId, orderNumber }
    });
  }

  /**
   * A TRIP IS WAITING, and this is the notification that did not exist.
   *
   * -------------------------------------------------------------------------
   * RIDERS HAVE NEVER BEEN PUSHED A JOB
   * -------------------------------------------------------------------------
   * Trips reached riders through one channel only: `emitOrderAvailableForPickup`,
   * a socket event to a room. A socket needs the app open and connected, and
   * Android kills background sockets. So a rider with the phone in their pocket
   * learned of nothing, cooked food sat on the pass, and the sweeper eventually
   * raised NO_RIDER_FOUND — which reads as "no riders available" when what
   * actually happened is that nobody was asked.
   *
   * The rider app has been ready for this the whole time. `orderAlert.ts` creates
   * the `new-orders` channel with a looping alarm built for exactly this moment.
   * The server had never sent to it. Same shape as the kitchen push, and it
   * reaches riders on the APK they already have.
   *
   * -------------------------------------------------------------------------
   * NO MONEY IN THE BODY, AND FOR A DIFFERENT REASON THAN THE KITCHEN'S
   * -------------------------------------------------------------------------
   * A rider's own earning is theirs to see and would genuinely help them decide.
   * It is left out because computing it here means importing the payout
   * calculator from the rider router, which imports this module — and a cycle in
   * the notification path is a risk that is not worth an extra line on a lock
   * screen. The restaurant and the distance are what decide whether to open the
   * app; the app then shows the full offer including the fee.
   */
  async notifyRiderTripAvailable(
    riderUserId: string,
    orderId: string,
    orderNumber: string,
    restaurantName: string,
    distanceLabel: string | null
  ) {
    return this.sendPushNotification({
      userId: riderUserId,
      orderId,
      orderNumber,
      title: 'New trip available',
      body: `Pick up from ${restaurantName}${distanceLabel ? `, ${distanceLabel} away` : ''}. Open the app to accept it.`,
      data: { type: 'RIDER_TRIP_AVAILABLE', orderId, orderNumber },
      androidChannelId: CHANNEL.RIDER,
      /*
       * Tagged per order, so the later waves of the same trip REPLACE this entry
       * rather than stacking beside it. Dispatch re-offers every few minutes
       * until somebody takes the job, and four identical alarms for one trip is
       * how a rider learns to clear the whole channel.
       */
      androidTag: `trip:${orderId}`
    });
  }

  /**
   * That trip is gone — somebody else took it.
   *
   * -------------------------------------------------------------------------
   * WHY THIS IS DATA ONLY, AND WHAT IT DOES AND DOES NOT DO TODAY
   * -------------------------------------------------------------------------
   * Six riders are woken for one trip and one accepts. The other five keep a
   * looping alarm in the tray for a job that no longer exists, and a rider who
   * taps it later is refused. That is the same "offered something and then told
   * no" shape that the offer list had, arriving through the push instead.
   *
   * There is no "delete that notification" message type. The only way to clear
   * an entry is to tell the APP and let it do it, which means a message with no
   * notification block — data only, invisible, handled in code.
   *
   * A visible replacement is not an alternative. Channel importance and sound are
   * fixed when the app creates the channel, so a "that trip is gone" message on
   * `new-orders` would play the looping alarm AGAIN — worse than the stale entry.
   *
   * BE CLEAR ABOUT TODAY: the shipped rider APK has no handler for this, so it
   * currently arrives and is ignored. Nothing breaks, nothing is cleared. It is
   * shipped now because it is inert until the app half exists and then works with
   * no server change, and because `androidTag` above — which DOES work on the
   * shipped build — stops the waves stacking, which is the larger half of the
   * same problem.
   */
  async notifyRiderTripWithdrawn(riderUserId: string, orderId: string, orderNumber: string) {
    return this.sendPushNotification({
      userId: riderUserId,
      orderId,
      orderNumber,
      // Carried for the app to display if it decides to; never shown by Android
      // itself, because `dataOnly` omits the notification block.
      title: 'Trip taken',
      body: 'Another rider took this one.',
      data: { type: 'RIDER_TRIP_WITHDRAWN', orderId, orderNumber, tag: `trip:${orderId}` },
      androidChannelId: CHANNEL.RIDER,
      androidTag: `trip:${orderId}`,
      dataOnly: true
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
   * Told the customer their delivery is late, and told them honestly.
   *
   * -------------------------------------------------------------------------
   * A FROZEN MAP IS THE WORST VERSION OF THIS
   * -------------------------------------------------------------------------
   * Until now a rider who stopped moving produced nothing at all: the customer
   * watched a marker that had stopped, with no idea whether the app was broken,
   * the rider was lost, or their food was coming. Silence makes them assume the
   * worst AND phone support, which is the outcome this avoids.
   *
   * Two different truths, said differently. Late-with-a-moving-rider is traffic
   * and reads as such. Lost contact says so — not to alarm anybody, but because
   * "we are looking into it" is the only sentence that is both true and useful,
   * and a customer who is told something is wrong before they work it out
   * themselves is a customer who trusts the next thing the app says.
   *
   * No mention of what might have happened to the rider. That is speculation
   * about a person, on a stranger's lock screen.
   */
  async notifyCustomerDeliveryDelayed(
    userId: string,
    orderId: string,
    orderNumber: string,
    lostContact: boolean
  ) {
    return this.sendPushNotification({
      androidChannelId: CHANNEL.ORDER_UPDATES,
      userId,
      orderId,
      orderNumber,
      title: lostContact ? 'We are checking on your order' : 'Your order is running late',
      body: lostContact
        ? `We have lost contact with the rider carrying #${orderNumber} and are looking into it now. We will update you shortly.`
        : `#${orderNumber} is taking longer than we estimated. Your rider is still on the way.`,
      data: { type: 'DELIVERY_DELAYED', orderId, orderNumber }
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
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
      androidChannelId: CHANNEL.ORDER_UPDATES,
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

  /* ------------------------------------------------------------------ *
   *  MONEY REACHED YOU                                                  *
   *                                                                     *
   *  For "pay everyone", the person being paid was the one who did not   *
   *  find out. `PAYOUT_SENT` existed as a ledger entry and an audit      *
   *  line; the partner and the rider learned nothing, so payday          *
   *  produced a round of "has it gone yet" calls from people who had     *
   *  already been paid.                                                  *
   *                                                                     *
   *  ALL THREE USE CHANNEL.DEFAULT, AND THAT IS THE POINT.               *
   *                                                                     *
   *  The partner and rider apps each create exactly ONE channel: the     *
   *  MAX-importance order alarm that plays `new_order.wav` on a loop.    *
   *  Channel importance and sound are fixed when a channel is created,   *
   *  so "you were paid" on that channel would be indistinguishable from  *
   *  a new order — a kitchen would run to the pass for a bank transfer,  *
   *  and after twice would start ignoring the alarm that matters.        *
   *                                                                     *
   *  `default` is not a channel either app creates, so Android delivers  *
   *  these through the messaging SDK's own fallback channel: ordinary    *
   *  importance, no alarm. That is exactly the route every customer      *
   *  push already takes, because the customer app creates no channels    *
   *  at all — so this is no more novel than the notifications that work  *
   *  today, and it needs no new build of anything. A properly named      *
   *  "Payments" channel is an improvement for whenever those two apps    *
   *  are next built, not a precondition for telling somebody they were   *
   *  paid.                                                              *
   * ------------------------------------------------------------------ */

  /**
   * Somebody was paid.
   *
   * Sent when a payout reaches PAID and never on a draft or an approval — the
   * distance between "authorised" and "in your account" is a gateway call that
   * can fail, and a platform that announces the first as the second is lying to
   * the one person who cannot check.
   *
   * The destination is named. "You were paid Rs 4,820" invites the question this
   * is meant to prevent; "into the account ending 1234" answers it.
   */
  async notifyPayeePaid(
    userId: string,
    input: {
      amountLabel: string;
      destinationLabel: string | null;
      payoutId: string;
      reference?: string;
      /**
       * Whether the money has ARRIVED, or only been accepted for sending.
       *
       * RazorpayX accepting a payout is not RazorpayX having paid it. Telling
       * somebody "you have been paid" about a transfer the bank has not made yet
       * sends them to look at an account that has not moved — and the second time
       * that happens they stop believing the message, which is worse than never
       * having sent it.
       */
      landed?: boolean;
    }
  ) {
    const arrived = input.landed !== false;
    return this.sendPushNotification({
      userId,
      title: arrived ? 'You have been paid' : 'Your payment is on its way',
      body: arrived
        ? `${input.amountLabel} has been sent` +
          (input.destinationLabel ? ` to ${input.destinationLabel}` : '') +
          '.'
        : `${input.amountLabel} is on its way` +
          (input.destinationLabel ? ` to ${input.destinationLabel}` : '') +
          '. It usually arrives within a few hours.',
      androidChannelId: CHANNEL.PAYMENTS,
      data: {
        type: 'PAYOUT_PAID',
        payoutId: input.payoutId,
        ...(input.reference ? { reference: input.reference } : {})
      }
    });
  }

  /**
   * A refund actually left.
   *
   * Only on settlement. The admin is told when a refund is RAISED and the
   * customer heard nothing when it was PAID, which is the wrong way round: one
   * of those two people is waiting for money.
   *
   * Never sent for a refund left PROCESSING. A refund that has not settled must
   * never be announced as sent — a customer told their money is on its way stops
   * chasing it, and that is the one lie that makes the money disappear quietly.
   */
  async notifyCustomerRefundSent(
    userId: string,
    input: { orderId: string; orderNumber: string; amountLabel: string; timing: string }
  ) {
    return this.sendPushNotification({
      userId,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      title: 'Your refund has been sent',
      body: `${input.amountLabel} for order #${input.orderNumber}. ${input.timing}`,
      androidChannelId: CHANNEL.ORDER_UPDATES,
      data: { type: 'REFUND_SENT', orderId: input.orderId, orderNumber: input.orderNumber }
    });
  }

  /**
   * The kitchen has taken the order on.
   *
   * ONE message for whichever of ACCEPTED and PREPARING arrives first. A kitchen
   * that taps "accept" and then "start cooking" ten seconds later is one event
   * as far as the customer is concerned, and two notifications about it reads as
   * a glitch.
   *
   * ACCEPTED had no message at all, which mattered more once the live map
   * appeared at that moment: the thing the customer most wants to look at opened
   * without anybody telling them it was there.
   */
  async notifyKitchenHasOrder(
    userId: string,
    orderId: string,
    orderNumber: string,
    prepMins?: number
  ) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'The kitchen has your order',
      body: prepMins
        ? `Your food is being prepared — about ${prepMins} minutes. You can follow it on the map.`
        : 'The restaurant has accepted your order and is starting on it. You can follow it on the map.',
      androidChannelId: CHANNEL.DEFAULT,
      data: {
        type: 'KITCHEN_HAS_ORDER',
        orderId,
        orderNumber,
        ...(prepMins ? { prepTime: String(prepMins) } : {})
      }
    });
  }

  /**
   * A rider is coming for it.
   *
   * FIRST NAME ONLY. A customer needs to know who is arriving, not a stranger's
   * full legal name — and the rider did not agree to have it pushed to every
   * customer they deliver to.
   */
  async notifyRiderAssigned(
    userId: string,
    orderId: string,
    orderNumber: string,
    riderFirstName: string
  ) {
    return this.sendPushNotification({
      userId,
      orderId,
      orderNumber,
      title: 'A delivery partner is on the way',
      body: `${riderFirstName} is heading to the restaurant to collect your order.`,
      androidChannelId: CHANNEL.ORDER_UPDATES,
      data: { type: 'RIDER_ASSIGNED', orderId, orderNumber, riderFirstName }
    });
  }

  /** To a RIDER: operations took a trip off them (A1) or moved it on (A2). */
  async notifyRiderTripTakenOff(riderUserId: string, orderId: string, orderNumber: string, reason: string) {
    return this.sendPushNotification({
      userId: riderUserId,
      orderId,
      orderNumber,
      title: 'Trip moved by support',
      body: `Order #${orderNumber} is no longer yours. ${reason}`,
      data: { type: 'RIDER_TRIP_TAKEN_OFF', orderId, orderNumber },
      androidChannelId: CHANNEL.RIDER
    });
  }

  /** To a RIDER: operations gave them a trip, after pickup with where to collect it. */
  async notifyRiderTripGiven(riderUserId: string, orderId: string, orderNumber: string, handoverNote?: string) {
    return this.sendPushNotification({
      userId: riderUserId,
      orderId,
      orderNumber,
      title: 'Support gave you a trip',
      body: handoverNote
        ? `Order #${orderNumber}: collect the bag from the other rider. ${handoverNote}`
        : `Order #${orderNumber} is now yours. Open the app to start.`,
      data: { type: 'RIDER_TRIP_GIVEN', orderId, orderNumber },
      androidChannelId: CHANNEL.RIDER
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
