import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { userRepository } from '../db/repositories/userRepository.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { config } from '../config/env.ts';
import { validate } from '../middlewares/validate.ts';
import { authRateLimiterMiddleware } from '../middlewares/rateLimiter.ts';
import { AppError } from '../utils/AppError.ts';
import { z } from 'zod';
import type { UserRole } from '@quick-bites/shared-types';

export const authRouter = Router();

export function generateToken(user: any): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      is_gold: user.isGold,
      user_metadata: { name: user.fullName }
    },
    config.JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
}

/**
 * Roles a person may hold immediately on sign-up. Staff roles are deliberately absent:
 * self-service registration previously copied `role` straight out of the request body,
 * so anyone could POST `{"role":"super_admin"}` and receive an administrator token.
 * Partner and rider accounts are onboarded through KYC; staff are provisioned directly.
 */
const SELF_SERVICE_ROLES = ['customer'] as const;

const RegisterSchema = z.object({
  email: z.string().email('A valid email address is required').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  fullName: z.string().min(1, 'Full name is required').max(120),
  phone: z.string().max(20).optional(),
  role: z.enum(SELF_SERVICE_ROLES).optional()
});

// POST /api/auth/register
authRouter.post('/register', authRateLimiterMiddleware, validate({ body: RegisterSchema }), async (req, res) => {
  try {
    // Stored normalised so the account is found however it is later typed;
    // lookups trim and lowercase too, but the record itself should be clean.
    const email = String(req.body.email).trim().toLowerCase();
    const { password, fullName, phone } = req.body;

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    // Never taken from the request: the only role obtainable by self-registration.
    const assignedRole: UserRole = 'customer';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await userRepository.create({
      id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      email,
      passwordHash: hashedPassword,
      fullName,
      phone,
      role: assignedRole,
      isGold: false,
      preferredLanguage: 'en'
    });

    // Auto-create wallet for customers and riders
    if (assignedRole === 'customer') {
      await walletRepository.credit(user.id, 100.00, 'Sign-up Bonus Balance');
    }

    return res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          isGold: user.isGold
        },
        token: generateToken(user)
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/login
authRouter.post('/login', authRateLimiterMiddleware, async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await userRepository.verifyCredentials(email, password, role);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: role 
          ? `Invalid credentials or account does not have '${role}' access permissions`
          : 'Invalid email or password'
      });
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          isGold: user.isGold
        },
        token: generateToken(user)
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/auth/me/:userId
authRouter.get('/me/:userId', authMiddleware(), async (req, res) => {
  try {
    const isSelf = req.user?.id === req.params.userId;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only access your own profile.'
      });
    }

    const user = await userRepository.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const { passwordHash, ...safeUser } = user;
    return res.json({ success: true, data: { user: safeUser } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const UpdateProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  preferredLanguage: z.enum(['en', 'hi', 'kn']).optional()
});

/**
 * PATCH /api/auth/me — updates the signed-in user's own profile.
 *
 * Deliberately narrow: name, phone and language only. Email is the account
 * identifier and changing it would silently move the login; role and wallet
 * balance are not the user's to set, which is the same mistake registration
 * used to make by trusting `role` from the request body.
 */
authRouter.patch('/me', authMiddleware(), validate({ body: UpdateProfileSchema }), async (req, res, next) => {
  try {
    const updated = await userRepository.updateProfile(req.user!.id, req.body);
    if (!updated) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

    const { passwordHash, ...safeUser } = updated as any;
    res.json({
      success: true,
      data: { user: safeUser },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password confirmation is required')
});

/**
 * DELETE /api/auth/me — permanently deletes the authenticated user's account.
 * Google Play requires an in-app deletion path for apps offering sign-up.
 * Re-authentication is required so a mislaid unlocked phone cannot wipe an account.
 */
authRouter.delete('/me', authMiddleware(), validate({ body: DeleteAccountSchema }), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');
    }

    const confirmed = await userRepository.verifyCredentials(user.email, req.body.password);
    if (!confirmed) {
      throw new AppError('Password is incorrect. Account was not deleted.', 401, 'INVALID_PASSWORD');
    }

    const deleted = await userRepository.deleteAccount(userId);
    if (!deleted) {
      throw new AppError('Account could not be deleted.', 500, 'DELETE_FAILED');
    }

    return res.json({
      success: true,
      data: { deleted: true },
      message: 'Your account and personal data have been permanently deleted.'
    });
  } catch (err) {
    next(err);
  }
});
