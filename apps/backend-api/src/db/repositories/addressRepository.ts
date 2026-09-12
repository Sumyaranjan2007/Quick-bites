import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../client.ts';

export interface AddressRecord {
  id: string;
  userId: string;
  label: string;
  addressLine: string;
  landmark?: string;
  city: string;
  pincode: string;
  coordinates?: { latitude: number; longitude: number };
  isDefault: boolean;
  createdAt: string;
}

export const addressRepository = {
  async listByUserId(userId: string): Promise<AddressRecord[]> {
    return Array.from(memoryStore.addresses.values())
      .filter((a: AddressRecord) => a.userId === userId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  },

  async findById(id: string): Promise<AddressRecord | null> {
    return memoryStore.addresses.get(id) || null;
  },

  async create(input: Omit<AddressRecord, 'id' | 'createdAt' | 'isDefault'> & { isDefault?: boolean }): Promise<AddressRecord> {
    const existing = await this.listByUserId(input.userId);
    // The first address a customer saves becomes their default automatically.
    const isDefault = input.isDefault ?? existing.length === 0;

    const address: AddressRecord = {
      ...input,
      id: 'addr_' + crypto.randomUUID(),
      isDefault,
      createdAt: new Date().toISOString()
    };

    if (isDefault) {
      for (const other of existing) {
        other.isDefault = false;
      }
    }

    memoryStore.addresses.set(address.id, address);
    triggerAutoSave();
    return address;
  },

  async update(id: string, userId: string, updates: Partial<AddressRecord>): Promise<AddressRecord | null> {
    const address = memoryStore.addresses.get(id);
    if (!address || address.userId !== userId) return null;

    Object.assign(address, updates, { id: address.id, userId: address.userId });

    if (updates.isDefault) {
      for (const other of await this.listByUserId(userId)) {
        if (other.id !== id) other.isDefault = false;
      }
    }

    triggerAutoSave();
    return address;
  },

  async remove(id: string, userId: string): Promise<boolean> {
    const address = memoryStore.addresses.get(id);
    if (!address || address.userId !== userId) return false;

    memoryStore.addresses.delete(id);

    // Never leave a customer without a default address.
    if (address.isDefault) {
      const remaining = await this.listByUserId(userId);
      if (remaining.length > 0) remaining[0].isDefault = true;
    }

    triggerAutoSave();
    return true;
  }
};
