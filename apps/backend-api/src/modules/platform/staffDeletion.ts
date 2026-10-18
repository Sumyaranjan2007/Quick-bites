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
  // Owner Q2 (18 Oct 2026): they can still sign in, see their money and settle
  // up while an admin reviews; they get no new orders (kitchen closed, rider
  // offline and refused at "go online"). So the account is not blocked.
  await userRepository.update(userId, { deletionRequestedAt: new Date().toISOString() } as any);
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
  /** What an admin checks before approving (owner, item 14): open with the full record (B7). */
  kitchens: Array<{ id: string; name: string }>;
  riderId: string | null;
  ordersInProgress: number;
  ordersTotal: number;
  documents: { total: number; approved: number };
  lastActiveAt: string | null;
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
  const kitchens = restaurantsOf(user.id);
  const theirs = (Array.from(memoryStore.orders.values()) as any[]).filter(
    o => kitchens.some(k => k.id === o.restaurantId) || (rider && o.riderId === rider.id)
  );
  const entityIds = new Set([...kitchens.map(k => k.id), ...(rider ? [rider.id] : [])]);
  const docs = (Array.from(memoryStore.kycDocuments.values()) as any[]).filter(d => entityIds.has(d.entityId));
  const lastActiveAt = theirs.reduce<string | null>((latest, o) => {
    const at = o.updatedAt || o.createdAt;
    return at && (!latest || at > latest) ? at : latest;
  }, null);
  return {
    kitchens: kitchens.map(k => ({ id: k.id, name: k.name })),
    riderId: rider?.id ?? null,
    ordersInProgress: theirs.filter(o => !LIVE.includes(o.status)).length,
    ordersTotal: theirs.length,
    documents: { total: docs.length, approved: docs.filter(d => d.status === 'APPROVED').length },
    lastActiveAt,
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
  // Requests made before 18 Oct also locked the account; lift only that lock, never a separate block.
  const legacyLock = user.isBlocked && user.blockReason === REASON;
  await userRepository.update(userId, {
    deletionRequestedAt: undefined,
    ...(legacyLock ? { isBlocked: false, blockReason: '' } : {})
  } as any);
  for (const kitchen of restaurantsOf(userId)) {
    if (kitchen.statusBeforeDeletionRequest) {
      kitchen.status = kitchen.statusBeforeDeletionRequest;
      delete kitchen.statusBeforeDeletionRequest;
      memoryStore.restaurants.set(kitchen.id, kitchen);
    }
  }
  triggerAutoSave();
}

/**
 * Remove an account (owner Q1, 18 Oct 2026): closed for good, data kept, and
 * the person may register again from scratch with the same email and number.
 * Unlike Block, nothing is banned; unlike a deletion request, an admin does it.
 * The email and phone move to `removedIdentity` and the account gets a
 * placeholder address, so a new sign-up does not find (and refuse on) this one.
 * Refused while one of its orders is still in progress.
 */
export async function removeAccount(userId: string, reason: string, byUserId: string): Promise<void> {
  const user = (await userRepository.findById(userId)) as any;
  if (!user) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');
  if (user.removedAt) throw new AppError('This account is already removed.', 409, 'ALREADY_REMOVED');

  const kitchens = restaurantsOf(userId);
  const rider = riderOf(userId);
  const live = (Array.from(memoryStore.orders.values()) as any[]).find(
    o =>
      !LIVE.includes(o.status) &&
      (o.customerId === userId || kitchens.some(k => k.id === o.restaurantId) || (rider && o.riderId === rider.id))
  );
  if (live) {
    throw new AppError(`Order #${live.orderNumber} is still in progress. Remove the account once it is finished.`, 409, 'ORDER_IN_PROGRESS');
  }

  for (const kitchen of kitchens) {
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
    blockReason: 'This account was removed by Quick Bites.',
    removedAt: new Date().toISOString(),
    removedReason: reason,
    removedBy: byUserId,
    removedIdentity: { email: user.email, phone: user.phone },
    email: `removed-${userId}@removed.quickbite.app`,
    phone: undefined,
    deletionRequestedAt: undefined
  } as any);
  triggerAutoSave();
}
