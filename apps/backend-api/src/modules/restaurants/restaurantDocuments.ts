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
  const latestByType = new Map<string, KycDocument>();
  for (const doc of documents) {
    const existing = latestByType.get(doc.documentType);
    if (!existing || new Date(doc.submittedAt).getTime() > new Date(existing.submittedAt).getTime()) {
      latestByType.set(doc.documentType, doc);
    }
  }

  const slots: DocumentSlot[] = RESTAURANT_DOCUMENT_CATALOGUE.map(requirement => {
    const submitted = latestByType.get(requirement.documentType);
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
        status === 'REJECTED' || (status === 'NOT_UPLOADED' && requirement.required)
    };
  });

  const mandatory = slots.filter(s => s.required);

  return {
    slots,
    verified: mandatory.every(s => s.status === 'APPROVED'),
    outstanding: mandatory.filter(s => s.status === 'NOT_UPLOADED').map(s => s.label),
    rejected: slots.filter(s => s.status === 'REJECTED').map(s => s.label),
    awaitingReview: slots.filter(s => s.status === 'PENDING').map(s => s.label)
  };
}
