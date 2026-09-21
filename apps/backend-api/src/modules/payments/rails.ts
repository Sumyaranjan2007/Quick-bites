/**
 * How money physically leaves the platform.
 *
 * Several rails, deliberately. The owner asked to be able to pay in any
 * situation, and the situations are real: a gateway that is down at nine on a
 * Friday must not mean forty riders go unpaid over a weekend, and a partner
 * whose bank keeps refusing an IFSC must not be unpayable until they fix it.
 *
 * -------------------------------------------------------------------------
 * WHAT MAKES SEVERAL RAILS SAFE RATHER THAN CHAOTIC
 * -------------------------------------------------------------------------
 * Every rail produces the SAME ledger entries. Only the reference format
 * differs — a RazorpayX payout id, a UTR typed by an administrator, a payout
 * link the recipient opened. The books cannot tell the rails apart, which is
 * exactly right: the money left either way, and a settlement report that said
 * otherwise would be describing our plumbing instead of our business.
 *
 * What differs is how much the platform KNOWS. A RazorpayX payout reports its
 * own outcome; a manual transfer is somebody's word that they did it. So a
 * manual rail demands a reference and records who claimed it, and nothing on a
 * manual rail is ever marked SENT by the system on its own.
 */
import { config } from '../../config/env.ts';
import { AppError } from '../../utils/AppError.ts';
import { razorpayXAdapter, isRazorpayXConfigured } from './razorpayXAdapter.ts';
import { getActiveRates } from './pricingConfig.ts';
import type { PayoutRailId, RailResultStatus } from '@quick-bites/shared-types';

export interface PayoutInstruction {
  amountPaise: number;
  /** Only ever a verified fund account. Absent on the manual and link rails. */
  fundAccountId?: string;
  payeeName: string;
  payeePhone?: string;
  /** Ours. The same value goes to Razorpay, so neither side can pay twice. */
  idempotencyKey: string;
  referenceId: string;
  narration: string;
  purpose: 'payout' | 'refund';
  /** What an administrator typed, on a manual rail. */
  manualReference?: string;
}

export interface RailResult {
  status: RailResultStatus;
  /** The payout id, the UTR, or the link id. What proves the money moved. */
  reference?: string;
  /** For a payout link: where the recipient goes to claim it. */
  claimUrl?: string;
  reason?: string;
}

export interface PayoutRail {
  readonly id: PayoutRailId;
  readonly displayName: string;
  /** What an administrator needs to know before choosing it. */
  readonly description: string;
  /** Whether this deployment can actually use it right now. */
  available(): boolean;
  /** Why it cannot be used, when it cannot. */
  unavailableReason(): string | null;
  send(instruction: PayoutInstruction): Promise<RailResult>;
}

/* ------------------------------------------------------------------ *
 *  RAZORPAYX — the default                                            *
 * ------------------------------------------------------------------ */

const razorpayXRail: PayoutRail = {
  id: 'RAZORPAYX',
  displayName: 'RazorpayX',
  description: 'Straight to their verified bank account. Usually arrives within minutes.',
  available: () => isRazorpayXConfigured(),
  unavailableReason: () =>
    isRazorpayXConfigured()
      ? null
      : 'RazorpayX is not configured on this deployment. Pay by bank transfer and record the UTR instead.',

  async send(instruction) {
    if (!instruction.fundAccountId) {
      // Reached only through a bug: the caller is supposed to refuse an
      // unverified payee long before here. Refused loudly rather than
      // attempted, because "pay this person somehow" is not a thing a payout
      // rail should improvise.
      throw new AppError(
        'That payee has no verified account to pay into.',
        409,
        'PAYEE_NOT_VERIFIED'
      );
    }

    const result = await razorpayXAdapter.createPayout({
      fundAccountId: instruction.fundAccountId,
      amountPaise: instruction.amountPaise,
      idempotencyKey: instruction.idempotencyKey,
      referenceId: instruction.referenceId,
      narration: instruction.narration,
      purpose: instruction.purpose === 'refund' ? 'refund' : 'payout'
    });

    return {
      status: result.status,
      reference: result.payoutId,
      reason: result.reason
    };
  }
};

/* ------------------------------------------------------------------ *
 *  PAYOUT LINK — for a payee with no account we can pay               *
 * ------------------------------------------------------------------ */

const payoutLinkRail: PayoutRail = {
  id: 'PAYOUT_LINK',
  displayName: 'Payout link',
  description:
    'Sends a link. They enter their own UPI id or bank account. Use for a customer refund on a cash order, ' +
    'or anyone with no verified account.',
  available: () => isRazorpayXConfigured(),
  unavailableReason: () =>
    isRazorpayXConfigured() ? null : 'RazorpayX is not configured on this deployment.',

  async send(instruction) {
    if (!instruction.payeePhone) {
      throw new AppError(
        'A payout link needs a phone number to reach them on.',
        400,
        'PAYEE_PHONE_REQUIRED'
      );
    }

    const rates = getActiveRates();
    const result = await razorpayXAdapter.createPayoutLink({
      amountPaise: instruction.amountPaise,
      contactName: instruction.payeeName,
      contactPhone: instruction.payeePhone,
      purpose: instruction.purpose === 'refund' ? 'refund' : 'payout',
      description: instruction.narration,
      referenceId: instruction.referenceId,
      expiryUnix: Math.floor(Date.now() / 1000) + rates.payoutLinkExpiryHours * 3600,
      // SMS to Indian numbers needs TRAI DLT registration, which is not done.
      // Off, so the link is handed over in the app rather than sent into a void
      // and assumed delivered.
      sendSms: false
    });

    return {
      status: result.status,
      reference: result.linkId,
      claimUrl: result.shortUrl,
      reason: result.reason
    };
  }
};

/* ------------------------------------------------------------------ *
 *  MANUAL — somebody moved it, and says so                            *
 * ------------------------------------------------------------------ */

function manualRail(id: 'MANUAL_BANK' | 'UPI_MANUAL', displayName: string, description: string): PayoutRail {
  return {
    id,
    displayName,
    description,
    // Always available. That is the point of it: this is the rail that works
    // when nothing else does, and a deployment with no gateway at all can still
    // pay people and keep honest books.
    available: () => true,
    unavailableReason: () => null,

    async send(instruction) {
      if (!instruction.manualReference || instruction.manualReference.trim().length < 4) {
        throw new AppError(
          'Record the UTR or transaction reference. A payment nobody can point at is not a payment.',
          400,
          'MANUAL_REFERENCE_REQUIRED'
        );
      }

      // No network call. The administrator has already moved the money; this
      // records that they say so, and the ledger entries are identical to
      // every other rail's. Returned as SENT rather than UNCERTAIN because a
      // human is asserting it, and that assertion is the evidence.
      return {
        status: 'SENT' as RailResultStatus,
        reference: instruction.manualReference.trim()
      };
    }
  };
}

export const RAILS: Record<PayoutRailId, PayoutRail> = {
  RAZORPAYX: razorpayXRail,
  PAYOUT_LINK: payoutLinkRail,
  MANUAL_BANK: manualRail(
    'MANUAL_BANK',
    'Bank transfer, recorded',
    'You transfer it yourself by net banking and record the UTR here. Always available.'
  ),
  UPI_MANUAL: manualRail(
    'UPI_MANUAL',
    'UPI, recorded',
    'You pay by UPI and record the reference. For small corrections.'
  )
};

export function railFor(id: PayoutRailId): PayoutRail {
  const rail = RAILS[id];
  if (!rail) throw new AppError('No such payout method.', 400, 'UNKNOWN_RAIL');
  return rail;
}

/**
 * The rail used unless an administrator picks another.
 *
 * RazorpayX where it is configured, and the recorded bank transfer where it is
 * not — so a deployment without a gateway still has a working, auditable way to
 * pay people rather than a screen full of disabled buttons.
 */
export function defaultRail(): PayoutRailId {
  return isRazorpayXConfigured() ? 'RAZORPAYX' : 'MANUAL_BANK';
}

/** What the admin screen shows, with the reason any rail is unavailable. */
export function railCatalogue() {
  return (Object.keys(RAILS) as PayoutRailId[]).map(id => {
    const rail = RAILS[id];
    return {
      id,
      displayName: rail.displayName,
      description: rail.description,
      available: rail.available(),
      unavailableReason: rail.unavailableReason(),
      isDefault: id === defaultRail(),
      /** Whether the administrator has to type a reference for this rail. */
      needsManualReference: id === 'MANUAL_BANK' || id === 'UPI_MANUAL'
    };
  });
}

/** Whether payouts can go out at all on this deployment, by any rail. */
export function payoutsPossible(): boolean {
  return (Object.keys(RAILS) as PayoutRailId[]).some(id => RAILS[id].available());
}

export { config };
