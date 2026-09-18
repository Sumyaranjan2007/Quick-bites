import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';
import type { Order, OrderStatus, RiderTripStage } from '@quick-bites/shared-types';

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
    if (status === 'DELIVERED') {
      order.deliveredAt = new Date().toISOString();
      order.paymentStatus = 'PAID';
    }
    order.updatedAt = new Date().toISOString();
    memoryStore.orders.set(id, order);
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
  async listAvailableBroadcasts(forRiderId?: string): Promise<Order[]> {
    return Array.from(memoryStore.orders.values())
      .filter((o: Order) => (o.status === 'ACCEPTED' || o.status === 'PREPARING' || o.status === 'READY_FOR_PICKUP') && !o.riderId)
      .filter((o: Order) => !forRiderId || !(o.declinedByRiderIds || []).includes(forRiderId))
      .sort((a: Order, b: Order) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
