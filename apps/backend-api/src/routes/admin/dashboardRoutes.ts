/**
 * The overview screen, the analytics behind it, and the payload the admin app
 * uses to decide what an account is allowed to see.
 */
import { Router } from 'express';
import { requirePermission } from '../../middlewares/adminAccess.ts';
import { buildDashboard, revenueSeries, economicsOf, LIVE_STATUSES } from '../../modules/admin/analytics.ts';
import { adminRoleRepository } from '../../db/repositories/adminRoleRepository.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { memoryStore } from '../../db/client.ts';
import { listFlags, setFlag, isEnabled } from '../../modules/platform/featureFlags.ts';
import { breakerSnapshots } from '../../modules/platform/circuitBreaker.ts';
import { auditRepository } from '../../db/repositories/auditRepository.ts';
import { AppError } from '../../utils/AppError.ts';
import { ADMIN_PERMISSION_GROUPS } from '@quick-bites/shared-types';
import type { Order } from '@quick-bites/shared-types';
import { hasActiveTrip } from '../../modules/orders/riderTrip.ts';
import { awaitingApply } from '../../modules/payments/payeeAccounts.ts';
import { listRequests } from '../../modules/payments/payoutRequests.ts';

export const dashboardRoutes = Router();

/**
 * GET /api/admin/me
 *
 * Identity plus the effective permission set. The app builds its navigation from
 * this rather than from the role name, so a permission added to a custom role
 * shows up without the app needing to know that role exists.
 */
dashboardRoutes.get('/me', async (req, res) => {
  const access = req.adminAccess!;
  res.json({
    success: true,
    data: {
      user: req.user,
      role: access.role
        ? { id: access.role.id, key: access.role.key, name: access.role.name, isSystem: access.role.isSystem }
        : null,
      isSuperAdmin: access.isSuperAdmin,
      permissions: access.permissions,
      permissionCatalogue: ADMIN_PERMISSION_GROUPS
    }
  });
});

/** GET /api/admin/dashboard — every headline figure on one screen. */
dashboardRoutes.get('/dashboard', requirePermission('analytics.dashboard.view'), async (_req, res, next) => {
  try {
    res.json({
      success: true,
      data: { ...buildDashboard(), revenueTrend: revenueSeries(14) }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/metrics — the first-generation summary.
 *
 * Kept because an installed copy of the admin app still asks for it; a released
 * build cannot be updated retroactively, and the shape is cheap to keep honest.
 */
dashboardRoutes.get('/metrics', requirePermission('analytics.dashboard.view'), async (_req, res, next) => {
  try {
    const snapshot = buildDashboard();
    res.json({
      success: true,
      data: {
        activeOrdersCount: snapshot.orders.live,
        totalOrdersCount: snapshot.orders.total,
        deliveredOrdersCount: snapshot.orders.completed,
        grossMerchandiseValue: snapshot.money.grossMerchandiseValue,
        onlineRidersCount: snapshot.people.onlineDrivers,
        pendingKycCount: snapshot.queues.pendingKyc,
        totalRestaurantsCount: snapshot.people.totalRestaurants,
        totalUsersCount: snapshot.people.totalCustomers
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/analytics/orders — volume and outcome over the last fortnight. */
dashboardRoutes.get('/analytics/orders', requirePermission('analytics.orders.view'), async (_req, res, next) => {
  try {
    const orders = (await orderRepository.listAll()) as Order[];
    const byStatus: Record<string, number> = {};
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));

    for (const order of orders) {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
      // Bucketed in IST: a peak at 8pm local is the only reading an operator
      // in Bengaluru can act on.
      const istHour = new Date(new Date(order.createdAt).getTime() + 330 * 60_000).getUTCHours();
      byHour[istHour].orders += 1;
    }

    const cancelReasons: Record<string, number> = {};
    for (const order of orders) {
      if (order.status === 'CANCELLED') {
        const reason = order.cancellationReason || 'Not recorded';
        cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
      }
    }

    res.json({
      success: true,
      data: { byStatus, byHour, cancelReasons, trend: revenueSeries(14) }
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/analytics/performance — per-restaurant and per-rider scorecards. */
dashboardRoutes.get('/analytics/performance', requirePermission('analytics.performance.view'), async (_req, res, next) => {
  try {
    const orders = (await orderRepository.listAll()) as Order[];
    const delivered = orders.filter(o => o.status === 'DELIVERED');

    const restaurants = await restaurantRepository.listAll();
    const restaurantRows = restaurants.map(restaurant => {
      const own = delivered.filter(o => o.restaurantId === restaurant.id);
      const revenue = own.reduce((total, o) => total + economicsOf(o).gross, 0);
      const cancelled = orders.filter(o => o.restaurantId === restaurant.id && o.status === 'CANCELLED').length;
      return {
        id: restaurant.id,
        name: restaurant.name,
        status: restaurant.status,
        isOpen: restaurant.isOpen,
        orders: own.length,
        cancelled,
        revenue: Math.round(revenue * 100) / 100,
        rating: restaurant.ratingAverage,
        ratingCount: restaurant.ratingCount
      };
    }).sort((a, b) => b.revenue - a.revenue);

    const riders = await riderRepository.findAll();
    const riderRows = riders.map(rider => {
      const own = delivered.filter(o => o.riderId === rider.id);
      const rated = own.filter(o => typeof o.riderRating === 'number');
      const earnings = own.reduce((total, o) => total + (Number(o.riderPayout) || 0), 0);
      return {
        id: rider.id,
        name: rider.fullName,
        driverCode: rider.driverCode,
        isOnline: rider.isOnline,
        kycStatus: rider.kycStatus,
        trips: own.length,
        earnings: Math.round(earnings * 100) / 100,
        rating: rated.length
          ? Math.round((rated.reduce((t, o) => t + (o.riderRating || 0), 0) / rated.length) * 10) / 10
          : 0,
        acceptanceRate: rider.offersReceived
          ? Math.round(((rider.offersAccepted || 0) / rider.offersReceived) * 100)
          : 0
      };
    }).sort((a, b) => b.trips - a.trips);

    res.json({ success: true, data: { restaurants: restaurantRows, riders: riderRows } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/live — the small, frequently-polled slice.
 *
 * The full dashboard walks every order; this returns only what changes minute to
 * minute, so the console can refresh often without asking for everything.
 */
dashboardRoutes.get('/live', requirePermission('analytics.dashboard.view'), async (_req, res, next) => {
  try {
    const orders = (await orderRepository.listAll()) as Order[];
    const live = orders.filter(o => LIVE_STATUSES.has(o.status));
    const onlineRiders = await riderRepository.findActiveOnlineRiders();

    res.json({
      success: true,
      data: {
        liveOrders: live.length,
        inTransit: live.filter(o => hasActiveTrip(o)).length,
        onlineRiders: onlineRiders.length,
        pendingKyc: Array.from(memoryStore.kycDocuments.values()).filter((d: any) => d.status === 'PENDING').length,
        openRefunds: Array.from(memoryStore.refundRequests.values()).filter(
          (r: any) => r.status === 'REQUESTED' || r.status === 'PROCESSING'
        ).length,
        openTickets: Array.from(memoryStore.supportTickets.values()).filter(
          (t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS'
        ).length,
        openSos: Array.from(memoryStore.sosAlerts.values()).filter((a: any) => a.status === 'OPEN').length,
        /*
         * Queues that had no count, and therefore no badge.
         *
         * An approval queue nobody can see from the outside is an approval
         * queue nobody empties. A partner who submits a new photograph or a
         * new dish has no way to make anyone look at it, and the only person
         * who could is not told it exists.
         */
        pendingProfileEdits: Array.from(memoryStore.profileEdits.values()).filter(
          (e: any) => e.status === 'PENDING'
        ).length,
        pendingMenuRequests: Array.from(memoryStore.menuRequests.values()).filter(
          (r: any) => r.status === 'PENDING'
        ).length,

        /*
         * THE MONEY QUEUES.
         *
         * Three things that wait for an administrator and had no way of saying
         * so. A bank account nobody applies is a partner who cannot be paid; a
         * payout request nobody sees is a partner asking for their money into
         * silence; a cash deposit nobody confirms is a rider whose figure
         * never comes down.
         *
         * Counted here rather than on each screen so the navigation can show
         * where attention is needed WITHOUT the administrator opening every
         * section to find out - which is the only reason a badge exists.
         *
         * Every count is deliberately permissive about shape: these
         * collections are written by another part of the system and a field
         * renamed there must make a badge wrong, never make this endpoint
         * throw and take every other badge down with it.
         */
        /*
         * The real status values, checked against the types rather than
         * guessed. The first two were counting nothing:
         *
         *   - a payee account has `validationStatus`, not `status`, and there
         *     is no REJECTED state — so the clause was always true and the
         *     count included archived accounts and ones the bank had refused,
         *     which cannot be applied and are not work anybody can do.
         *   - a payout request is OPEN | SEEN | SETTLED | DECLINED |
         *     WITHDRAWN. PENDING and REQUESTED do not exist, so this read zero
         *     however many people were waiting to be paid — and zero on a
         *     badge reads as "nothing to do".
         *
         * Read through the modules that own these collections, so a rename
         * moves the count with it instead of silently zeroing it.
         */
        payeeAccountsAwaitingReview: awaitingApply().length,
        openPayoutRequests: listRequests({ open: true }).length,
        cashDepositsAwaitingConfirmation: Array.from(memoryStore.cashDeposits.values()).filter(
          (d: any) => d.status === 'DECLARED'
        ).length,

        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/settings — the runtime switches, and nothing else.
 *
 * This used to return every entry in the settings map. That map is also where
 * pending sign-in codes live, keyed by phone number, and where processed
 * webhook ids are recorded. So the response carried a list of everyone
 * currently signing in, with the SHA-256 of each one's six-digit code beside
 * their number — and a six-digit space is a million hashes, which is a second
 * of work. Any admin token, or any leak of one, was therefore a way to sign in
 * as an arbitrary customer.
 *
 * The declared catalogue is now the whole response. Nothing undeclared can end
 * up in it by being written to the same store.
 */
dashboardRoutes.get('/settings', requirePermission('admin.settings.manage'), async (_req, res) => {
  res.json({
    success: true,
    // The breakers ride along with the switches because they answer the same
    // question at a glance: is anything currently off, and did a person do it
    // or did a dependency do it?
    data: { flags: listFlags(), dependencies: breakerSnapshots(), roles: await adminRoleRepository.list() }
  });
});

/**
 * PUT /api/admin/settings/flags/:key — throw a switch.
 *
 * Separate from a general settings write on purpose: the set of things an
 * operator can change at runtime is exactly the catalogue, and a generic
 * key/value endpoint would quietly grow past it.
 */
dashboardRoutes.put('/settings/flags/:key', requirePermission('admin.settings.manage'), async (req, res, next) => {
  try {
    const { enabled, note } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      throw new AppError('Send enabled as true or false.', 400, 'INVALID_FLAG_VALUE');
    }

    const before = isEnabled(req.params.key);
    const record = setFlag(req.params.key, enabled, req.user?.fullName || req.user?.id, note);

    // Recorded against the person, not the platform: switching off ordering is
    // among the most consequential things anyone can do here, and the audit
    // trail is what answers who did it at 20:14 on a Friday.
    await auditRepository.record({
      actorUserId: req.user!.id,
      actorName: req.user?.fullName || 'admin',
      actorRole: req.user?.role || 'admin',
      action: enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
      entityType: 'feature_flag',
      entityId: req.params.key,
      before: { enabled: before },
      after: { enabled },
      summary: `${enabled ? 'Enabled' : 'Disabled'} "${req.params.key}"${record.note ? ` — ${record.note}` : ''}.`
    });

    res.json({ success: true, data: { flags: listFlags() } });
  } catch (err) {
    next(err);
  }
});
