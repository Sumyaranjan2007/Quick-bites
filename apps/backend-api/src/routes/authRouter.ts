import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { userRepository } from '../db/repositories/userRepository.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';
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
    if (user?.isBlocked) {
      // Said plainly rather than as "invalid credentials": the password was
      // right, and a blocked customer who thinks they mistyped will try forever
      // instead of contacting support.
      return res.status(403).json({
        success: false,
        error: user.blockReason
          ? `This account has been blocked: ${user.blockReason}. Contact Quick Bites support.`
          : 'This account has been blocked. Contact Quick Bites support.'
      });
    }
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

/* ========================================================================== *
 *                            PASSWORD MANAGEMENT                             *
 * ========================================================================== */

/**
 * Reset codes in flight, keyed by user id.
 *
 * Held in the store rather than in a module variable so a reset survives the
 * process restarting mid-flow, and so a multi-step reset behaves the same on a
 * redeployed container as it does locally. Only the hash of the code is kept:
 * anyone who can read the database should not thereby be able to sign in as
 * every user on the platform.
 */
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

function hashResetCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

const ForgotPasswordSchema = z.object({
  email: z.string().email('Enter the email address on the account.').max(254)
});

/**
 * POST /api/auth/forgot-password
 *
 * Always answers the same way, whether or not the address is on an account.
 * Saying "no such user" turns this endpoint into a way to discover who has an
 * account, which is the first step of a credential-stuffing run.
 */
authRouter.post(
  '/forgot-password',
  authRateLimiterMiddleware,
  validate({ body: ForgotPasswordSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const user = await userRepository.findByEmail(email);

      let echoCode: string | undefined;
      if (user) {
        const code = String(crypto.randomInt(100000, 1000000));
        memoryStore.settings.set(`reset:${user.id}`, {
          userId: user.id,
          codeHash: hashResetCode(code),
          expiresAt: Date.now() + RESET_TTL_MS,
          attempts: 0,
          createdAt: new Date().toISOString()
        });
        triggerAutoSave();

        console.log(
          JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            event: 'PASSWORD_RESET_REQUESTED',
            email,
            // Printed so support can read the code out when no mail provider is
            // configured. This log is as sensitive as the account itself.
            resetCode: code,
            expiresInMinutes: RESET_TTL_MS / 60000
          })
        );

        if (config.PASSWORD_RESET_ECHO) echoCode = code;
      }

      res.json({
        success: true,
        data: {
          sent: true,
          // Present only when the deployment has been configured to hand the
          // code back directly; otherwise the app tells the user to check their
          // email and support reads it from the log.
          ...(echoCode ? { resetCode: echoCode } : {}),
          expiresInMinutes: RESET_TTL_MS / 60000
        },
        message: 'If that address is on an account, a reset code is on its way.'
      });
    } catch (err) {
      next(err);
    }
  }
);

const ResetPasswordSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().trim().length(6, 'The reset code is six digits.'),
  newPassword: z
    .string()
    .min(8, 'Choose a password of at least 8 characters.')
    .max(128)
});

/**
 * POST /api/auth/reset-password
 *
 * Consumes the code exactly once. A wrong code counts against a small attempt
 * budget, after which the reset is thrown away — six digits is guessable if a
 * caller is allowed to keep trying.
 */
authRouter.post(
  '/reset-password',
  authRateLimiterMiddleware,
  validate({ body: ResetPasswordSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const user = await userRepository.findByEmail(email);
      const pending = user ? memoryStore.settings.get(`reset:${user.id}`) : null;

      if (!user || !pending) {
        throw new AppError('That reset code is not valid. Request a new one.', 400, 'INVALID_RESET_CODE');
      }
      if (Date.now() > pending.expiresAt) {
        memoryStore.settings.delete(`reset:${user.id}`);
        triggerAutoSave();
        throw new AppError('That reset code has expired. Request a new one.', 400, 'RESET_CODE_EXPIRED');
      }
      if (pending.codeHash !== hashResetCode(req.body.code)) {
        pending.attempts = (pending.attempts || 0) + 1;
        if (pending.attempts >= RESET_MAX_ATTEMPTS) {
          memoryStore.settings.delete(`reset:${user.id}`);
        } else {
          memoryStore.settings.set(`reset:${user.id}`, pending);
        }
        triggerAutoSave();
        throw new AppError('That reset code is not valid. Request a new one.', 400, 'INVALID_RESET_CODE');
      }

      await userRepository.update(user.id, { passwordHash: await bcrypt.hash(req.body.newPassword, 10) });
      memoryStore.settings.delete(`reset:${user.id}`);
      triggerAutoSave();

      res.json({
        success: true,
        data: { reset: true, token: generateToken({ ...user, passwordHash: undefined }) },
        message: 'Your password has been changed. You are signed in.'
      });
    } catch (err) {
      next(err);
    }
  }
);

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(8, 'Choose a password of at least 8 characters.').max(128)
});

/**
 * POST /api/auth/change-password
 *
 * Requires the current password even though the caller is already signed in: a
 * phone left unlocked on a table should not be enough to lock its owner out of
 * their own account.
 */
authRouter.post(
  '/change-password',
  authMiddleware(),
  validate({ body: ChangePasswordSchema }),
  async (req, res, next) => {
    try {
      const user = await userRepository.findById(req.user!.id);
      if (!user) throw new AppError('Account not found.', 404, 'USER_NOT_FOUND');

      const confirmed = await userRepository.verifyCredentials(user.email, req.body.currentPassword);
      if (!confirmed) {
        throw new AppError('Your current password is not correct.', 401, 'INVALID_PASSWORD');
      }
      if (req.body.currentPassword === req.body.newPassword) {
        throw new AppError('The new password has to be different from the old one.', 400, 'PASSWORD_UNCHANGED');
      }

      await userRepository.update(user.id, { passwordHash: await bcrypt.hash(req.body.newPassword, 10) });

      res.json({
        success: true,
        data: { changed: true },
        message: 'Your password has been changed.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 *
 * Tokens are stateless and self-expiring, so there is nothing to revoke here;
 * the client discards its copy. The endpoint exists so every app has one call to
 * make on sign-out, and so the moment is recorded rather than being invisible.
 */
authRouter.post('/logout', authMiddleware(), async (req, res) => {
  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'USER_LOGGED_OUT',
      userId: req.user?.id,
      role: req.user?.role
    })
  );
  res.json({ success: true, data: { loggedOut: true } });
});
