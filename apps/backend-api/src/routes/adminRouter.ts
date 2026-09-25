/**
 * The admin console's API.
 *
 * Split by subject rather than kept as one file: the console covers orders,
 * people, catalogue, money, marketing, support and access control, and a single
 * router was already the place every new endpoint went to be lost.
 *
 * `attachAdminAccess` runs first for everything below, so each route can state
 * the permission it needs and trust that it has been resolved. The permission is
 * enforced here, on the server, for every route — the app hiding a section is a
 * convenience, not the control.
 */
import { durable } from '../middlewares/durable.ts';
import { Router } from 'express';
import { attachAdminAccess } from '../middlewares/adminAccess.ts';
import { dashboardRoutes } from './admin/dashboardRoutes.ts';
import { orderRoutes } from './admin/orderRoutes.ts';
import { peopleRoutes } from './admin/peopleRoutes.ts';
import { platformRoutes } from './admin/platformRoutes.ts';
import { catalogRoutes } from './admin/catalogRoutes.ts';
import { financeRoutes } from './admin/financeRoutes.ts';
import { pricingRoutes } from './admin/pricingRoutes.ts';
import { payeeRoutes } from './admin/payeeRoutes.ts';
import { payoutRoutes } from './admin/payoutRoutes.ts';
import { marketingRoutes } from './admin/marketingRoutes.ts';
import { supportRoutes } from './admin/supportRoutes.ts';
import { rbacRoutes } from './admin/rbacRoutes.ts';
import { legacyRoutes } from './admin/legacyRoutes.ts';

export const adminRouter = Router();

adminRouter.use(attachAdminAccess);
/*
 * Every admin WRITE answers only once it is in the database (N19). Admin
 * writes are rare and most of them move money or decide who is paid (a
 * cancellation refunds, a payout is sent, a rate changes the next bill), so
 * they are all held rather than choosing route by route, where a router
 * mounted in the wrong order would silently miss out.
 */
adminRouter.use(durable);

adminRouter.use(dashboardRoutes);
adminRouter.use(orderRoutes);
adminRouter.use(peopleRoutes);
adminRouter.use(platformRoutes);
adminRouter.use(catalogRoutes);
adminRouter.use(financeRoutes);
adminRouter.use(pricingRoutes);
adminRouter.use(payeeRoutes);
adminRouter.use(payoutRoutes);
adminRouter.use(marketingRoutes);
adminRouter.use(supportRoutes);
adminRouter.use(rbacRoutes);
adminRouter.use(legacyRoutes);
