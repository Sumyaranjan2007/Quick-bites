import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import { memoryStore } from '../db/client.ts';
import { rolesOf } from '../db/repositories/userRepository.ts';
import type { UserRole } from '@quick-bites/shared-types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** The role this account acts as by default. Not the whole answer — see `roles`. */
  role: UserRole;
  /**
   * Every role this person holds, resolved from the store on this request.
   *
   * Always at least `[role]`. Read this rather than comparing `role` wherever
   * the question is "may they", because one person can be a customer and a
   * rider at once and comparing the primary role says no.
   */
  roles: UserRole[];
  fullName: string;
  isGold: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authMiddleware(requiredRole?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    
    // Check if Demo Mode static token (only active in DEMO_MODE for testing)
    if (config.DEMO_MODE && authHeader) {
      if (authHeader === 'Bearer demo-customer-token') {
        req.user = {
          id: 'usr_demo_customer_01',
          email: 'rahul.demo@quickbite.app',
          role: 'customer',
          roles: ['customer'],
          fullName: 'Rahul Sharma (Demo)',
          isGold: true
        };
        return next();
      } else if (authHeader === 'Bearer demo-partner-token') {
        req.user = {
          id: 'usr_demo_partner_01',
          email: 'sunita.demo@quickbite.app',
          role: 'restaurant_owner',
          roles: ['restaurant_owner'],
          fullName: 'Sunita Deshmukh (Demo)',
          isGold: false
        };
        return next();
      } else if (authHeader === 'Bearer demo-admin-token') {
        req.user = {
          id: 'usr_demo_admin_01',
          email: 'admin.demo@quickbite.app',
          role: 'admin',
          roles: ['admin'],
          fullName: 'Ananya Iyer (Admin)',
          isGold: true
        };
        return next();
      }
    }
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header.'
        },
        meta: {
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId
        }
      });
      return;
    }
    
    try {
      const token = authHeader.split(' ')[1];
      // Pin the algorithm: without this, verification accepts whatever `alg` the
      // token itself declares, which invites algorithm-confusion attacks.
      const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as any;

      req.user = {
        id: payload.sub || 'usr_unknown',
        email: payload.email || '',
        role: payload.role || 'customer',
        // Replaced below from the stored record. The token's word is never the
        // final answer about what somebody may do.
        roles: [payload.role || 'customer'],
        fullName: payload.user_metadata?.name || 'Quick Bites User',
        isGold: !!payload.is_gold
      };

      /*
       * The token says who they claim to be. The STORE says whether they may
       * still act.
       *
       * A token is valid for seven days and carries no way to withdraw it, so
       * until now blocking an account only took effect at the next sign-in —
       * and the one thing a blocked account will not do is sign in again. A
       * customer blocked for fraudulent refund claims, a rider suspended for
       * no-shows, a partner closed down: every one of them kept full use of
       * the platform for up to a week, from the session they already had open.
       * The admin screen said "Blocked" and meant it about a future login.
       *
       * This is the same rule `middlewares/adminAccess.ts` already applies to
       * permissions — resolved from the stored record on every request, never
       * from the token. It was written there for exactly this reason and was
       * never extended to the account itself.
       *
       * Demo-mode tokens return above and never reach here.
       */
      const stored = memoryStore.users.get(req.user.id) as
        | { isBlocked?: boolean; blockReason?: string; role?: string; roles?: string[] }
        | undefined;

      if (!stored) {
        // The account no longer exists — deleted by its owner, or removed by a
        // platform reset. Its token outlives it by up to a week otherwise.
        res.status(401).json({
          success: false,
          error: {
            code: 'ACCOUNT_NOT_FOUND',
            message: 'This account no longer exists. Please sign in again.'
          },
          meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
        });
        return;
      }

      // A password reset or change bumps the account's token version, which
      // retires every token issued before it (a lost or stolen phone keeps
      // working for 7 days otherwise). Tokens issued before versions existed
      // carry none and match an account that has never been bumped.
      if ((Number(payload.tv) || 0) !== (Number((stored as any).tokenVersion) || 0)) {
        res.status(401).json({
          success: false,
          error: { code: 'SESSION_REVOKED', message: 'You were signed out because the password changed. Sign in again.' },
          meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
        });
        return;
      }

      if (stored.isBlocked) {
        // 403 rather than 401, and said plainly: a blocked person who is told
        // "unauthorised" signs out and back in forever. The apps read this code
        // to end the session and show the reason instead.
        res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_BLOCKED',
            message: stored.blockReason
              ? `This account has been blocked: ${stored.blockReason}. Contact Quick Bites support.`
              : 'This account has been blocked. Contact Quick Bites support.'
          },
          meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
        });
        return;
      }

      // A role changed after the token was issued — a demotion, most of all —
      // must apply now rather than in a week. The stored record wins.
      /*
       * The role this session acts as: the token's, when the account still
       * holds it (a partner-app session of a rider who also owns a kitchen),
       * otherwise the account's primary role. A role since removed therefore
       * stops working at once — the token cannot keep it alive.
       */
      const heldNow = rolesOf(stored);
      if (payload.role && heldNow.includes(payload.role)) req.user.role = payload.role as UserRole;
      else if (stored.role) req.user.role = stored.role as UserRole;
      
      /*
       * WHAT THIS PERSON MAY DO, WHICH IS NOT THE SAME AS WHAT THEY ARE.
       *
       * One phone number is one PERSON, and a person is routinely more than
       * one thing on a food platform: a rider orders their own dinner, a
       * restaurant owner orders from somebody else's kitchen. Asking
       * `role === requiredRole` made those mutually exclusive, so signing up
       * to deliver with the number already on your customer account was
       * refused at registration with nothing to do about it.
       *
       * Resolved from the STORE, like the block check above, so a role granted
       * a minute ago works against a token issued last week. Nobody has to
       * sign out and back in to start delivering.
       *
       * `rolesOf` falls back to `[role]`, so every account created before this
       * existed is judged exactly as it always was.
       */
      const held = rolesOf(stored);
      req.user.roles = held as UserRole[];
      if (requiredRole) {
        const isAdmin = held.includes('admin') || held.includes('super_admin');
        const matchesRole = held.includes(requiredRole);
        if (!matchesRole && !isAdmin) {
          res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Insufficient privileges for this resource.'
            },
            meta: {
              timestamp: new Date().toISOString(),
              correlationId: req.correlationId
            }
          });
          return;
        }
      }
      
      next();
    } catch (err: any) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Authentication token is expired or invalid.'
        },
        meta: {
          timestamp: new Date().toISOString(),
          correlationId: req.correlationId
        }
      });
    }
  };
}
