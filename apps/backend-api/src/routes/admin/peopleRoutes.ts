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
import { MANDATORY_RIDER_DOCUMENTS } from '../../db/repositories/riderRepository.ts';
import { buildDocumentOverview } from '../../modules/restaurants/restaurantDocuments.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { walletRepository } from '../../db/repositories/walletRepository.ts';
import { kycRepository } from '../../db/repositories/kycRepository.ts';
import { payoutRepository } from '../../db/repositories/payoutRepository.ts';
import { recordAudit } from '../../modules/admin/audit.ts';
import { summariseOrder, matchesQuery, paginate } from './shared.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { setRiderOfferPoolMembership } from '../../sockets/socketServer.ts';
import type { Order } from '@quick-bites/shared-types';
import { hasActiveTrip } from '../../modules/orders/riderTrip.ts';
import {
  connectedAccountFor,
  accountBlockReason,
  publicView as payeePublicView
} from '../../modules/payments/payeeAccounts.ts';
import type { PayeeOwnerType } from '@quick-bites/shared-types';

/**
 * Where this partner's money goes, for their profile panel.
 *
 * The owner's words: the bank details "will be added to their profile which is
 * available in the admin portal so they can pay everything as settlement". This
 * is that -- read by id from the one account record, never copied onto the
 * rider or restaurant row, so there is exactly one place an account number
 * lives and no second copy to go stale after somebody changes it.
 *
 * It answers two questions separately and never collapses them:
 *
 *   IS AN ACCOUNT CONNECTED -- what an administrator decided, from appliedAt.
 *   CAN MONEY ACTUALLY MOVE -- the payout gate, which is stricter.
 *
 * Collapsed into one flag, an account somebody deliberately approved could read
 * as "no account connected", which is the same sentence shown for a partner who
 * never submitted anything. Those need opposite actions from whoever is looking.
 */
async function payoutDestination(ownerType: PayeeOwnerType, ownerId: string) {
  const account = connectedAccountFor(ownerType, ownerId);
  const blockedReason = accountBlockReason(ownerType, ownerId);

  if (!account) {
    return {
      connected: false,
      account: null,
      appliedByName: null,
      payableNow: false,
      // Never a bare "none". The reason a payout will fail belongs on the
      // screen somebody is already looking at when they ask why.
      reason: blockedReason || 'No account connected. This partner cannot be paid.'
    };
  }

  const admin = account.appliedByAdminId
    ? ((memoryStore.users.get(account.appliedByAdminId) as any) ?? null)
    : null;

  return {
    connected: true,
    account: payeePublicView(account),
    appliedByName: admin?.fullName || admin?.email || null,
    payableNow: blockedReason === null,
    reason: blockedReason
  };
}

export const peopleRoutes = Router();

/**
 * Blocking the LOGIN ACCOUNT behind a rider or a restaurant.
 *
 * Suspending and blocking are deliberately different things, and both are
 * needed:
 *
 *   SUSPEND (a rider's kycStatus, a restaurant's status) stops them trading.
 *   They can still sign in, read why, fix a rejected document and talk to
 *   support. That is the normal case — almost every suspension is a problem
 *   somebody is expected to resolve, and locking them out of the screen that
 *   explains it guarantees they cannot.
 *
 *   BLOCK (`user.isBlocked`) locks the account out of the platform entirely.
 *   It is for fraud and abuse, and it is the lever that had no equivalent for
 *   partners or riders at all — only customers could be blocked, so a rider
 *   running a refund scam could be suspended from delivering and go on using
 *   every other endpoint with the same token.
 *
 * Blocking takes effect on the next request rather than the next sign-in; see
 * `middlewares/auth.ts`.
 */
async function setAccountBlocked(
  userId: string | undefined,
  isBlocked: boolean,
  blockReason: string | undefined
): Promise<void> {
  if (!userId) return;
  const user = await userRepository.findById(userId);
  if (!user) return;
  await userRepository.update(userId, {
    isBlocked,
    // Cleared on unblock rather than left behind, or the next block with no
    // reason given would quietly reuse the last one.
    blockReason: isBlocked ? blockReason || '' : ''
  } as any);
}

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

      /*
       * Refused, and kept mounted. The wallet cannot be spent anywhere, so a
       * "goodwill credit" here told an administrator they had given a customer money
       * that the customer could never use. The admin app shows this message, which
       * names what to do instead.
       */
      throw new AppError(
        req.body.direction === 'CREDIT'
          ? `The customer wallet has been retired and cannot be spent, so crediting it would give ${user.fullName || 'this customer'} nothing. ` +
              'To give money back, refund one of their orders from the Refunds screen — it returns to the card or UPI they paid with.'
          : 'The customer wallet has been retired. There is nothing on it to deduct.',
        410,
        'WALLET_RETIRED'
      );
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
      const active = own.find(o => hasActiveTrip(o));
      return {
        id: rider.id,
        userId: rider.userId,
        fullName: rider.fullName,
        driverCode: rider.driverCode,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        kycStatus: rider.kycStatus,
        // The account lock, which is a different thing from the KYC state and
        // was previously invisible on this screen — so an administrator could
        // block a rider and then see no trace of having done it.
        isBlocked: Boolean((memoryStore.users.get(rider.userId) as any)?.isBlocked),
        blockReason: (memoryStore.users.get(rider.userId) as any)?.blockReason || '',
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
    if (status === 'BLOCKED') drivers = drivers.filter(d => d.isBlocked);
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
        account: {
          userId: rider.userId,
          isBlocked: Boolean((memoryStore.users.get(rider.userId) as any)?.isBlocked),
          blockReason: (memoryStore.users.get(rider.userId) as any)?.blockReason || ''
        },
        documents: await kycRepository.findByEntity('RIDER', rider.id),
        payoutDestination: await payoutDestination('RIDER', rider.id),
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
  /** Locks the rider's login account. See `setAccountBlocked` above. */
  isBlocked: z.boolean().optional(),
  blockReason: z.string().trim().max(300).optional(),
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

      const { kycStatus, reason, isBlocked, blockReason, ...fields } = req.body;
      const owner = await userRepository.findById(rider.userId);
      const before = {
        kycStatus: rider.kycStatus,
        isBlocked: Boolean((owner as any)?.isBlocked),
        ...fields
      };

      if (Object.keys(fields).length) await riderRepository.update(rider.id, fields);
      // Routed through updateKycStatus rather than a plain patch so the
      // side effect that matters — a suspended rider being taken off shift —
      // cannot be skipped.
      if (kycStatus) await riderRepository.updateKycStatus(rider.id, kycStatus);

      if (isBlocked !== undefined) {
        await setAccountBlocked(rider.userId, isBlocked, blockReason);
        if (isBlocked) {
          // Off shift and out of the dispatch pool immediately. A blocked rider
          // holding an open socket would otherwise keep receiving offers until
          // it dropped, and every offer they take is a customer's dinner.
          await riderRepository.updateOnlineStatus(rider.id, false);
          setRiderOfferPoolMembership(rider.userId, false);
        }
      }

      recordAudit(req, {
        action: isBlocked !== undefined
          ? isBlocked
            ? 'DRIVER_BLOCKED'
            : 'DRIVER_UNBLOCKED'
          : kycStatus
            ? `DRIVER_${kycStatus}`
            : 'DRIVER_UPDATED',
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
        isBlocked: Boolean((memoryStore.users.get(restaurant.ownerId) as any)?.isBlocked),
        blockReason: (memoryStore.users.get(restaurant.ownerId) as any)?.blockReason || '',
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

    if (status === 'BLOCKED') restaurants = restaurants.filter(r => r.isBlocked);
    else if (status && status !== 'ALL') restaurants = restaurants.filter(r => r.status === status);
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
        owner: owner
          ? {
              id: owner.id,
              fullName: owner.fullName,
              email: owner.email,
              phone: owner.phone,
              isBlocked: Boolean((owner as any).isBlocked),
              blockReason: (owner as any).blockReason || ''
            }
          : null,
        menu: memoryStore.menus.get(restaurant.id) || null,
        documents: await kycRepository.findByEntity('RESTAURANT', restaurant.id),
        payoutDestination: await payoutDestination('RESTAURANT', restaurant.id),
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
  /**
   * Where the kitchen actually is.
   *
   * Editable here because there was nowhere else. Every restaurant onboarded
   * before the partner app grew a map carries the register route's placeholder
   * — the centre of Bengaluru — and the partner app can only set a pin during
   * REGISTRATION. So a live restaurant sitting thirty kilometres from itself
   * had no route back to the truth: not through its own app, not through
   * operations, not at all. It was listed (see restaurantLocation.ts) but never
   * measured, so it could never show a real distance or delivery time.
   */
  coordinates: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180)
    })
    .optional(),
  /** How far this kitchen delivers. Bounded as at registration. */
  serviceRadiusKm: z.number().min(1).max(25).optional(),
  /** Locks the owner's login account. See `setAccountBlocked` above. */
  isBlocked: z.boolean().optional(),
  blockReason: z.string().trim().max(300).optional(),
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

      const { reason, status, isBlocked, blockReason, ...fields } = req.body;
      const owner = await userRepository.findById(restaurant.ownerId);
      const before = {
        status: restaurant.status,
        name: restaurant.name,
        isBlocked: Boolean((owner as any)?.isBlocked)
      };

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
      if (isBlocked !== undefined) {
        await setAccountBlocked(restaurant.ownerId, isBlocked, blockReason);
        // A kitchen whose owner cannot sign in must not be left showing as
        // open to customers with nobody able to accept an order.
        if (isBlocked) restaurant.isOpen = false;
      }

      memoryStore.restaurants.set(restaurant.id, restaurant);
      triggerAutoSave();

      recordAudit(req, {
        action: isBlocked !== undefined
          ? isBlocked
            ? 'RESTAURANT_OWNER_BLOCKED'
            : 'RESTAURANT_OWNER_UNBLOCKED'
          : status
            ? `RESTAURANT_${status}`
            : 'RESTAURANT_UPDATED',
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

      /*
       * The decision is re-derived from EVERY document, not taken from this one.
       *
       * This block used to read `action === 'APPROVE' ? 'ACTIVE' : 'REJECTED'`
       * and activate the restaurant on any single approval. Two consequences,
       * both of which put an unverified kitchen in front of customers:
       *
       *   - Approving ONE document approved the restaurant. A partner who
       *     submitted only a bank account proof — which is OPTIONAL — became
       *     ACTIVE, visible, and able to take orders with no FSSAI food
       *     licence on file at all. The one document a kitchen may not legally
       *     trade without was the one nothing checked for.
       *
       *   - Rejecting one document rejected the restaurant. Turning down an
       *     optional GST registration marked the whole partner REJECTED while
       *     leaving `status` ACTIVE, so its KYC said one thing and its trading
       *     state said another.
       *
       * `buildDocumentOverview` already answers the real question — are all the
       * MANDATORY documents approved — and it is the same function the partner
       * app renders, so what the partner is told and what the platform enforces
       * cannot drift apart.
       */
      /*
       * What the decision achieved, reported back.
       *
       * A reviewer used to approve one document and the partner went live, so
       * there was nothing to say. Now that approval is derived from the whole
       * required set, the reviewer needs to know which of the two it was:
       * "one more to go" or "this restaurant is now trading". Without it they
       * approve a licence, see nothing happen, and go looking for a button
       * that does not exist.
       */
      let outcome: {
        verified: boolean;
        outstanding: string[];
        entityStatus?: string;
        summary: string;
      } | null = null;

      if (doc.entityType === 'RESTAURANT') {
        const restaurant = await restaurantRepository.findById(doc.entityId);
        if (restaurant) {
          const overview = buildDocumentOverview(
            await kycRepository.findByEntity('RESTAURANT', restaurant.id)
          );
          const mandatoryRejected = overview.slots.some(s => s.required && s.status === 'REJECTED');

          // Through the repository so the decision is written down. Assigning
          // the fields and calling memoryStore.set skipped triggerAutoSave, so
          // an approval survived only if some unrelated write happened to save
          // the store first — the same shape as the kitchen toggle.
          /*
           * An APPROVAL never reduces standing.
           *
           * Writing the computed status unconditionally would take a trading
           * restaurant back to PENDING_APPROVAL the moment somebody approved
           * an optional extra document for it — including every partner an
           * administrator activated by hand, whose required documents were
           * verified outside the queue. Only a rejection moves anybody
           * backwards.
           */
          if (overview.verified) {
            await restaurantRepository.updateKycStatus(restaurant.id, 'ACTIVE');
          } else if (mandatoryRejected) {
            await restaurantRepository.updateKycStatus(restaurant.id, 'REJECTED');
          } else if (restaurant.kycStatus !== 'ACTIVE') {
            await restaurantRepository.updateKycStatus(restaurant.id, 'PENDING_APPROVAL');
          }

          if (overview.verified && restaurant.status === 'PENDING_APPROVAL') {
            await restaurantRepository.updateStatus(restaurant.id, 'ACTIVE');
          }

          /*
           * A required document rejected on a kitchen that is already trading
           * takes it out of trading.
           *
           * This is the unpleasant case and it is the right one: an FSSAI
           * licence turned down as expired or forged means the kitchen may not
           * sell food today, and leaving it open because it was open an hour
           * ago is the platform knowingly listing an unlicensed kitchen. Back
           * to PENDING_APPROVAL rather than SUSPENDED, because the partner is
           * expected to photograph a valid one and send it again.
           */
          if (mandatoryRejected && restaurant.status === 'ACTIVE') {
            await restaurantRepository.updateStatus(restaurant.id, 'PENDING_APPROVAL');
            await restaurantRepository.setOpenState(restaurant.id, false);
          }

          const after = await restaurantRepository.findById(restaurant.id);
          const stillNeeded = overview.slots
            .filter(s => s.required && s.status !== 'APPROVED')
            .map(s => s.label);
          outcome = {
            verified: overview.verified,
            outstanding: stillNeeded,
            entityStatus: after?.status,
            summary: overview.verified
              ? `${restaurant.name} is verified and now trading.`
              : mandatoryRejected
                ? `${restaurant.name} is not verified and has been taken off the customer feed. Still needed: ${stillNeeded.join(', ')}.`
                : `Recorded. ${restaurant.name} is not verified yet — still needed: ${stillNeeded.join(', ')}.`
          };
        }
      } else if (doc.entityType === 'RIDER') {
        // The same rule for riders. Their shift gate separately requires an
        // approved licence and RC, so this was not reachable as an unlicensed
        // rider on the road — but a rider whose AADHAAR was approved read as
        // ACTIVE everywhere operations looked, which is the figure a dispatcher
        // trusts.
        const riderDocs = await kycRepository.findByEntity('RIDER', doc.entityId);
        const approvedTypes = new Set(
          riderDocs.filter(d => d.status === 'APPROVED').map(d => d.documentType)
        );
        const mandatoryRejected = riderDocs.some(
          d => d.status === 'REJECTED' && (MANDATORY_RIDER_DOCUMENTS as readonly string[]).includes(d.documentType)
        );
        const allMandatoryApproved = MANDATORY_RIDER_DOCUMENTS.every(t => approvedTypes.has(t));

        const currentRider = await riderRepository.findById(doc.entityId);
        if (allMandatoryApproved) {
          await riderRepository.updateKycStatus(doc.entityId, 'ACTIVE');
        } else if (mandatoryRejected) {
          await riderRepository.updateKycStatus(doc.entityId, 'REJECTED');
        } else if (currentRider && currentRider.kycStatus !== 'ACTIVE') {
          await riderRepository.updateKycStatus(doc.entityId, 'PENDING_APPROVAL');
        }

        const stillNeeded = MANDATORY_RIDER_DOCUMENTS.filter(t => !approvedTypes.has(t)) as string[];
        const afterRider = await riderRepository.findById(doc.entityId);
        outcome = {
          verified: allMandatoryApproved,
          outstanding: stillNeeded,
          entityStatus: afterRider?.kycStatus,
          summary: allMandatoryApproved
            ? `${doc.entityName || 'This rider'} is verified and can go online.`
            : `Recorded. Still needed before they can go online: ${stillNeeded.join(', ')}.`
        };
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

      res.json({
        success: true,
        data: { document: doc, outcome },
        message: outcome?.summary
      });
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
