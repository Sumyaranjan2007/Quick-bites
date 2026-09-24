/**
 * Telling the person who was paid.
 *
 * -------------------------------------------------------------------------
 * THE ONE PERSON WHO WAS NOT TOLD
 * -------------------------------------------------------------------------
 * A payout reaching PAID wrote a ledger entry and an audit line. The partner
 * whose money it was, and the rider whose week's work it settled, learned
 * nothing at all — so every payday produced a round of "has it gone yet"
 * questions from people the platform had already paid.
 *
 * It is also the cheapest trust there is to buy. A kitchen that gets told
 * without asking stops wondering whether the platform is good for the money.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT THREE LINES IN payouts.ts
 * -------------------------------------------------------------------------
 * Two reasons, and the second is the real one.
 *
 * Device tokens are keyed by USER. A payout carries an owner type and an owner
 * id — a restaurant id or a rider id — and neither is a user id. Pushing to the
 * owner id matches no device and fails silently, which looks exactly like the
 * bug this fixes. Resolving it needs the rider and restaurant repositories.
 *
 * And `payouts.ts` is the money path. Importing repositories and the push
 * dispatcher into it would put the notification graph inside the module that
 * executes bank transfers, where a cycle is not a build error but a payout that
 * throws at midnight. `adminNotifier.ts` is kept apart for the same reason and
 * this mirrors it deliberately.
 *
 * -------------------------------------------------------------------------
 * AND IT CANNOT FAIL A PAYOUT
 * -------------------------------------------------------------------------
 * Everything here is caught. The money has already left the bank by the time
 * this runs; a payout must record its own outcome whether or not anybody can be
 * told about it, and a push service having a bad minute must never turn a
 * completed transfer into an exception.
 */
import { riderRepository } from '../db/repositories/riderRepository.ts';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { payableAccountFor } from '../modules/payments/payeeAccounts.ts';
import { fcmDispatcher } from './fcmDispatcher.ts';
import type { PayeeOwnerType } from '@quick-bites/shared-types';

/**
 * The user account behind a payee, or null.
 *
 * Null is a real answer rather than a fault: a restaurant whose owner row is
 * missing, or a rider who was created without a user, cannot be pushed to. It is
 * logged, because a payee who never hears about a payout is worth knowing about
 * even though nothing can be done about it in this moment.
 */
async function userIdFor(ownerType: PayeeOwnerType, ownerId: string): Promise<string | null> {
  if (ownerType === 'RIDER') {
    const rider = await riderRepository.findById(ownerId);
    return (rider as { userId?: string } | null)?.userId || null;
  }
  const restaurant = await restaurantRepository.findById(ownerId);
  return (restaurant as { ownerId?: string } | null)?.ownerId || null;
}

/**
 * Where the money went, in words somebody can check against their own bank app.
 *
 * Read from the payee's own approved account rather than from the payout, which
 * records the rail but not the destination. Only the last four digits — the rest
 * is not needed to recognise an account and is not worth putting on a lock
 * screen.
 */
function destinationLabelFor(ownerType: PayeeOwnerType, ownerId: string): string | null {
  const account = payableAccountFor(ownerType, ownerId);
  if (!account) return null;
  if (account.vpa) return account.vpa;
  if (account.accountLast4) return `the account ending ${account.accountLast4}`;
  return null;
}

/**
 * Tells a partner or rider that their money has been sent.
 *
 * Call with `void`. It never throws and never rejects.
 */
export async function notifyPayeePaid(input: {
  ownerType: PayeeOwnerType;
  ownerId: string;
  ownerName: string;
  amountLabel: string;
  payoutId: string;
  reference?: string;
  /** False when the rail only ACCEPTED it, which is not the same as arriving. */
  landed?: boolean;
}): Promise<void> {
  try {
    const userId = await userIdFor(input.ownerType, input.ownerId);
    if (!userId) {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'PAYEE_PUSH_NO_USER',
          payoutId: input.payoutId,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          message: 'Paid somebody with no user account, so they cannot be told.'
        })
      );
      return;
    }

    await fcmDispatcher.notifyPayeePaid(userId, {
      amountLabel: input.amountLabel,
      destinationLabel: destinationLabelFor(input.ownerType, input.ownerId),
      payoutId: input.payoutId,
      reference: input.reference,
      landed: input.landed !== false
    });
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        timestamp: new Date().toISOString(),
        event: 'PAYEE_PUSH_FAILED',
        payoutId: input.payoutId,
        message: err?.message || String(err)
      })
    );
  }
}
