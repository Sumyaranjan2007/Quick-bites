import { memoryStore, triggerAutoSave } from '../client.ts';
import type { DeliveryRider, KycStatus, Coordinates } from '@quick-bites/shared-types';

/**
 * Documents a rider must have approved before they are allowed on shift.
 *
 * Insurance is collected too, but a missing insurance paper does not stop
 * someone earning — it is chased separately by operations.
 */
export const MANDATORY_RIDER_DOCUMENTS = ['DRIVING_LICENSE', 'VEHICLE_RC'] as const;
export const RIDER_DOCUMENT_TYPES = ['DRIVING_LICENSE', 'VEHICLE_RC', 'AADHAAR', 'PAN', 'INSURANCE'] as const;

export class RiderRepository {
  async findById(id: string): Promise<DeliveryRider | null> {
    return memoryStore.riders.get(id) || null;
  }

  async findByUserId(userId: string): Promise<DeliveryRider | null> {
    for (const rider of memoryStore.riders.values()) {
      if (rider.userId === userId) {
        return rider;
      }
    }
    return null;
  }

  async create(data: Omit<DeliveryRider, 'id'> & { id?: string }): Promise<DeliveryRider> {
    const id = data.id || `rdr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const rider: DeliveryRider = {
      id,
      ...data,
      driverCode: data.driverCode || nextDriverCode(),
      isOnline: data.isOnline ?? false,
      kycStatus: data.kycStatus || 'PENDING_APPROVAL',
      codCashInHand: data.codCashInHand ?? 0,
      offersReceived: data.offersReceived ?? 0,
      offersAccepted: data.offersAccepted ?? 0
    };
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  /**
   * Applies a partial update.
   *
   * Every mutation here ends in triggerAutoSave. They used not to: the shift
   * toggle wrote `isOnline` into the in-memory map and never asked for the
   * snapshot to be persisted, so a rider who went Online was Offline again
   * after the next restart — and nothing downstream, customer or dispatch,
   * agreed with what the rider's own screen was showing.
   */
  async update(id: string, patch: Partial<DeliveryRider>): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    Object.assign(rider, patch);
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  async updateOnlineStatus(id: string, isOnline: boolean): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    const now = new Date().toISOString();
    rider.isOnline = isOnline;
    rider.lastPingAt = now;
    rider.lastShiftChangeAt = now;
    // Kept from the previous shift only while the rider stays on it, so "hours
    // online today" measures one continuous stretch rather than all of history.
    rider.onlineSince = isOnline ? now : undefined;
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  async updateLocation(id: string, coords: Coordinates): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.currentCoordinates = coords;
    rider.lastPingAt = new Date().toISOString();
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  async updateKycStatus(id: string, status: KycStatus): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.kycStatus = status;
    // A rider whose approval is withdrawn must not stay on the dispatch list.
    if (status !== 'ACTIVE') {
      rider.isOnline = false;
      rider.onlineSince = undefined;
    }
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  /** Counts a trip being offered to this rider, for the acceptance rate. */
  async recordOffer(id: string): Promise<void> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return;
    rider.offersReceived = (rider.offersReceived || 0) + 1;
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
  }

  /** Counts an offer this rider took. Also counts the offer, so a trip claimed
   *  straight from the list without a prior offer still lands in both totals. */
  async recordAcceptance(id: string, countOffer: boolean): Promise<void> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return;
    if (countOffer) rider.offersReceived = (rider.offersReceived || 0) + 1;
    rider.offersAccepted = (rider.offersAccepted || 0) + 1;
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
  }

  /**
   * Records that this rider accepted a trip and never collected it.
   *
   * Counted rather than punished. One no-show is a puncture, a phone that died,
   * or a rider who had an accident; a pattern of them is somebody accepting
   * trips to keep their acceptance rate up and then dropping the ones they do
   * not fancy, which costs a customer their dinner every time. The number is
   * what makes the difference visible in the admin app — this code has no
   * business deciding which one it was.
   */
  async recordNoShow(id: string): Promise<void> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return;
    rider.noShowCount = (rider.noShowCount || 0) + 1;
    rider.lastNoShowAt = new Date().toISOString();
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
  }

  async adjustCashInHand(id: string, delta: number): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.codCashInHand = Math.round(((rider.codCashInHand || 0) + delta) * 100) / 100;
    memoryStore.riders.set(id, rider);
    triggerAutoSave();
    return rider;
  }

  async findActiveOnlineRiders(): Promise<DeliveryRider[]> {
    const active: DeliveryRider[] = [];
    for (const rider of memoryStore.riders.values()) {
      if (rider.isOnline && rider.kycStatus === 'ACTIVE') {
        active.push(rider);
      }
    }
    return active;
  }

  async findAll(): Promise<DeliveryRider[]> {
    return Array.from(memoryStore.riders.values());
  }
}

/** QB-RID-0001 upwards, so the number a rider quotes to support is short. */
function nextDriverCode(): string {
  let highest = 0;
  for (const rider of memoryStore.riders.values()) {
    const match = /^QB-RID-(\d+)$/.exec(rider.driverCode || '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `QB-RID-${String(highest + 1).padStart(4, '0')}`;
}

export const riderRepository = new RiderRepository();
