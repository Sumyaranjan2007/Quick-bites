/**
 * Session handling for the restaurant partner portal.
 *
 * The portal used to sign itself in from client code with a hardcoded
 * `partner@quickbite.app` / `pass123`, so those credentials shipped inside the
 * JavaScript bundle served to every visitor — and, the repository being public, were
 * readable on GitHub as well. Anyone opening the deployed URL could read a live
 * restaurant's orders and change its menu. Partners now sign in as themselves.
 *
 * The token is kept in sessionStorage rather than localStorage so it dies with the
 * browser tab instead of lingering on a shared terminal in a kitchen.
 */

const STORAGE_KEY = 'qb.partner.session';

export interface PartnerSession {
  token: string;
  user: { id: string; email: string; fullName: string; role: string };
  restaurantId?: string;
}

let cached: PartnerSession | null = null;

export function getSession(): PartnerSession | null {
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    cached = JSON.parse(raw) as PartnerSession;
    return cached;
  } catch {
    return null;
  }
}

export function setSession(session: PartnerSession): void {
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

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
