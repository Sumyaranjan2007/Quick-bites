/**
 * The payment policies this platform is held to.
 *
 * The owner asked for "all policies regarding payments which is a must for a
 * firm". These are them: what a customer is charged, when and how a refund
 * comes back, what a partner is paid and what is deducted, what a rider earns
 * and what happens to cash in their bag, how a dispute is raised, and what we
 * do and do not keep.
 *
 * -------------------------------------------------------------------------
 * WHY THEY LIVE HERE AND NOT IN THE APPS
 * -------------------------------------------------------------------------
 * Same reason as the rider policies next door: a policy revision has to reach
 * everybody the next time they open a screen, not the next time they install a
 * build. A platform whose published refund policy is three versions behind what
 * its code does is in a worse position than one with no policy at all — it has
 * made a promise it demonstrably does not keep.
 *
 * -------------------------------------------------------------------------
 * AND WHY THE NUMBERS ARE NOT IN THE TEXT
 * -------------------------------------------------------------------------
 * Where a policy has to state a figure — the hold period, the cash ceiling, a
 * commission rate — it is interpolated from the LIVE pricing config rather than
 * typed into the prose. An administrator who changes the hold to three days
 * would otherwise leave a published policy saying one, and the published policy
 * is the one a partner would be entitled to rely on.
 *
 * -------------------------------------------------------------------------
 * THE CONTACT DETAILS ARE NOT INVENTED
 * -------------------------------------------------------------------------
 * A grievance officer is a named human being with a real address, required
 * under the Consumer Protection (E-Commerce) Rules. Making one up would be
 * worse than leaving it blank: a customer would write to an address that does
 * not exist and conclude, reasonably, that the complaint had been received.
 *
 * So the block is configured by the owner, and until it is, every policy that
 * needs it says plainly that it has not been published yet and gives the route
 * that does work. `policyGaps()` is what an admin screen surfaces.
 */
import type { PolicyDocument } from '../riders/riderPolicies.ts';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { getActiveRates } from './pricingConfig.ts';

export type PolicyAudience = 'customer' | 'partner' | 'rider' | 'public';

export interface PaymentPolicy extends PolicyDocument {
  audiences: PolicyAudience[];
}

/* ------------------------------------------------------------------ *
 *  WHO A COMPLAINT GOES TO                                            *
 * ------------------------------------------------------------------ */

export interface GrievanceContact {
  officerName: string;
  designation?: string;
  email: string;
  phone?: string;
  address: string;
  /** Working hours, so "no reply at 2am" is not treated as being ignored. */
  hours?: string;
}

const GRIEVANCE_KEY = 'policy:grievance';

export function getGrievanceContact(): GrievanceContact | null {
  const stored = memoryStore.settings.get(GRIEVANCE_KEY);
  return stored && typeof stored.email === 'string' && stored.email.includes('@')
    ? (stored as GrievanceContact)
    : null;
}

export function setGrievanceContact(input: GrievanceContact): GrievanceContact {
  const contact: GrievanceContact = {
    officerName: (input.officerName || '').trim(),
    designation: input.designation?.trim(),
    email: (input.email || '').trim().toLowerCase(),
    phone: input.phone?.trim(),
    address: (input.address || '').trim(),
    hours: input.hours?.trim()
  };
  memoryStore.settings.set(GRIEVANCE_KEY, contact);
  triggerAutoSave();
  return contact;
}

/** What still has to be published before these policies are complete. */
export function policyGaps(): string[] {
  const gaps: string[] = [];
  const contact = getGrievanceContact();

  if (!contact) {
    gaps.push(
      'No grievance officer has been published. The Consumer Protection (E-Commerce) Rules require a named person, a working email and a postal address.'
    );
    return gaps;
  }
  if (contact.officerName.length < 3) gaps.push('The grievance officer has no name.');
  if (!contact.address || contact.address.length < 10) {
    gaps.push('The grievance officer has no postal address.');
  }
  return gaps;
}

/**
 * The paragraph every policy ends with.
 *
 * When nothing is configured it does NOT fall silent and it does not invent a
 * name. It says the escalation route is not yet published and points at the
 * in-app one, which genuinely works.
 */
function grievanceSection(): { heading: string; body: string } {
  const contact = getGrievanceContact();
  if (!contact) {
    return {
      heading: 'If you are not satisfied',
      body:
        'Raise it from the Help section of your app. Every payment complaint is recorded against the order it concerns and is answered by a person. ' +
        'A named grievance officer and postal address for formal escalation have not been published yet — until they are, the in-app route is the one that reaches us.'
    };
  }
  return {
    heading: 'If you are not satisfied',
    body:
      'Raise it first from the Help section of your app, where it is recorded against the order it concerns. ' +
      `If it is not resolved, write to ${contact.officerName}${contact.designation ? `, ${contact.designation}` : ''}, at ${contact.email}` +
      `${contact.phone ? ` or ${contact.phone}` : ''}. Post may be sent to ${contact.address}.` +
      `${contact.hours ? ` ${contact.hours}.` : ''}`
  };
}

const UPDATED_AT = '2026-09-22';

/**
 * Every payment policy, with the live rates written into the text.
 *
 * A function rather than a constant precisely so the figures cannot go stale:
 * a change to the hold period or the cash ceiling is reflected the next time
 * anybody opens the policy.
 */
export function paymentPolicies(): PaymentPolicy[] {
  const rates = getActiveRates();
  const grievance = grievanceSection();

  const money = (n: number) => `Rs ${Number(n).toLocaleString('en-IN')}`;

  return [
    {
      id: 'payments-and-charges',
      title: 'Payments and charges',
      summary: 'What you are charged, when the money is taken, and what each line on the bill is.',
      updatedAt: UPDATED_AT,
      audiences: ['customer', 'public'],
      sections: [
        {
          heading: 'What you pay',
          body:
            'The price of the food, a packaging charge set by the restaurant, a delivery fee based on distance, ' +
            `a platform fee of ${money(rates.platformFeeBase)} plus ${rates.platformFeeGstPercent}% tax on it, and ` +
            `${rates.gstFoodPercent}% GST on the restaurant service. Every one of these is shown separately on the bill before you pay, and the total you are shown is the total that is charged. We never add anything after you have confirmed.`
        },
        {
          heading: 'When the money is taken',
          body:
            'For an online payment, at the moment you confirm the order. If the payment does not complete, no order is placed and nothing is charged. ' +
            'If money leaves your account but no order appears, it has not been taken by us — it is an authorisation the bank will release, usually within five working days, and our support team will confirm this against the gateway record if you ask.'
        },
        {
          heading: 'Cash on delivery',
          body:
            'You pay the delivery partner at the door. You may also pay by UPI at the door: the partner will show a code for the exact amount of your order. ' +
            'Paying that code settles the order in full — do not also hand over cash. A delivery partner has no way to mark an order paid themselves; only the payment gateway can, which is why the code turns green by itself.'
        },
        {
          heading: 'Tips',
          body:
            'A tip is passed to your delivery partner in full. We take no commission on it and no tax is charged on it, because it is not payment for anything we supplied.'
        },
        {
          heading: 'Your card details',
          body:
            'We never see or store your card number, UPI PIN or bank credentials. Payment is handled entirely by our payment gateway. Nobody at Quick Bites, including support staff and administrators, can view them.'
        },
        {
          heading: 'Invoices',
          body:
            'A bill is available against every delivered order from your order history. Where our GST registration allows it, this is a tax invoice carrying our GSTIN; otherwise it is a payment receipt and says so. We will not issue a document described as a tax invoice unless it is one.'
        },
        grievance
      ]
    },

    {
      id: 'refunds-and-cancellations',
      title: 'Refunds and cancellations',
      summary: 'When you get money back, how much, how it reaches you, and how long it takes.',
      updatedAt: UPDATED_AT,
      audiences: ['customer', 'public'],
      sections: [
        {
          heading: 'The principle',
          body:
            'A refund goes back the way the money came. If you paid by card, it returns to that card; by UPI, to that UPI account; by net banking, to that account. ' +
            'We do not hold your money in a wallet and we do not offer credit in place of a refund. You are not asked for your bank details for a refund on an online payment, because we already know where the money came from — anybody asking you for them in our name is not us.'
        },
        {
          heading: 'Cancelling before the restaurant accepts',
          body: 'Full refund, every time, with no reason required.'
        },
        {
          heading: 'Cancelling after the restaurant has started cooking',
          body:
            'The food has been made and somebody has paid for the ingredients. A cancellation charge may apply, it is shown to you before you confirm the cancellation, and the rest is refunded in full.'
        },
        {
          heading: 'If we cancel',
          body:
            'If no restaurant or delivery partner can be found, if the restaurant cannot complete your order, or if we cancel for any reason of our own, you are refunded in full including every fee. A failure at our end is not charged to you.'
        },
        {
          heading: 'Something wrong with the order',
          body:
            'Report it from the order in your app. Missing items, the wrong order, spilled or inedible food and non-delivery are all refundable. ' +
            'We ask for a short description and, where it helps, a photograph. A person reviews it — it is not decided by an automatic rule — and you are told the outcome and the reason.'
        },
        {
          heading: 'Cash orders',
          body:
            'If you paid in cash there is no card to refund, so we send you a payment link and you choose where the money goes — your own UPI id or bank account. ' +
            'The link is yours alone and expires after ' +
            `${rates.payoutLinkExpiryHours} hours; if it does, ask support and a new one is issued. Occasionally a delivery partner will return cash at the door instead, and that is recorded against the order so you are not refunded twice.`
        },
        {
          heading: 'How long it takes',
          body:
            'We send the refund as soon as it is approved. Reaching your account then depends on your bank: UPI is usually within a day, cards commonly take three to seven working days. ' +
            'The status is shown against the order, with the reference, so you can quote it to your bank.'
        },
        {
          heading: 'Partial refunds',
          body:
            'Where only part of an order was wrong, only that part is refunded. The amount and what it covers are shown before you accept it.'
        },
        grievance
      ]
    },

    {
      id: 'partner-settlements',
      title: 'Restaurant settlements',
      summary: 'What we take, what we withhold, when you are paid, and what you can check it against.',
      updatedAt: UPDATED_AT,
      audiences: ['partner'],
      sections: [
        {
          heading: 'What you earn',
          body:
            'The food total and the packaging charge on every delivered order, less our commission and the tax we are required to withhold. ' +
            'The delivery fee is not yours and no tip is ever taken from a rider to pay a restaurant.'
        },
        {
          heading: 'Commission',
          body:
            `Our commission is agreed with you and is applied to the food total. The standard rate is ${rates.defaultCommissionPercent}%; yours is shown on every order in your statement. ` +
            'The rate that applies to an order is the rate that was in force when the order was placed, and it is frozen onto that order. A change we agree later never restates what you have already earned.'
        },
        {
          heading: 'Tax withheld',
          body:
            `We withhold ${rates.tdsPercent}% of the value of your supplies as tax deducted at source under section 194-O of the Income-tax Act, and pay it to the government against your PAN. ` +
            'It is not our money and it is not a charge. It appears as a separate line on every statement and can be claimed against your own tax liability.'
        },
        {
          heading: 'When you are paid',
          body:
            `An order becomes payable ${rates.partnerHoldDays === 1 ? 'one day' : `${rates.partnerHoldDays} days`} after it is delivered. The hold exists so that a refund raised the day after delivery comes off a settlement rather than becoming a debt we have to ask you for. ` +
            `Payments run daily. Anything below ${money(rates.minPayoutAmount)} carries to the next run rather than being sent as a fee-heavy transfer.`
        },
        {
          heading: 'Where you are paid',
          body:
            'To the bank account you register in the app. We verify it with a small test transfer that confirms the account exists and the name on it. ' +
            'We do not keep your account number after verification — only the last four digits, so you can recognise it. Until an account is verified we have nowhere to send a settlement.'
        },
        {
          heading: 'Asking to be paid',
          body:
            'You may raise a payout request at any time from your statement. It does not change the amount and it is not required: everything owed is paid on the ordinary run whether or not you ask. ' +
            'What it does is tell our finance team you are waiting, with your statement attached.'
        },
        {
          heading: 'Deductions and adjustments',
          body:
            'A refund paid to a customer for something that was wrong with the food is deducted from your settlement, on the order it relates to, with the reason recorded. ' +
            'It appears as its own line — never as a smaller number with no explanation. Any other adjustment is named and dated in the same way.'
        },
        {
          heading: 'If you think a figure is wrong',
          body:
            'Every order in your statement opens to show exactly how it was worked out. If it still looks wrong, raise it from the Help section quoting the order number. ' +
            'Our records and yours are drawn from the same ledger, so a disagreement is about one order rather than about the total.'
        },
        grievance
      ]
    },

    {
      id: 'rider-earnings',
      title: 'Delivery partner earnings and payouts',
      summary: 'What you earn, when it reaches your bank, and what stops a payout.',
      updatedAt: UPDATED_AT,
      audiences: ['rider'],
      sections: [
        {
          heading: 'What you earn',
          body:
            `A fee for each trip, based on distance, with a minimum of ${money(rates.riderMinEarningPerTrip)} per completed trip, plus any incentive you have qualified for. ` +
            'Tips are paid to you in full. We take no commission on a tip, ever.'
        },
        {
          heading: 'When you are paid',
          body:
            `Earnings become payable ${rates.riderHoldDays === 0 ? 'the same day' : rates.riderHoldDays === 1 ? 'one day after' : `${rates.riderHoldDays} days after`} the trip is completed, and payments run daily to the bank account or UPI id you have registered. ` +
            `Anything below ${money(rates.minPayoutAmount)} carries to the next run.`
        },
        {
          heading: 'Cash you are carrying',
          body:
            'Cash you collect on delivery belongs to Quick Bites from the moment it is handed to you. It is not part of your earnings and it is never set against them. ' +
            'While you are holding any of it, your earnings are not paid out — you are not paid the difference between the two, because that is a net position rather than a payment.'
        },
        {
          heading: 'The cash limit',
          body:
            `You can hold up to ${money(rates.codCashCeiling)} of our cash at a time. Above that, cash orders stop being offered to you; orders already paid online continue as normal. ` +
            'Your app shows what you are holding against the limit from the first rupee, so it is never a surprise.'
        },
        {
          heading: 'Depositing cash',
          body:
            'Declare what you are bringing in before you set off, then bring it to the office. An administrator counts it in front of you and records what was counted. ' +
            'Your balance reduces by the counted amount, not by the declared one — that is what protects you as much as us. If the two differ, both figures and the reason are kept on your record, and neither side\'s word alone decides it.'
        },
        {
          heading: 'Taking payment online at the door',
          body:
            'Where a customer would rather pay by UPI, show the code in your app. It is for the exact amount of that order. ' +
            'It turns green only when the payment gateway confirms the money — your phone cannot mark it paid and neither can anyone at our end. If it says it cannot check, do not take cash until it does: the customer may have already paid.'
        },
        {
          heading: 'Where you are paid',
          body:
            'To the bank account or UPI id you register in the app, verified with a small test transfer. We do not keep your account number afterwards, only the last four digits. Until it is verified there is nowhere to send your earnings.'
        },
        {
          heading: 'Asking to be paid',
          body:
            'You can raise a request from your statement. It does not change what you are owed and you do not have to ask — everything owed is paid on the daily run either way.'
        },
        {
          heading: 'If you think a figure is wrong',
          body:
            'Every trip in your statement opens to show how it was worked out, including the tip. Raise anything that still looks wrong from the Help section, quoting the trip number.'
        },
        grievance
      ]
    },

    {
      id: 'payment-security',
      title: 'Payment security',
      summary: 'What we hold, what we deliberately do not, and how money is authorised to leave.',
      updatedAt: UPDATED_AT,
      audiences: ['customer', 'partner', 'rider', 'public'],
      sections: [
        {
          heading: 'What we never hold',
          body:
            'Card numbers, CVVs, UPI PINs and bank credentials never reach our systems. Payment is handled entirely by our payment gateway. ' +
            'After a partner or rider bank account is verified, the account number itself is discarded and only the last four digits are kept.'
        },
        {
          heading: 'How money leaves',
          body:
            'Every payment out is drawn from a double-entry ledger and cannot be typed in by hand. Above a threshold, a second administrator must approve it, and the person who prepared it cannot be the one who approves it. ' +
            'There is a daily ceiling on the total that can be sent. These are enforced by the server, not by the screen.'
        },
        {
          heading: 'Every movement is recorded',
          body:
            'The ledger is append-only. A correction is a new entry, never an edit, so nothing can be quietly rewritten after the fact. Every rate change, payout, approval, refund and cash count is recorded with who did it and what it looked like before and after.'
        },
        {
          heading: 'Nobody can mark something paid',
          body:
            'An order becomes paid because the payment gateway said so, and for no other reason. No delivery partner, no member of staff and no administrator can set that status by hand.'
        },
        {
          heading: 'If you are asked for details',
          body:
            'We will never ask you for a card number, a UPI PIN, an OTP or a password — not by phone, not by message, not through the app. Anyone who does is not us, whatever they say. Report it from the Help section.'
        },
        grievance
      ]
    },

    {
      id: 'disputes-and-chargebacks',
      title: 'Disputes and chargebacks',
      summary: 'How a payment dispute is handled, and what we do with the evidence.',
      updatedAt: UPDATED_AT,
      audiences: ['customer', 'partner', 'public'],
      sections: [
        {
          heading: 'Raise it with us first',
          body:
            'A complaint raised in the app is answered by a person, is recorded against the order, and is usually resolved in days. A dispute raised with your bank takes weeks and we are given no chance to fix it in the meantime.'
        },
        {
          heading: 'If you do go to your bank',
          body:
            'We respond to every chargeback with the order record: what was ordered, when it was placed, when it was delivered, the delivery confirmation, and any refund already paid. ' +
            'We do not contest a chargeback where our own record shows the customer was right.'
        },
        {
          heading: 'While a dispute is open',
          body:
            'The amount in dispute may be held back from the settlement it belongs to. It is shown as held, on the order it relates to, rather than disappearing from a total. If the dispute is decided in the partner\'s favour it is released on the next run.'
        },
        {
          heading: 'Repeated claims',
          body:
            'We look at patterns, not single orders. An account making repeated claims of the same kind may be asked for more evidence before a refund is approved. Nobody is refused a refund automatically, and a refusal always says why.'
        },
        grievance
      ]
    }
  ];
}

export function findPaymentPolicy(id: string): PaymentPolicy | undefined {
  return paymentPolicies().find(p => p.id === id);
}

export function policiesFor(audience: PolicyAudience): PaymentPolicy[] {
  return paymentPolicies().filter(p => p.audiences.includes(audience));
}
