import { memoryStore } from '../client.ts';
import type { DeliveryRider, KycStatus, Coordinates } from '@quick-bites/shared-types';

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
      isOnline: data.isOnline ?? false,
      kycStatus: data.kycStatus || 'PENDING_APPROVAL'
    };
    memoryStore.riders.set(id, rider);
    return rider;
  }

  async updateOnlineStatus(id: string, isOnline: boolean): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.isOnline = isOnline;
    rider.lastPingAt = new Date().toISOString();
    memoryStore.riders.set(id, rider);
    return rider;
  }

  async updateLocation(id: string, coords: Coordinates): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.currentCoordinates = coords;
    rider.lastPingAt = new Date().toISOString();
    memoryStore.riders.set(id, rider);
    return rider;
  }

  async updateKycStatus(id: string, status: KycStatus): Promise<DeliveryRider | null> {
    const rider = memoryStore.riders.get(id);
    if (!rider) return null;
    rider.kycStatus = status;
    memoryStore.riders.set(id, rider);
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

export const riderRepository = new RiderRepository();
