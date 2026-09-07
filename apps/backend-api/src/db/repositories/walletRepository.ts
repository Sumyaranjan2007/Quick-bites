import { memoryStore, triggerAutoSave } from '../client.ts';
import type { Wallet, WalletTransaction } from '@quick-bites/shared-types';

export class WalletRepository {
  async getByUserId(userId: string): Promise<Wallet> {
    let wallet = memoryStore.wallets.get(userId);
    if (!wallet) {
      wallet = {
        id: `wlt_${userId}`,
        userId,
        balance: 0.00,
        currency: 'INR',
        updatedAt: new Date().toISOString()
      };
      memoryStore.wallets.set(userId, wallet);
      triggerAutoSave();
    }
    return wallet;
  }

  async credit(userId: string, amount: number, description: string, orderId?: string): Promise<Wallet> {
    const wallet = await this.getByUserId(userId);
    wallet.balance = Math.round((wallet.balance + amount) * 100) / 100;
    wallet.updatedAt = new Date().toISOString();
    memoryStore.wallets.set(userId, wallet);

    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      walletId: wallet.id,
      orderId,
      amount,
      type: 'CREDIT',
      description,
      createdAt: new Date().toISOString()
    };
    memoryStore.walletTransactions.set(tx.id, tx);
    triggerAutoSave();

    return wallet;
  }

  async debit(userId: string, amount: number, description: string, orderId?: string): Promise<Wallet> {
    const wallet = await this.getByUserId(userId);
    if (wallet.balance < amount) {
      throw new Error(`Insufficient wallet balance: available Rs ${wallet.balance}, requested Rs ${amount}`);
    }

    wallet.balance = Math.round((wallet.balance - amount) * 100) / 100;
    wallet.updatedAt = new Date().toISOString();
    memoryStore.wallets.set(userId, wallet);

    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      walletId: wallet.id,
      orderId,
      amount,
      type: 'DEBIT',
      description,
      createdAt: new Date().toISOString()
    };
    memoryStore.walletTransactions.set(tx.id, tx);
    triggerAutoSave();

    return wallet;
  }

  async getTransactions(walletId: string): Promise<WalletTransaction[]> {
    const list: WalletTransaction[] = [];
    for (const tx of memoryStore.walletTransactions.values()) {
      if (tx.walletId === walletId) {
        list.push(tx);
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const walletRepository = new WalletRepository();
