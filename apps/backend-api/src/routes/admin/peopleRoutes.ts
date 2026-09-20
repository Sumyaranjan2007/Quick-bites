/**
 * The people on the platform: customers, delivery partners, restaurant partners,
 * and the documents that qualify the last two to trade.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { validate } from '../../middlewares/validate.ts';
import { AppError } from '../../utils/AppError.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { walletRepository } from '../../db/repositories/walletRepository.ts';
import { kycRepository } from '../../db/repositories/kycRepository.ts';
import { payoutRepository } from '../../db/repositories/payoutRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { summariseOrder, matchesQuery, paginate } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import type { Order } from '@quick-bites/shared-types';

export const peopleRoutes = Router();

/* ------------------------------- Customers ------------------------------- */

/** GET /api/admin/customers — searchable directory with order and spend totals. */
peopleRoutes.get('/customers', requirePermission('users.customers.view'), async (req, res, next) => {
  try {
    const { q, status, page, pageSize } = req.query as Record<string, string>;
    const orders = (await orderRepository.listAll()) as Order[];

    let customers = (await userRepository.list())
      .filter(u => u.role === 'customer')
      .map(user => {
        const own = orders.filter(o => o.customerId === user.id);
        const delivered = own.filter(o => o.status === 'DELIVERED');
        const wallet = memoryStore.wallets.get(user.id);
        return {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          isGold: user.isGold,
          isBlocked: Boolean((user as any).isBlocked),
          joinedAt: user.createdAt,
          orderCount: own.length,
          deliveredCount: delivered.length,
          lifetimeValue:
            Math.round(delivered.reduce((total, o) => total + (Number(o.bill?.totalAmount) || 0), 0) * 100) / 100,
          walletBalance: wallet?.balance ?? 0,
          lastOrderAt: own[0]?.createdAt || null
        };
      });

    if (status === 'BLOCKED') customers = customers.filter(c => c.isBlocked);
    if (status === 'ACTIVE') customers = customers.filter(c => !c.isBlocked);
    if (q) customers = customers.filter(c => matchesQuery(q, c.fullName, c.email, c.phone, c.id));

    customers.sort((a, b) => b.lifetimeValue - a.lifetimeValue);
    const { rows, pagination } = paginate(customers, Number(page) || 1, Number(pageSize) || 25);
    res.json({ success: true, data: { customers: rows, pagination } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/customers/:id — profile, wallet, addresses and order history. */
peopleRoutes.get('/customers/:id', requirePermission('users.customers.view'), async (req, res, next) => {
  try {
    const user = await userRepository.findById(req.params.id);
    if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

    const orders = await orderRepository.listByCustomerId(user.id);
    const wallet = await walletRepository.getByUserId(user.id);
    const { passwordHash, ...safe } = user as any;

    res.json({
      success: true,
      data: {
        customer: safe,
        wallet,
        transactions: await walletRepository.getTransactions(wallet.id),
        addresses: Array.from(memoryStore.addresses.values()).filter((a: any) => a.userId === user.id),
        orders: orders.map(summariseOrder),
        stats: {
          total: orders.length,
          delivered: orders.filter(o => o.status === 'DELIVERED').length,
          cancelled: orders.filter(o => o.status === 'CANCELLED').length,
          spend:
            Math.round(
              orders
                .filter(o => o.status === 'DELIVERED')
                .reduce((t, o) => t + (Number(o.bill?.totalAmount) || 0), 0) * 100
            ) / 100
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

const CustomerUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  isGold: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
  blockReason: z.string().trim().max(300).optional()
});

/**
 * PATCH /api/admin/customers/:id
 *
 * Email is not editable here on purpose: it is the login, and moving it from a
 * support screen would hand the account to whoever typed the new address.
 */
peopleRoutes.patch(
  '/customers/:id',
  requirePermission('users.customers.manage'),
  validate({ body: CustomerUpdateSchema }),
  async (req, res, next) => {
    try {
      const user = await userRepository.findById(req.params.id);
      if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

      const before = { fullName: user.fullName, isGold: user.isGold, isBlocked: (user as any).isBlocked };
      const updated = await userRepository.update(user.id, req.body);

      recordAudit(req, {
        action: req.body.isBlocked === undefined ? 'CUSTOMER_UPDATED' : req.body.isBlocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
        entityType: 'CUSTOMER',
        entityId: user.id,
        summary: `Updated customer ${user.fullName}${req.body.blockReason ? ` — ${req.body.blockReason}` : ''}`,
        before,
        after: req.body
      });

      const { passwordHash, ...safe } = (updated || {}) as any;
      res.json({ success: true, data: { customer: safe } });
    } catch (err) {
      next(err);
    }
  }
);

const WalletAdjustSchema = z.object({
  amount: z.number().positive().max(100000),
  direction: z.enum(['CREDIT', 'DEBIT']),
  reason: z.string().trim().min(3).max(200)
});

/** POST /api/admin/customers/:id/wallet — goodwill credits and corrections. */
peopleRoutes.post(
  '/customers/:id/wallet',
  requirePermission('users.customers.manage', 'finance.refunds.manage'),
  validate({ body: WalletAdjustSchema }),
  async (req, res, next) => {
    try {
      const user = await userRepository.findById(req.params.id);
      if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

      const { amount, direction, reason } = req.body;
      const wallet =
        direction === 'CREDIT'
          ? await walletRepository.credit(user.id, amount, reason)
          : await walletRepository.debit(user.id, amount, reason);

      recordAudit(req, {
        action: `WALLET_${direction}`,
        entityType: 'CUSTOMER',
        entityId: user.id,
        summary: `${direction === 'CREDIT' ? 'Credited' : 'Debited'} Rs ${amount} ${
          direction === 'CREDIT' ? 'to' : 'from'
        } ${user.fullName}: ${reason}`,
        after: { balance: wallet.balance }
      });

      res.json({ success: true, data: { wallet } });
    } catch (err) {
      next(err);
    }
  }
);

/* --------------------------------- Drivers -------------------------------- */

/** GET /api/admin/drivers — fleet directory with live status and earnings. */
peopleRoutes.get('/drivers', requirePermission('users.drivers.view'), async (req, res, next) => {
  try {
    const { q, status, page, pageSize } = req.query as Record<string, string>;
    const orders = (await orderRepository.listAll()) as Order[];

    let drivers = (await riderRepository.findAll()).map(rider => {
      const own = orders.filter(o => o.riderId === rider.id);
      const delivered = own.filter(o => o.status === 'DELIVERED');
      const rated = delivered.filter(o => typeof o.riderRating === 'number');
      const active = own.find(o => o.status === 'RIDER_ASSIGNED' || o.status === 'OUT_FOR_DELIVERY');
      return {
        id: rider.id,
        userId: rider.userId,
        fullName: rider.fullName,
        driverCode: rider.driverCode,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        kycStatus: rider.kycStatus,
        isOnline: rider.isOnline,
        onlineSince: rider.onlineSince,
        lastPingAt: rider.lastPingAt,
        currentCoordinates: rider.currentCoordinates,
        codCashInHand: rider.codCashInHand || 0,
        trips: delivered.length,
        earnings: Math.round(delivered.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100,
        rating: rated.length
          ? Math.round((rated.reduce((t, o) => t + (o.riderRating || 0), 0) / rated.length) * 10) / 10
          : 0,
        acceptanceRate: rider.offersReceived
          ? Math.round(((rider.offersAccepted || 0) / rider.offersReceived) * 100)
          : 0,
        /**
         * Trips accepted and then never collected.
         *
         * Served beside the acceptance rate on purpose: the two together are
         * the thing worth looking at. A rider at 95% acceptance with six
         * no-shows is protecting that number by taking trips they then drop,
         * and each one costs a customer their dinner. Neither figure says that
         * on its own.
         */
        noShowCount: rider.noShowCount || 0,
        lastNoShowAt: rider.lastNoShowAt || null,
        activeOrderId: active?.id || null,
        activeOrderNumber: active?.orderNumber || null
      };
    });

    if (status === 'ONLINE') drivers = drivers.filter(d => d.isOnline);
    if (status === 'ACTIVE') drivers = drivers.filter(d => d.kycStatus === 'ACTIVE');
    if (status === 'PENDING') drivers = drivers.filter(d => d.kycStatus === 'PENDING_APPROVAL');
    if (status === 'SUSPENDED') drivers = drivers.filter(d => d.kycStatus === 'SUSPENDED');
    if (q) drivers = drivers.filter(d => matchesQuery(q, d.fullName, d.driverCode, d.phone, d.id));

    drivers.sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.trips - a.trips);
    const { rows, pagination } = paginate(drivers, Number(page) || 1, Number(pageSize) || 25);
    res.json({ success: true, data: { drivers: rows, pagination } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/drivers/:id — profile, documents, trips and payout history. */
peopleRoutes.get('/drivers/:id', requirePermission('users.drivers.view'), async (req, res, next) => {
  try {
    const rider = await riderRepository.findById(req.params.id);
    if (!rider) throw new AppError('Delivery partner not found.', 404, 'RIDER_NOT_FOUND');

    const orders = await orderRepository.listByRiderId(rider.id);
    const delivered = orders.filter(o => o.status === 'DELIVERED');

    res.json({
      success: true,
      data: {
        driver: rider,
        documents: await kycRepository.findByEntity('RIDER', rider.id),
        wallet: await walletRepository.getByUserId(rider.userId),
        payouts: await payoutRepository.list({ riderId: rider.id }),
        trips: orders.map(summariseOrder),
        stats: {
          trips: delivered.length,
          earnings: Math.round(delivered.reduce((t, o) => t + (Number(o.riderPayout) || 0), 0) * 100) / 100,
          paidOut: await payoutRepository.paidTotal(rider.id),
          codCashInHand: rider.codCashInHand || 0,
          cancelled: orders.filter(o => o.status === 'CANCELLED').length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

const DriverUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  vehicleType: z.enum(['BIKE', 'EV', 'CYCLE']).optional(),
  kycStatus: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
  reason: z.string().trim().max(300).optional()
});

/** PATCH /api/admin/drivers/:id — edit a partner, or change what they may do. */
peopleRoutes.patch(
  '/drivers/:id',
  requirePermission('users.drivers.manage'),
  validate({ body: DriverUpdateSchema }),
  async (req, res, next) => {
    try {
      const rider = await riderRepository.findById(req.params.id);
      if (!rider) throw new AppError('Delivery partner not found.', 404, 'RIDER_NOT_FOUND');

      const { kycStatus, reason, ...fields } = req.body;
      const before = { kycStatus: rider.kycStatus, ...fields };

      if (Object.keys(fields).length) await riderRepository.update(rider.id, fields);
      // Routed through updateKycStatus rather than a plain patch so the
      // side effect that matters — a suspended rider being taken off shift —
      // cannot be skipped.
      if (kycStatus) await riderRepository.updateKycStatus(rider.id, kycStatus);

      recordAudit(req, {
        action: kycStatus ? `DRIVER_${kycStatus}` : 'DRIVER_UPDATED',
        entityType: 'RIDER',
        entityId: rider.id,
        summary: `Updated delivery partner ${rider.fullName}${reason ? ` — ${reason}` : ''}`,
        before,
        after: req.body
      });

      res.json({ success: true, data: { driver: await riderRepository.findById(rider.id) } });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------- Restaurants ------------------------------ */

/** GET /api/admin/restaurants — partner directory with live trading state. */
peopleRoutes.get('/restaurants', requirePermission('users.restaurants.view'), async (req, res, next) => {
  try {
    const { q, status, page, pageSize } = req.query as Record<string, string>;
    const orders = (await orderRepository.listAll()) as Order[];

    let restaurants = (await restaurantRepository.listAll()).map(restaurant => {
      const own = orders.filter(o => o.restaurantId === restaurant.id);
      const delivered = own.filter(o => o.status === 'DELIVERED');
      const menu = memoryStore.menus.get(restaurant.id);
      const live = own.filter(o => !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status));
      return {
        id: restaurant.id,
        name: restaurant.name,
        ownerId: restaurant.ownerId,
        phone: restaurant.phone,
        city: restaurant.city,
        addressLine: restaurant.addressLine,
        cuisineTags: restaurant.cuisineTags,
        status: restaurant.status,
        kycStatus: restaurant.kycStatus,
        isOpen: restaurant.isOpen,
        isPureVeg: restaurant.isPureVeg,
        rating: restaurant.ratingAverage,
        ratingCount: restaurant.ratingCount,
        orders: own.length,
        liveOrders: live.length,
        revenue: Math.round(delivered.reduce((t, o) => t + (Number(o.bill?.totalAmount) || 0), 0) * 100) / 100,
        payable:
          Math.round(delivered.reduce((t, o) => t + (Number(o.bill?.restaurantNetPayout) || 0), 0) * 100) / 100,
        menuItems: (menu?.categories || []).reduce((n: number, c: any) => n + (c.items?.length || 0), 0)
      };
    });

    if (status && status !== 'ALL') restaurants = restaurants.filter(r => r.status === status);
    if (q) restaurants = restaurants.filter(r => matchesQuery(q, r.name, r.city, r.phone, r.id));

    restaurants.sort((a, b) => b.revenue - a.revenue);
    const { rows, pagination } = paginate(restaurants, Number(page) || 1, Number(pageSize) || 25);
    res.json({ success: true, data: { restaurants: rows, pagination } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/restaurants/:id — the partner, their menu and their trade. */
peopleRoutes.get('/restaurants/:id', requirePermission('users.restaurants.view'), async (req, res, next) => {
  try {
    const restaurant = await restaurantRepository.findById(req.params.id);
    if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

    const orders = await orderRepository.listByRestaurantId(restaurant.id);
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const owner = memoryStore.users.get(restaurant.ownerId);

    res.json({
      success: true,
      data: {
        restaurant,
        owner: owner ? { id: owner.id, fullName: owner.fullName, email: owner.email, phone: owner.phone } : null,
        menu: memoryStore.menus.get(restaurant.id) || null,
        documents: await kycRepository.findByEntity('RESTAURANT', restaurant.id),
        orders: orders.slice(0, 50).map(summariseOrder),
        stats: {
          orders: orders.length,
          delivered: delivered.length,
          cancelled: orders.filter(o => o.status === 'CANCELLED').length,
          revenue: Math.round(delivered.reduce((t, o) => t + (Number(o.bill?.totalAmount) || 0), 0) * 100) / 100,
          payable:
            Math.round(delivered.reduce((t, o) => t + (Number(o.bill?.restaurantNetPayout) || 0), 0) * 100) / 100
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

const RestaurantUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  cuisineTags: z.array(z.string().trim().max(40)).max(12).optional(),
  packagingFee: z.number().min(0).max(200).optional(),
  isPureVeg: z.boolean().optional(),
  status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  reason: z.string().trim().max(300).optional()
});

/** PATCH /api/admin/restaurants/:id — edit, approve, suspend or close a partner. */
peopleRoutes.patch(
  '/restaurants/:id',
  requirePermission('users.restaurants.manage', 'catalog.restaurants.approve'),
  validate({ body: RestaurantUpdateSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await restaurantRepository.findById(req.params.id);
      if (!restaurant) throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');

      const { reason, status, ...fields } = req.body;
      const before = { status: restaurant.status, name: restaurant.name };

      Object.assign(restaurant, fields);
      if (status) {
        restaurant.status = status;
        // The trading state and the KYC state have to agree, or a suspended
        // partner still looks approved on the screen that decides onboarding.
        if (status === 'ACTIVE') restaurant.kycStatus = 'ACTIVE';
        if (status === 'SUSPENDED') restaurant.kycStatus = 'SUSPENDED';
        // A partner that is not trading must not keep taking orders.
        if (status !== 'ACTIVE') restaurant.isOpen = false;
      }
      memoryStore.restaurants.set(restaurant.id, restaurant);
      triggerAutoSave();

      recordAudit(req, {
        action: status ? `RESTAURANT_${status}` : 'RESTAURANT_UPDATED',
        entityType: 'RESTAURANT',
        entityId: restaurant.id,
        summary: `Updated restaurant ${restaurant.name}${reason ? ` — ${reason}` : ''}`,
        before,
        after: req.body
      });

      res.json({ success: true, data: { restaurant } });
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------- Documents ------------------------------- */

/** GET /api/admin/documents?status=PENDING — the KYC review queue. */
peopleRoutes.get('/documents', requirePermission('documents.view'), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const all = Array.from(memoryStore.kycDocuments.values());
    const rows = (status === 'ALL' ? all : all.filter((d: any) => d.status === status)).sort(
      (a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
    res.json({ success: true, data: { documents: rows, pending: rows.filter((d: any) => d.status === 'PENDING') } });
  } catch (err) {
    next(err);
  }
});

const DocumentReviewSchema = z.object({
  documentId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT', 'REQUEST_REUPLOAD']),
  rejectionReason: z.string().trim().max(400).optional()
});

/**
 * POST /api/admin/documents/review
 *
 * REQUEST_REUPLOAD is a rejection that says so: the document goes back to the
 * partner with a reason instead of leaving them approved-or-not with no idea
 * what to fix.
 */
peopleRoutes.post(
  '/documents/review',
  requirePermission('documents.review'),
  validate({ body: DocumentReviewSchema }),
  async (req, res, next) => {
    try {
      const { documentId, action, rejectionReason } = req.body;
      if (action !== 'APPROVE' && !rejectionReason) {
        throw new AppError(
          'Tell the partner what was wrong, so they can correct and resubmit.',
          400,
          'REJECTION_REASON_REQUIRED'
        );
      }

      const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const doc = await kycRepository.reviewDocument(documentId, status, rejectionReason);
      if (!doc) throw new AppError('Document not found.', 404, 'DOCUMENT_NOT_FOUND');

      if (doc.entityType === 'RESTAURANT') {
        const restaurant = await restaurantRepository.findById(doc.entityId);
        if (restaurant) {
          // Through the repository so the decision is written down. Assigning the
          // fields and calling memoryStore.set skipped triggerAutoSave, so an
          // approval survived only if some unrelated write happened to save the
          // store before the next restart — the same shape as the kitchen toggle.
          await restaurantRepository.updateKycStatus(
            restaurant.id,
            action === 'APPROVE' ? 'ACTIVE' : 'REJECTED'
          );
          if (action === 'APPROVE' && restaurant.status === 'PENDING_APPROVAL') {
            await restaurantRepository.updateStatus(restaurant.id, 'ACTIVE');
          }
        }
      } else if (doc.entityType === 'RIDER') {
        await riderRepository.updateKycStatus(doc.entityId, action === 'APPROVE' ? 'ACTIVE' : 'REJECTED');
      }

      recordAudit(req, {
        action: `DOCUMENT_${action}`,
        entityType: 'KYC_DOCUMENT',
        entityId: doc.id,
        summary: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} ${doc.documentType} for ${
          doc.entityName || doc.entityId
        }${rejectionReason ? ` — ${rejectionReason}` : ''}`,
        after: { status }
      });

      res.json({ success: true, data: { document: doc } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/staff/:userId/reset-password
 *
 * Replaces emailed recovery codes for partners, riders and administrators.
 *
 * Customers no longer have a password at all — they sign in with a code sent to
 * their phone — but staff still do, because a kitchen tablet is shared between
 * shifts and a restaurant's access should not depend on one person's handset
 * being in the building. That left staff with no way back in once the email
 * flow was removed, and reinstating email for three roles would mean running a
 * mail provider for an audience of a few dozen people.
 *
 * So recovery becomes what it already is in practice at every delivery company:
 * the partner telephones operations, and an administrator sets a temporary
 * password over the phone. It is audit-logged, because an administrator able to
 * silently take over a partner account is exactly the power that needs a record
 * against it.
 *
 * An administrator's own account is recovered by changing ADMIN_PASSWORD on the
 * host and redeploying — the bootstrap re-applies it. There is deliberately no
 * self-service path into the account that can approve everyone else.
 */
const StaffPasswordResetSchema = z.object({
  temporaryPassword: z
    .string()
    .min(10, 'Use at least 10 characters — this is spoken aloud over a telephone.')
    .max(128)
});

peopleRoutes.post(
  '/staff/:userId/reset-password',
  requirePermission('users.drivers.manage', 'users.restaurants.manage'),
  validate({ body: StaffPasswordResetSchema }),
  async (req, res, next) => {
    try {
      const user = await userRepository.findById(req.params.userId);
      if (!user) throw new AppError('No such account.', 404, 'USER_NOT_FOUND');

      // Customers are excluded rather than merely unnecessary here: giving them
      // a password would create a second way into an account whose only
      // credential is meant to be possession of the phone number.
      if (user.role === 'customer') {
        throw new AppError(
          'Customers sign in with a code sent to their phone and have no password to reset.',
          400,
          'CUSTOMER_HAS_NO_PASSWORD'
        );
      }

      await userRepository.update(user.id, {
        passwordHash: await bcrypt.hash(req.body.temporaryPassword, 10)
      });

      recordAudit(req, {
        action: 'STAFF_PASSWORD_RESET',
        entityType: user.role === 'rider' ? 'RIDER' : 'RESTAURANT_PARTNER',
        entityId: user.id,
        summary: `Reset the password for ${user.fullName} (${user.email})`
      });

      res.json({
        success: true,
        data: { reset: true },
        message: `Password reset for ${user.fullName}. Ask them to change it after signing in.`
      });
    } catch (err) {
      next(err);
    }
  }
);
