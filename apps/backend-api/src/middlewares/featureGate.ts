/**
 * Route-level kill switch.
 *
 * Kept apart from `featureFlags.ts` so that the flag module stays free of
 * Express: it is called from services and from the sweeper as well as from
 * routes, and a domain module that imports a web framework cannot be tested
 * without one.
 */
import type { Request, Response, NextFunction } from 'express';
import { assertEnabled } from '../modules/platform/featureFlags.ts';

export function requireFeature(key: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertEnabled(key);
      next();
    } catch (error) {
      // Handed to the error middleware rather than answered here, so a disabled
      // feature produces the same envelope as every other refusal and the apps
      // need no special case for it.
      next(error);
    }
  };
}
