import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export interface ValidationTarget {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidationTarget) {
  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request payload validation failed.',
            details: error.errors.map(err => ({
              field: err.path.join('.'),
              issue: err.message
            }))
          },
          meta: {
            timestamp: new Date().toISOString(),
            correlationId: req.correlationId
          }
        });
        return;
      }
      next(error);
    }
  };
  /*
   * The body schema, readable from the mounted route. The body contract check
   * (test/bodyContract.test.ts) compares every body the phone apps send with
   * the schema the route actually enforces, which is only exact if it reads the
   * real schema object rather than re-parsing the source.
   */
  (middleware as any).bodySchema = schemas.body;
  return middleware;
}
