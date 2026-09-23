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
      /*
       * WHAT IS ACTUALLY CONNECTED, not what somebody once planned to connect.
       *
       * These read 'Supabase PostgreSQL + PostGIS' and 'MongoDB Atlas M0' as
       * fixed strings, with status 'UP' regardless of whether anything was
       * reachable. They named products this deployment does not use: the store
       * is whatever DATABASE_URL points at, and MONGODB_URI is read by no code
       * outside the config file.
       *
       * That is not cosmetic. Reading these labels cost an afternoon - the
       * owner was told to copy Supabase and Mongo credentials into a new
       * deployment to fix a crash caused by a missing DATABASE_URL, because
       * the endpoint said those were the databases. An endpoint that names the
       * wrong dependency is worse than one that names none, because it is
       * believed.
       *
       * So each entry now reports whether its variable is set and says plainly
       * when a service is not in use. 'UP' is reserved for the store, which is
       * the one thing this process genuinely cannot run without - reaching
       * this code at all means it connected at boot.
       */
      database: {
        status: 'UP',
        provider: process.env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL)' : 'local JSON snapshot',
        durable: Boolean(process.env.DATABASE_URL)
      },
      cache: {
        status: 'UP',
        provider: config.UPSTASH_REDIS_REST_URL ? 'Upstash Redis' : 'In-Memory Token Bucket'
      },
      search: {
        configured: Boolean(config.MEILISEARCH_HOST && config.MEILISEARCH_API_KEY),
        provider:
          config.MEILISEARCH_HOST && config.MEILISEARCH_API_KEY
            ? 'Meilisearch'
            : 'built-in matching (no Meilisearch configured)'
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
