/**
 * The web build of this app is served by the API server itself (at /admin or
 * /partner), so it talks to the server it was loaded from — production, or a
 * QA server, with no rebuild. EXPO_PUBLIC_API_URL overrides it for local
 * development, where the page comes from Expo's dev server instead.
 *
 * Native builds use config.ts; Metro picks this file only for the web.
 */
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || `${window.location.origin}/api`;
