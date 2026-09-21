/**
 * Which payee a signed-in person is.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS NOT A ROLE CHECK ANY MORE
 * -------------------------------------------------------------------------
 * It used to be: `if (role === 'rider') … else if (role === 'restaurant_owner') …`,
 * reading `req.user.role`. That was correct exactly as long as one account had
 * exactly one role.
 *
 * It no longer does. Roles became non-exclusive so that somebody who ordered
 * food last month can sign up to deliver this month without losing the ability
 * to order — and `role` now means the PRIMARY role, not the only one. Under
 * that rule the old check quietly breaks in the worst possible direction: a
 * rider whose primary role is still `customer` is told they are not a payee,
 * which is to say they cannot see or claim money they have earned.
 *
 * So identity is resolved from the ENTITY instead. A person is a rider because
 * a rider record names them, and a partner because a restaurant names them as
 * its owner. That is true regardless of what any role list says, it cannot
 * drift out of step with a token, and it is the same id the ledger, the payee
 * accounts and every payout are keyed by.
 *
 * -------------------------------------------------------------------------
 * AND WHEN SOMEBODY IS BOTH
 * -------------------------------------------------------------------------
 * Now possible: one person can hold a rider record and own a restaurant. Their
 * earnings are two separate balances and must never be added together or
 * silently swapped, so a caller who is both must say which one they mean. The
 * primary role breaks the tie when it can; otherwise the caller is asked,
 * rather than guessed at. Guessing here pays the wrong balance to the right
 * person, which reconciles perfectly and is still wrong.
 */
import type { PayeeOwnerType } from '@quick-bites/shared-types';
import { AppError } from '../../utils/AppError.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../../db/repositories/restaurantRepository.ts';
import { userRepository } from '../../db/repositories/userRepository.ts';

export interface PayeeIdentity {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerUserId: string;
  ownerName: string;
  /**
   * The name the bank is asked to confirm. For a kitchen that is the
   * registered business name, not the owner's personal one — comparing against
   * the person fails every properly-held business account, which is most of
   * them.
   */
  kycName: string;
  contactPhone?: string;
  /** True when this person is also the other kind of payee. */
  alsoOtherPayee: boolean;
}

/** What the caller may ask to be treated as. */
export type PayeePreference = 'RIDER' | 'RESTAURANT' | undefined;

export function parsePreference(value: unknown): PayeePreference {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === 'RIDER') return 'RIDER';
  if (upper === 'RESTAURANT' || upper === 'PARTNER') return 'RESTAURANT';
  return undefined;
}

export async function resolvePayee(
  userId: string,
  primaryRole: string,
  preference: PayeePreference = undefined
): Promise<PayeeIdentity> {
  const [rider, restaurants] = await Promise.all([
    riderRepository.findByUserId(userId),
    restaurantRepository.listAll()
  ]);
  const restaurant = restaurants.find(r => r.ownerId === userId) || null;

  const isRider = Boolean(rider);
  const isPartner = Boolean(restaurant);

  if (!isRider && !isPartner) {
    throw new AppError('Only partners and riders are paid by Quick Bites.', 403, 'NOT_A_PAYEE');
  }

  let chosen: PayeeOwnerType;
  if (isRider && isPartner) {
    if (preference) {
      chosen = preference;
    } else if (primaryRole === 'rider') {
      chosen = 'RIDER';
    } else if (primaryRole === 'restaurant_owner') {
      chosen = 'RESTAURANT';
    } else {
      throw new AppError(
        'You are both a partner and a rider. Say which earnings you mean.',
        400,
        'PAYEE_AMBIGUOUS'
      );
    }
  } else if (preference && ((preference === 'RIDER') !== isRider)) {
    // They asked to be treated as something they are not. Refused rather than
    // quietly answered with the other one.
    throw new AppError(
      preference === 'RIDER'
        ? 'There is no rider profile on this account.'
        : 'There is no restaurant on this account.',
      404,
      preference === 'RIDER' ? 'RIDER_NOT_FOUND' : 'RESTAURANT_NOT_FOUND'
    );
  } else {
    chosen = isRider ? 'RIDER' : 'RESTAURANT';
  }

  if (chosen === 'RIDER') {
    return {
      ownerType: 'RIDER',
      ownerId: rider!.id,
      ownerUserId: userId,
      ownerName: rider!.fullName || 'Rider',
      kycName: rider!.fullName || '',
      contactPhone: (rider as any)?.phone,
      alsoOtherPayee: isPartner
    };
  }

  const owner = await userRepository.findById(userId);
  return {
    ownerType: 'RESTAURANT',
    ownerId: restaurant!.id,
    ownerUserId: userId,
    ownerName: restaurant!.name || 'Restaurant',
    kycName: restaurant!.name || owner?.fullName || '',
    contactPhone: restaurant!.phone,
    alsoOtherPayee: isRider
  };
}
