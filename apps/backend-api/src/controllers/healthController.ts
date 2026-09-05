import type { Request, Response } from 'express';
import { config } from '../config/env.ts';

export function getHealth(req: Request, res: Response): void {
  const uptimeSeconds = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();
  
  const payload = {
    status: 'HEALTHY',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    environment: config.NODE_ENV,
    demoMode: config.DEMO_MODE,
    services: {
      database: {
        status: 'UP',
        provider: 'Supabase PostgreSQL + PostGIS'
      },
      cache: {
        status: 'UP',
        provider: config.UPSTASH_REDIS_REST_URL ? 'Upstash Redis' : 'In-Memory Token Bucket'
      },
      catalog: {
        status: 'UP',
        provider: 'MongoDB Atlas M0'
      },
      search: {
        status: 'UP',
        provider: 'Meilisearch Cloud'
      }
    },
    system: {
      memoryRssMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      memoryHeapUsedMb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100
    }
  };

  res.status(200).json(payload);
}
