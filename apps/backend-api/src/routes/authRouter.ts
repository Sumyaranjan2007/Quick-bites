import { Router } from 'express';
import crypto from 'crypto';
import { isStaffRole, requestStaffDeletion } from '../modules/platform/staffDeletion.ts';
import { notifyAdminsDeletionRequested } from '../notifications/adminNotifier.ts';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { userRepository, grantRole, hasRole, rolesOf } from '../db/repositories/userRepository.ts';
import { memoryStore, triggerAutoSave, persistDurably } from '../db/client.ts';
import { pendingRoles, CONFIRM_TTL_MS, type PendingRole } from '../modules/auth/confirmLinks.ts';
import { normalizeIndianPhone } from '../utils/phone.ts';
import { assertNotBanned } from '../modules/platform/blockedIdentifiers.ts';
import { walletRepository } from '../db/repositories/walletRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { config } from '../config/env.ts';
import { validate } from '../middlewares/validate.ts';
import { authRateLimiterMiddleware } from '../middlewares/rateLimiter.ts';
import { requireFeature } from '../middlewares/featureGate.ts';
import { AppError } from '../utils/AppError.ts';
import { z } from 'zod';
import { phoneSchema, optionalPhoneSchema } from '../utils/phone.ts';
import { otpService } from '../modules/auth/otpService.ts';
import { maskPhone, isRealEmail, sendEmail } from '../modules/auth/otpDrivers.ts';
import { page, escape } from './publicPages.ts';
import type { UserRole } from '@quick-bites/shared-types';
import { CUISINE_TYPES } from '@quick-bites/shared-types';
import { UNSET_COORDINATES } from '../modules/restaurants/restaurantLocation.ts';
import { notifyAdminsNewSignup } from '../notifications/adminNotifier.ts';

export const authRouter = Router();

/**
 * `actingRole` is the role the app signed in AS. A person can hold several
 * (grantRole), and the partner app must get a restaurant_owner session even
 * when the account was first a customer. Only a role the account holds is
 * accepted; anything else falls back to the primary role.
 */
export function generateToken(user: any, actingRole?: string, scope?: 'customer'): string {
  const held = rolesOf(user);
  const role = actingRole && held.includes(actingRole) ? actingRole : user.role;
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role,
      // 'customer': a customer-app session, limited to customer features (middlewares/auth.ts).
      ...(scope ? { scope } : {}),
      is_gold: user.isGold,
      user_metadata: { name: user.fullName },
      // Token version: bumped on a password change or reset to retire older tokens.
      tv: Number(user.tokenVersion) || 0
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
  /*
   * Length checked in the handler, not here, for the same reason the partner
   * and rider schemas do it there: this field is either a password being
   * chosen or the existing password of an account this person already holds,
   * offered as proof. Only the first has a minimum.
   */
  password: z.string().min(1, 'Enter your password.').max(128),
  fullName: z.string().min(1, 'Full name is required').max(120),
  phone: phoneSchema,
  role: z.enum(SELF_SERVICE_ROLES).optional()
});

// POST /api/auth/register
authRouter.post('/register', authRateLimiterMiddleware, requireFeature('registrations'), validate({ body: RegisterSchema }), async (req, res, next) => {
  try {
    // Stored normalised so the account is found however it is later typed;
    // lookups trim and lowercase too, but the record itself should be clean.
    const email = String(req.body.email).trim().toLowerCase();
    const { password, fullName, phone } = req.body;

    /*
     * THIS USED TO CHECK THE EMAIL AND NOT THE PHONE NUMBER.
     *
     * Which meant a rider who had signed up with phone X and one address could
     * register here with phone X and a different address, and get a SECOND
     * account on the same number. Phone is the sign-in identity - there is an
     * OTP route keyed on it - so two accounts sharing one number makes
     * `findByPhone` return whichever happened to be created first, and the
     * person signs in to an account that is theirs but is not the one holding
     * their orders.
     *
     * It is the mirror of the reported bug. That one refused a real person for
     * having an account; this one silently gave them a second one.
     *
     * Same resolution as the rider and partner routes: an existing account is
     * not a dead end and is not duplicated either. Prove it is yours and the
     * customer role is added to it.
     */
    const identity = await resolveIdentity(email, phone, password, 'customer' as UserRole);
    // Unreachable today (a password-less account is a customer already); kept a refusal.
    if (identity.kind === 'CONFIRM_BY_EMAIL') throw roleAlreadyHeld('customer' as UserRole);

    // Never taken from the request: the only role obtainable by self-registration.
    const assignedRole: UserRole = 'customer';

    let user;
    if (identity.kind === 'EXISTING') {
      user = (await grantRole(identity.user.id, assignedRole))!;
    } else {
      enforceNewPasswordStrength(password);
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await userRepository.create({
        id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        email,
        passwordHash: hashedPassword,
        fullName,
        phone,
        role: assignedRole,
        roles: [assignedRole],
        isGold: false,
        preferredLanguage: 'en'
      });
    }

    // No sign-up bonus. It used to credit Rs 100 to every new customer, which
    // is money given away to anyone who can supply a phone number — and the
    // wallet it landed in no longer accepts top-ups, so the balance had nowhere
    // to come from and no reason to exist. The wallet is created on first use
    // by getByUserId; nothing needs to seed it.

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
    /*
     * An AppError carries its own status and code, and this turned every one
     * of them into a 500.
     *
     * That did not matter while the only failure here was unexpected. Now
     * registration can legitimately refuse — the number belongs to somebody
     * else, the account is blocked, the password does not prove ownership — so
     * a 500 would tell the app "we broke" about things the person could fix,
     * and the apps would show a generic failure instead of the sentence
     * saying what to do.
     */
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        error: { code: error.code, message: error.message },
        meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
      });
    }
    return next(error); // security L1: the error handler masks internals in production
  }
});

// POST /api/auth/login
/*
 * Declared for the body contract check (S13) and nothing else: the handler
 * below keeps its own checks and its own error shape, which the apps display.
 */
const LoginBodySchema = z.object({ email: z.unknown(), password: z.unknown(), role: z.unknown() });

authRouter.post('/login', authRateLimiterMiddleware, validate({ body: LoginBodySchema }), async (req, res, next) => {
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
          role: role && rolesOf(user).includes(role) ? role : user.role,
          isGold: user.isGold,
          avatarUrl: user.avatarUrl,
          favouriteRestaurantIds: user.favouriteRestaurantIds || []
        },
        token: generateToken(user, role)
      }
    });
  } catch (error: any) {
    return next(error); // security L1: the error handler masks internals in production
  }
});

// GET /api/auth/me/:userId
authRouter.get('/me/:userId', authMiddleware(), async (req, res, next) => {
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
    const { passwordHash, passwordReset, ...safeUser } = user as any;
    // Whether this account has a password at all. A customer who signed up with
    // a phone code never set one, and the app must not ask them for it — to
    // delete the account, or on a "change password" row.
    return res.json({ success: true, data: { user: { ...safeUser, hasPassword: Boolean(passwordHash) } } });
  } catch (error: any) {
    return next(error); // security L1: the error handler masks internals in production
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
    // A number is one person's (security M1, 18 Oct 2026): taking another
    // account's phone here pointed its sign-in codes and its riders' calls at
    // the taker. Changing it with a code to the new number is master plan B6.
    if (req.body.phone !== undefined) {
      const holder = await userRepository.findByPhone(req.body.phone);
      if (holder && holder.id !== req.user!.id) {
        throw new AppError('That mobile number is already on another Quick Bites account.', 409, 'PHONE_IN_USE');
      }
      // An unused number is no safer to take without proving it (security M1, round 2):
      // its real owner's first sign-in code would go to this account's email. A new
      // number needs a code to it (master plan B6); until then support changes it.
      // Saving the same number again, as the apps do on every profile save, is fine.
      const current = (await userRepository.findById(req.user!.id))?.phone || '';
      const changing = normalizeIndianPhone(req.body.phone) !== normalizeIndianPhone(current);
      const isStaffAdmin = req.user!.role === 'admin' && (req.user as any).scope !== 'customer';
      if (changing && !isStaffAdmin) {
        throw new AppError(
          'To change your mobile number, contact Quick Bites support from Help. A code to the new number will do this in the app soon.',
          409,
          'PHONE_CHANGE_NEEDS_CODE'
        );
      }
    }
    const updated = await userRepository.updateProfile(req.user!.id, req.body);
    if (!updated) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

    const { passwordHash, passwordReset, ...safeUser } = updated as any;
    res.json({
      success: true,
      data: { user: safeUser },
      meta: { timestamp: new Date().toISOString(), correlationId: req.correlationId }
    });
  } catch (err) {
    next(err);
  }
});

/*
 * A password OR a fresh phone code.
 *
 * Only a password used to be accepted, and a customer who signs up with a phone
 * code never has one — so every real customer who tried to delete their account
 * was told "Password is incorrect", for ever. They now confirm with a code sent
 * to their number (POST /auth/otp/request), which proves the same thing: that
 * the person holding the phone is the account's owner, not just somebody who
 * picked it up unlocked.
 */
const DeleteAccountSchema = z
  .object({
    password: z.string().min(1).optional(),
    code: z.string().trim().min(4).max(8).optional()
  })
  .refine(b => Boolean(b.password || b.code), {
    message: 'Confirm with your password, or with the code sent to your phone.'
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

    if (req.body.code) {
      if (!user.phone) {
        throw new AppError('This account has no phone number to send a code to. Use your password.', 400, 'NO_PHONE');
      }
      const result = await otpService.verify(user.phone, req.body.code);
      if (!result.ok) {
        throw new AppError(
          `${result.reason || 'That code is not valid.'} Account was not deleted.`,
          401,
          'INVALID_OTP'
        );
      }
    } else {
      const confirmed = await userRepository.verifyCredentials(user.email, req.body.password);
      if (!confirmed) {
        throw new AppError(
          user.passwordHash
            ? 'Password is incorrect. Account was not deleted.'
            : 'This account has no password. Confirm with the code sent to your phone instead.',
          401,
          'INVALID_PASSWORD'
        );
      }
    }

    // A partner or rider: closed now, deleted by an administrator once nothing
    // is owed either way (owner, 2 Oct 2026). See staffDeletion.ts.
    // From the Customer app, an account that is also a partner or rider loses
    // only its customer side; the kitchen or rider account is closed only
    // from its own app (owner, 17 Oct 2026).
    if (req.user!.role === 'customer' && rolesOf(user).some(r => isStaffRole(r))) {
      const live = (Array.from(memoryStore.orders.values()) as any[]).find(
        o => o.customerId === userId && !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)
      );
      if (live) {
        throw new AppError(
          `Order #${live.orderNumber} is still in progress. You can delete your account once it is delivered or cancelled.`,
          409,
          'ORDER_IN_PROGRESS'
        );
      }
      await userRepository.removeCustomerSide(userId);
      return res.json({
        success: true,
        data: { deleted: true },
        message: 'Your customer account and its data have been deleted. Your partner or rider account is unchanged.'
      });
    }
    if (isStaffRole(user.role) || isStaffRole(req.user!.role)) {
      await requestStaffDeletion(userId);
      void notifyAdminsDeletionRequested({
        userId,
        name: user.fullName || user.email,
        kind: user.role === 'restaurant_owner' ? 'RESTAURANT' : 'RIDER'
      }).catch(() => undefined);
      return res.json({
        success: true,
        data: { deleted: false, requested: true },
        message:
          'Your account is closed. We will pay anything we owe you, then delete it — usually within 7 days. You will not be able to sign in.'
      });
    }

    // Not while money or food is in flight: a live order would lose its
    // customer mid-delivery, and a rider would walk away with platform cash.
    const CLOSED = ['DELIVERED', 'CANCELLED', 'REFUNDED'];
    const live = (Array.from(memoryStore.orders.values()) as any[]).find(
      o => o.customerId === userId && !CLOSED.includes(o.status)
    );
    if (live) {
      throw new AppError(
        `Order #${live.orderNumber} is still in progress. You can delete your account once it is delivered or cancelled.`,
        409,
        'ORDER_IN_PROGRESS'
      );
    }
    const riderRow = (Array.from(memoryStore.riders.values()) as any[]).find(r => r.userId === userId);
    if (riderRow && Number(riderRow.codCashInHand) > 0) {
      throw new AppError(
        'You are still holding cash from deliveries. Deposit it first, then delete your account.',
        409,
        'CASH_IN_HAND'
      );
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
  /*
   * Length is NOT checked here, and that is deliberate.
   *
   * This field now carries two different things: a new password being chosen,
   * and the EXISTING password of an account this person already has, offered
   * as proof that it is theirs. Only the first has a minimum length, and
   * enforcing it here would refuse an existing account whose password is
   * shorter than eight characters before the comparison could ever run - so
   * anybody who signed up before that rule existed could never add a role, and
   * would be told to "choose a password of at least 8 characters" about a
   * password they were not choosing.
   *
   * The minimum is applied in the handler, on the branch that creates an
   * account. See `enforceNewPasswordStrength`.
   */
  password: z.string().min(1, 'Enter your password.').max(128),
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
  /**
   * How far this kitchen is willing to deliver.
   *
   * Bounded at both ends rather than trusted: under a kilometre is a radius
   * that reaches nobody and reads as a typo, and beyond 25 km is further than
   * food survives on a two-wheeler. Absent means the platform default applies.
   */
  /** Ignored since 18 Oct 2026 (admins set one radius); accepted so older Partner apps still sign up. */
  serviceRadiusKm: z.number().min(1).max(25).optional(),
  /** The partner's "pure veg" tick from older apps; now only sets `cuisineType` (the seal is admin-only, B5). */
  isPureVeg: z.boolean().optional(),
  cuisineType: z.enum(CUISINE_TYPES).optional()
});

const RiderRegistrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().email('A valid email address is required.').max(254),
  phone: phoneSchema,
  /*
   * Length is NOT checked here, and that is deliberate.
   *
   * This field now carries two different things: a new password being chosen,
   * and the EXISTING password of an account this person already has, offered
   * as proof that it is theirs. Only the first has a minimum length, and
   * enforcing it here would refuse an existing account whose password is
   * shorter than eight characters before the comparison could ever run - so
   * anybody who signed up before that rule existed could never add a role, and
   * would be told to "choose a password of at least 8 characters" about a
   * password they were not choosing.
   *
   * The minimum is applied in the handler, on the branch that creates an
   * account. See `enforceNewPasswordStrength`.
   */
  password: z.string().min(1, 'Enter your password.').max(128),
  vehicleType: z.enum(['BIKE', 'EV', 'CYCLE']),
  licenseNumber: z.string().trim().min(4, 'Enter your driving licence number.').max(40),
  vehicleRegistrationNumber: z.string().trim().min(4).max(20).optional()
});

/**
 * The minimum applies to a password being CHOSEN, never to one being proved.
 *
 * Its own function so the two registration routes cannot drift, and so the
 * rule reads in one place: eight characters for a new account, and no opinion
 * at all about the password an existing account already has.
 */
function enforceNewPasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new AppError('Choose a password of at least 8 characters.', 400, 'WEAK_PASSWORD');
  }
}

/**
 * Who is signing up, and whether they are already somebody here.
 *
 * A phone number identifies a PERSON, and one person is routinely more than
 * one thing on a food platform. A rider orders their own dinner. A restaurant
 * owner orders from somebody else's kitchen. Somebody signs up as a customer
 * in February and applies to deliver in June, with the one number they own.
 *
 * That last case was refused outright - "An account with this mobile number
 * already exists", 409, with nothing to do about it but find a second SIM. It
 * was reported from the apps, and it is right to report: there is no sense in
 * which that person is not allowed to deliver.
 *
 * So an existing account is no longer a dead end. If they can prove it is
 * theirs - the password it already has - the new role is added to it. If they
 * cannot, it stays refused, because "this number is already registered" must
 * never become a way to attach yourself to somebody else's account by claiming
 * to be them.
 *
 * Three outcomes, and the caller must handle each:
 *   { kind: 'NEW' }             nobody holds this identity; create an account
 *   { kind: 'EXISTING', user }  proven theirs; grant the role instead
 *   { kind: 'CONFIRM_BY_EMAIL', user }  a password-less account; askToConfirmByEmail
 * Anything else throws.
 */
type IdentityCheck =
  | { kind: 'NEW' }
  | { kind: 'EXISTING'; user: NonNullable<Awaited<ReturnType<typeof userRepository.findByPhone>>> }
  | { kind: 'CONFIRM_BY_EMAIL'; user: NonNullable<Awaited<ReturnType<typeof userRepository.findByPhone>>> };

async function resolveIdentity(
  email: string,
  phone: string,
  password: string,
  role: UserRole
): Promise<IdentityCheck> {
  // A blocked person's email or number, however written, opens no new account (owner Q1).
  assertNotBanned({ email, phone });
  const byPhone = await userRepository.findByPhone(phone);
  const byEmail = await userRepository.findByEmail(email);

  if (!byPhone && !byEmail) return { kind: 'NEW' };

  /*
   * The number belongs to one person and the address to another.
   *
   * Refused rather than resolved, because there is no answer here that is not
   * a guess about which of two real accounts is signing up - and guessing
   * wrong attaches a delivery role to a stranger.
   */
  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    throw new AppError(
      'That mobile number and email address belong to two different Quick Bites accounts. Sign in to the one you want to use, or use a different address.',
      409,
      'IDENTITY_CONFLICT'
    );
  }

  /*
   * TO ADD A ROLE TO AN ACCOUNT, BOTH DETAILS MUST BE THAT ACCOUNT'S.
   *
   * Matching on the phone alone looked sufficient and was not. Somebody
   * registering with an existing number and a NEW email address would have
   * been handed the old account silently, and would then be signed in to an
   * address they had never given - having just typed a different one into the
   * form and been told they were registered.
   *
   * Matching on the email alone is the same fault wearing the other hat: it
   * would attach a new phone number to an old account without the old number
   * ever being involved.
   *
   * So adding a role is exactly what it sounds like: the same account,
   * identified the way it already is, proved with its own password. Half a
   * match is refused, and the refusal says which half, so the person can
   * correct it rather than guess.
   */
  if (byPhone && (!byEmail || byEmail.id !== byPhone.id)) {
    throw new AppError(
      'This mobile number already has a Quick Bites account, registered to a different email address. Sign in with that address to add this to it, or register with a different number.',
      409,
      'PHONE_IN_USE'
    );
  }
  // What is left: the email's account, with this phone or a phone nobody holds.
  // A different phone is allowed now (owner, 17 Oct 2026): the restaurant or
  // rider record keeps the typed number; the account keeps its own. The proof
  // below (password, or the account's own inbox) is what protects it.
  const existing = byEmail!;

  /*
   * A blocked account cannot collect a new role.
   *
   * Without this, somebody blocked as a customer for fraudulent refund claims
   * could sign up to deliver on the same number and be back on the platform
   * the same afternoon, holding food and cash. Said as a block rather than as
   * a wrong password, because it is true and the other is not.
   */
  if (existing.isBlocked) {
    throw new AppError(
      existing.blockReason
        ? `This account has been blocked: ${existing.blockReason}. Contact Quick Bites support.`
        : 'This account has been blocked. Contact Quick Bites support.',
      403,
      'ACCOUNT_BLOCKED'
    );
  }

  /*
   * PROOF, not a claim.
   *
   * Safe to answer here only because both registration routes sit behind
   * `authRateLimiterMiddleware`. Without that this is a password oracle:
   * submit one registration per guess and read the outcome.
   */
  const proven = existing.passwordHash ? await bcrypt.compare(password, existing.passwordHash) : false;

  /*
   * NO PASSWORD TO PROVE: a customer who signs in with an emailed code. Asking
   * for "that account's password" refused them for ever. Their proof is the
   * same one the Customer app uses — their inbox: the caller emails a link
   * (`askToConfirmByEmail`) and nothing changes until it is opened.
   */
  if (!existing.passwordHash && isRealEmail(existing.email)) {
    if (hasRole(existing, role)) throw roleAlreadyHeld(role);
    return { kind: 'CONFIRM_BY_EMAIL', user: existing };
  }

  if (!proven) {
    throw new AppError(
      byPhone
        ? 'An account already uses this mobile number. Enter that account\u2019s password to add this role to it, or sign in and apply from there.'
        : 'An account already uses this email address. Enter that account\u2019s password to add this role to it, or sign in and apply from there.',
      409,
      byPhone ? 'PHONE_IN_USE' : 'EMAIL_IN_USE'
    );
  }

  // Already has it. Refused plainly rather than creating a second restaurant
  // or a second rider record against one person - the shape of bug that is
  // only noticed when payouts go to the wrong one of them.
  if (hasRole(existing, role)) throw roleAlreadyHeld(role);

  return { kind: 'EXISTING', user: existing };
}

/*
 * A sentence per role. This was a two-branch ternary on `role === 'rider'`,
 * which was fine while only two routes called it — and told a customer
 * registering a second time that they already had a restaurant.
 */
function roleAlreadyHeld(role: UserRole): AppError {
  const alreadyHave: Record<string, string> = {
    rider: 'You are already registered as a delivery partner. Sign in to the delivery app instead.',
    restaurant_owner: 'You already have a restaurant on Quick Bites. Sign in to the partner app instead.',
    customer: 'You already have a Quick Bites account. Sign in instead.'
  };
  return new AppError(
    alreadyHave[role] ?? 'You already have this on your Quick Bites account. Sign in instead.',
    409,
    'ROLE_ALREADY_HELD'
  );
}

/*
 * Adding a role to a password-less (customer) account, proved by its inbox.
 *
 * Kept in the store (`pendingRoleConfirmations`), keyed by a hash of the
 * link's token, for 30 minutes. It used to be a Map in memory, so every deploy
 * voided the links people had just been emailed (K3, 17 Oct 2026).
 *
 * The link opens a page with a Confirm BUTTON (a POST). A GET never changes
 * anything, because mail scanners open every link in an email; a GET that
 * confirmed would let a stranger's request through without the owner.
 */
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function publicBaseUrl(): string {
  // Never the request's Host header: a forged Host would put a stranger's
  // domain in the link, and they would collect the token.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (config.NODE_ENV === 'production') return 'https://quick-bites-production.up.railway.app';
  return `http://localhost:${config.PORT}`;
}

const ROLE_WORDS = {
  restaurant_owner: {
    app: 'Quick Bites Partner', title: 'Confirm your restaurant',
    after: 'Upload your documents in the app. We check them before you can take orders.'
  },
  rider: {
    app: 'Quick Bites Rider', title: 'Confirm you as a rider',
    after: 'Upload your documents in the app. We check them before you can go on shift.'
  }
} as const;

/** What is being added, in words, for the email and pages. */
const whatIsAdded = (role: PendingRole['role'], body: Record<string, any>) =>
  role === 'restaurant_owner' ? `your restaurant "${String(body.restaurantName)}"` : 'you as a delivery rider';

/** The confirm flow's button and numbered steps, readable on a phone. */
const BUTTON = 'display:inline-block;font-size:18px;font-weight:600;padding:14px 32px;border-radius:12px;border:0;background:#6e0f1e;color:#fff;text-decoration:none';
const steps = (items: string[]) => `<ol style="padding-left:22px">${items.map(i => `<li style="margin:6px 0">${i}</li>`).join('')}</ol>`;

async function askToConfirmByEmail(user: { id: string; email: string }, role: PendingRole['role'], body: Record<string, any>): Promise<never> {
  const { password, ...rest } = body;
  const now = Date.now();
  for (const [key, p] of pendingRoles()) {
    if (now - p.createdAt > CONFIRM_TTL_MS) pendingRoles().delete(key);
  }
  const words = ROLE_WORDS[role];
  // Shown in the app's message box under the sign-up form: it must say what to do next.
  const sentMessage =
    `Almost done. You already have a Quick Bites account with this email, so we need to check it is you.\n\n` +
    `1. Open the email we just sent to ${user.email} (look in Spam too).\n` +
    `2. Tap the link in it, then tap Confirm.\n` +
    `3. Come back here, tap Sign in, and use this email and the password you just typed.\n\n` +
    `The link works for 30 minutes.`;

  enforceNewPasswordStrength(password);
  const passwordHash = await bcrypt.hash(password, 10);

  // One email a minute per account: a resubmitted form updates the link already
  // sent (its latest password and details) instead of filling the inbox.
  const recent = Array.from(pendingRoles().entries()).find(([, p]) => p.userId === user.id && now - p.createdAt < 60_000);
  if (recent) {
    pendingRoles().set(recent[0], { ...recent[1], role, passwordHash, body: rest });
    await persistDurably();
    throw new AppError(sentMessage, 409, 'CONFIRM_BY_EMAIL');
  }

  for (const [key, p] of pendingRoles()) if (p.userId === user.id) pendingRoles().delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  pendingRoles().set(hashToken(token), { userId: user.id, role, passwordHash, body: rest, createdAt: now });
  // Saved before the email goes out: a link that arrives must still work after a restart.
  await persistDurably();

  const link = `${publicBaseUrl()}/api/auth/confirm/${token}`;
  const what = whatIsAdded(role, rest);
  const sent = await sendEmail(
    user.email,
    `${words.title} on Quick Bites`,
    `Hello,\n\nYou asked to add ${what} to your Quick Bites account (${user.email}).\n\n` +
      `1. Open this link: ${link}\n2. Tap Confirm.\n3. Open the ${words.app} app, tap Sign in, and use this email and the password you chose.\n\n` +
      `The link works once, for 30 minutes. If you did not ask for this, ignore this email. Nothing changes.\n\nQuick Bites`,
    `<p>Hello,</p><p>You asked to add <strong>${escape(what)}</strong> to your Quick Bites account (${escape(user.email)}).</p>` +
      `<p><a href="${link}" style="${BUTTON}">Open and confirm</a></p>` +
      steps([
        'Tap the button above.',
        'Tap <strong>Confirm</strong> on the page that opens.',
        `Open the <strong>${escape(words.app)}</strong> app, tap <strong>Sign in</strong>, and use this email and the password you chose.`
      ]) +
      `<p style="color:#6b5d60">The link works once, for 30 minutes. If you did not ask for this, ignore this email. Nothing changes.</p>` +
      `<p style="color:#6b5d60;font-size:13px">Button not working? Copy this address into your browser:<br>${link}</p><p>Quick Bites</p>`
  );
  if (config.NODE_ENV !== 'production') console.log(JSON.stringify({ level: 'INFO', event: 'ROLE_CONFIRM_LINK', link }));
  // Off production the logged link stands in for the email (QA server).
  if (!sent.accepted && config.NODE_ENV === 'production') {
    pendingRoles().delete(hashToken(token));
    triggerAutoSave();
    console.error(JSON.stringify({ level: 'ERROR', event: 'ROLE_CONFIRM_EMAIL_FAILED', userId: user.id, error: sent.error }));
    throw new AppError('We could not send the confirmation email just now. Try again in a few minutes.', 503, 'EMAIL_UNAVAILABLE');
  }
  throw new AppError(sentMessage, 409, 'CONFIRM_BY_EMAIL');
}

/** The restaurant record for a partner sign-up (also run by a confirmed email link). */
async function openRestaurant(user: { id: string }, body: Record<string, any>) {
  const { phone, restaurantName } = body;
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
    addressLine: body.addressLine,
    city: body.city,
    pincode: body.pincode,
    // The placeholder is Bangalore's centre, kept because `coordinates` is
    // a required field and a kitchen with none would break callers that
    // assume it. It is NOT treated as a location: `hasRealLocation` in
    // modules/restaurants/restaurantLocation.ts recognises this exact pair
    // as "never set", so a restaurant carrying it is listed everywhere
    // rather than measured from a point nobody chose.
    //
    // The partner app now requires a pin before it will register, so this
    // branch only runs for a client that has not been updated.
    coordinates: {
      latitude: body.latitude ?? UNSET_COORDINATES.latitude,
      longitude: body.longitude ?? UNSET_COORDINATES.longitude
    },
    fssaiLicenseNumber: body.fssaiLicenseNumber,
    // The Pure Veg seal is given only by admins (owner, 18 Oct 2026); the partner's tick is their cuisine type.
    isPureVeg: false,
    ...(body.cuisineType || body.isPureVeg ? { cuisineType: body.cuisineType ?? 'VEG' } : {}),
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

  /*
   * AND TELL SOMEBODY THEY ARE WAITING.
   *
   * This announced nothing at all. A restaurant registered, landed in
   * PENDING_APPROVAL, and waited for somebody to happen to open the People
   * screen — so the platform's own growth was the one thing it never
   * mentioned. A partner who waits three days has usually signed up with
   * somebody else by then.
   */
  void notifyAdminsNewSignup({
    entityId: restaurant.id,
    entityName: restaurant.name,
    kind: 'RESTAURANT'
  });
  return restaurant;
}

/** The delivery-partner record for a rider sign-up (also run by a confirmed email link). */
async function openRiderRecord(user: { id: string }, body: Record<string, any>) {
  const { phone, fullName, vehicleType, licenseNumber } = body;
  const rider = await riderRepository.create({
    userId: user.id,
    fullName,
    phone,
    vehicleType,
    licenseNumber,
    vehicleRegistrationNumber: body.vehicleRegistrationNumber,
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

  // Same silence as a partner signing up. A rider cannot earn until they are
  // approved, so nobody knowing they are there is a rider who gives up.
  void notifyAdminsNewSignup({
    entityId: rider.id,
    entityName: rider.fullName || 'A new rider',
    kind: 'RIDER'
  });
  return rider;
}

/**
 * POST /api/auth/register/partner
 *
 * Creates the owner's login and their restaurant, both pending approval.
 */
authRouter.post(
  '/register/partner',
  authRateLimiterMiddleware,
  requireFeature('registrations'),
  validate({ body: PartnerRegistrationSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const { phone, fullName, password } = req.body;
      assertNotBanned({ fssai: req.body.fssaiLicenseNumber, gstin: req.body.gstin });
      const identity = await resolveIdentity(email, phone, password, 'restaurant_owner' as UserRole);
      if (identity.kind === 'CONFIRM_BY_EMAIL') return await askToConfirmByEmail(identity.user, 'restaurant_owner', req.body);

      // Same rule as the rider route: an existing person keeps their account
      // and gains a role, rather than being told to find another phone number.
      let user;
      if (identity.kind === 'EXISTING') {
        user = (await grantRole(identity.user.id, 'restaurant_owner'))!;
      } else {
        enforceNewPasswordStrength(password);
        user = await userRepository.create({
          id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          email,
          passwordHash: await bcrypt.hash(password, 10),
          fullName,
          phone,
          role: 'restaurant_owner' as UserRole,
          roles: ['restaurant_owner' as UserRole],
          isGold: false,
          preferredLanguage: 'en'
        });
      }

      const restaurant = await openRestaurant(user, req.body);

      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role },
          restaurant: { id: restaurant.id, name: restaurant.name, status: restaurant.status },
          token: generateToken(user, 'restaurant_owner'),
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
  requireFeature('registrations'),
  validate({ body: RiderRegistrationSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const { phone, fullName, password } = req.body;
      assertNotBanned({ license: req.body.licenseNumber });
      const identity = await resolveIdentity(email, phone, password, 'rider' as UserRole);
      if (identity.kind === 'CONFIRM_BY_EMAIL') return await askToConfirmByEmail(identity.user, 'rider', req.body);

      /*
       * An existing customer KEEPS their account and gains the rider role.
       *
       * Their primary role is deliberately left alone: it is what the customer
       * app opens as, and moving it would change where an app they already
       * have installed lands on launch. The delivery app asks for the rider
       * role and now gets it, on the very next request, without signing out.
       */
      let user;
      if (identity.kind === 'EXISTING') {
        user = (await grantRole(identity.user.id, 'rider'))!;
      } else {
        enforceNewPasswordStrength(password);
        user = await userRepository.create({
          id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          email,
          passwordHash: await bcrypt.hash(password, 10),
          fullName,
          phone,
          role: 'rider' as UserRole,
          roles: ['rider' as UserRole],
          isGold: false,
          preferredLanguage: 'en'
        });
      }

      const rider = await openRiderRecord(user, req.body);

      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role },
          rider: { id: rider.id, driverCode: rider.driverCode, kycStatus: rider.kycStatus },
          token: generateToken(user, 'rider'),
          awaitingApproval: true
        },
        message: 'You are registered. Upload your documents — an administrator reviews them before you can go on shift.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET/POST /api/auth/confirm/:token — the link `askToConfirmByEmail` sends.
 *
 * GET only shows what will happen and a Confirm button; POST does it, with
 * every check of the sign-up repeated, because things may have changed in the
 * half hour since (a role granted, the number taken, the account blocked).
 */
function pendingFor(token: string): PendingRole | null {
  const key = hashToken(String(token));
  const pending = pendingRoles().get(key);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > CONFIRM_TTL_MS) {
    pendingRoles().delete(key);
    triggerAutoSave();
    return null;
  }
  return pending;
}

const expiredPage = () =>
  page(
    'Link expired',
    `<h1>This link has expired or was already used</h1>
<p>A confirm link works once, for 30 minutes.</p>
${steps([
  '<strong>Already tapped Confirm?</strong> You are done. Open the app and tap <strong>Sign in</strong> with your email and the password you chose.',
  '<strong>Not yet?</strong> Open the Partner or Rider app, tap <strong>Create account</strong> and fill it in again. We will email you a new link.'
])}`
  );

authRouter.get('/confirm/:token', (req, res) => {
  const pending = pendingFor(req.params.token);
  // 'same-origin', never 'no-referrer': with no-referrer the browser sends
  // `Origin: null` on the Confirm button, which the live server refused (500).
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
  if (!pending) return res.status(404).type('html').send(expiredPage());
  const words = ROLE_WORDS[pending.role];
  res.type('html').send(
    page(
      words.title,
      `<h1>${escape(words.title)}</h1>
<p>Tap <strong>Confirm</strong> to add <strong>${escape(whatIsAdded(pending.role, pending.body))}</strong> to your Quick Bites account. Your orders, addresses and the Customer app stay as they are.</p>
<form method="post"><button type="submit" style="${BUTTON}">Confirm</button></form>
<p style="color:#6b5d60">Did not ask for this? Close this page. Nothing changes.</p>`
    )
  );
});

authRouter.post('/confirm/:token', requireFeature('registrations'), async (req, res, next) => {
  try {
    const key = hashToken(String(req.params.token));
    const pending = pendingFor(req.params.token);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
    if (!pending) return res.status(404).type('html').send(expiredPage());
    pendingRoles().delete(key); // once only, whatever happens next
    await persistDurably();

    const fail = (message: string) =>
      res.status(409).type('html').send(
        page('Not added', `<h1>Not added</h1><p>${escape(message)}</p><p>Need help? Email officalquickbites@gmail.com.</p>`)
      );
    let user = await userRepository.findById(pending.userId);
    if (!user) return fail('This account no longer exists.');
    if (user.isBlocked) return fail('This account has been blocked. Contact Quick Bites support.');
    if (hasRole(user, pending.role)) return fail(roleAlreadyHeld(pending.role).message);
    const byPhone = await userRepository.findByPhone(pending.body.phone);
    if (byPhone && byPhone.id !== user.id) {
      return fail('That mobile number now belongs to another Quick Bites account. Register again with a different number.');
    }

    // The password typed at sign-up becomes the account's Partner/Rider password,
    // unless one was set in the meantime (that one stands).
    if (!user.passwordHash) user = (await userRepository.update(user.id, { passwordHash: pending.passwordHash }))!;
    // A phone-code account is named "Quick Bites Customer" until told otherwise.
    if (user.fullName === 'Quick Bites Customer' && pending.body.fullName) {
      user = (await userRepository.update(user.id, { fullName: pending.body.fullName }))!;
    }
    user = (await grantRole(user.id, pending.role))!;
    if (pending.role === 'restaurant_owner') await openRestaurant(user, pending.body);
    else await openRiderRecord(user, pending.body);

    const words = ROLE_WORDS[pending.role];
    res.type('html').send(
      page(
        'Confirmed',
        `<h1>Confirmed &#10003;</h1>
<p>We added <strong>${escape(whatIsAdded(pending.role, pending.body))}</strong> to your Quick Bites account. What to do now:</p>
${steps([
  `Open the <strong>${escape(words.app)}</strong> app.`,
  'Tap <strong>Sign in</strong> (not Create account).',
  `Email: <strong>${escape(user.email)}</strong>. Password: the one you typed when you signed up.`,
  escape(words.after)
])}
<p style="color:#6b5d60">You can close this page.</p>`
      )
    );
  } catch (err) {
    next(err);
  }
});

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

// Email is optional so the apps already on phones (phone only) keep working.
const OtpRequestSchema = z.object({
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)
    .refine(isRealEmail, 'Enter a valid email address.').optional()
});

const OtpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code we sent you.'),
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
      const outcome = await otpService.request(req.body.phone, req.body.email);

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
      const outcome = await otpService.request(req.body.phone, req.body.email);
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
      // The address the code was emailed to: receiving it proves the customer holds it.
      const email = result.email;

      /*
       * A NEW number with the email of an existing account (owner, 17 Oct 2026):
       * a partner or rider typing their own mobile, not the one on the kitchen or
       * rider account. The code went to that account's own inbox, the proof every
       * sign-in here rests on, so it is that account. Its phone stays; this number
       * finds it again by email next time. Never with the shared test code or the
       * reviewer number (emailProven), where knowing an email would be enough.
       */
      if (!user && email && result.emailProven) {
        user = await userRepository.findByEmail(email);
      }

      /*
       * A restaurant owner or rider may also order food (owner, 17 Oct 2026):
       * the same account gains the customer role, and the session is
       * customer-only (generateToken scope). Proof is the code emailed to the
       * address ALREADY on their account (otpService), never a typed one or an
       * SMS to a number nobody verified. Operations accounts stay out.
       */
      if (user && !hasRole(user, 'customer')) {
        const partnerOrRider = rolesOf(user).every(r => r === 'restaurant_owner' || r === 'rider');
        if (!partnerOrRider || !email || !isRealEmail(user.email) || email !== user.email.toLowerCase()) {
          throw new AppError(
            partnerOrRider
              ? 'Sign in with the email address on your partner or rider account.'
              : 'This belongs to a Quick Bites staff account. Use a different number and email.',
            403,
            'STAFF_ACCOUNT'
          );
        }
        user = (await grantRole(user.id, 'customer'))!;
      }
      if (email) {
        const holder = await userRepository.findByEmail(email);
        if (holder && holder.id !== user?.id) {
          throw new AppError(
            hasRole(holder, 'customer')
              ? 'This email is already used by another Quick Bites account. Use a different email.'
              : 'This email belongs to a partner or rider account. Sign in with the mobile number on that account.',
            409,
            'EMAIL_IN_USE'
          );
        }
      }

      if (!user) {
        assertNotBanned({ phone, email });
        // First sign-in. The role is assigned here and never read from the
        // request: phone sign-in mints customers and nothing else, so it can
        // never become a route to a staff account.
        user = await userRepository.create({
          id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          // Kept for staff tooling that still indexes by address. It is not a
          // login credential for this account: there is no password to use with it.
          email: email || `${phone}@phone.quickbite.app`,
          fullName: fullName || 'Quick Bites Customer',
          phone,
          role: 'customer' as UserRole,
          isGold: false,
          preferredLanguage: 'en'
        });
        created = true;
      } else if (email && !isRealEmail(user.email)) {
        // seniordev: an account made by phone code before 11 Oct has no address,
        // so the first email sign-in claims it. Those accounts were only ever
        // protected by the shared test code; anything newer has an address and
        // gets its code there.
        user = (await userRepository.update(user.id, { email })) || user;
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
            role: 'customer',
            isGold: user.isGold,
            avatarUrl: user.avatarUrl,
            favouriteRestaurantIds: user.favouriteRestaurantIds || [],
            // So the app asks a phone-only customer for a code, not a password.
            hasPassword: Boolean((user as any).passwordHash)
          },
          token: generateToken(user, 'customer', 'customer')
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

      // The token version goes up, so every other device signed in to this
      // account is signed out (and its live connection closed). This device
      // keeps working: all four apps store `data.token` below (U2).
      await userRepository.update(user.id, {
        passwordHash: await bcrypt.hash(req.body.newPassword, 10),
        tokenVersion: (Number((user as any).tokenVersion) || 0) + 1
      } as any);

      // A fresh token for THIS device: the change retired every older one.
      const refreshed = await userRepository.findById(user.id);
      res.json({
        success: true,
        data: { changed: true, token: refreshed ? generateToken(refreshed) : undefined },
        message: 'Your password has been changed.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/*
 * Forgot password (master plan B6, 18 Oct 2026): a 6-digit code to the account's
 * email, then a new password. For accounts that have a password (partners,
 * riders, staff); a customer-only account signs in with a phone code instead.
 *
 * The reply to "send me a code" is the same whether or not the email has an
 * account (review D8), so the form cannot be used to find out who is a partner.
 * The code is stored only as a hash on the user record, lasts 10 minutes, allows
 * 5 tries, and one email a minute. Setting the new password signs out every
 * other device, as change-password does.
 */
const RESET_TTL_MS = 10 * 60_000;
const RESET_TRIES = 5;
const resetHash = (userId: string, code: string) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
const FORGOT_REPLY = 'If that email has a Quick Bites password, a 6-digit code is on its way. It works for 10 minutes. Check spam too.';
const BAD_RESET = () => new AppError('That code is not right, or it has expired. Ask for a new one.', 400, 'INVALID_RESET_CODE');

const ForgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.') });
const ResetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
  newPassword: z.string().min(8, 'Choose a password of at least 8 characters.').max(128)
});

/** The accounts this flow is for: has a password, and is not the super admin re-applied from ADMIN_EMAIL at every boot. */
function resettable(user: any): boolean {
  if (!user?.passwordHash || user.isBlocked) return false;
  return !(config.ADMIN_EMAIL && user.email?.toLowerCase() === config.ADMIN_EMAIL.toLowerCase());
}

/** POST /api/auth/password/forgot — emails a reset code; same answer for every email. */
authRouter.post('/password/forgot', authRateLimiterMiddleware, validate({ body: ForgotPasswordSchema }), async (req, res, next) => {
  try {
    const user: any = await userRepository.findByEmail(req.body.email);
    const now = Date.now();
    const recent = user?.passwordReset && now - Date.parse(user.passwordReset.sentAt) < 60_000;
    if (resettable(user) && !recent) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await userRepository.update(user.id, {
        passwordReset: {
          codeHash: resetHash(user.id, code),
          sentAt: new Date(now).toISOString(),
          expiresAt: new Date(now + RESET_TTL_MS).toISOString(),
          triesLeft: RESET_TRIES
        }
      } as any);
      await persistDurably();
      const text = `Your Quick Bites password reset code is ${code}. It works for 10 minutes. If you did not ask for it, ignore this email: your password has not changed.`;
      const sent = await sendEmail(user.email, 'Your Quick Bites password reset code', text, `<p>${text}</p>`);
      // Off production the logged code stands in for the email (QA server), as for confirm links.
      if (config.NODE_ENV !== 'production') console.log(JSON.stringify({ level: 'INFO', event: 'PASSWORD_RESET_CODE', email: user.email, code }));
      if (!sent.accepted && config.NODE_ENV === 'production') {
        console.error(JSON.stringify({ level: 'ERROR', event: 'PASSWORD_RESET_EMAIL_FAILED', userId: user.id, error: sent.error }));
      }
    }
    res.json({ success: true, data: { sent: true }, message: FORGOT_REPLY });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/password/reset — the code from the email and a new password. */
authRouter.post('/password/reset', authRateLimiterMiddleware, validate({ body: ResetPasswordSchema }), async (req, res, next) => {
  try {
    const user: any = await userRepository.findByEmail(req.body.email);
    const pending = user?.passwordReset;
    if (!resettable(user) || !pending) throw BAD_RESET();
    if (Date.now() > Date.parse(pending.expiresAt) || !(pending.triesLeft > 0)) {
      await userRepository.update(user.id, { passwordReset: undefined } as any);
      throw BAD_RESET();
    }
    const given = Buffer.from(resetHash(user.id, req.body.code));
    const expected = Buffer.from(pending.codeHash);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      const triesLeft = pending.triesLeft - 1;
      await userRepository.update(user.id, { passwordReset: triesLeft > 0 ? { ...pending, triesLeft } : undefined } as any);
      await persistDurably();
      throw BAD_RESET();
    }
    await userRepository.update(user.id, {
      passwordHash: await bcrypt.hash(req.body.newPassword, 10),
      tokenVersion: (Number(user.tokenVersion) || 0) + 1,
      passwordReset: undefined
    } as any);
    await persistDurably();
    res.json({ success: true, data: { reset: true }, message: 'Your password has been changed. Sign in with the new one.' });
  } catch (err) {
    next(err);
  }
});

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
