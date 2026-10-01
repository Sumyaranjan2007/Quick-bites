/**
 * "Delete account" for restaurant partners and riders (owner, 2 Oct 2026).
 *
 * Google Play requires an in-app way to delete an account in any app people
 * can sign up in. A customer's account is deleted at once. A partner's or a
 * rider's cannot be, honestly: the platform may owe them money, or a rider may
 * be holding the platform's cash, and deleting the account first would leave
 * money with nobody to pay or to collect from.
 *
 * So for them it is a REQUEST that takes effect immediately as far as they can
 * tell — the account is locked, the kitchen closes, the rider goes off shift —
 * and an administrator completes the deletion once nothing is owed either way.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { AppError } from '../../utils/AppError.ts';
import { duesFor } from '../payments/payouts.ts';
import { toRupees } from '../payments/money.ts';
import { setRiderOfferPoolMembership } from '../../sockets/socketServer.ts';

const LIVE = ['DELIVERED', 'CANCELLED', 'REFUNDED'];
const REASON = 'Account deletion requested by the account holder';

export function isStaffRole(role: string | undefined): boolean {
  return role === 'restaurant_owner' || role === 'rider';
}

function restaurantsOf(userId: string): any[] {
  return (Array.from(memoryStore.restaurants.values()) as any[]).filter(r => r.ownerId === userId);
}
function riderOf(userId: string): any | undefined {
  return (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === userId);
}

/** Closes the account now and queues it for an administrator. */
export async function requestStaffDeletion(userId: string): Promise<void> {
  const user = (await userRepository.findById(userId)) as any;
  if (!user) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');

  const kitchens = restaurantsOf(userId);
  const rider = riderOf(userId);
  const orders = Array.from(memoryStore.orders.values()) as any[];
  const live = orders.find(
    o => !LIVE.includes(o.status) && (kitchens.some(k => k.id === o.restaurantId) || (rider && o.riderId === rider.id))
  );
  if (live) {
    throw new AppError(
      `Order #${live.orderNumber} is still in progress. Finish it first, then delete your account.`,
      409,
      'ORDER_IN_PROGRESS'
    );
  }

  for (const kitchen of kitchens) {
    kitchen.statusBeforeDeletionRequest = kitchen.status;
    kitchen.isOpen = false;
    kitchen.status = 'CLOSED';
    memoryStore.restaurants.set(kitchen.id, kitchen);
  }
  if (rider) {
    rider.isOnline = false;
    memoryStore.riders.set(rider.id, rider);
    setRiderOfferPoolMembership(userId, false);
  }
  await userRepository.update(userId, {
    isBlocked: true,
    blockReason: REASON,
    deletionRequestedAt: new Date().toISOString()
  } as any);
  triggerAutoSave();
}

export interface DeletionRequestRow {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  requestedAt: string;
  /** What Quick Bites still owes them, in rupees. */
  owedToThem: number;
  /** Platform cash a rider still holds, in rupees. */
  cashTheyHold: number;
  canComplete: boolean;
  waitingFor: string | null;
}

function rowFor(user: any): DeletionRequestRow {
  let owedPaise = 0;
  let cashPaise = 0;
  for (const kitchen of restaurantsOf(user.id)) owedPaise += duesFor('RESTAURANT', kitchen.id, kitchen.name).outstandingPaise;
  const rider = riderOf(user.id);
  if (rider) {
    const due = duesFor('RIDER', rider.id, rider.fullName);
    owedPaise += due.outstandingPaise;
    cashPaise += due.cashInHandPaise;
  }
  const waitingFor =
    owedPaise > 0
      ? `Pay them ${toRupees(owedPaise)} first (Money → Settlements).`
      : cashPaise > 0
        ? `Collect ${toRupees(cashPaise)} of cash they hold first.`
        : null;
  return {
    userId: user.id,
    name: user.fullName || user.email,
    email: user.email,
    phone: user.phone,
    role: user.role,
    requestedAt: user.deletionRequestedAt,
    owedToThem: toRupees(owedPaise),
    cashTheyHold: toRupees(cashPaise),
    canComplete: owedPaise === 0 && cashPaise === 0,
    waitingFor
  };
}

export function listDeletionRequests(): DeletionRequestRow[] {
  return (Array.from(memoryStore.users.values()) as any[])
    .filter(u => u.deletionRequestedAt && isStaffRole(u.role))
    .map(rowFor)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * Deletes the account once nothing is owed either way. The restaurant and
 * rider records stay (closed), because past orders and payouts refer to them,
 * but carry no way to reach the person any more.
 */
export async function completeStaffDeletion(userId: string): Promise<void> {
  const user = (await userRepository.findById(userId)) as any;
  if (!user || !user.deletionRequestedAt) throw new AppError('No deletion request for this account.', 404, 'NO_REQUEST');
  const row = rowFor(user);
  if (!row.canComplete) throw new AppError(row.waitingFor || 'Settle what is owed first.', 409, 'DUES_OUTSTANDING');

  for (const kitchen of restaurantsOf(userId)) {
    kitchen.status = 'CLOSED';
    kitchen.isOpen = false;
    kitchen.phone = '';
    memoryStore.restaurants.set(kitchen.id, kitchen);
  }
  const rider = riderOf(userId);
  if (rider) {
    rider.phone = '';
    rider.isOnline = false;
    memoryStore.riders.set(rider.id, rider);
  }
  await userRepository.deleteAccount(userId);
}

/** Changed their mind: the account opens again (the kitchen stays closed until they open it). */
export async function cancelStaffDeletion(userId: string): Promise<void> {
  const user = (await userRepository.findById(userId)) as any;
  if (!user || !user.deletionRequestedAt) throw new AppError('No deletion request for this account.', 404, 'NO_REQUEST');
  await userRepository.update(userId, { isBlocked: false, blockReason: '', deletionRequestedAt: undefined } as any);
  for (const kitchen of restaurantsOf(userId)) {
    if (kitchen.statusBeforeDeletionRequest) {
      kitchen.status = kitchen.statusBeforeDeletionRequest;
      delete kitchen.statusBeforeDeletionRequest;
      memoryStore.restaurants.set(kitchen.id, kitchen);
    }
  }
  triggerAutoSave();
}
