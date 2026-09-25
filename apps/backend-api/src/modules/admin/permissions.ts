/**
 * Who is allowed to do what in the admin console.
 *
 * One module owns the answer so the route guard, the `/admin/me` payload the app
 * builds its navigation from, and the seed all agree. When they were worked out
 * separately, a screen could appear for an account whose requests the server
 * then refused — which reads as a broken console rather than as a permission.
 *
 * The rules, in order:
 *   1. `super_admin` holds every permission, always. It is the role that can
 *      hand out roles, so it cannot be defined by one.
 *   2. Any other staff account holds exactly the permissions of the role it is
 *      assigned, and nothing while that role is disabled.
 *   3. A staff account with no role assigned falls back to Operations Admin.
 *      Accounts provisioned before roles existed keep working, but they get the
 *      day-to-day operations set rather than finance or platform administration.
 */
import type { AdminPermission, AdminRole, UserRole } from '@quick-bites/shared-types';
import { ALL_ADMIN_PERMISSIONS } from '@quick-bites/shared-types';
import { memoryStore } from '../../db/client.ts';

/** The role an unassigned staff account is treated as holding. */
export const DEFAULT_ADMIN_ROLE_KEY = 'operations_admin';

/**
 * Roles that ship with the platform.
 *
 * They are seeded into the store so they can be listed, inspected and assigned
 * like any other role, but they are marked `isSystem` and cannot be deleted:
 * deleting the only role that grants `admin.roles.manage` would leave nobody
 * able to create a replacement.
 */
export const SYSTEM_ROLE_DEFINITIONS: Array<
  Pick<AdminRole, 'key' | 'name' | 'description' | 'permissions'>
> = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted access to every part of the platform, including roles and settings.',
    permissions: [...ALL_ADMIN_PERMISSIONS]
  },
  {
    key: 'operations_admin',
    name: 'Operations Admin',
    description: 'Runs the day: orders, live deliveries, drivers and restaurants.',
    permissions: [
      'analytics.dashboard.view',
      'analytics.orders.view',
      'analytics.performance.view',
      'orders.view',
      'orders.detail.view',
      'orders.deliveries.manage',
      'orders.status.update',
      'orders.cancel',
      'orders.refunds.handle',
      'users.customers.view',
      'users.drivers.view',
      'users.drivers.manage',
      'users.restaurants.view',
      'users.restaurants.manage',
      'catalog.restaurants.approve',
      'catalog.menus.view',
      'documents.view',
      'documents.review',
      'support.tickets.view',
      'support.tickets.manage'
    ]
  },
  {
    key: 'finance_admin',
    name: 'Finance Admin',
    description: 'Payments, refunds, revenue analytics, driver payouts and restaurant settlements.',
    permissions: [
      'analytics.dashboard.view',
      'orders.view',
      'orders.detail.view',
      'finance.payments.view',
      'finance.revenue.view',
      'finance.refunds.manage',
      'finance.payouts.view',
      'finance.payouts.manage',
      'finance.settlements.view',
      'finance.settlements.manage',
      'finance.reports.view',
      /*
       * Added after the payments rebuild, and missing until now.
       *
       * `finance.config.edit` and `finance.ledger.view` were introduced with the
       * pricing config and the ledger, and were granted to `super_admin` because
       * it holds everything automatically. Nobody remembered to give them to the
       * one role whose entire job they are.
       *
       * The effect was invisible in testing, because a super admin can reach
       * every screen: a Finance Admin signing in got a console with no Rates
       * tab, no Tax tab, no ledger and no way to publish the grievance officer —
       * for a role described as owning payments and settlements. The screens
       * existed and were unreachable by the person they were built for.
       *
       * `ensureSystemRoles` re-syncs shipped roles on every boot, so existing
       * deployments pick this up on the next redeploy without anybody editing a
       * role by hand.
       */
      'finance.config.edit',
      'finance.ledger.view',
      'orders.refunds.handle',
      'users.customers.view',
      'users.drivers.view',
      'users.restaurants.view'
    ]
  },
  {
    key: 'support_admin',
    name: 'Support Admin',
    description: 'Customer care: complaints, support cases and refund requests.',
    permissions: [
      'analytics.dashboard.view',
      'orders.view',
      'orders.detail.view',
      'users.customers.view',
      'users.customers.manage',
      'users.drivers.view',
      'support.tickets.view',
      'support.tickets.manage',
      'orders.refunds.handle',
      'finance.refunds.manage',
      'reviews.view'
    ]
  },
  {
    key: 'restaurant_admin',
    name: 'Restaurant Admin',
    description: 'Restaurant onboarding, menus and categories.',
    permissions: [
      'analytics.dashboard.view',
      'users.restaurants.view',
      'users.restaurants.manage',
      'catalog.restaurants.approve',
      'catalog.menus.view',
      'catalog.menus.review',
      'catalog.menus.edit',
      'catalog.categories.manage',
      'documents.view',
      'documents.review',
      'reviews.view'
    ]
  },
  {
    key: 'marketing_admin',
    name: 'Marketing Admin',
    description: 'Coupons, offers and promotional campaigns.',
    permissions: [
      'analytics.dashboard.view',
      'analytics.orders.view',
      'marketing.coupons.manage',
      'marketing.promotions.manage',
      'catalog.categories.manage',
      'users.restaurants.view',
      'finance.revenue.view'
    ]
  },
  {
    key: 'content_admin',
    name: 'Content & Review Admin',
    description: 'Moderates reviews and curates categories and content.',
    permissions: [
      'analytics.dashboard.view',
      'reviews.view',
      'reviews.moderate',
      'catalog.categories.manage',
      'catalog.menus.view',
      'users.restaurants.view'
    ]
  }
];

export function isStaffRole(role: UserRole | string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

function activeRoleFor(user: { adminRoleId?: string } | null | undefined): AdminRole | null {
  if (!user?.adminRoleId) return null;
  const role = memoryStore.adminRoles.get(user.adminRoleId) as AdminRole | undefined;
  return role || null;
}

function roleByKey(key: string): AdminRole | null {
  for (const role of memoryStore.adminRoles.values()) {
    if ((role as AdminRole).key === key) return role as AdminRole;
  }
  return null;
}

export interface ResolvedAccess {
  permissions: AdminPermission[];
  role: AdminRole | null;
  /** True when the account bypasses role checks entirely. */
  isSuperAdmin: boolean;
  /** Set when the account's own role is switched off, so the app can explain it. */
  roleDisabled: boolean;
}

/**
 * Works out the effective permission set for a staff account.
 *
 * Takes the stored user record rather than the JWT payload: a role change must
 * take effect on the administrator's next request, not when their week-old token
 * finally expires.
 */
export function resolveAccess(user: {
  role?: UserRole | string;
  adminRoleId?: string;
} | null | undefined): ResolvedAccess {
  if (!user || !isStaffRole(user.role)) {
    return { permissions: [], role: null, isSuperAdmin: false, roleDisabled: false };
  }

  if (user.role === 'super_admin') {
    return {
      permissions: [...ALL_ADMIN_PERMISSIONS],
      role: roleByKey('super_admin'),
      isSuperAdmin: true,
      roleDisabled: false
    };
  }

  const assigned = activeRoleFor(user);
  if (assigned) {
    if (!assigned.isActive) {
      return { permissions: [], role: assigned, isSuperAdmin: false, roleDisabled: true };
    }
    return { permissions: [...assigned.permissions], role: assigned, isSuperAdmin: false, roleDisabled: false };
  }

  const fallback = roleByKey(DEFAULT_ADMIN_ROLE_KEY);
  return {
    permissions: fallback ? [...fallback.permissions] : [],
    role: fallback,
    isSuperAdmin: false,
    roleDisabled: false
  };
}
