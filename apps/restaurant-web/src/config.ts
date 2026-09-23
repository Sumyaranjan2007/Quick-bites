/**
 * Where this console talks to Quick Bites.
 *
 * One value, in one file. VITE_API_URL overrides it at build time, which is how
 * a staging deployment is pointed somewhere else without editing source.
 */
export const DEFAULT_API_URL =
  ((import.meta as any).env?.VITE_API_URL as string) || 'https://quick-bites-production.up.railway.app/api';
