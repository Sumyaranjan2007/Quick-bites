import crypto from 'crypto';
import { memoryStore, triggerAutoSave, calculateDistanceKm } from '../client.ts';
import type { Coordinates, Order, OrderStatus, RiderTripStage } from '@quick-bites/shared-types';

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
    if (status === 'DELIVERED') {
      order.deliveredAt = new Date().toISOString();
      order.paymentStatus = 'PAID';
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
    order.status = 'RIDER_ASSIGNED';
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

  async verifyPickup(id: string, pickupCode: string): Promise<{ success: boolean; order?: Order; error?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found' };
    if (order.pickupCode !== pickupCode.trim()) {
      return { success: false, error: 'Invalid pickup verification code' };
    }

    order.status = 'OUT_FOR_DELIVERY';
    order.riderStage = 'OUT_FOR_DELIVERY';
    order.pickedUpAt = new Date().toISOString();
    order.updatedAt = order.pickedUpAt;
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return { success: true, order };
  },

  async verifyDeliveryOtp(id: string, otp: string): Promise<{ success: boolean; order?: Order; error?: string }> {
    const order = memoryStore.orders.get(id);
    if (!order) return { success: false, error: 'Order not found' };
    if (order.deliveryOtp !== otp.trim()) {
      return { success: false, error: 'Invalid doorstep delivery OTP' };
    }

    order.status = 'DELIVERED';
    order.riderStage = undefined;
    order.deliveredAt = new Date().toISOString();
    order.paymentStatus = 'PAID';
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
    const available = Array.from(memoryStore.orders.values())
      .filter((o: Order) => (o.status === 'ACCEPTED' || o.status === 'PREPARING' || o.status === 'READY_FOR_PICKUP') && !o.riderId)
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
    if (order.status !== 'RIDER_ASSIGNED') return null;

    order.declinedByRiderIds = Array.from(new Set([...(order.declinedByRiderIds || []), riderId]));
    order.riderId = undefined;
    order.riderName = undefined;
    order.riderPhone = undefined;
    order.riderStage = undefined;
    order.riderAssignedAt = undefined;
    order.status = 'READY_FOR_PICKUP';
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
    triggerAutoSave();
    return order;
  },

  /** Every trip a rider has accepted and not yet collected. */
  async listAssignedAwaitingPickup(): Promise<Order[]> {
    return Array.from(memoryStore.orders.values()).filter(
      (o: Order) => o.status === 'RIDER_ASSIGNED' && !!o.riderId
    );
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
