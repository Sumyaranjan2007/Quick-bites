import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
  
  // Structured JSON Log in compliance with Rule 12 & OBSERVABILITY.md
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    requestId: req.correlationId,
    userId: req.user?.id || null,
    path: req.originalUrl,
    method: req.method,
    statusCode,
    errorCode,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  }));

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: statusCode === 500 && process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Our team has been alerted.'
        : err.message || 'Internal Server Error',
      details: err.details || null
    },
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId
    }
  });
}
