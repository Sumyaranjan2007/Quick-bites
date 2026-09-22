/**
 * Where this app talks to Quick Bites.
 *
 * One value, in one file. It used to be a literal inside a screen — the same
 * production URL written out in six different places across the four apps, so
 * pointing a build at a different backend meant finding and editing all of
 * them, and missing one meant a build that was half against production.
 *
 * The Server settings panel on the sign-in screen overrides this at runtime,
 * which is what a tester uses against a local API. This is only the default a
 * fresh install starts from.
 */
export const DEFAULT_API_URL = 'https://quick-bites-production.up.railway.app/api';
