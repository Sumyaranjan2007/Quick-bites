/**
 * Switches an operator can throw without a deployment.
 *
 * The situation this exists for: the payment gateway is returning errors on
 * every third call at eight in the evening. The fix is to stop offering online
 * payment and let everyone pay cash for twenty minutes. Without a switch, that
 * fix is a code change, a build, a review and a deploy — call it forty minutes
 * on a good day, during which every affected customer has already left. With a
 * switch it is one toggle in the operations app.
 *
 * Three rules make the difference between a kill switch and a footgun:
 *
 * DECLARED, NOT FREE-FORM. The catalogue below is the whole set. An admin
 * cannot invent `disable_everythng` and wonder why it did nothing, and the
 * operations screen is generated from this list rather than written twice.
 *
 * SAFE BY DEFAULT. Every flag defaults to the value that keeps the platform
 * working. A store that fails to load, a fresh database, a restore from backup
 * — all of them come up serving customers, never come up switched off.
 *
 * SAYS WHAT IT DID. Turning something off returns 503 with the operator's own
 * sentence, not a generic error. The customer is told "card payments are
 * paused, please pay cash", which is a thing they can act on.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';

export interface FeatureFlagDefinition {
  key: string;
  label: string;
  /** What actually stops working when this is switched off. */
  description: string;
  /**
   * The sentence shown to whoever is blocked by it. Kept with the definition so
   * that a flag cannot be added without somebody deciding what the affected
   * person is told.
   */
  blockedMessage: string;
  /** Always the value that keeps the platform running. */
  defaultEnabled: boolean;
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'ordering',
    label: 'Accept new orders',
    description:
      'The master switch. Off, checkout is refused platform-wide; orders already placed continue ' +
      'through cooking and delivery untouched.',
    blockedMessage: 'We have paused new orders for a few minutes. Existing orders are unaffected.',
    defaultEnabled: true
  },
  {
    key: 'online_payments',
    label: 'Online payment',
    description:
      'Card, UPI and netbanking through the payment gateway. Turn off when the gateway is failing, ' +
      'so customers are offered cash on delivery instead of a spinner.',
    blockedMessage: 'Online payment is temporarily unavailable. Please choose cash on delivery.',
    defaultEnabled: true
  },
  {
    key: 'cash_on_delivery',
    label: 'Cash on delivery',
    description: 'Off during a festival surge, or in a period when riders should not be carrying cash.',
    blockedMessage: 'Cash on delivery is not available right now. Please pay online.',
    defaultEnabled: true
  },
  {
    key: 'coupons',
    label: 'Coupon codes',
    description:
      'Off the moment a code leaks or is being farmed. Faster than deactivating codes one by one, ' +
      'and it does not need you to know which code is the problem yet.',
    blockedMessage: 'Coupons are paused at the moment. Your order can still be placed without one.',
    defaultEnabled: true
  },
  {
    key: 'registrations',
    label: 'New sign-ups',
    description:
      'Customer, restaurant and rider registration. Off during a scripted sign-up attack. Existing ' +
      'accounts sign in normally.',
    blockedMessage: 'New sign-ups are paused for a short while. Please try again a little later.',
    defaultEnabled: true
  },
  {
    key: 'rider_broadcast',
    label: 'Offer orders to riders',
    description:
      'The broadcast that lets riders claim orders. Off, cooked orders stay visible to operations ' +
      'for manual assignment instead of going to the fleet.',
    blockedMessage: 'Order offers are paused. Operations are assigning deliveries manually.',
    defaultEnabled: true
  },
  {
    key: 'scheduled_reports',
    label: 'Background jobs',
    description:
      'The automatic sweeper that cancels orders no kitchen accepted and the payment reconciliation ' +
      'pass. Off only while investigating one of them.',
    blockedMessage: 'Background processing is paused.',
    defaultEnabled: true
  }
];

interface StoredFlag {
  enabled: boolean;
  updatedAt: string;
  updatedBy?: string;
  /** An operator's own note: "gateway 5xx, ticket 4412". */
  note?: string;
}

const storeKey = (key: string) => `flag:${key}`;

export function findFlagDefinition(key: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAGS.find(f => f.key === key);
}

/**
 * Whether a capability is on.
 *
 * Returns the default for anything it does not recognise or cannot read. A
 * lookup that throws would turn a typo in a call site into an outage, which is
 * the exact opposite of what a kill switch is for.
 */
export function isEnabled(key: string): boolean {
  const definition = findFlagDefinition(key);
  if (!definition) return true;
  const stored = memoryStore.settings.get(storeKey(key)) as StoredFlag | undefined;
  if (!stored || typeof stored.enabled !== 'boolean') return definition.defaultEnabled;
  return stored.enabled;
}

/** Throws a 503 carrying the operator's message when the capability is off. */
export function assertEnabled(key: string): void {
  if (isEnabled(key)) return;
  const definition = findFlagDefinition(key);
  throw new AppError(
    definition?.blockedMessage || 'This is temporarily unavailable.',
    503,
    `FEATURE_DISABLED_${key.toUpperCase()}`
  );
}

export function setFlag(key: string, enabled: boolean, updatedBy?: string, note?: string): StoredFlag {
  const definition = findFlagDefinition(key);
  if (!definition) {
    throw new AppError('That is not a switch this platform has.', 404, 'UNKNOWN_FEATURE_FLAG');
  }
  const record: StoredFlag = {
    enabled,
    updatedAt: new Date().toISOString(),
    updatedBy,
    note: note?.trim() || undefined
  };
  memoryStore.settings.set(storeKey(key), record);
  triggerAutoSave();

  // A switch thrown in an incident is something you want in the log beside the
  // errors it was thrown because of.
  console.log(JSON.stringify({
    level: 'WARN',
    timestamp: record.updatedAt,
    event: enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
    flag: key,
    updatedBy,
    note: record.note
  }));

  return record;
}

/** The catalogue with each flag's current state, for the operations screen. */
export function listFlags(): Array<FeatureFlagDefinition & StoredFlag> {
  return FEATURE_FLAGS.map(definition => {
    const stored = memoryStore.settings.get(storeKey(definition.key)) as StoredFlag | undefined;
    return {
      ...definition,
      enabled: stored && typeof stored.enabled === 'boolean' ? stored.enabled : definition.defaultEnabled,
      updatedAt: stored?.updatedAt || '',
      updatedBy: stored?.updatedBy,
      note: stored?.note
    };
  });
}
