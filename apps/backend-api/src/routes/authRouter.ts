import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { userRepository, grantRole, hasRole } from '../db/repositories/userRepository.ts';
import { memoryStore, triggerAutoSave } from '../db/client.ts';
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
import { maskPhone } from '../modules/auth/otpDrivers.ts';
import type { UserRole } from '@quick-bites/shared-types';
import { UNSET_COORDINATES } from '../modules/restaurants/restaurantLocation.ts';
import { notifyAdminsNewSignup } from '../notifications/adminNotifier.ts';

export const authRouter = Router();

export function generateToken(user: any): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
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
authRouter.post('/register', authRateLimiterMiddleware, requireFeature('registrations'), validate({ body: RegisterSchema }), async (req, res) => {
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
  serviceRadiusKm: z.number().min(1).max(25).optional(),
  isPureVeg: z.boolean().optional()
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
 * Two outcomes, and the caller must handle both:
 *   { kind: 'NEW' }             nobody holds this identity; create an account
 *   { kind: 'EXISTING', user }  proven theirs; grant the role instead
 * Anything else throws.
 */
type IdentityCheck =
  | { kind: 'NEW' }
  | { kind: 'EXISTING'; user: NonNullable<Awaited<ReturnType<typeof userRepository.findByPhone>>> };

async function resolveIdentity(
  email: string,
  phone: string,
  password: string,
  role: UserRole
): Promise<IdentityCheck> {
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
  if (byEmail && (!byPhone || byPhone.id !== byEmail.id)) {
    throw new AppError(
      'This email address already has a Quick Bites account, registered to a different mobile number. Sign in to add this to it, or register with a different address.',
      409,
      'EMAIL_IN_USE'
    );
  }

  const existing = byPhone || byEmail!;

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
  if (hasRole(existing, role)) {
    /*
     * A sentence per role. This was a two-branch ternary on `role === 'rider'`,
     * which was fine while only two routes called it — and told a customer
     * registering a second time that they already had a restaurant.
     */
    const alreadyHave: Record<string, string> = {
      rider: 'You are already registered as a delivery partner. Sign in to the delivery app instead.',
      restaurant_owner: 'You already have a restaurant on Quick Bites. Sign in to the partner app instead.',
      customer: 'You already have a Quick Bites account. Sign in instead.'
    };
    throw new AppError(
      alreadyHave[role] ?? 'You already have this on your Quick Bites account. Sign in instead.',
      409,
      'ROLE_ALREADY_HELD'
    );
  }

  return { kind: 'EXISTING', user: existing };
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
      const { phone, fullName, password, restaurantName } = req.body;
      const identity = await resolveIdentity(email, phone, password, 'restaurant_owner' as UserRole);

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
          latitude: req.body.latitude ?? UNSET_COORDINATES.latitude,
          longitude: req.body.longitude ?? UNSET_COORDINATES.longitude
        },
        // Absent is meaningful: the listing falls back to the platform default
        // rather than storing a number nobody chose.
        ...(req.body.serviceRadiusKm ? { serviceRadiusKm: req.body.serviceRadiusKm } : {}),
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
  requireFeature('registrations'),
  validate({ body: RiderRegistrationSchema }),
  async (req, res, next) => {
    try {
      const email = String(req.body.email).trim().toLowerCase();
      const { phone, fullName, password, vehicleType, licenseNumber } = req.body;
      const identity = await resolveIdentity(email, phone, password, 'rider' as UserRole);

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

      // Same silence as a partner signing up. A rider cannot earn until they are
      // approved, so nobody knowing they are there is a rider who gives up.
      void notifyAdminsNewSignup({
        entityId: rider.id,
        entityName: rider.fullName || 'A new rider',
        kind: 'RIDER'
      });

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

      // The token version is NOT bumped here yet: the shipped apps do not store
      // a replacement token, so bumping would sign the person out of the very
      // device they changed it on. An administrator's reset (the lost-phone
      // case) does bump it. Once the apps save `data.token` below, bump here too.
      await userRepository.update(user.id, { passwordHash: await bcrypt.hash(req.body.newPassword, 10) });

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
