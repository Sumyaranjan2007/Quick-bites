/**
 * How long a customer and a rider can see each other's phone number.
 *
 * They do need it. A rider outside a gate with no bell, and a customer whose
 * food has been sitting in a lobby for ten minutes, both need to make one call
 * — and an order where neither can reach the other is an order that fails.
 *
 * What neither needs is the number afterwards. A delivery app that hands out
 * permanent phone numbers has, over a year, handed every rider a contact list
 * of the women whose flats they have been to. That is the harm, it is well
 * documented in this industry, and it does not require anybody to be malicious:
 * it only requires the number to still be on the screen tomorrow.
 *
 * So the number is live only while the trip is. Once the order reaches a
 * terminal state, every route that used to return it returns the last three
 * digits instead — enough for support to confirm "the number ending 210" with
 * a caller, not enough to call anyone.
 *
 * WHAT THIS IS NOT. This is not number masking in the telephony sense. Real
 * masking routes both parties through a proxy number rented from an operator,
 * so neither ever learns the other's digits at all. That needs a vendor account
 * and a per-minute bill, and pretending to do it without one would be worse
 * than not doing it — the number would still be on the screen and everybody
 * would believe it was hidden. `maskedCallProxy` below is where that provider
 * plugs in when there is one.
 */
import type { Order, OrderStatus } from '@quick-bites/shared-types';

/**
 * While an order is in one of these, the two parties may be mid-handover and
 * must be able to reach each other.
 */
const CONTACTABLE: OrderStatus[] = [
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'HANDED_TO_RIDER',
  'OUT_FOR_DELIVERY'
];

export function isContactable(status: OrderStatus): boolean {
  return CONTACTABLE.includes(status);
}

/**
 * The last three digits, in the shape Indian numbers are read aloud.
 *
 * Three rather than four: four digits plus a known operator prefix narrows a
 * number far more than most people expect, and three is all that a "is this the
 * number ending 210?" confirmation needs.
 */
export function maskPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return `••••• ••${digits.slice(-3)}`;
}

export interface VisibleContact {
  /** The dialable number, or null once the order is over. */
  phone: string | null;
  /** Always present when there is a number at all, for display and support. */
  maskedPhone: string | null;
  /** True while the number above can actually be called. */
  callable: boolean;
}

/**
 * What one party may see of the other's number, given where the order is.
 *
 * Takes the status rather than reading it from the order so that a caller
 * deciding on a different rule — support staff looking at a closed case, for
 * instance — has to say so explicitly rather than getting it by accident.
 */
export function visibleContact(phone: string | null | undefined, status: OrderStatus): VisibleContact {
  const masked = maskPhoneNumber(phone);
  if (!phone || !masked) return { phone: null, maskedPhone: null, callable: false };

  if (!isContactable(status)) {
    return { phone: null, maskedPhone: masked, callable: false };
  }
  return { phone, maskedPhone: masked, callable: true };
}

/**
 * The seam for real telephony masking.
 *
 * Returns null today, which every caller already handles by falling back to the
 * direct number above. When a proxy provider is added, this returns the rented
 * number and the direct one stops being sent at all — one change here rather
 * than in every route that shows a number.
 */
export function maskedCallProxy(_order: Order, _party: 'customer' | 'rider'): string | null {
  return null;
}

/* -------------------------------------------------------------------------- *
 *                        THE ORDER RECORD, PER READER                         *
 * -------------------------------------------------------------------------- */

/** Who is asking. Derived from the request, never sent by the client. */
export type OrderViewer = 'customer' | 'rider' | 'restaurant' | 'staff' | 'other';

/**
 * The order as a given reader is allowed to see it.
 *
 * `GET /orders/:id` used to return the stored record verbatim to anyone the
 * permission check let through, which included the assigned rider. Two things
 * went out with it that should not have:
 *
 * THE DELIVERY OTP. It is the whole proof that a handover happened. A rider who
 * can read it off their own order screen can mark the order delivered without
 * ever meeting the customer — which is precisely the fraud the proximity flag
 * was added to detect, handed over directly. The tracking endpoint was written
 * to avoid exactly this ("the customer needs to follow the rider without being
 * handed the whole order record, which contains the delivery OTP") and the
 * detail endpoint beside it did it anyway.
 *
 * THE PHONE NUMBERS, FOREVER. The contact rule above was applied on the
 * tracking response, and the customer app reads `order.riderPhone` first and
 * falls back to the tracking one — so the rule was bypassed by the field that
 * won.
 *
 * Allowlist rather than a delete list: a field added to Order later must be
 * thought about before it reaches a client, rather than shipping by default.
 */
export function shapeOrderForViewer(order: Order, viewer: OrderViewer): Record<string, unknown> {
  const { deliveryOtp, pickupCode, riderPhone, customerPhone, ...rest } = order as Order & {
    customerPhone?: string;
  };

  const shaped: Record<string, unknown> = { ...rest };

  // Staff already hold the highest trust level in this system and every admin
  // action is audited by name, so they see the record whole — a support agent
  // resolving "the rider says he handed it over and I say he did not" cannot do
  // it with the evidence removed.
  if (viewer === 'staff') {
    return { ...order };
  }

  // The customer reads the delivery code out at the door. Nobody else needs it,
  // and the rider must not have it.
  if (viewer === 'customer' && deliveryOtp) shaped.deliveryOtp = deliveryOtp;

  // The pickup code is the counter handover: the kitchen checks it against the
  // rider. Both ends of that need it; the customer is not involved.
  if ((viewer === 'rider' || viewer === 'restaurant') && pickupCode) shaped.pickupCode = pickupCode;

  const rider = visibleContact(riderPhone, order.status);
  const customer = visibleContact(customerPhone, order.status);

  // Nobody the rules above recognise. Neither code, neither number — the least
  // privileged view there is. Reached when a route lets somebody through who is
  // not a party to this order.
  if (viewer === 'other') {
    delete shaped.pickupCode;
    delete shaped.deliveryOtp;
    return shaped;
  }

  if (viewer === 'customer') {
    shaped.riderPhone = rider.phone;
    shaped.riderPhoneMasked = rider.maskedPhone;
  } else if (viewer === 'rider') {
    shaped.customerPhone = customer.phone;
    shaped.customerPhoneMasked = customer.maskedPhone;
  } else {
    // The kitchen. It is a party to a live order — a missing item or an
    // unreachable doorstep is a call it legitimately needs to make, to either
    // side — so the same rule applies to it as to the other two: reachable
    // while the order is live, and nothing kept afterwards.
    shaped.customerPhone = customer.phone;
    shaped.customerPhoneMasked = customer.maskedPhone;
    shaped.riderPhone = rider.phone;
    shaped.riderPhoneMasked = rider.maskedPhone;
  }

  return shaped;
}

/** Maps the authenticated role plus the order to the reader it represents. */
export function viewerFor(
  order: Order,
  user: { id?: string; role?: string } | undefined
): OrderViewer {
  if (user?.role === 'admin' || user?.role === 'super_admin') return 'staff';
  if (user?.role === 'restaurant_owner') return 'restaurant';
  // Identity before role: a rider reading somebody else's order is not that
  // order's rider, and must not be treated as one.
  if (order.riderId && order.riderId === user?.id) return 'rider';
  if (order.customerId === user?.id) return 'customer';

  // Anyone else. This used to fall back on the ROLE — so a rider looking at an
  // order that was never theirs was shaped as that order's rider and handed its
  // pickup code and the customer's phone number. Holding a rider account is not
  // the same as being this delivery's rider, and defaulting the unknown case to
  // 'customer' was no better: that is the reader who gets the delivery OTP.
  return 'other';
}
