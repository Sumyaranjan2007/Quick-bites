import type { Request, Response, NextFunction } from 'express';
import { memoryStore } from '../db/client.ts';
import { emitSync } from './socketServer.ts';

/**
 * "Something you are looking at changed" — real time for every screen (round 3, item 1).
 *
 * After every successful write through the API, the accounts the write touched are
 * told to reload (`sync {topic}`, no data: each app re-reads through its own guarded
 * routes, so nothing leaks). Every Operations console hears every write. One choke
 * point instead of an emit in each of ~200 routes, so a new route is live by default.
 */

/** Fields on a record that name a person, a kitchen or a rider. */
const PEOPLE_FIELDS = ['userId', 'ownerUserId', 'ownerId', 'customerId', 'raisedByUserId', 'restaurantId', 'riderId', 'payeeId'];

/** Records that belong to someone: an id of one of these reaches its people. */
const OWNED = [
  'orders', 'supportTickets', 'payouts', 'payoutRequests', 'payeeAccounts', 'kycDocuments', 'menuRequests',
  'profileEdits', 'refundRequests', 'cashDeposits', 'addresses', 'sosAlerts', 'restaurantCharges', 'restaurantSettlements'
] as const;

/** Writes that happen every few seconds or only sign someone in: never worth a reload. */
const QUIET = /\/(riders\/(telemetry|location)|devices|auth|places|search|test|support\/help)(\/|$)/;

/** Settings every app reads (prices, radius, banners, picks, a kitchen opening): every screen reloads. */
const EVERYONE =
  /^\/(admin\/(pricing|rates|recommended-restaurants|coupons|categories|platform|policies|menus|settings)|restaurants\/[^/]+\/kitchen-status)(\/|$)/;

const store = memoryStore as unknown as Record<string, Map<string, any>>;

/** The user accounts behind one id: a user, a kitchen's owner, a rider's account. */
function peopleOf(id: string): string[] {
  if (store.users.has(id)) return [id];
  const kitchen = store.restaurants.get(id);
  if (kitchen) return kitchen.ownerId ? [kitchen.ownerId] : [];
  const rider = store.riders.get(id);
  if (rider) return rider.userId ? [rider.userId] : [];
  return [];
}

/** Every account a write naming these ids touches. Exported for the suite. */
export function affectedUsers(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (!id || typeof id !== 'string') continue;
    peopleOf(id).forEach(u => out.add(u));
    for (const name of OWNED) {
      const record = store[name]?.get(id);
      if (!record) continue;
      for (const field of PEOPLE_FIELDS) {
        const value = record[field];
        if (typeof value === 'string') peopleOf(value).forEach(u => out.add(u));
      }
    }
  }
  return [...out];
}

/** `orders`, `admin/people`, … : what kind of thing changed, so a screen can ignore the rest. */
export function topicOf(path: string): string {
  const parts = path.replace(/^\/api(\/v1)?\//, '').split('/').filter(Boolean);
  return parts[0] === 'admin' ? parts.slice(0, 2).join('/') : parts[0] || '';
}

/** Ids a write names: its path parts and the `…Id` fields of its body. */
function idsIn(req: Request, path: string): string[] {
  const ids = path.split('/').filter(Boolean);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const [key, value] of Object.entries(body)) {
    if (/id$/i.test(key) && typeof value === 'string') ids.push(value);
  }
  return ids;
}

export function liveSyncMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path.replace(/^\/v1(?=\/)/, ''); // mounted at /api, so /api/v1 arrives as /v1/...
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || QUIET.test(path)) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const topic = topicOf(req.originalUrl.split('?')[0]);
    if (EVERYONE.test(path)) {
      emitSync('everyone', topic);
      return;
    }
    const users = affectedUsers(idsIn(req, path));
    const self = (req as any).user?.id;
    if (self) users.push(self);
    emitSync(users, topic);
  });
  next();
}
