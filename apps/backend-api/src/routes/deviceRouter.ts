import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { deviceTokenRepository } from '../db/repositories/deviceTokenRepository.ts';
import { pushIsConfigured } from '../notifications/fcmTransport.ts';
import type { DevicePlatform, UserRole } from '@quick-bites/shared-types';

/**
 * Where each app tells the platform how to reach it.
 *
 * All four apps call this on launch and after every sign-in, because a push
 * token is not stable: the service rotates it, a reinstall changes it, and
 * clearing app data loses it. Registering only once, at sign-up, is how a
 * platform ends up holding a table of tokens that stopped working months ago.
 */
export const deviceRouter = Router();

const RegisterSchema = z.object({
  token: z.string().trim().min(10, 'That is not a push token.').max(4096),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  /** Distinguishes two installs by the same person on two devices. */
  deviceId: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(40).optional()
});

/**
 * POST /api/devices
 *
 * Idempotent on the token, so calling it on every launch refreshes one row
 * rather than adding another. Without that, one phone collects a row per
 * launch and every notification is delivered to it a dozen times.
 */
deviceRouter.post('/', authMiddleware(), validate({ body: RegisterSchema }), async (req, res, next) => {
  try {
    const device = await deviceTokenRepository.register({
      userId: req.user!.id,
      // The role is recorded from the SESSION, never from the request. An app
      // that could name its own role could register itself as a rider and
      // receive other people's delivery offers.
      role: req.user!.role as UserRole,
      token: req.body.token,
      platform: req.body.platform as DevicePlatform,
      deviceId: req.body.deviceId,
      appVersion: req.body.appVersion
    });

    res.status(201).json({
      success: true,
      data: {
        device: { id: device.id, platform: device.platform, lastSeenAt: device.lastSeenAt },
        /*
         * Said plainly, because it is the difference between "we will notify
         * you" and "we have written it down". A deployment with no Firebase
         * credential still accepts registrations and still logs every
         * notification; it just cannot deliver one, and an app that knows that
         * can say so instead of promising something that will not happen.
         */
        deliveryConfigured: pushIsConfigured()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/devices/:token
 *
 * Called on sign-out. A shared kitchen phone changes hands between shifts, and
 * the previous partner must stop receiving that restaurant's orders the moment
 * they sign out — not whenever the token next happens to fail.
 */
deviceRouter.delete('/:token', authMiddleware(), async (req, res, next) => {
  try {
    // Scoped to the caller, so one person cannot unregister another's device
    // by guessing a token.
    const removed = await deviceTokenRepository.remove(req.user!.id, req.params.token);
    res.json({ success: true, data: { removed } });
  } catch (err) {
    next(err);
  }
});
