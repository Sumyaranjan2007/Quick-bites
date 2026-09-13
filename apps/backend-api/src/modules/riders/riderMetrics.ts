/**
 * Everything the rider app puts on a number: earnings, trips, acceptance rate,
 * ratings and incentive progress.
 *
 * These are derived from the orders the rider actually completed rather than
 * from counters the app keeps for itself. The rider app used to add up its own
 * trips and cash in local state, so the figures reset every time the app was
 * reopened and disagreed with the wallet the server was keeping.
 */
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { walletRepository } from '../../db/repositories/walletRepository.ts';
import type { DeliveryRider, Order } from '@quick-bites/shared-types';

/** Riders, restaurants and customers are all in India; days end at IST midnight. */
const IST_OFFSET_MINUTES = 330;

function toIst(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
}

/** UTC instant of the most recent IST midnight at or before `at`. */
export function startOfIstDay(at: Date = new Date()): Date {
  const ist = toIst(at);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightIst - IST_OFFSET_MINUTES * 60_000);
}

/** UTC instant of the Monday that starts the IST week containing `at`. */
export function startOfIstWeek(at: Date = new Date()): Date {
  const dayStart = startOfIstDay(at);
  const ist = toIst(dayStart);
  const dayOfWeek = (ist.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(dayStart.getTime() - dayOfWeek * 24 * 60 * 60_000);
}

/** `2026-09-14`, in IST, for keying a day's incentives. */
export function istDayKey(at: Date = new Date()): string {
  return toIst(at).toISOString().slice(0, 10);
}

export function istWeekKey(at: Date = new Date()): string {
  return `W${istDayKey(startOfIstWeek(at))}`;
}

const ACTIVE_TRIP_STATUSES = new Set(['RIDER_ASSIGNED', 'OUT_FOR_DELIVERY']);

function payoutOf(order: Order): number {
  return Number(order.riderPayout) || 0;
}

function codOf(order: Order): number {
  return order.paymentMethod === 'CASH_ON_DELIVERY' ? Number(order.bill?.totalAmount) || 0 : 0;
}

export interface TripSummary {
  orderId: string;
  orderNumber: string;
  restaurantName?: string;
  dropAddress?: string;
  deliveredAt?: string;
  payout: number;
  distanceKm?: number;
  paymentMode: string;
  cashCollected: number;
  rating?: number;
  ratingComment?: string;
}

export function summariseTrip(order: Order): TripSummary {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantName: order.restaurantName,
    dropAddress: order.deliveryAddressText,
    deliveredAt: order.deliveredAt,
    payout: payoutOf(order),
    distanceKm: order.distanceKm,
    paymentMode: order.paymentMethod === 'CASH_ON_DELIVERY' ? 'COD' : 'PREPAID',
    cashCollected: codOf(order),
    rating: order.riderRating,
    ratingComment: order.riderRatingComment || order.ratingComment
  };
}

export interface IncentiveProgress {
  code: string;
  title: string;
  description: string;
  /** What the rider has done so far, in the unit the target is measured in. */
  progress: number;
  target: number;
  unit: 'trips' | 'rating';
  reward: number;
  period: 'DAY' | 'WEEK';
  achieved: boolean;
  /** True once the reward has actually been credited to the rider's wallet. */
  paid: boolean;
  paidAt?: string;
}

interface IncentiveRule {
  code: string;
  title: string;
  description: string;
  period: 'DAY' | 'WEEK';
  unit: 'trips' | 'rating';
  target: number;
  reward: number;
  /** Riders only qualify for rating bonuses once they have enough rated trips. */
  minRatedTrips?: number;
  measure: (ctx: MeasureContext) => number;
}

interface MeasureContext {
  todayTrips: number;
  weekTrips: number;
  peakTripsToday: number;
  weekRatedTrips: number;
  weekAverageRating: number;
}

/**
 * The incentive ladder.
 *
 * Deliberately modest and legible: a rider should be able to see, at a glance,
 * how many more trips stand between them and the next payment.
 */
const INCENTIVE_RULES: IncentiveRule[] = [
  {
    code: 'DAILY_8',
    title: 'Daily Dash',
    description: 'Complete 8 deliveries between midnight and midnight.',
    period: 'DAY',
    unit: 'trips',
    target: 8,
    reward: 120,
    measure: c => c.todayTrips
  },
  {
    code: 'PEAK_5',
    title: 'Dinner Rush',
    description: 'Complete 5 deliveries during the 7pm–11pm dinner peak.',
    period: 'DAY',
    unit: 'trips',
    target: 5,
    reward: 100,
    measure: c => c.peakTripsToday
  },
  {
    code: 'WEEK_20',
    title: 'Steady Week',
    description: 'Complete 20 deliveries between Monday and Sunday.',
    period: 'WEEK',
    unit: 'trips',
    target: 20,
    reward: 300,
    measure: c => c.weekTrips
  },
  {
    code: 'WEEK_40',
    title: 'Full Week',
    description: 'Complete 40 deliveries between Monday and Sunday.',
    period: 'WEEK',
    unit: 'trips',
    target: 40,
    reward: 700,
    measure: c => c.weekTrips
  },
  {
    code: 'WEEK_RATING',
    title: 'Five Star Service',
    description: 'Hold a 4.7 rating or better across at least 10 rated trips this week.',
    period: 'WEEK',
    unit: 'rating',
    target: 4.7,
    reward: 250,
    minRatedTrips: 10,
    measure: c => c.weekAverageRating
  }
];

function incentiveKey(riderId: string, rule: IncentiveRule, now: Date): string {
  const period = rule.period === 'DAY' ? istDayKey(now) : istWeekKey(now);
  return `${riderId}:${rule.code}:${period}`;
}

export interface RiderMetrics {
  todayEarnings: number;
  todayTrips: number;
  todayCashCollected: number;
  weekEarnings: number;
  weekTrips: number;
  totalEarnings: number;
  totalTrips: number;
  acceptanceRate: number;
  offersReceived: number;
  offersAccepted: number;
  averageRating: number | null;
  ratedTripCount: number;
  incentivesEarned: number;
  onlineMinutesToday: number;
}

/**
 * Reads every trip this rider has carried and reduces it to the numbers the
 * dashboard shows. Called after every state change a rider can cause, which is
 * what keeps the dashboard current without the app having to guess.
 */
export async function computeRiderMetrics(rider: DeliveryRider, now: Date = new Date()): Promise<{
  metrics: RiderMetrics;
  delivered: Order[];
  activeOrder: Order | null;
}> {
  const orders = await orderRepository.listByRiderId(rider.id);
  const delivered = orders.filter(o => o.status === 'DELIVERED');
  const activeOrder = orders.find(o => ACTIVE_TRIP_STATUSES.has(o.status)) || null;

  const dayStart = startOfIstDay(now).getTime();
  const weekStart = startOfIstWeek(now).getTime();

  const deliveredAtMs = (o: Order) => new Date(o.deliveredAt || o.updatedAt).getTime();
  const today = delivered.filter(o => deliveredAtMs(o) >= dayStart);
  const week = delivered.filter(o => deliveredAtMs(o) >= weekStart);

  const sum = (list: Order[], pick: (o: Order) => number) => 
    Math.round(list.reduce((total, o) => total + pick(o), 0) * 100) / 100;

  const rated = delivered.filter(o => typeof o.riderRating === 'number');
  const averageRating = rated.length
    ? Math.round((rated.reduce((t, o) => t + (o.riderRating as number), 0) / rated.length) * 10) / 10
    : null;

  const offersReceived = rider.offersReceived || 0;
  const offersAccepted = rider.offersAccepted || 0;
  // A rider who has not been offered anything yet is shown 100%, not 0% —
  // starting everyone at zero would read as a penalty for being new.
  const acceptanceRate = offersReceived === 0
    ? 100
    : Math.round((offersAccepted / offersReceived) * 1000) / 10;

  const incentiveTransactions = await listIncentiveAwards(rider.id);
  const incentivesEarned = Math.round(
    incentiveTransactions
      .filter(award => new Date(award.paidAt).getTime() >= weekStart)
      .reduce((t, award) => t + award.reward, 0) * 100
  ) / 100;

  const onlineMinutesToday = rider.isOnline && rider.onlineSince
    ? Math.round((now.getTime() - Math.max(new Date(rider.onlineSince).getTime(), dayStart)) / 60_000)
    : 0;

  return {
    metrics: {
      todayEarnings: sum(today, payoutOf),
      todayTrips: today.length,
      todayCashCollected: sum(today, codOf),
      weekEarnings: sum(week, payoutOf),
      weekTrips: week.length,
      totalEarnings: sum(delivered, payoutOf),
      totalTrips: delivered.length,
      acceptanceRate,
      offersReceived,
      offersAccepted,
      averageRating,
      ratedTripCount: rated.length,
      incentivesEarned,
      onlineMinutesToday
    },
    delivered,
    activeOrder
  };
}

interface IncentiveAward {
  id: string;
  riderId: string;
  code: string;
  reward: number;
  paidAt: string;
}

async function listIncentiveAwards(riderId: string): Promise<IncentiveAward[]> {
  const awards: IncentiveAward[] = [];
  for (const award of memoryStore.riderIncentives.values()) {
    if (award.riderId === riderId) awards.push(award);
  }
  return awards;
}

/**
 * Works out where the rider stands against every incentive, and pays out the
 * ones they have just completed.
 *
 * Payment happens here rather than at delivery time so that a target reached by
 * any route — a late rating arriving, a trip completed on another device — is
 * still honoured. `riderIncentives` records what has been paid, keyed by rider,
 * rule and period, so a target can never pay twice.
 */
export async function evaluateIncentives(
  rider: DeliveryRider,
  options: { award: boolean } = { award: true },
  now: Date = new Date()
): Promise<{ incentives: IncentiveProgress[]; newlyAwarded: IncentiveProgress[] }> {
  const orders = await orderRepository.listByRiderId(rider.id);
  const delivered = orders.filter(o => o.status === 'DELIVERED');
  const dayStart = startOfIstDay(now).getTime();
  const weekStart = startOfIstWeek(now).getTime();
  const deliveredAtMs = (o: Order) => new Date(o.deliveredAt || o.updatedAt).getTime();

  const today = delivered.filter(o => deliveredAtMs(o) >= dayStart);
  const week = delivered.filter(o => deliveredAtMs(o) >= weekStart);
  const weekRated = week.filter(o => typeof o.riderRating === 'number');

  const peakTripsToday = today.filter(o => {
    const hour = toIst(new Date(o.deliveredAt || o.updatedAt)).getUTCHours();
    return hour >= 19 && hour < 23;
  }).length;

  const ctx: MeasureContext = {
    todayTrips: today.length,
    weekTrips: week.length,
    peakTripsToday,
    weekRatedTrips: weekRated.length,
    weekAverageRating: weekRated.length
      ? Math.round((weekRated.reduce((t, o) => t + (o.riderRating as number), 0) / weekRated.length) * 10) / 10
      : 0
  };

  const incentives: IncentiveProgress[] = [];
  const newlyAwarded: IncentiveProgress[] = [];

  for (const rule of INCENTIVE_RULES) {
    const progress = rule.measure(ctx);
    const meetsMinimum = !rule.minRatedTrips || ctx.weekRatedTrips >= rule.minRatedTrips;
    const achieved = meetsMinimum && progress >= rule.target;
    const key = incentiveKey(rider.id, rule, now);
    const existing = memoryStore.riderIncentives.get(key);

    const entry: IncentiveProgress = {
      code: rule.code,
      title: rule.title,
      description: rule.description,
      progress: Math.round(progress * 10) / 10,
      target: rule.target,
      unit: rule.unit,
      reward: rule.reward,
      period: rule.period,
      achieved: achieved || Boolean(existing),
      paid: Boolean(existing),
      paidAt: existing?.paidAt
    };

    if (achieved && !existing && options.award) {
      const paidAt = now.toISOString();
      memoryStore.riderIncentives.set(key, {
        id: key,
        riderId: rider.id,
        code: rule.code,
        reward: rule.reward,
        paidAt
      });
      triggerAutoSave();
      await walletRepository.credit(
        rider.userId,
        rule.reward,
        `Incentive: ${rule.title}`
      );
      entry.paid = true;
      entry.paidAt = paidAt;
      newlyAwarded.push(entry);
    }

    incentives.push(entry);
  }

  return { incentives, newlyAwarded };
}
