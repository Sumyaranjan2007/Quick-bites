import type { Request, Response } from 'express';
import { config } from '../config/env.ts';
import { placesStatus } from '../modules/places/placesService.ts';
import { routingStatus } from '../modules/places/routingService.ts';
import { pushIsConfigured } from '../notifications/fcmTransport.ts';

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
      },
      /**
       * Whether this deployment can answer questions about places.
       *
       * Both of these were written to be reported here and never connected, so
       * the only way to find out whether MAPBOX_ACCESS_TOKEN had actually
       * reached the deployment was to sign in as a customer and watch an
       * address search come back empty — which looks identical to a street
       * that does not exist.
       *
       * `configured` is a boolean and the breaker snapshots carry counts and
       * states. No key material passes through either, which the routing suite
       * asserts rather than assumes.
       */
      addressLookup: placesStatus(),
      roadDistance: routingStatus(),
      /**
       * Whether this deployment can actually deliver a push notification.
       *
       * Same reasoning as the two above, and the same failure it prevents. A
       * notification that goes nowhere is logged as dispatched and looks
       * identical to one that arrived - so without this, the only way to find
       * out whether FCM_SERVICE_ACCOUNT_JSON had reached the deployment was to
       * install an app on a phone, place an order, and wait for a notification
       * that might never have been possible.
       *
       * `configured` is a boolean. No part of the service account, including
       * the project id, passes through here: a credential's contents do not
       * belong on an endpoint that answers without authentication.
       */
      pushNotifications: { configured: pushIsConfigured() }
    },
    system: {
      memoryRssMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
      memoryHeapUsedMb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100
    }
  };

  res.status(200).json(payload);
}
