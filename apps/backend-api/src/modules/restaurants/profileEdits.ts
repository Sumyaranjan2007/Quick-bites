import {
  EDITABLE_PROFILE_FIELDS,
  type EditableProfile,
  type EditableProfileField,
  type OpeningHours,
  type ProfileEdit,
  type ProfileEditStatus,
  type ProfileFieldRejection,
  type Restaurant
} from '@quick-bites/shared-types';
import { validateOpeningHours } from './openingHours.ts';

export { EDITABLE_PROFILE_FIELDS };
export type {
  EditableProfile,
  EditableProfileField,
  ProfileEdit,
  ProfileEditStatus,
  ProfileFieldRejection
};

/**
 * A restaurant's profile, in two versions at once.
 *
 * The owner's rule is that everything a customer sees passes a human first. That
 * has one hard consequence: a restaurant must hold what customers see AND what
 * the partner has asked it to become, at the same time. Writing an edit straight
 * onto the live record and reviewing it afterwards would put an unreviewed name,
 * or an unreviewed photograph, on the home screen for however long the queue is.
 *
 * So the live `Restaurant` is never touched until a reviewer says so. Everything
 * in flight lives here.
 *
 * The types live in `@quick-bites/shared-types`, because the partner app submits
 * them and the admin apps review them. Only the rules are here.
 */

/* ------------------------------------------------------------------ limits */

export const MAX_DESCRIPTION_CHARS = 400;
export const MAX_CUISINE_TAGS = 8;
export const MAX_GALLERY_IMAGES = 4;
export const MAX_IMAGE_CHARS = 400_000;
export const MAX_NAME_CHARS = 60;

/**
 * The same rule the document and dish uploads use: a picture, or a link to one.
 *
 * Checked on the server and not merely in the app, because the app is the part a
 * determined partner can modify. A client that skips the resize is refused here.
 */
function imageProblem(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null; // Clearing an image is allowed.
  if (trimmed.length > MAX_IMAGE_CHARS) {
    return `${label} is too large. Photograph it again — the app resizes it for you.`;
  }
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (!/^data:image\/(jpeg|jpg|png);base64,/i.test(trimmed)) {
    return `${label} must be a JPG or PNG photograph.`;
  }
  const base64 = trimmed.slice(trimmed.indexOf(',') + 1);
  if (base64.length === 0) return `${label} is empty.`;
  // Refuses a data URI whose prefix is right and whose body is prose. The prefix
  // is the part a hand-written payload gets correct.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return `${label} is not a readable image.`;
  }
  return null;
}

/** Bengaluru's bounding box, the same one registration is checked against. */
const COORDINATE_BOUNDS = {
  minLatitude: 12.7,
  maxLatitude: 13.25,
  minLongitude: 77.3,
  maxLongitude: 77.9
};

export interface ProfileValidationResult {
  ok: boolean;
  errors: string[];
  /** Present only when `ok`: the accepted fields, normalised. */
  value?: Partial<EditableProfile>;
}

/**
 * Validates a partner's requested changes.
 *
 * Every field is optional — this is a patch, not a record — but a field that IS
 * present must be right. An unknown key is refused rather than dropped, because
 * a partner who mistypes a field name and gets a 200 believes they changed
 * something they did not.
 */
export function validateProfileChanges(input: unknown): ProfileValidationResult {
  const errors: string[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Changes must be an object.'] };
  }

  const raw = input as Record<string, unknown>;
  const value: Partial<EditableProfile> = {};

  for (const key of Object.keys(raw)) {
    if (!(EDITABLE_PROFILE_FIELDS as readonly string[]).includes(key)) {
      errors.push(`"${key}" is not something a partner can change.`);
    }
  }

  const str = (key: EditableProfileField, max: number, label: string): string | undefined => {
    if (!(key in raw)) return undefined;
    const v = raw[key];
    if (typeof v !== 'string') {
      errors.push(`${label} must be text.`);
      return undefined;
    }
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      errors.push(`${label} cannot be blank.`);
      return undefined;
    }
    if (trimmed.length > max) {
      errors.push(`${label} must be ${max} characters or fewer.`);
      return undefined;
    }
    return trimmed;
  };

  const name = str('name', MAX_NAME_CHARS, 'The restaurant name');
  if (name !== undefined) value.name = name;

  if ('description' in raw) {
    const v = raw.description;
    if (typeof v !== 'string') {
      errors.push('The description must be text.');
    } else if (v.trim().length > MAX_DESCRIPTION_CHARS) {
      errors.push(`The description must be ${MAX_DESCRIPTION_CHARS} characters or fewer.`);
    } else {
      // Blank is meaningful here — it removes a description — so unlike the
      // other text fields this one is not refused for being empty.
      value.description = v.trim();
    }
  }

  if ('phone' in raw) {
    const v = raw.phone;
    if (typeof v !== 'string' || !/^[6-9]\d{9}$/.test(v.trim())) {
      errors.push('The phone number must be ten digits, starting 6 to 9.');
    } else {
      value.phone = v.trim();
    }
  }

  const addressLine = str('addressLine', 200, 'The address');
  if (addressLine !== undefined) value.addressLine = addressLine;

  const city = str('city', 60, 'The city');
  if (city !== undefined) value.city = city;

  if ('pincode' in raw) {
    const v = raw.pincode;
    if (typeof v !== 'string' || !/^\d{6}$/.test(v.trim())) {
      errors.push('The pincode must be six digits.');
    } else {
      value.pincode = v.trim();
    }
  }

  if ('coordinates' in raw) {
    const v = raw.coordinates as { latitude?: unknown; longitude?: unknown } | null;
    const latitude = Number(v?.latitude);
    const longitude = Number(v?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      errors.push('The map pin must carry a latitude and a longitude.');
    } else if (
      latitude < COORDINATE_BOUNDS.minLatitude ||
      latitude > COORDINATE_BOUNDS.maxLatitude ||
      longitude < COORDINATE_BOUNDS.minLongitude ||
      longitude > COORDINATE_BOUNDS.maxLongitude
    ) {
      errors.push('That map pin is outside the area this platform serves.');
    } else {
      value.coordinates = { latitude, longitude };
    }
  }

  if ('cuisineTags' in raw) {
    const v = raw.cuisineTags;
    if (!Array.isArray(v)) {
      errors.push('Cuisines must be a list.');
    } else if (v.length === 0) {
      errors.push('Pick at least one cuisine — it is how customers find you.');
    } else if (v.length > MAX_CUISINE_TAGS) {
      errors.push(`At most ${MAX_CUISINE_TAGS} cuisines.`);
    } else if (!v.every(t => typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 30)) {
      errors.push('Each cuisine must be text, up to 30 characters.');
    } else {
      // De-duplicated case-insensitively: "Chinese" and "chinese" on one card
      // reads as a mistake, because it is one.
      const seen = new Set<string>();
      const tags: string[] = [];
      for (const t of v as string[]) {
        const trimmed = t.trim();
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(trimmed);
      }
      value.cuisineTags = tags;
    }
  }

  if ('costForTwo' in raw) {
    const v = Number(raw.costForTwo);
    if (!Number.isFinite(v) || v <= 0) {
      errors.push('Cost for two must be a positive amount.');
    } else if (v > 10_000) {
      errors.push('Cost for two looks wrong. Check it before submitting.');
    } else {
      value.costForTwo = Math.round(v);
    }
  }

  if ('bannerUrl' in raw) {
    const v = raw.bannerUrl;
    if (typeof v !== 'string') {
      errors.push('The cover photo must be an image.');
    } else {
      const problem = imageProblem(v, 'The cover photo');
      if (problem) errors.push(problem);
      else value.bannerUrl = v.trim();
    }
  }

  if ('galleryUrls' in raw) {
    const v = raw.galleryUrls;
    if (!Array.isArray(v)) {
      errors.push('The photo gallery must be a list.');
    } else if (v.length > MAX_GALLERY_IMAGES) {
      errors.push(`At most ${MAX_GALLERY_IMAGES} photographs in the gallery.`);
    } else {
      const gallery: string[] = [];
      let bad = false;
      for (let i = 0; i < v.length; i += 1) {
        const entry = v[i];
        if (typeof entry !== 'string') {
          errors.push(`Gallery photo ${i + 1} is not an image.`);
          bad = true;
          break;
        }
        const problem = imageProblem(entry, `Gallery photo ${i + 1}`);
        if (problem) {
          errors.push(problem);
          bad = true;
          break;
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) gallery.push(trimmed);
      }
      if (!bad) value.galleryUrls = gallery;
    }
  }

  if ('openingHours' in raw) {
    const result = validateOpeningHours(raw.openingHours);
    if (!result.ok) errors.push(...result.errors);
    else value.openingHours = result.value!;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value };
}

/* --------------------------------------------------------------- diffing */

/** The live record, read through the editable field list. */
export function readEditableProfile(
  restaurant: Restaurant & { description?: string; galleryUrls?: string[]; openingHours?: OpeningHours }
): Partial<EditableProfile> {
  return {
    name: restaurant.name,
    description: restaurant.description ?? '',
    phone: restaurant.phone,
    addressLine: restaurant.addressLine,
    city: restaurant.city,
    pincode: restaurant.pincode,
    coordinates: {
      latitude: restaurant.coordinates.latitude,
      longitude: restaurant.coordinates.longitude
    },
    cuisineTags: restaurant.cuisineTags,
    costForTwo: restaurant.costForTwo ?? 0,
    bannerUrl: restaurant.bannerUrl ?? '',
    galleryUrls: restaurant.galleryUrls ?? [],
    openingHours: restaurant.openingHours
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Order matters for a gallery (the first photo is the one on the card) and
  // for cuisine tags (the first is the one shown on a narrow card), so this is
  // a straight structural comparison, not a set comparison.
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ProfileDiff {
  changes: Partial<EditableProfile>;
  previous: Partial<EditableProfile>;
  changedFields: EditableProfileField[];
}

/**
 * Keeps only the fields that genuinely differ from what is live.
 *
 * A partner app that posts the whole form on save — which is what every partner
 * app does — would otherwise put every field into review on every edit, so
 * changing a phone number would send the restaurant's name and photographs back
 * to a reviewer. That queue becomes unreadable within a week, and a reviewer
 * who is shown twelve unchanged fields stops reading any of them.
 */
export function diffProfile(
  current: Partial<EditableProfile>,
  requested: Partial<EditableProfile>
): ProfileDiff {
  const changes: Partial<EditableProfile> = {};
  const previous: Partial<EditableProfile> = {};
  const changedFields: EditableProfileField[] = [];

  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (!(field in requested)) continue;
    const next = requested[field];
    const now = current[field];
    if (sameValue(now, next)) continue;

    (changes as Record<string, unknown>)[field] = next;
    (previous as Record<string, unknown>)[field] = now;
    changedFields.push(field);
  }

  return { changes, previous, changedFields };
}

/* --------------------------------------------------------------- review */

export interface ReviewDecision {
  approve: EditableProfileField[];
  reject: ProfileFieldRejection[];
}

export interface ReviewOutcome {
  status: ProfileEditStatus;
  /** Fields to write onto the live record. Only these. */
  apply: Partial<EditableProfile>;
  approvedFields: EditableProfileField[];
  rejections: ProfileFieldRejection[];
  errors: string[];
}

/**
 * Turns a reviewer's field-by-field decision into what to write.
 *
 * Every changed field must be decided. A review that silently leaves a field
 * undecided would mark the submission closed with that change neither live nor
 * refused, and nothing would ever show it again — the partner would be left
 * waiting on a decision that had already been made without it.
 */
export function reviewProfileEdit(edit: ProfileEdit, decision: ReviewDecision): ReviewOutcome {
  const errors: string[] = [];
  const changed = Object.keys(edit.changes) as EditableProfileField[];

  const approved = decision.approve.filter(f => changed.includes(f));
  const rejected = decision.reject.filter(f => changed.includes(f.field));

  for (const field of decision.approve) {
    if (!changed.includes(field)) errors.push(`"${field}" was not part of this submission.`);
  }
  for (const entry of decision.reject) {
    if (!changed.includes(entry.field)) {
      errors.push(`"${entry.field}" was not part of this submission.`);
    } else if (!entry.reason || entry.reason.trim().length === 0) {
      errors.push(`Say why "${entry.field}" was refused — the partner has to know what to fix.`);
    }
  }

  const decided = new Set<string>([...approved, ...rejected.map(r => r.field)]);
  for (const field of changed) {
    if (!decided.has(field)) errors.push(`"${field}" has not been decided.`);
  }
  for (const field of approved) {
    if (rejected.some(r => r.field === field)) {
      errors.push(`"${field}" is both approved and refused.`);
    }
  }

  if (errors.length > 0) {
    return { status: edit.status, apply: {}, approvedFields: [], rejections: [], errors };
  }

  const apply: Partial<EditableProfile> = {};
  for (const field of approved) {
    (apply as Record<string, unknown>)[field] = edit.changes[field];
  }

  const status: ProfileEditStatus =
    rejected.length === 0 ? 'APPROVED' : approved.length === 0 ? 'REJECTED' : 'PARTIALLY_APPROVED';

  return {
    status,
    apply,
    approvedFields: approved,
    rejections: rejected.map(r => ({ field: r.field, reason: r.reason.trim() })),
    errors: []
  };
}

/**
 * Whether an approved change needs the restaurant taken off the customer feed
 * until it is live.
 *
 * Nothing in the editable list does. It is here as the single place to answer
 * that question, because the first field that DOES — a change of address far
 * enough to move which customers can reach the kitchen — will need it, and
 * scattering that decision across the routes is how it gets missed.
 */
export function requiresRelisting(fields: EditableProfileField[]): boolean {
  return fields.includes('coordinates') || fields.includes('pincode');
}
