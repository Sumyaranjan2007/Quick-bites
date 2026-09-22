/**
 * Which rider bonuses the platform actually pays, and how much.
 *
 * -------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * -------------------------------------------------------------------------
 * The owner said: *"I wear the bonus at automatically — I sometimes give bonus
 * of 700 to the rider. I don't want to do that. I am not understanding the
 * finance of that part."*
 *
 * They were right to be alarmed. Five bonuses were hardcoded into
 * `modules/riders/riderMetrics.ts` — ₹120, ₹100, ₹300, **₹700** and ₹250 — and
 * awarded automatically on trip counts and ratings. Nobody approved them,
 * nothing surfaced them before they were paid, and changing one meant a deploy.
 * A platform that pays out money its owner cannot find the source of is not a
 * platform its owner controls.
 *
 * -------------------------------------------------------------------------
 * THEY ARE OFF UNTIL SOMEBODY TURNS THEM ON
 * -------------------------------------------------------------------------
 * Every bonus defaults to **disabled**. That is the whole point of the change:
 * the safe default for automatically giving away money is not to. An owner who
 * wants a dinner-rush bonus can switch it on and set what it is worth; an owner
 * who does not is no longer paying one by accident.
 *
 * Defaulting them ON with the old amounts would have preserved the behaviour at
 * the cost of preserving the complaint.
 *
 * -------------------------------------------------------------------------
 * AND NOTHING ALREADY EARNED IS TAKEN BACK
 * -------------------------------------------------------------------------
 * Turning a bonus off stops it being awarded from now on. A rider who already
 * hit a target has been paid, and that payment is in the ledger, which does not
 * forget. Clawing it back because the owner later changed the rules would be
 * the platform reaching into somebody's earnings for its own mistake.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { AppError } from '../../utils/AppError.ts';

export interface IncentiveSetting {
  /** Matches the rule code in `riderMetrics.ts`. */
  code: string;
  enabled: boolean;
  /** Rupees paid when the target is met. */
  reward: number;
  /** Trips, or a rating, depending on the rule. */
  target: number;
}

const KEY = 'incentives:config';

/**
 * The shipped defaults: every bonus OFF, at the amount it used to pay.
 *
 * The old amounts are kept as the starting values rather than zeroed, so an
 * owner switching one on gets a sensible figure rather than a blank — but
 * nothing pays until they do.
 */
const DEFAULTS: IncentiveSetting[] = [
  { code: 'DAILY_8', enabled: false, reward: 120, target: 8 },
  { code: 'PEAK_5', enabled: false, reward: 100, target: 5 },
  { code: 'WEEK_20', enabled: false, reward: 300, target: 20 },
  { code: 'WEEK_40', enabled: false, reward: 700, target: 40 },
  { code: 'WEEK_RATING', enabled: false, reward: 250, target: 4.7 }
];

export function incentiveSettings(): IncentiveSetting[] {
  const stored = memoryStore.settings.get(KEY);
  const saved: IncentiveSetting[] = Array.isArray(stored?.rules) ? stored.rules : [];

  // Merged rather than replaced, so a rule added in a later release appears
  // (disabled) instead of silently not existing for anybody who has ever saved
  // this screen.
  return DEFAULTS.map(def => {
    const found = saved.find(s => s.code === def.code);
    return found ? { ...def, ...found, code: def.code } : def;
  });
}

/** What one rule is worth right now, or `null` when it is switched off. */
export function settingFor(code: string): IncentiveSetting | null {
  const setting = incentiveSettings().find(s => s.code === code);
  return setting && setting.enabled ? setting : null;
}

export function setIncentiveSettings(
  changes: Array<Partial<IncentiveSetting> & { code: string }>,
  actorUserId: string
): IncentiveSetting[] {
  const current = incentiveSettings();

  for (const change of changes) {
    const existing = current.find(s => s.code === change.code);
    if (!existing) throw new AppError(`There is no bonus called ${change.code}.`, 400, 'UNKNOWN_INCENTIVE');

    if (change.reward !== undefined) {
      if (!Number.isFinite(change.reward) || change.reward < 0 || change.reward > 5000) {
        throw new AppError('A bonus must be between Rs 0 and Rs 5,000.', 400, 'REWARD_OUT_OF_RANGE');
      }
      existing.reward = change.reward;
    }
    if (change.target !== undefined) {
      if (!Number.isFinite(change.target) || change.target <= 0 || change.target > 500) {
        throw new AppError('A target must be between 1 and 500.', 400, 'TARGET_OUT_OF_RANGE');
      }
      existing.target = change.target;
    }
    if (change.enabled !== undefined) existing.enabled = Boolean(change.enabled);
  }

  memoryStore.settings.set(KEY, { rules: current, updatedAt: new Date().toISOString(), actorUserId });
  triggerAutoSave();

  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'RIDER_INCENTIVES_CONFIGURED',
      actorUserId,
      enabled: current.filter(s => s.enabled).map(s => `${s.code}@${s.reward}`)
    })
  );

  return current;
}

export function resetIncentiveConfigForTesting(): void {
  memoryStore.settings.delete(KEY);
}
