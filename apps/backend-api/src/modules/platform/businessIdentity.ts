import { memoryStore, triggerAutoSave } from '../../db/client.ts';

/**
 * Who this platform legally is.
 *
 * Every official surface needs the same answer — a receipt, the Terms, the
 * Privacy Policy, the payment policies, the About screen in four apps — and
 * before this there was no answer anywhere. `legal/TERMS_OF_SERVICE.md` and
 * `legal/PRIVACY_POLICY.md` described obligations without ever naming the
 * entity that holds them, which is the one thing a legal document cannot leave
 * out.
 *
 * STORED, NOT HARDCODED, for two reasons that both matter.
 *
 * This repository is public. A registration number is a matter of public
 * record — anyone can verify a Udyam number on the government portal — but the
 * owner's address and mobile sitting in source, forever, in every fork and
 * every clone, is more exposure than the job needs.
 *
 * And a business fact changes. An address moves, a phone number changes, an
 * enterprise is reclassified from Micro to Small on its next return. Every one
 * of those should be a correction somebody types, not a release somebody cuts.
 *
 * The values below are the seed, so a fresh deployment is correct on its first
 * boot rather than showing blanks until an administrator remembers. The stored
 * record wins whenever there is one.
 */

export interface BusinessIdentity {
  /** The name on the registration. Not necessarily the brand. */
  legalName: string;
  tradingName: string;
  /** Udyam is MSME registration. It is NOT a tax registration — see below. */
  udyamNumber: string;
  enterpriseType: string;
  majorActivity: string;
  addressLine: string;
  street: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  /** The official business contact. Published to customers on purpose. */
  contactPhone: string;
  contactEmail: string;
  incorporatedOn: string;
  commencedOn: string;
  registeredOn: string;
  /** Free text, so the owner can add anything a regulator later asks for. */
  notes?: string;
}

const KEY = 'platform:business-identity';

/**
 * Seeded from the Udyam Registration Certificate the owner supplied.
 *
 * Dates are stored as given on the certificate (DD/MM/YYYY) rather than
 * normalised to ISO, because what is printed on an official document and what
 * is printed on ours should be the same string. A reader comparing the two
 * should not have to reformat anything in their head.
 */
const SEED: BusinessIdentity = {
  legalName: 'QUICK BITES',
  tradingName: 'Quick Bites',
  udyamNumber: 'UDYAM-KR-29-0052148',
  enterpriseType: 'Micro',
  majorActivity: 'Services',
  addressLine: 'Harohalli',
  street: 'Kanakapura Main Road',
  city: 'Harohalli',
  district: 'Ramanagara',
  state: 'Karnataka',
  pincode: '562112',
  contactPhone: '7899415741',
  contactEmail: 'officalquickbites@gmail.com',
  incorporatedOn: '15/09/2026',
  commencedOn: '15/09/2026',
  registeredOn: '21/09/2026'
};

export function businessIdentity(): BusinessIdentity {
  const stored = memoryStore.settings.get(KEY) as BusinessIdentity | undefined;
  // Merged rather than replaced, so an administrator who corrects one field
  // does not blank the rest by omitting them.
  return stored ? { ...SEED, ...stored } : { ...SEED };
}

export function saveBusinessIdentity(changes: Partial<BusinessIdentity>): BusinessIdentity {
  const next = { ...businessIdentity(), ...changes };
  memoryStore.settings.set(KEY, next);
  triggerAutoSave();
  return next;
}

/** One line, the way an address is written on a document. */
export function formattedAddress(identity = businessIdentity()): string {
  return [
    identity.addressLine,
    identity.street,
    identity.city,
    identity.district,
    `${identity.state} ${identity.pincode}`
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The block that goes at the foot of a receipt, a policy or an About screen.
 *
 * Deliberately says "MSME registration" and nothing about tax. Udyam is an
 * MSME registration; it is not a GSTIN and it confers no right to charge or
 * reclaim tax. Printing it beside a total in a way that reads like a tax
 * registration would turn a correct receipt into a misleading one — and the
 * tax section was removed from this platform at the owner's instruction, so
 * there is no GSTIN to print beside it and no invoice claiming one.
 */
export function officialFooter(identity = businessIdentity()): string[] {
  return [
    identity.legalName,
    formattedAddress(identity),
    `MSME Udyam Registration: ${identity.udyamNumber}`,
    `${identity.contactEmail} · ${identity.contactPhone}`
  ];
}
