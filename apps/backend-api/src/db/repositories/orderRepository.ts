import {
  recordWrongCode,
  clearWrongCodes,
  lockedMinutesLeft,
  lockedMessage,
  LOCK_MINUTES
} from '../../modules/orders/codeAttempts.ts';
import crypto from 'crypto';
import { memoryStore, triggerAutoSave, calculateDistanceKm } from '../client.ts';
import type { Coordinates, Order, OrderStatus, RiderTripStage } from '@quick-bites/shared-types';
import { isAwaitingPickup, isCarrying, offerableNow } from '../../modules/orders/riderTrip.ts';

/*
 * WHAT DELIVERY IS ALLOWED TO CONCLUDE ABOUT THE MONEY.
 *
 * Both places that mark an order DELIVERED used to write
 * `paymentStatus = 'PAID'` for every order regardless of method. On a prepaid
 * order whose payment never completed, arrival of the food recorded receipt of
 * money that never arrived.
 *
 * That is not cosmetic. `financeRoutes.ts` selects payables and settlements on
 * `status === 'DELIVERED'` without consulting `paymentStatus` at all, so an
 * unpaid order became a payable and then a payout to the restaurant and the
 * rider. The platform pays out money it never collected.
 *
 * The rule is about which event is the payment:
 *
 *   CASH_ON_DELIVERY  - handing the food over IS the payment. PAID is correct.
 *   already PAID      - a gateway or webhook said so. Leave it alone.
 *   anything else     - the payment is somebody else's event and has not
 *                       happened. Delivery must not invent it.
 *
 * The third case is recorded rather than ignored. An order delivered with the
 * money unresolved is a real condition that needs a human, and the way it stops
 * being visible to anyone is precisely by overwriting it with 'PAID'.
 */
function settlePaymentOnDelivery(order: Order): void {
  if (order.paymentMethod === 'CASH_ON_DELIVERY' || order.paymentStatus === 'PAID') {
    order.paymentStatus = 'PAID';
    return;
  }

  order.paymentUnresolvedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      level: 'ERROR',
      timestamp: order.paymentUnresolvedAt,
      event: 'DELIVERED_WITHOUT_PAYMENT',
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus
    })
  );
}

export const orderRepository = {
  async findById(id: string): Promise<Order | null> {
    return memoryStore.orders.get(id) || null;
  },

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    for (const order of memoryStore.orders.values()) {
      if (order.idempotencyKey === key) return order;
    }
    return null;
  },

  async create(order: Order): Promise<Order> {
    // Generate authoritative 4-digit pickup code & 4-digit delivery OTP if not provided
    if (!order.pickupCode) {
      order.pickupCode = crypto.randomInt(1000, 10000).toString();
    }
    if (!order.deliveryOtp) {
      order.deliveryOtp = crypto.randomInt(1000, 10000).toString();
    }
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Records the gateway's identifiers against an order.
   *
   * Razorpay signs its OWN order id, not our order number, so the mapping has
   * to be kept or no signature can ever be verified.
   */
  async setPaymentReference(
    id: string,
    reference: { razorpayOrderId?: string; razorpayPaymentId?: string }
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    if (reference.razorpayOrderId) order.razorpayOrderId = reference.razorpayOrderId;
    if (reference.razorpayPaymentId) order.razorpayPaymentId = reference.razorpayPaymentId;
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  async updateStatus(id: string, status: OrderStatus, prepMinutes?: number): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    order.status = status;
    if (prepMinutes !== undefined) {
      order.preparationMinutes = prepMinutes;
    }
    // Stamped once, when the kitchen first takes the order on. Re-stamping it on
    // a later transition would restart the preparation countdown and push the
    // customer's arrival time further away the closer the food got to ready.
    if ((status === 'ACCEPTED' || status === 'PREPARING') && !order.acceptedAt) {
      order.acceptedAt = new Date().toISOString();
    }
    // Stamped once, and never cleared. Assigning a rider overwrites `status`,
    // so this is the only durable record that the kitchen finished - and it is
    // what pickup verification is allowed to trust.
    if (status === 'READY_FOR_PICKUP' && !order.readyAt) {
      order.readyAt = new Date().toISOString();
    }
    /*
     * Stamped here as well as in `verifyPickup`, and once only.
     *
     * OUT_FOR_DELIVERY has to mean the same thing however it was reached. An
     * administrator moving an order on through this method left `pickedUpAt`
     * unset, and two things then read the order wrongly: the no-show sweep saw
     * a rider still "on their way to the restaurant" and took a trip off
     * somebody actively delivering it, and the settlement gate - which treats
     * `pickedUpAt` as the proof that food left the kitchen - would never let
     * that order be paid out at all.
     *
     * `!order.pickedUpAt` matters. Re-stamping on a later write would move the
     * collection time forward and quietly stretch every delivery-duration
     * figure computed from it.
     */
    if (status === 'OUT_FOR_DELIVERY' && !order.pickedUpAt) {
      order.pickedUpAt = new Date().toISOString();
    }
    if (status === 'DELIVERED') {
      order.deliveredAt = new Date().toISOString();
      settlePaymentOnDelivery(order);
    }
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Cancels an order and records who did it and why, in one write.
   *
   * Separate from updateStatus because a cancellation carries facts no other
   * transition does. Setting the status and then writing the reason in a second
   * step is how an order ends up cancelled with no reason attached when the
   * second step throws — and a cancellation with no reason is invisible to
   * every report that asks why orders are being lost.
   */
  async recordCancellation(
    id: string,
    detail: { reason: string; reasonCode: string; byUserId: string; byRole: Order['cancelledByRole'] }
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;

    const now = new Date().toISOString();
    order.status = 'CANCELLED';
    order.cancellationReason = detail.reason;
    order.cancellationReasonCode = detail.reasonCode;
    order.cancelledByUserId = detail.byUserId;
    order.cancelledByRole = detail.byRole;
    order.cancelledAt = now;
    order.updatedAt = now;

    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Writes back an order the caller has already modified.
   *
   * Narrow on purpose: it exists for the refund path, which decides the final
   * status only after a third party has answered. Reach for a named method
   * first — this one will happily persist whatever it is handed.
   */
  async save(order: Order): Promise<Order> {
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(order.id, order);
    triggerAutoSave();
    return order;
  },

  async assignRider(
    id: string,
    riderId: string,
    riderName: string,
    riderPhone?: string,
    payout?: number
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;

    // Atomic check: if already claimed, return null
    if (order.riderId && order.riderId !== riderId) {
      return null;
    }

    order.riderId = riderId;
    order.riderName = riderName;
    if (riderPhone) order.riderPhone = riderPhone;
    if (typeof payout === 'number') order.riderPayout = payout;

    /*
     * `order.status` IS DELIBERATELY NOT TOUCHED HERE.
     *
     * This line used to read `order.status = 'RIDER_ASSIGNED'`, and it is the
     * whole of the bug the owner reported as "the rider accepts and everything
     * marks itself done". A rider accepting a trip is not something that
     * happens to the food, but it was written into the food's status, and the
     * only exits from that status were OUT_FOR_DELIVERY and CANCELLED. The
     * kitchen's remaining steps became unreachable, their buttons stopped
     * doing anything, and collection was then refused - correctly - because
     * the food had never legitimately passed "prepared".
     *
     * The rider's progress lives on `riderStage`, which runs alongside. The
     * food cooks at its own pace and the rider rides at theirs.
     */
    order.riderStage = 'HEADING_TO_RESTAURANT';
    order.riderAssignedAt = new Date().toISOString();
    order.updatedAt = order.riderAssignedAt;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Records that a rider passed on a trip, so dispatch stops offering it to them
   * and the pass can be counted against their acceptance rate.
   */
  async declineByRider(id: string, riderId: string): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    const declined = new Set(order.declinedByRiderIds || []);
    declined.add(riderId);
    order.declinedByRiderIds = Array.from(declined);
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Notes that this trip has been shown to a rider. Returns true only the first
   * time, which is what stops a polling app from counting the same offer twice.
   */
  async markOfferedToRider(id: string, riderId: string): Promise<boolean> {
    const order = memoryStore.orders.get(id);
    if (!order) return false;
    const offered = order.offeredToRiderIds || [];
    if (offered.includes(riderId)) return false;
    order.offeredToRiderIds = [...offered, riderId];
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return true;
  },

  /** Moves the rider's trip on one step, e.g. once they reach the restaurant. */
  async setRiderStage(id: string, stage: RiderTripStage): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    order.riderStage = stage;
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /*
   * EVERY REFUSAL HERE NOW SAYS WHICH REFUSAL IT WAS.
   *
   * This returned only a message, and the route turned every one of them into
   * `INVALID_PICKUP_CODE`. So a rider standing at the counter with the right
   * code, whose kitchen had simply not pressed "Ready" yet, was told their
   * code was invalid. They retype it, the restaurant reads it out again, and
   * both of them conclude the app is broken - when the real instruction was
   * "ask the kitchen to press Ready".
   *
   * Reported by the owner as an invalid code on the restaurant side that then
   * strands the whole delivery, and they were describing this exactly.
   *
   * The `code` is what the rider app titles the message from, so the two
   * cannot drift: a new refusal added here without a code shows as a generic
   * failure rather than silently borrowing the wrong name.
   */
  async verifyPickup(
    id: string,
    pickupCode: string
  ): Promise<{ success: boolean; order?: Order; error?: string; code?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' };

    /*
     * ONLY FOOD THAT IS WAITING ON THE COUNTER CAN BE COLLECTED.
     *
     * `readyAt` alone let a CANCELLED or REFUNDED order that had once been
     * ready be "collected" again, which moved it to OUT_FOR_DELIVERY and let
     * it be delivered and paid out after its money went back to the customer.
     * A collected or delivered order answers with what actually happened.
     */
    if (order.status === 'OUT_FOR_DELIVERY' || order.status === 'DELIVERED') {
      return { success: false, error: 'This order has already been collected.', code: 'ALREADY_COLLECTED' };
    }
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      return { success: false, error: 'This order was cancelled. Do not collect it.', code: 'ORDER_CANCELLED' };
    }

    const pickupLock = lockedMinutesLeft(order);
    if (pickupLock > 0) {
      return { success: false, error: lockedMessage(pickupLock), code: 'CODE_LOCKED' };
    }
    if (order.pickupCode !== pickupCode.trim()) {
      const locked = recordWrongCode(order, 'pickup');
      memoryStore.orders.set(id, order);
      triggerAutoSave();
      return {
        success: false,
        error: locked
          ? lockedMessage(LOCK_MINUTES)
          : 'That code does not match this order. Check the code on the restaurant screen.',
        code: locked ? 'CODE_LOCKED' : 'INVALID_PICKUP_CODE'
      };
    }
    clearWrongCodes(order, 'pickup');

    /*
     * THE FOOD HAS TO EXIST BEFORE ANYBODY CAN CARRY IT.
     *
     * This checked the code and nothing else, so a rider holding a valid
     * pickup code could verify collection while the kitchen was still
     * cooking, and the order jumped straight to OUT_FOR_DELIVERY. The
     * customer was then told their food was on its way while it was still in
     * the pan.
     *
     * Reported by the owner as "it should not be out for delivery until the
     * cooking is done AND the code is entered". Both, not either.
     *
     * `readyAt` rather than the status alone: readiness is a FACT with a
     * timestamp, and the status is a position that later steps move on from.
     * Asking the status would refuse a collection the instant the kitchen
     * tapped "handed over".
     */
    const kitchenIsDone =
      order.status === 'READY_FOR_PICKUP' ||
      order.status === 'HANDED_TO_RIDER' ||
      Boolean(order.readyAt);
    if (!kitchenIsDone) {
      return {
        success: false,
        error: 'The kitchen has not marked this order ready yet. Ask them to tap Ready.',
        code: 'KITCHEN_NOT_READY'
      };
    }

    /*
     * WHO SAID THE FOOD CHANGED HANDS.
     *
     * A handover has two halves: the kitchen taps HANDED_TO_RIDER, and the
     * rider quotes the code. When both happened it is mutual, and "he never
     * collected it" has an answer that does not depend on believing either
     * party.
     *
     * When the kitchen did not tap, the rider still proceeds. The kitchen has
     * already got what it wanted once the bag is off the counter, so the tap
     * is pure overhead to them and will be forgotten - and the cost of
     * blocking lands on a rider standing outside holding the food and a
     * customer watching an order that never moves. So the collection is
     * recorded as rider-asserted instead, which keeps the distinction that
     * mattered without turning a forgotten tap into a stranded delivery.
     */
    order.handoverWitnessedBy = order.status === 'HANDED_TO_RIDER' ? 'BOTH' : 'RIDER_ONLY';

    order.status = 'OUT_FOR_DELIVERY';
    order.riderStage = 'PICKED_UP';
    order.pickedUpAt = new Date().toISOString();
    order.updatedAt = order.pickedUpAt;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return { success: true, order };
  },

  /*
   * A CORRECT OTP IS NOT ON ITS OWN A DELIVERY.
   *
   * This wrote `status = 'DELIVERED'` with no precondition at all, and the
   * route above it checks only that the rider owns the order. So an order
   * sitting at ORDER_PLACED - never cooked, never collected - became DELIVERED
   * the moment a correct code arrived. `validateTransition` never sees this
   * path; the route calls the repository directly.
   *
   * That is not a display problem. DELIVERED is where money moves:
   * `recordOrderEarnings` posts against it, and `backfillEarnings()` posts any
   * DELIVERED order it finds unposted. A trip that never happened would be paid
   * for, and paid again the next time that sweep ran.
   *
   * THIS COMMENT USED TO SAY THE SWEEP RUNS AT BOOT. It does not, and both
   * sessions repeated it from here rather than from the call sites before
   * anyone checked. `backfillEarnings` has exactly one caller in `src` —
   * `payoutRoutes.ts:543`, an admin route somebody has to press. There is no
   * boot-time call anywhere.
   *
   * That difference is not pedantry. "Revenue is behind until a restart" is a
   * delay. The truth is that an ordinary cash delivery — the rider tapping the
   * code at the door, which never reaches `updateOrderStatus` and so never
   * reaches `recordOrderEarnings` — posts NOTHING to the ledger until a human
   * presses that button. See the plan's §4.4a. Do not fix it by calling the
   * sweep at boot: that turns missing revenue into revenue that appears on
   * restart, which is worse because it looks fixed.
   *
   * The code itself is not a secret the rider cannot obtain - it is stripped
   * from rider responses, but the customer reads it out loud, which is the
   * entire point of it. What makes it proof of delivery is that it arrives at
   * the END of a trip the system watched happen. So the trip has to have
   * happened: the kitchen finished, the rider collected, the food left. That is
   * exactly what OUT_FOR_DELIVERY means, and it is the only status this may be
   * entered from.
   */
  async verifyDeliveryOtp(
    id: string,
    otp: string
  ): Promise<{ success: boolean; order?: Order; error?: string; code?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' };

    // Answered before the OTP is examined, so a rider who taps twice on a bad
    // connection is told what actually happened rather than 'invalid code'.
    if (order.status === 'DELIVERED') {
      return {
        success: false,
        error: 'This order is already marked delivered.',
        code: 'ALREADY_DELIVERED'
      };
    }
    if (order.status !== 'OUT_FOR_DELIVERY') {
      return {
        success: false,
        error:
          'This order has not been collected yet. Confirm pickup at the restaurant before entering the doorstep code.',
        code: 'NOT_COLLECTED'
      };
    }

    const deliveryLock = lockedMinutesLeft(order);
    if (deliveryLock > 0) {
      return { success: false, error: lockedMessage(deliveryLock), code: 'CODE_LOCKED' };
    }
    if (order.deliveryOtp !== otp.trim()) {
      const locked = recordWrongCode(order, 'delivery');
      memoryStore.orders.set(id, order);
      triggerAutoSave();
      return {
        success: false,
        error: locked
          ? lockedMessage(LOCK_MINUTES)
          : 'That code does not match. Ask the customer to read it from their order screen.',
        code: locked ? 'CODE_LOCKED' : 'INVALID_OTP'
      };
    }
    clearWrongCodes(order, 'delivery');

    order.status = 'DELIVERED';
    order.riderStage = 'DELIVERED';
    order.deliveredAt = new Date().toISOString();
    settlePaymentOnDelivery(order);
    order.updatedAt = order.deliveredAt;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return { success: true, order };
  },

  /** Records the rider's latest position on the trip so the customer can follow it. */
  async updateRiderLocation(
    orderId: string,
    coords: { latitude: number; longitude: number },
    bearing: number,
    updatedAt: string
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(orderId);
    if (!order) return null;
    order.riderCoordinates = coords;
    order.riderBearing = bearing;
    order.riderLocationUpdatedAt = updatedAt;
    memoryStore.orders.set(orderId, order);
    triggerAutoSave();
    return order;
  },

  /**
   * Trips waiting for a rider.
   *
   * `forRiderId` hides the ones that rider already passed on — without it a
   * declined job reappears on the next refresh and the rider is asked the same
   * question forever.
   */
  /**
   * Unclaimed trips, nearest kitchen first.
   *
   * Ordered by how far the rider has to ride to COLLECT, which is the part of
   * the journey they are choosing between — the drop is wherever it is either
   * way. This used to be ordered by how recently the order was placed, which
   * offered a rider standing outside one restaurant a pickup across town
   * because it happened to be newer.
   *
   * Falls back to newest-first when the rider has no recorded position: an
   * arbitrary order is better than one built on a coordinate we do not have,
   * and a rider who has just come on shift has not pinged yet.
   */
  async listAvailableBroadcasts(forRiderId?: string, near?: Coordinates): Promise<Order[]> {
    /*
     * WHICH ORDERS ARE OFFERED, decided per restaurant rather than hardcoded.
     *
     * This read `ACCEPTED || PREPARING || READY_FOR_PICKUP` for every kitchen,
     * so a rider could be sent to a restaurant that had not started cooking.
     * That is right for a kitchen whose dishes take twenty minutes and wastes
     * a rider's evening at one whose dishes take three.
     *
     * `riderOfferAtStatus` is the restaurant's own setting, defaulting to
     * READY_FOR_PICKUP - the owner's choice, and the one that cannot strand a
     * rider, because food that is ready stays ready.
     */
    const available = Array.from(memoryStore.orders.values())
      .filter((o: Order) => !o.riderId && offerableNow(o))
      .filter((o: Order) => !forRiderId || !(o.declinedByRiderIds || []).includes(forRiderId));

    if (!near || !Number.isFinite(near.latitude) || !Number.isFinite(near.longitude)) {
      return available.sort(
        (a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const toKitchen = (o: Order) =>
      o.restaurantCoordinates
        ? calculateDistanceKm(
            near.latitude,
            near.longitude,
            o.restaurantCoordinates.latitude,
            o.restaurantCoordinates.longitude
          )
        : // A kitchen with no recorded position sorts last rather than first,
          // which is where a NaN comparison would have left it.
          Number.MAX_SAFE_INTEGER;

    return available.sort((a: Order, b: Order) => toKitchen(a) - toKitchen(b));
  },

  async listByCustomerId(customerId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.customerId === customerId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listByRestaurantId(restaurantId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.restaurantId === restaurantId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async listByRiderId(riderId: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => o.riderId === riderId)
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  /**
   * Orders that are waiting on somebody who has not acted.
   *
   * Narrowed here rather than in the sweeper so the scan stays a scan of the
   * live tail and not of every order ever placed. The two shapes it returns are
   * different problems: ORDER_PLACED means the kitchen has not looked, and the
   * cooked-with-no-rider ones mean nobody will collect it.
   */
  async listAwaitingAction(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values()).filter(
      (o: Order) =>
        o.status === 'ORDER_PLACED' ||
        ((o.status === 'ACCEPTED' || o.status === 'PREPARING' || o.status === 'READY_FOR_PICKUP') && !o.riderId)
    );
  },

  /**
   * Takes a trip back off a rider who accepted it and never turned up.
   *
   * Returns the order to the pool at READY_FOR_PICKUP rather than to whatever
   * it was before, because by the time a rider has been sitting on it for
   * several minutes the food is made. The rider is added to `declinedByRiderIds`
   * so the same trip is not immediately offered back to the person who has just
   * failed to collect it — which, with proximity ordering, is exactly who would
   * be top of the list.
   *
   * Returns null if somebody collected it in the meantime, so a sweep racing a
   * real pickup cannot snatch an order out of a rider's hands.
   */
  async releaseRider(id: string, riderId: string): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    if (order.riderId !== riderId) return null;

    /*
     * Asked of the rider's track, not the food's.
     *
     * This read `status !== 'RIDER_ASSIGNED'`, which worked only because
     * assigning a rider overwrote the food's status. A rider who has already
     * collected must not be released - that would take an order away from
     * somebody carrying the food - and `isAwaitingPickup` is the question
     * that actually distinguishes the two.
     */
    if (!isAwaitingPickup(order)) return null;

    order.declinedByRiderIds = Array.from(new Set([...(order.declinedByRiderIds || []), riderId]));
    order.riderId = undefined;
    order.riderName = undefined;
    order.riderPhone = undefined;
    order.riderStage = 'UNASSIGNED';
    order.riderAssignedAt = undefined;

    /*
     * The FOOD's status is left exactly where it was, along with `readyAt`.
     *
     * Both were written here before, forcing READY_FOR_PICKUP and stamping
     * `readyAt` on release - a workaround for the status having been
     * overwritten at assignment, which it no longer is. Keeping it would now
     * declare food ready that the kitchen may still be cooking, purely because
     * a rider wandered off. A rider leaving tells us nothing about the food.
     */
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /** Every trip a rider has accepted and not yet collected. */
  async listAssignedAwaitingPickup(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values()).filter((o: Order) => isAwaitingPickup(o));
  },

  /**
   * Orders a rider has COLLECTED and not yet handed over.
   *
   * Nothing watched these. The sweeper iterated exactly two lists — orders
   * awaiting action, and trips accepted but not collected — so a rider who picked
   * the food up and then stopped left the order out for delivery forever. No
   * alert anywhere, the customer watching a map that had stopped moving, and on a
   * cash order an unseen person holding both the food and the money.
   *
   * It is the one case re-offering cannot recover, because the food has left the
   * building.
   *
   * `isCarrying` rather than a status read: the rider's track and the food's
   * status move independently, and this is a question about the RIDER. It also
   * means a DELIVERED order is excluded by construction rather than by a filter
   * somebody has to remember — which matters, because every order ever delivered
   * carries a `riderLocationUpdatedAt` that a naive staleness check would fire on.
   */
  async listCarrying(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values()).filter((o: Order) => isCarrying(o));
  },

  /** So one warning is sent rather than one every thirty seconds. */
  async markNoShowWarned(id: string, at: string): Promise<boolean> {
    const order = memoryStore.orders.get(id);
    if (!order || (order as any).noShowWarnedAt) return false;
    (order as any).noShowWarnedAt = at;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return true;
  },

  /**
   * Records that operations have been told about this one, so the next sweep
   * does not tell them again thirty seconds later.
   */
  async markRiderSearchAlerted(id: string, at: string): Promise<boolean> {
    const order = memoryStore.orders.get(id);
    if (!order) return false;
    order.riderSearchAlertedAt = at;
    order.updatedAt = new Date().toISOString();
    triggerAutoSave();
    return true;
  },

  /**
   * Marks a handover that was confirmed away from the delivery address.
   *
   * Deliberately does not change the status: the order really was delivered as
   * far as the customer is concerned, and blocking the transition would leave
   * the rider unable to finish a trip over a GPS reading.
   */
  async flagDeliveryProximity(
    id: string,
    flag: { distanceMetres: number; thresholdMetres: number; flaggedAt: string }
  ): Promise<boolean> {
    const order = memoryStore.orders.get(id);
    if (!order) return false;
    order.deliveryProximityFlag = flag;
    triggerAutoSave();
    return true;
  },

  /**
   * Orders whose money has not settled — the input to reconciliation.
   *
   * Matches on paymentStatus as well as status: an order can be moved out of
   * PAYMENT_PENDING by a path that never marked it paid, and an order that is
   * live with PENDING money is exactly the case worth finding.
   */
  async listUnsettled(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values()).filter(
      (o: Order) => o.status === 'PAYMENT_PENDING' && o.paymentStatus !== 'PAID'
    );
  },

  async listAll(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async setRating(
    id: string,
    rating: number,
    comment?: string,
    riderRating?: number,
    riderRatingComment?: string
  ): Promise<Order | null> {
    const order = memoryStore.orders.get(id);
    if (!order) return null;
    order.rating = rating;
    order.ratingComment = comment;
    // A customer who rates the order without scoring the rider separately is
    // taken to have meant the same score for both, rather than leaving the
    // rider with no feedback at all from a trip they completed.
    order.riderRating = riderRating ?? rating;
    order.riderRatingComment = riderRatingComment;
    order.ratedAt = new Date().toISOString();
    order.updatedAt = order.ratedAt;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  }
};
