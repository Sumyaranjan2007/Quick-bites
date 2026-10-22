/**
 * The first-time location guide (owner, 22 Oct 2026, round 6): a new customer is
 * walked through setting where to deliver, once per phone, and never again.
 * Pure (no React Native), so the backend suite can check it.
 */
export type GuideStep = 'hidden' | 'find' | 'save' | 'done';

export const GUIDE_DONE_KEY = 'qb.locationGuideDone.v1';

export function locationGuideStep(s: {
  signedIn: boolean;
  /** The saved addresses were really read (offline is not "none"). */
  addressesLoaded: boolean;
  savedCount: number;
  /** A spot was chosen (GPS or map) but not saved yet. */
  picked: boolean;
  /** Finished on this phone before; unknown until storage is read, treated as finished. */
  guideDone: boolean;
  justSaved: boolean;
}): GuideStep {
  if (!s.signedIn || !s.addressesLoaded || s.guideDone) return 'hidden';
  if (s.justSaved) return 'done';
  if (s.savedCount > 0) return 'hidden';
  return s.picked ? 'save' : 'find';
}
