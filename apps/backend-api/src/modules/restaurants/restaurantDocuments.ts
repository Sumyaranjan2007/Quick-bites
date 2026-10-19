import { documentsByType } from '../../db/repositories/kycRepository.ts';
import type { KycDocument } from '@quick-bites/shared-types';

/**
 * What a restaurant must provide before it can trade, and what each document is for.
 *
 * The partner app previously showed a single opaque "KYC Docs" panel with no
 * indication of what was needed, where it went, or why anything was pending. This
 * catalogue is the source for that screen: the app renders it rather than
 * hardcoding a list, so the requirements and the review logic cannot disagree.
 */

export const RESTAURANT_DOCUMENT_TYPES = ['FSSAI', 'GSTIN', 'PAN', 'BANK_PROOF'] as const;
export type RestaurantDocumentType = (typeof RESTAURANT_DOCUMENT_TYPES)[number];

/*
 * Photographs only.
 *
 * PDF was advertised here for as long as this catalogue has existed and was
 * never once accepted: the partner app has no file browser, the upload route
 * takes an image data URI or an https link, and nothing in the platform can
 * store or render a PDF. Telling a partner a format is accepted when the only
 * control on the screen is a camera is how somebody spends an evening trying to
 * attach one.
 */
export const ACCEPTED_FORMATS = ['JPG', 'PNG'] as const;
export const MAX_UPLOAD_MB = 5;

export interface DocumentRequirement {
  documentType: RestaurantDocumentType;
  label: string;
  /** Plain-language explanation of why this is being asked for. */
  purpose: string;
  required: boolean;
  acceptedFormats: readonly string[];
  maxSizeMb: number;
  /** What the reviewer needs to be able to read on the uploaded file. */
  mustShow: string;
}

export const RESTAURANT_DOCUMENT_CATALOGUE: DocumentRequirement[] = [
  {
    documentType: 'FSSAI',
    label: 'FSSAI food licence',
    purpose:
      'Proves the kitchen is licensed to prepare and sell food. Required by law for every food business in India, and shown on the customer bill.',
    required: true,
    acceptedFormats: ACCEPTED_FORMATS,
    maxSizeMb: MAX_UPLOAD_MB,
    mustShow: 'The 14-digit licence number and the expiry date, both legible.'
  },
  {
    documentType: 'PAN',
    label: 'PAN card',
    purpose:
      'Identifies the business for tax. Payouts cannot be released without it, because tax is deducted against this number.',
    required: true,
    acceptedFormats: ACCEPTED_FORMATS,
    maxSizeMb: MAX_UPLOAD_MB,
    mustShow: 'The 10-character PAN and the registered name.'
  },
  {
    documentType: 'GSTIN',
    label: 'GST registration',
    purpose:
      'Needed if the business is GST-registered, so GST can be shown correctly on customer invoices. Skip it if the business is below the registration threshold.',
    required: false,
    acceptedFormats: ACCEPTED_FORMATS,
    maxSizeMb: MAX_UPLOAD_MB,
    mustShow: 'The 15-character GSTIN and the trade name.'
  },
  {
    documentType: 'BANK_PROOF',
    label: 'Bank account proof',
    purpose:
      'Where weekly payouts are sent. A cancelled cheque or a bank statement header is enough — this is the account the money lands in.',
    required: false,
    acceptedFormats: ACCEPTED_FORMATS,
    maxSizeMb: MAX_UPLOAD_MB,
    mustShow: 'Account number, IFSC and the account holder name.'
  }
];

export type DocumentUiStatus = 'NOT_UPLOADED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DocumentSlot extends DocumentRequirement {
  status: DocumentUiStatus;
  documentId?: string;
  documentNumber?: string;
  fileUrl?: string;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  /** True when the partner is expected to act: nothing uploaded, or it was rejected. */
  actionNeeded: boolean;
  /** An approved document stands for this type (maybe an earlier one, while a replacement waits). */
  verified: boolean;
}

export interface DocumentOverview {
  slots: DocumentSlot[];
  /** Every mandatory document approved. */
  verified: boolean;
  outstanding: string[];
  rejected: string[];
  awaitingReview: string[];
}

/**
 * Merges what was submitted onto the catalogue.
 *
 * The most recent submission for a type wins, so a re-upload after a rejection
 * replaces the rejected one in the partner's view instead of showing both.
 */
export function buildDocumentOverview(documents: KycDocument[]): DocumentOverview {
  const byType = documentsByType(documents);

  const slots: DocumentSlot[] = RESTAURANT_DOCUMENT_CATALOGUE.map(requirement => {
    const submitted = byType.get(requirement.documentType)?.latest;
    const verified = Boolean(byType.get(requirement.documentType)?.standing);
    const status: DocumentUiStatus = submitted ? submitted.status : 'NOT_UPLOADED';

    return {
      ...requirement,
      status,
      documentId: submitted?.id,
      documentNumber: submitted?.documentNumber,
      fileUrl: submitted?.fileUrl,
      submittedAt: submitted?.submittedAt,
      reviewedAt: submitted?.reviewedAt,
      rejectionReason: submitted?.rejectionReason,
      actionNeeded:
        status === 'REJECTED' || (status === 'NOT_UPLOADED' && requirement.required),
      verified
    };
  });

  const mandatory = slots.filter(s => s.required);

  return {
    slots,
    verified: mandatory.every(s => s.verified),
    outstanding: mandatory.filter(s => s.status === 'NOT_UPLOADED').map(s => s.label),
    // Refused with nothing approved standing: a refused replacement is not a problem yet.
    rejected: slots.filter(s => s.status === 'REJECTED' && !s.verified).map(s => s.label),
    awaitingReview: slots.filter(s => s.status === 'PENDING').map(s => s.label)
  };
}

/** The shape of every licence FSSAI issues: fourteen digits. */
export const FSSAI_LICENCE_NUMBER = /^\d{14}$/;

/**
 * The format each numbered document must have (T-2): FSSAI 14 digits, GSTIN the
 * 15-character GST pattern, PAN five letters, four digits, a letter. Null when it
 * is fine or the type has no fixed format. Spaces are ignored, letters any case.
 */
export function documentNumberError(type: string, number: unknown): string | null {
  const n = String(number ?? '').replace(/\s+/g, '').toUpperCase();
  if ((type === 'FSSAI' || type === 'FSSAI_LICENSE') && !FSSAI_LICENCE_NUMBER.test(n)) return 'The FSSAI licence number is 14 digits.';
  if (type === 'GSTIN' && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(n)) return 'The GSTIN must be 15 characters, like 29ABCDE1234F1Z5.';
  if (type === 'PAN' && !/^[A-Z]{5}\d{4}[A-Z]$/.test(n)) return 'The PAN is 10 characters, like ABCDE1234F.';
  return null;
}

/**
 * Whether customers may be told this kitchen's FSSAI licence was checked.
 *
 * The customer app used to print "FSSAI verified partner kitchen" on every
 * restaurant, including ones whose licence field held typed letters. A
 * licence counts as verified only when all three hold: the number on the
 * restaurant is a real 14-digit licence number, the latest FSSAI document an
 * administrator reviewed was APPROVED, and that document (when it records a
 * number) carries the same number. A kitchen activated by hand, with no
 * approved licence in the queue, gets no badge: nobody checked it here.
 */
export function isFssaiVerified(licenceNumber: unknown, documents: KycDocument[]): boolean {
  const number = typeof licenceNumber === 'string' ? licenceNumber.replace(/\s+/g, '') : '';
  if (!FSSAI_LICENCE_NUMBER.test(number)) return false;
  const standing = documentsByType(documents).get('FSSAI')?.standing;
  if (!standing) return false;
  if (standing.documentNumber && standing.documentNumber.replace(/\s+/g, '') !== number) return false;
  return true;
}
