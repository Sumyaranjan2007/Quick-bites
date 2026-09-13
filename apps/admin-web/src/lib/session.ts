/**
 * Session handling for the admin portal.
 *
 * This portal used to sign itself in from client code with a hardcoded
 * `admin@quickbite.app` / `pass123`, which meant the credentials shipped inside the
 * JavaScript bundle served to every visitor — and, because the repository is public,
 * were readable on GitHub too. Anyone who opened the deployed URL got an
 * administrator session. The operator now signs in with their own credentials.
 *
 * The token is kept in sessionStorage rather than localStorage so it dies with the
 * browser tab instead of persisting on a shared machine.
 */

const STORAGE_KEY = 'qb.admin.session';

export interface AdminSession {
  token: string;
  user: { id: string; email: string; fullName: string; role: string };
}

let cached: AdminSession | null = null;

export function getSession(): AdminSession | null {
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    cached = JSON.parse(raw) as AdminSession;
    return cached;
  } catch {
    return null;
  }
}

export function setSession(session: AdminSession): void {
  cached = session;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A browser with site data blocked still works for the life of the tab.
  }
}

export function clearSession(): void {
  cached = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

export function getToken(): string {
  return getSession()?.token ?? '';
}

/** Authorization header for an authenticated call, or an empty object when signed out. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
