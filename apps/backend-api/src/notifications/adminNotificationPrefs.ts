/**
 * Which kinds of admin notification are switched on.
 *
 * -------------------------------------------------------------------------
 * DEFAULT ON, AND THAT IS NOT THE CAUTIOUS CHOICE
 * -------------------------------------------------------------------------
 * The owner asked to receive everything, in those words, because they are the
 * one solving the problems. So every category starts ON and a missing preference
 * means ON — a category added later is delivered before anybody has heard of it,
 * rather than silently muted until somebody finds the screen.
 *
 * That is the opposite of the usual default for notifications, and it is right
 * here for a reason that is specific to this platform: nobody else is watching.
 * A muted category on a food platform with one operator is a problem that reaches
 * a customer before it reaches a person.
 *
 * -------------------------------------------------------------------------
 * TWO THINGS CANNOT BE SWITCHED OFF
 * -------------------------------------------------------------------------
 * A rider pressing SOS, and an order no rider has taken.
 *
 * The first is the only notification on the platform where the phone should ring
 * at 3am, and a screen that can silence it is a screen somebody will silence on a
 * quiet Tuesday and not think about again.
 *
 * The second is the one that costs a customer their dinner. Nothing else notices
 * an order that no rider ever picked up — the food sits on the pass and the
 * customer watches a map that never moves.
 *
 * Held as a set of EVENT TYPES rather than as a property of a category, because
 * NO_RIDER_FOUND lives in the same category as five events that are perfectly
 * reasonable to mute. A per-category rule would have forced either muting it with
 * them or giving it a category of its own that explains nothing.
 */
import { memoryStore, triggerAutoSave } from '../db/client.ts';

export type AdminNotificationCategory =
  | 'SAFETY'
  | 'DISPATCH'
  | 'MONEY'
  | 'APPROVALS'
  | 'CUSTOMER_CARE'
  | 'DIGEST';

export interface CategoryDescriptor {
  key: AdminNotificationCategory;
  /** What the settings screen calls it. */
  label: string;
  /** What the person switching it off is giving up. */
  description: string;
  /**
   * True when something in this category ignores the switch.
   *
   * Said on the screen rather than discovered afterwards. A switch that appears
   * to work and does not is worse than a switch that says what it cannot do.
   */
  hasAlwaysOn: boolean;
  alwaysOnNote?: string;
}

/**
 * The event types that ignore the switch entirely.
 *
 * Typed loosely as strings because the notifier's own `type` fields are strings;
 * a check asserts every name here is an event the notifier actually sends, so a
 * typo cannot quietly make something switchable again.
 */
export const ALWAYS_ON_EVENTS: ReadonlySet<string> = new Set([
  'ADMIN_SOS_RAISED',
  'ADMIN_NO_RIDER_FOUND'
]);

export const NOTIFICATION_CATEGORIES: readonly CategoryDescriptor[] = [
  {
    key: 'SAFETY',
    label: 'Rider safety',
    description: 'A rider has pressed the emergency button.',
    hasAlwaysOn: true,
    alwaysOnNote: 'This one cannot be switched off.'
  },
  {
    key: 'DISPATCH',
    label: 'Deliveries going wrong',
    description:
      'Nobody has taken an order, a rider has gone quiet while carrying food, a delivery is overdue, ' +
      'a rider never turned up at the kitchen.',
    hasAlwaysOn: true,
    alwaysOnNote: 'An order no rider has taken always comes through, even with this off.'
  },
  {
    key: 'MONEY',
    label: 'Money',
    description:
      'A payout that failed, cash a rider has declared, a payment recovered, and anything wrong with ' +
      'the books.',
    hasAlwaysOn: false
  },
  {
    key: 'APPROVALS',
    label: 'Waiting for you',
    description: 'Bank accounts, ID documents, menu changes and profile edits somebody has submitted.',
    hasAlwaysOn: false
  },
  {
    key: 'CUSTOMER_CARE',
    label: 'Customers',
    description: 'Refund requests and support tickets.',
    hasAlwaysOn: false
  },
  {
    key: 'DIGEST',
    label: 'Twice-daily summary',
    description: 'How the day is going: orders placed, delivered and cancelled, and new sign-ups.',
    hasAlwaysOn: false
  }
];

const VALID = new Set<string>(NOTIFICATION_CATEGORIES.map(c => c.key));

function keyFor(category: AdminNotificationCategory): string {
  return `admin_notify:${category}`;
}

/**
 * Whether this category is switched on.
 *
 * ABSENT MEANS ON. Reading a missing value as off would mute every category on a
 * fresh deployment and on every category added afterwards, which is the exact
 * failure this platform cannot afford: silence that looks like nothing happening.
 */
export function isCategoryEnabled(category: AdminNotificationCategory): boolean {
  const stored = memoryStore.settings.get(keyFor(category));
  if (stored === undefined || stored === null) return true;
  return stored?.enabled !== false;
}

/** Whether this event may be suppressed at all. */
export function canSwitchOff(eventType: string): boolean {
  return !ALWAYS_ON_EVENTS.has(eventType);
}

/**
 * Whether this event should be sent.
 *
 * The one question the notifier asks. Both halves are here rather than at the
 * call site so that an event which ignores the switch cannot be made switchable
 * by somebody forgetting a condition.
 */
export function shouldSend(eventType: string, category: AdminNotificationCategory): boolean {
  if (!canSwitchOff(eventType)) return true;
  return isCategoryEnabled(category);
}

export function setCategoryEnabled(
  category: AdminNotificationCategory,
  enabled: boolean,
  actorUserId: string
): void {
  if (!VALID.has(category)) {
    throw new Error(`Unknown notification category: ${category}`);
  }
  memoryStore.settings.set(keyFor(category), {
    enabled,
    changedAt: new Date().toISOString(),
    changedByUserId: actorUserId
  });

  /*
   * SAVED HERE, not left to the caller.
   *
   * This survived a restart only because the route that sets it happens to write an
   * audit row immediately afterwards, and THAT triggers a save of the whole store.
   * It worked for a reason with nothing to do with this code — so a second caller
   * without an audit write, or an audit write that moved, would have silently
   * un-muted a category on the next deploy.
   */
  triggerAutoSave();
}

/** Every category with its current state, for the settings screen. */
export function allCategoryPreferences(): Array<
  CategoryDescriptor & { enabled: boolean; changedAt?: string }
> {
  return NOTIFICATION_CATEGORIES.map(descriptor => {
    const stored = memoryStore.settings.get(keyFor(descriptor.key));
    return {
      ...descriptor,
      enabled: isCategoryEnabled(descriptor.key),
      ...(stored?.changedAt ? { changedAt: stored.changedAt } : {})
    };
  });
}

/** Only used by tests, which need a clean slate. */
export function resetNotificationPrefsForTesting(): void {
  for (const descriptor of NOTIFICATION_CATEGORIES) {
    memoryStore.settings.delete(keyFor(descriptor.key));
  }
}
