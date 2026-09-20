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
import { Router } from 'express';
import { attachAdminAccess } from '../middlewares/adminAccess.ts';
import { dashboardRoutes } from './admin/dashboardRoutes.ts';
import { orderRoutes } from './admin/orderRoutes.ts';
import { peopleRoutes } from './admin/peopleRoutes.ts';
import { platformRoutes } from './admin/platformRoutes.ts';
import { catalogRoutes } from './admin/catalogRoutes.ts';
import { financeRoutes } from './admin/financeRoutes.ts';
import { marketingRoutes } from './admin/marketingRoutes.ts';
import { supportRoutes } from './admin/supportRoutes.ts';
import { rbacRoutes } from './admin/rbacRoutes.ts';
import { legacyRoutes } from './admin/legacyRoutes.ts';

export const adminRouter = Router();

adminRouter.use(attachAdminAccess);

adminRouter.use(dashboardRoutes);
adminRouter.use(orderRoutes);
adminRouter.use(peopleRoutes);
adminRouter.use(platformRoutes);
adminRouter.use(catalogRoutes);
adminRouter.use(financeRoutes);
adminRouter.use(marketingRoutes);
adminRouter.use(supportRoutes);
adminRouter.use(rbacRoutes);
adminRouter.use(legacyRoutes);
