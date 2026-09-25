/**
 * A money route answers only once what it wrote is in the database (N19).
 *
 * Everything else on the platform is saved by a debounced flush up to two
 * seconds after the request answers. For an order status that is fine; for a
 * payment captured, a refund sent or a payout marked paid it is not: the app
 * is told "done", the process restarts inside the window, and the record is
 * gone while the money is not.
 *
 * Wraps `res.json` for writes (never GETs, which change nothing, and never the
 * high-frequency rider pings, which are not mounted behind this). If the save
 * fails, the caller is told it was NOT saved, with a 503, instead of success.
 */
import type { Request, Response, NextFunction } from 'express';
import { persistDurably } from '../db/client.ts';

export function durable(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const send = res.json.bind(res);
  (res as any).json = (body: unknown) => {
    persistDurably()
      .then(() => send(body))
      .catch(err => {
        console.error(
          JSON.stringify({
            level: 'ERROR',
            event: 'MONEY_WRITE_NOT_PERSISTED',
            path: req.originalUrl,
            method: req.method,
            message: (err as Error)?.message
          })
        );
        if (!res.headersSent) res.status(503);
        send({
          success: false,
          error: {
            code: 'NOT_SAVED',
            message:
              'This could not be saved just now. Check whether it went through before trying again.'
          }
        });
      });
    return res;
  };
  next();
}
