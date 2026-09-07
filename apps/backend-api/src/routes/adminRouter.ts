import { Router } from 'express';
import { z } from 'zod';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { memoryStore } from '../db/client.ts';
import { emitOrderStatusUpdate } from '../sockets/socketServer.ts';
import { validate } from '../middlewares/validate.ts';

export const adminRouter = Router();

// GET /api/admin/metrics
adminRouter.get('/metrics', async (req, res) => {
  try {
    const orders = await orderRepository.listAll();
    const activeOrders = orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED' && o.status !== 'REFUNDED');
    const deliveredOrders = orders.filter(o => o.status === 'DELIVERED');
    const gmv = deliveredOrders.reduce((sum, o) => sum + (o.bill?.totalAmount || 0), 0);
    const activeRiders = await riderRepository.findActiveOnlineRiders();
    const pendingKyc = await kycRepository.getPendingDocuments();

    return res.json({
      success: true,
      data: {
        activeOrdersCount: activeOrders.length,
        totalOrdersCount: orders.length,
        deliveredOrdersCount: deliveredOrders.length,
        grossMerchandiseValue: Math.round(gmv * 100) / 100,
        onlineRidersCount: activeRiders.length,
        pendingKycCount: pendingKyc.length,
        totalRestaurantsCount: memoryStore.restaurants.size,
        totalUsersCount: memoryStore.users.size
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/kyc/pending
adminRouter.get('/kyc/pending', async (req, res) => {
  try {
    const pending = await kycRepository.getPendingDocuments();
    return res.json({ success: true, data: { pending } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const ReviewKycSchema = z.object({
  documentId: z.string().min(1, 'documentId is required'),
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional()
});

// POST /api/admin/kyc/review
adminRouter.post('/kyc/review', validate({ body: ReviewKycSchema }), async (req, res) => {
  try {
    const { documentId, action, rejectionReason } = req.body;

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const doc = await kycRepository.reviewDocument(documentId, status, rejectionReason);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Update entity status
    if (doc.entityType === 'RESTAURANT') {
      const rest = await restaurantRepository.findById(doc.entityId);
      if (rest) {
        rest.kycStatus = action === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      }
    } else if (doc.entityType === 'RIDER') {
      await riderRepository.updateKycStatus(doc.entityId, action === 'APPROVE' ? 'ACTIVE' : 'REJECTED');
    }

    return res.json({
      success: true,
      data: { document: doc },
      message: `KYC Document ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const RefundOrderSchema = z.object({
  amount: z.number().positive('Refund amount must be positive').optional(),
  reason: z.string().optional()
});

// POST /api/admin/orders/:id/refund
adminRouter.post('/orders/:id/refund', validate({ body: RefundOrderSchema }), async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const order = await orderRepository.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const refundAmount = amount ? Number(amount) : order.bill.totalAmount;
    await walletRepository.credit(
      order.customerId,
      refundAmount,
      `Refund for Order #${order.orderNumber}: ${reason || 'Admin Dispute Resolution'}`,
      order.id
    );

    await orderRepository.updateStatus(order.id, 'REFUNDED');
    emitOrderStatusUpdate(order.id, {
      orderId: order.id,
      status: 'REFUNDED',
      updatedAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: {
        orderId: order.id,
        refundAmount,
        reason: reason || 'Dispute Resolution'
      },
      message: `Rs ${refundAmount} credited to customer wallet successfully.`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const SuspendEntitySchema = z.object({
  entityType: z.enum(['RESTAURANT', 'RIDER']),
  entityId: z.string().min(1, 'entityId is required'),
  reason: z.string().optional()
});

// POST /api/admin/suspend
adminRouter.post('/suspend', validate({ body: SuspendEntitySchema }), async (req, res) => {
  try {
    const { entityType, entityId, reason } = req.body;
    if (entityType === 'RESTAURANT') {
      const rest = await restaurantRepository.findById(entityId);
      if (rest) {
        rest.status = 'SUSPENDED';
        rest.kycStatus = 'SUSPENDED';
        return res.json({ success: true, message: `Restaurant ${rest.name} suspended.` });
      }
    } else if (entityType === 'RIDER') {
      await riderRepository.updateKycStatus(entityId, 'SUSPENDED');
      await riderRepository.updateOnlineStatus(entityId, false);
      return res.json({ success: true, message: `Rider ${entityId} suspended.` });
    }
    return res.status(404).json({ success: false, error: 'Entity not found' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
