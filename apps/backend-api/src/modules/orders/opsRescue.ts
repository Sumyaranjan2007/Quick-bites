/**
 * What operations can do when a trip goes wrong on the road (A1, A2, A3).
 *
 *   A1  takeTripOffRider   the rider's phone died or they walked off BEFORE
 *                          pickup: the trip goes back on offer, the food's
 *                          status is untouched.
 *   A2  reassignTrip       hand the trip to a named rider. After pickup the new
 *                          rider has to collect the bag from the old one, so a
 *                          handover note is required, and a cash order is only
 *                          given to a rider under their cash ceiling.
 *   A3  deliverByOperations the customer cannot read their code. Only through
 *                          the ordinary DELIVERED transition, so earnings and
 *                          the rider's cash are recorded exactly once by
 *                          `completeDelivery()`. On a cash order staff must say
 *                          whether the rider took the cash; if not, the order
 *                          is closed as refused, nothing is booked to the
 *                          rider, and a case is opened for the kitchen's loss.
 *
 * Every refusal names what to do instead, because the person pressing these
 * buttons is not an engineer.
 */
import { AppError } from '../../utils/AppError.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { supportRepository } from '../../db/repositories/supportRepository.ts';
import { orderService } from './orderService.ts';
import { isAwaitingPickup, cashCeilingBlocks, hasActiveTrip } from './riderTrip.ts';
import { offerTripToNearbyRiders } from './tripOffers.ts';
import { emitOrderStatusUpdate, emitOrderAvailableForPickup } from '../../sockets/socketServer.ts';
import { fcmDispatcher } from '../../notifications/fcmDispatcher.ts';
import type { Order } from '@quick-bites/shared-types';

export interface OpsActor {
  userId: string;
  name: string;
}

const CLOSED = ['DELIVERED', 'CANCELLED', 'REFUNDED'];

function refuseClosed(order: Order) {
  if (order.status === 'DELIVERED') {
    throw new AppError('This order was already delivered.', 409, 'ALREADY_DELIVERED');
  }
  if (CLOSED.includes(order.status)) {
    throw new AppError('This order is closed. There is no trip to move.', 409, 'ORDER_ALREADY_CLOSED');
  }
}

async function riderUserId(riderId: string): Promise<string | undefined> {
  return (await riderRepository.findById(riderId))?.userId;
}

function announce(order: Order) {
  emitOrderStatusUpdate(order.id, {
    orderId: order.id,
    status: order.status,
    updatedAt: order.updatedAt,
    restaurantId: order.restaurantId
  });
}

/** A1: take a trip off its rider before pickup and put it back on offer. */
export async function takeTripOffRider(
  orderId: string,
  actor: OpsActor,
  input: { reason: string; countAsNoShow?: boolean }
): Promise<Order> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  refuseClosed(order);
  if (!order.riderId) {
    throw new AppError('No rider has this trip. It is already on offer.', 409, 'NO_RIDER_ASSIGNED');
  }
  if (!isAwaitingPickup(order)) {
    throw new AppError(
      'The rider has already collected this food. Use "Give to another rider" instead.',
      409,
      'ALREADY_COLLECTED'
    );
  }

  const fromRiderId = order.riderId;
  const at = new Date().toISOString();
  order.riderId = undefined;
  order.riderName = undefined;
  order.riderPhone = undefined;
  order.riderStage = 'UNASSIGNED';
  order.riderAssignedAt = undefined;
  // Same as a rider handing it back: a bag marked handed over to a rider who
  // never collected it is still on the counter. The kitchen's other steps stay.
  if (order.status === 'HANDED_TO_RIDER') order.status = 'READY_FOR_PICKUP';
  order.declinedByRiderIds = Array.from(new Set([...(order.declinedByRiderIds || []), fromRiderId]));
  order.riderReassignments = [
    ...(order.riderReassignments || []),
    { fromRiderId, byUserId: actor.userId, reason: input.reason, afterPickup: false, at }
  ];
  order.updatedAt = at;
  memoryStore.orders.set(order.id, order);
  triggerAutoSave();

  if (input.countAsNoShow) await riderRepository.recordNoShow(fromRiderId);

  announce(order);
  emitOrderAvailableForPickup({
    id: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName
  });
  void offerTripToNearbyRiders(order);
  const uid = await riderUserId(fromRiderId);
  if (uid) void fcmDispatcher.notifyRiderTripTakenOff(uid, order.id, order.orderNumber, input.reason);
  return order;
}

/** A2: give a trip to a named rider, before or after pickup. */
export async function reassignTrip(
  orderId: string,
  actor: OpsActor,
  input: { riderId: string; reason: string; handoverNote?: string }
): Promise<Order> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  refuseClosed(order);

  const target = await riderRepository.findById(input.riderId);
  if (!target) throw new AppError('That rider does not exist.', 404, 'RIDER_NOT_FOUND');
  if (target.id === order.riderId) {
    throw new AppError('This rider already has the trip.', 409, 'SAME_RIDER');
  }
  if (target.kycStatus !== 'ACTIVE') {
    throw new AppError('That rider is not approved to deliver yet.', 409, 'RIDER_NOT_ACTIVE');
  }
  const targetUser = await userRepository.findById(target.userId);
  if (!targetUser || (targetUser as any).isBlocked) {
    throw new AppError('That rider\'s account is blocked.', 409, 'RIDER_BLOCKED');
  }
  if (!target.isOnline) {
    throw new AppError('That rider is off shift. Ask them to go online first.', 409, 'RIDER_OFFLINE');
  }
  // The same one-trip rule the rider's own claim obeys: two bags for two
  // customers is a promise the platform cannot keep.
  const busy = (await orderRepository.listByRiderId(target.id)).find(o => o.id !== order.id && hasActiveTrip(o));
  if (busy) {
    throw new AppError(
      `That rider is on order #${busy.orderNumber}. Choose a free rider, or wait until they finish.`,
      409,
      'RIDER_ALREADY_ON_TRIP'
    );
  }
  const ceiling = cashCeilingBlocks(target.id, order);
  if (ceiling.blocked) {
    throw new AppError(
      `This is a cash order and that rider cannot take one yet: ${ceiling.message}`,
      409,
      'RIDER_CASH_CEILING'
    );
  }

  const afterPickup = Boolean(order.pickedUpAt) || order.status === 'OUT_FOR_DELIVERY';
  const handoverNote = (input.handoverNote || '').trim();
  if (afterPickup && !order.riderId) {
    throw new AppError('This food was collected but no rider is recorded. Call support engineering.', 409, 'NO_RIDER_ASSIGNED');
  }
  if (afterPickup && handoverNote.length < 5) {
    throw new AppError(
      'The food is with the first rider. Write where the new rider should collect it from.',
      400,
      'HANDOVER_NOTE_REQUIRED'
    );
  }

  const fromRiderId = order.riderId;
  const at = new Date().toISOString();
  order.riderId = target.id;
  order.riderName = target.fullName;
  order.riderPhone = target.phone;
  order.riderAssignedAt = at;
  // Before pickup the new rider starts from the restaurant. After pickup the
  // trip stage is left where it was: the food is on the road.
  if (!afterPickup) order.riderStage = 'HEADING_TO_RESTAURANT';
  if (fromRiderId) {
    order.declinedByRiderIds = Array.from(new Set([...(order.declinedByRiderIds || []), fromRiderId]));
  }
  order.riderReassignments = [
    ...(order.riderReassignments || []),
    {
      fromRiderId,
      toRiderId: target.id,
      byUserId: actor.userId,
      reason: input.reason,
      ...(afterPickup ? { handoverNote } : {}),
      afterPickup,
      at
    }
  ];
  order.updatedAt = at;
  memoryStore.orders.set(order.id, order);
  triggerAutoSave();

  // Losing a trip after pickup is never free: it counts as a no-show, or a
  // reassignment becomes the easy way out of a trip the rider didn't want.
  if (fromRiderId && afterPickup) await riderRepository.recordNoShow(fromRiderId);

  announce(order);
  void fcmDispatcher.notifyRiderTripGiven(target.userId, order.id, order.orderNumber, afterPickup ? handoverNote : undefined);
  if (fromRiderId) {
    const uid = await riderUserId(fromRiderId);
    if (uid) {
      void fcmDispatcher.notifyRiderTripTakenOff(
        uid,
        order.id,
        order.orderNumber,
        afterPickup ? `Hand the bag to ${target.fullName.split(' ')[0]}. ${handoverNote}` : input.reason
      );
    }
  }
  return order;
}

/** A3: close a trip at the door when the customer cannot read their code. */
export async function deliverByOperations(
  orderId: string,
  actor: OpsActor,
  input: { reason: string; cashCollectedBy?: 'RIDER' | 'NONE' }
): Promise<{ order: Order; outcome: 'DELIVERED' | 'REFUSED_AT_DOOR'; caseId?: string }> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  refuseClosed(order);
  if (order.status !== 'OUT_FOR_DELIVERY' || !order.pickedUpAt || !order.riderId) {
    throw new AppError(
      'Only food a rider has collected and is carrying can be marked delivered.',
      409,
      'NOT_OUT_FOR_DELIVERY'
    );
  }

  const isCash = order.paymentMethod === 'CASH_ON_DELIVERY';
  if (isCash && !input.cashCollectedBy) {
    throw new AppError(
      'This is a cash order. Say whether the rider collected the cash.',
      400,
      'CASH_COLLECTED_BY_REQUIRED'
    );
  }

  if (isCash && input.cashCollectedBy === 'NONE') {
    // Not a delivery: no money arrived, so nothing is booked to the rider and
    // nothing is earned. The kitchen cooked it, so a person decides its loss.
    const { order: cancelled } = await orderService.cancelOrder(
      order.id,
      { userId: actor.userId, name: actor.name, role: 'admin' },
      'COD_REFUSED_AT_DOOR'
    );
    // Raised by the staff member, not the customer, so it stays an internal
    // case and never appears in the customer's own help screen.
    const ticket = await supportRepository.create({
      raisedByUserId: actor.userId,
      raisedByRole: 'admin',
      raisedByName: actor.name,
      orderId: order.id,
      orderNumber: order.orderNumber,
      subject: `Cash refused at the door, order #${order.orderNumber}`,
      category: 'DELIVERY',
      message:
        `Operations (${actor.name}) closed this cash order because the customer did not pay: ${input.reason}. ` +
        `Decide the kitchen's compensation and whether to contact the customer (${order.customerId}).`,
      priority: 'HIGH'
    });
    return { order: cancelled ?? order, outcome: 'REFUSED_AT_DOOR', caseId: ticket.id };
  }

  const stored = memoryStore.orders.get(order.id) as Order;
  stored.deliveredByOperations = {
    byUserId: actor.userId,
    byName: actor.name,
    reason: input.reason,
    ...(isCash ? { cashCollectedBy: 'RIDER' as const } : {}),
    at: new Date().toISOString()
  };
  memoryStore.orders.set(order.id, stored);

  // The same transition the partner and rider take, so `completeDelivery()`
  // books the earnings and the rider's cash once. The code check is satisfied
  // by operations on the customer's behalf; who and why is recorded above.
  const delivered = await orderService.transitionStatus(order.id, 'DELIVERED', undefined, stored.deliveryOtp);
  const final = memoryStore.orders.get(order.id) as Order;
  final.riderStage = 'DELIVERED';
  memoryStore.orders.set(order.id, final);
  triggerAutoSave();
  return { order: (delivered as Order) ?? final, outcome: 'DELIVERED' };
}
