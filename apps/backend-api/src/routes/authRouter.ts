import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { userRepository } from '../db/repositories/userRepository.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { config } from '../config/env.ts';
import { validate } from '../middlewares/validate.ts';
import { authRateLimiterMiddleware } from '../middlewares/rateLimiter.ts';
import { AppError } from '../utils/AppError.ts';
import { z } from 'zod';
import { phoneSchema, optionalPhoneSchema } from '../utils/phone.ts';
import { otpService } from '../modules/auth/otpService.ts';
import { maskPhone } from '../modules/auth/otpDrivers.ts';
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
  phone: phoneSchema,
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
          isGold: user.isGold,
          avatarUrl: user.avatarUrl,
          favouriteRestaurantIds: user.favouriteRestaurantIds || []
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
          isGold: user.isGold,
          avatarUrl: user.avatarUrl,
          favouriteRestaurantIds: user.favouriteRestaurantIds || []
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
  phone: optionalPhoneSchema,
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
 *                  STAFF REGISTRATION (PARTNERS AND RIDERS)                  *
 * ========================================================================== *
 *
 * A restaurant or a rider signs themselves up and then waits to be approved.
 *
 * Until this existed there was no way onto the platform except a seeded account
 * with a shared password, which is why staff apps could not be handed to testers
 * at all: the password lived in one deployment's environment and nowhere else.
 *
 * Registration deliberately does NOT make anyone tradeable. It creates the
 * account and its pending business record, and lets them sign in to upload
 * documents and watch their own application. An administrator approving the KYC
 * is what turns a pending restaurant into one customers can see, and a pending
 * rider into one who can start a shift. Those gates are enforced in the service
 * and repository layers, not on a screen — a restaurant that has not been
 * approved is invisible to discovery because `findNearby` filters on ACTIVE.
 *
 * The role is set here, never read from the request. Self-registration that
 * copies `role` out of the body is how a sign-up form becomes an administrator
 * factory; `/auth/register` learned that lesson already.
 */

const PartnerRegistrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().email('A valid email address is required.').max(254),
  phone: phoneSchema,
  password: z.string().min(8, 'Choose a password of at least 8 characters.').max(128),
  restaurantName: z.string().trim().min(2, 'Enter the restaurant name.').max(120),
  addressLine: z.string().trim().min(5, 'Enter the kitchen address.').max(250),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode.'),
  /**
   * Optional at sign-up, deliberately.
   *
   * A real kitchen often applies for its FSSAI licence in parallel with joining
   * a platform, and blocking registration on a number they do not have yet
   * loses the partner rather than protecting anyone. The licence is a
   * requirement to TRADE, not to register — it is collected here when known,
   * and the approval step in the admin console is where it is actually checked
   * against the public register before the kitchen becomes visible.
   *
   * An empty string is normalised away so it is stored as absent rather than
   * as a blank the approver might mistake for a real value.
   */
  fssaiLicenseNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform(value => (value ? value : undefined)),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isPureVeg: z.boolean().optional()
});

const RiderRegistrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().email('A valid email address is required.').max(254),
  phone: phoneSchema,
  password: z.string().min(8, 'Choose a password of at least 8 characters.').max(128),
  vehicleType: z.enum(['BIKE', 'EV', 'CYCLE']),
  licenseNumber: z.string().trim().min(4, 'Enter your driving licence number.').max(40),
  vehicleRegistrationNumber: z.string().trim().min(4).max(20).optional()
});

/** Both registrations refuse an address or number already in use. */
async function assertIdentityFree(email: string, phone: string): Promise<void> {
  if (await userRepository.findByEmail(email)) {
    throw new AppError('An account with this email already exists.', 409, 'EMAIL_IN_USE');
  }
  if (await userRepository.findByPhone(phone)) {
    throw new AppError('An account with this mobile number already exists.', 409, 'PHONE_IN_USE');
  }
}

/**
 * POST /api/auth/register/partner
 *
 * Creates the owner's login and their restaurant, both pending approval.
 */
authRouter.post(
  '/register/partner',
  authRateLimiterMiddleware,
  validate({ body: PartnerRegistrationSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const { phone, fullName, password, restaurantName } = req.body;
      await assertIdentityFree(email, phone);

      const user = await userRepository.create({
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        fullName,
        phone,
        role: 'restaurant_owner' as UserRole,
        isGold: false,
        preferredLanguage: 'en'
      });

      const slug = restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);

      const restaurant = await restaurantRepository.create({
        id: `rst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ownerId: user.id,
        name: restaurantName,
        slug: `${slug}-${Math.random().toString(36).slice(2, 5)}`,
        phone,
        addressLine: req.body.addressLine,
        city: req.body.city,
        pincode: req.body.pincode,
        // Bangalore's centre until the owner sets a real pin. A kitchen with no
        // coordinates would be invisible to proximity search even after
        // approval, which looks like an approval that silently did nothing.
        coordinates: {
          latitude: req.body.latitude ?? 12.9716,
          longitude: req.body.longitude ?? 77.5946
        },
        fssaiLicenseNumber: req.body.fssaiLicenseNumber,
        isPureVeg: Boolean(req.body.isPureVeg),
        packagingFee: 0,
        status: 'PENDING_APPROVAL',
        kycStatus: 'PENDING_APPROVAL',
        ratingAverage: 0,
        ratingCount: 0,
        cuisineTags: [],
        isOpen: false
      } as any);

      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'PARTNER_REGISTERED',
        userId: user.id,
        restaurantId: restaurant.id
      }));

      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role },
          restaurant: { id: restaurant.id, name: restaurant.name, status: restaurant.status },
          token: generateToken(user),
          awaitingApproval: true
        },
        message: 'Your restaurant has been registered. Upload your documents — an administrator reviews them before you can take orders.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/register/rider
 *
 * Creates the rider's login and their delivery-partner record, pending approval.
 */
authRouter.post(
  '/register/rider',
  authRateLimiterMiddleware,
  validate({ body: RiderRegistrationSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const { phone, fullName, password, vehicleType, licenseNumber } = req.body;
      await assertIdentityFree(email, phone);

      const user = await userRepository.create({
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        fullName,
        phone,
        role: 'rider' as UserRole,
        isGold: false,
        preferredLanguage: 'en'
      });

      const rider = await riderRepository.create({
        userId: user.id,
        fullName,
        phone,
        vehicleType,
        licenseNumber,
        vehicleRegistrationNumber: req.body.vehicleRegistrationNumber,
        kycStatus: 'PENDING_APPROVAL',
        isOnline: false,
        codCashInHand: 0,
        walletBalance: 0,
        ratingAverage: 0,
        ratingCount: 0,
        tripsToday: 0
      } as any);

      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'RIDER_REGISTERED',
        userId: user.id,
        riderId: rider.id
      }));

      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role },
          rider: { id: rider.id, driverCode: rider.driverCode, kycStatus: rider.kycStatus },
          token: generateToken(user),
          awaitingApproval: true
        },
        message: 'You are registered. Upload your documents — an administrator reviews them before you can go on shift.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ========================================================================== *
 *                     PHONE SIGN-IN (CUSTOMERS)                              *
 * ========================================================================== *
 *
 * A customer is a phone number. There is no customer password to forget, to
 * reuse from another site, or to leak — which is why the email recovery flow
 * that used to live here is gone rather than ported.
 *
 * There is no separate sign-up either. Verifying a code for a number nobody
 * holds creates the account, which is how every delivery app in this market
 * behaves and removes an entire screen from the journey.
 *
 * Partners, riders and administrators keep email and password: a kitchen tablet
 * is shared between shifts and staff access should not depend on one person's
 * handset being in the building.
 */

const OtpRequestSchema = z.object({ phone: phoneSchema });

const OtpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from your phone.'),
  // Only read when the number has no account yet; ignored otherwise, so this
  // cannot be used to rename an existing account by signing into it.
  fullName: z.string().trim().min(2).max(80).optional()
});

/**
 * POST /api/auth/otp/request
 *
 * Answers identically for a number that has an account and one that does not.
 * A difference here would turn the endpoint into a way to ask "is this person a
 * customer?" of any phone number someone has a list of.
 */
authRouter.post(
  '/otp/request',
  authRateLimiterMiddleware,
  validate({ body: OtpRequestSchema }),
  async (req, res, next) => {
    try {
      const outcome = await otpService.request(req.body.phone);

      if (outcome.configurationError) {
        // The deployment cannot issue codes at all. That is this platform's
        // fault and is stated plainly rather than failing as a bad code later.
        throw new AppError(outcome.configurationError, 503, 'OTP_UNAVAILABLE');
      }

      res.json({
        success: true,
        data: {
          requested: true,
          deliveryConfigured: outcome.deliveryConfigured,
          retryAfterSeconds: outcome.retryAfterSeconds ?? null
        },
        message: outcome.deliveryConfigured
          ? 'If that number can receive messages, a code is on its way.'
          : 'Enter the verification code for this test deployment.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Resending is the same operation; the cooldown inside the service governs it. */
authRouter.post(
  '/otp/resend',
  authRateLimiterMiddleware,
  validate({ body: OtpRequestSchema }),
  async (req, res, next) => {
    try {
      const outcome = await otpService.request(req.body.phone);
      if (outcome.configurationError) {
        throw new AppError(outcome.configurationError, 503, 'OTP_UNAVAILABLE');
      }
      res.json({
        success: true,
        data: { requested: true, retryAfterSeconds: outcome.retryAfterSeconds ?? null },
        message: 'A new code has been requested.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/otp/verify
 *
 * Signs in, creating the account if the number is new.
 */
authRouter.post(
  '/otp/verify',
  authRateLimiterMiddleware,
  validate({ body: OtpVerifySchema }),
  async (req, res, next) => {
    try {
      const { phone, code, fullName } = req.body;

      const result = await otpService.verify(phone, code);
      if (!result.ok) {
        throw new AppError(result.reason || 'That code is not valid.', 400, 'INVALID_OTP');
      }

      let user = await userRepository.findByPhone(phone);
      let created = false;

      if (!user) {
        // First sign-in. The role is assigned here and never read from the
        // request: phone sign-in mints customers and nothing else, so it can
        // never become a route to a staff account.
        user = await userRepository.create({
          id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          // Kept for staff tooling that still indexes by address. It is not a
          // login credential for this account: there is no password to use with it.
          email: `${phone}@phone.quickbite.app`,
          fullName: fullName || 'Quick Bites Customer',
          phone,
          role: 'customer' as UserRole,
          isGold: false,
          preferredLanguage: 'en'
        });
        await walletRepository.credit(user.id, 100.0, 'Sign-up Bonus Balance');
        created = true;
      } else if (user.role !== 'customer') {
        // A staff member's number reaching this endpoint must not hand out a
        // staff token. They sign in with their credentials, in their own app.
        throw new AppError(
          'This number belongs to a partner account. Sign in from the partner app with your email and password.',
          403,
          'STAFF_ACCOUNT'
        );
      }

      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: created ? 'CUSTOMER_CREATED_BY_PHONE' : 'CUSTOMER_SIGNED_IN_BY_PHONE',
        userId: user.id,
        phone: maskPhone(phone)
      }));

      res.json({
        success: true,
        data: {
          isNewAccount: created,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
            isGold: user.isGold,
            avatarUrl: user.avatarUrl,
            favouriteRestaurantIds: user.favouriteRestaurantIds || []
          },
          token: generateToken(user)
        },
        message: created ? 'Welcome to Quick Bites.' : 'Signed in.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ========================================================================== *
 *                            PASSWORD MANAGEMENT                             *
 * ========================================================================== */


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
