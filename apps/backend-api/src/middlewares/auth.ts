import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';
import type { UserRole } from '@quick-bites/shared-types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
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
          fullName: 'Rahul Sharma (Demo)',
          isGold: true
        };
        return next();
      } else if (authHeader === 'Bearer demo-partner-token') {
        req.user = {
          id: 'usr_demo_partner_01',
          email: 'sunita.demo@quickbite.app',
          role: 'restaurant_owner',
          fullName: 'Sunita Deshmukh (Demo)',
          isGold: false
        };
        return next();
      } else if (authHeader === 'Bearer demo-admin-token') {
        req.user = {
          id: 'usr_demo_admin_01',
          email: 'admin.demo@quickbite.app',
          role: 'admin',
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
      const payload = jwt.verify(token, config.JWT_SECRET) as any;

      req.user = {
        id: payload.sub || 'usr_unknown',
        email: payload.email || '',
        role: payload.role || 'customer',
        fullName: payload.user_metadata?.name || 'Quick Bite User',
        isGold: !!payload.is_gold
      };
      
      // Enforce role authorization if specified
      if (requiredRole) {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        const matchesRole = req.user.role === requiredRole;
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
