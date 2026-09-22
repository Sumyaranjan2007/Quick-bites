import { memoryStore } from './client.ts';

/*
 * ---------------------------------------------------------------------------
 * BRINGING A PERSISTED STORE UP TO WHAT THIS BUILD UNDERSTANDS.
 * ---------------------------------------------------------------------------
 *
 * Orders written by an older build carry values this build has removed. They
 * do not fail loudly: a status no longer in VALID_TRANSITIONS produces an
 * `undefined` transition list, so every action on that order is refused with
 * "invalid transition" and the order is stuck forever, with food in a bag and
 * a customer watching a screen that never changes. Nothing throws. Nothing is
 * logged. The order simply stops.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A FEW LINES IN THE JSON LOADER.
 *
 * There are two ways a store is hydrated, and they share no code:
 *
 *   client.ts        loadStoreFromFile      the JSON snapshot, local
 *   postgresStore.ts loadStoreFromDatabase  the hosted deployment
 *
 * Local development, every test and every gate run go through the first one.
 * Production goes through the second. A migration written inside the JSON
 * loader passes everything we can run and does nothing at all where it is
 * needed - a green build that breaks every in-flight order on deploy. Putting
 * it in one exported function that both loaders call is what makes a third
 * loader, added later by someone who has not read this, fail visibly.
 *
 * Idempotent by construction: every rule rewrites a value this build no longer
 * accepts into one it does, so running it twice changes nothing the second
 * time. Safe at boot, safe to run again.
 */

/**
 * `RIDER_ASSIGNED` was a food status, which was the original mistake.
 *
 * Assigning a rider was modelled as a stage of the FOOD, so the moment a rider
 * accepted, the kitchen's remaining steps became unreachable: the only
 * transitions out of it were OUT_FOR_DELIVERY and CANCELLED. The kitchen could
 * not mark anything ready, and pickup was then correctly refused because the
 * food had never legitimately passed "prepared".
 *
 * The replacement is READY_FOR_PICKUP rather than PREPARING, and the choice
 * matters. Both are plausible, but only one is safe to be wrong about. An
 * order restored as READY_FOR_PICKUP that the kitchen has not finished can be
 * seen and corrected, and collection is still gated on the handover.
 * Restoring to PREPARING food that IS ready sends a rider away from a bag
 * sitting on the counter. Where the two disagree, err toward the state a human
 * can see and fix.
 *
 * `riderId` and `riderStage` are deliberately left alone. The rider is still
 * on this trip; it is only the FOOD's status that was wrong.
 */
const ORDER_STATUS_REWRITES: Record<string, string> = {
  RIDER_ASSIGNED: 'READY_FOR_PICKUP'
};

/**
 * The rider's own track called collection `OUT_FOR_DELIVERY`, borrowing the
 * food status's name for a different thing. Now that the two tracks are
 * genuinely separate, the rider's stage says what the RIDER did - they picked
 * it up - and the food's status says where the FOOD is.
 */
const RIDER_STAGE_REWRITES: Record<string, string> = {
  OUT_FOR_DELIVERY: 'PICKED_UP'
};

function log(event: string, detail: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), event, ...detail }));
}

export interface NormaliseResult {
  ordersScanned: number;
  statusesRewritten: number;
  riderStagesRewritten: number;
}

/**
 * Rewrites persisted values this build no longer accepts. Call after hydrating
 * `memoryStore` and before serving anything.
 */
export function normaliseLoadedStore(): NormaliseResult {
  const result: NormaliseResult = { ordersScanned: 0, statusesRewritten: 0, riderStagesRewritten: 0 };

  for (const [id, order] of memoryStore.orders as Map<string, any>) {
    if (!order || typeof order !== 'object') continue;
    result.ordersScanned++;
    let changed = false;

    const nextStatus = ORDER_STATUS_REWRITES[order.status];
    if (nextStatus) {
      log('STORE_MIGRATED_ORDER_STATUS', { orderId: id, from: order.status, to: nextStatus });
      order.status = nextStatus;
      result.statusesRewritten++;
      changed = true;
    }

    const nextStage = RIDER_STAGE_REWRITES[order.riderStage];
    if (nextStage) {
      log('STORE_MIGRATED_RIDER_STAGE', { orderId: id, from: order.riderStage, to: nextStage });
      order.riderStage = nextStage;
      result.riderStagesRewritten++;
      changed = true;
    }

    if (changed) memoryStore.orders.set(id, order);
  }

  if (result.statusesRewritten || result.riderStagesRewritten) {
    log('STORE_MIGRATION_COMPLETE', { ...result });
  }

  return result;
}
