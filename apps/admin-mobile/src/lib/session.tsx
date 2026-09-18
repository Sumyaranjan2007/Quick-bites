/**
 * Who is signed in, and what they are allowed to do.
 *
 * The permission list comes from the server on sign-in and is what the console
 * builds its navigation from. It is a convenience, not a control: the same
 * permission is enforced on every route, so a section that slipped through would
 * be refused rather than served. Hiding it keeps an administrator from walking
 * into a wall of refusals for work that is not theirs.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createClient, type ApiClient } from './api';

export { DEFAULT_API_URL } from '../config';
import { DEFAULT_API_URL } from '../config';

export interface AdminIdentity {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: Array<{ id: string; label: string; description: string }>;
}

export interface SessionState {
  token: string;
  apiUrl: string;
  user: AdminIdentity | null;
  roleName: string;
  roleId: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
  permissionCatalogue: PermissionGroup[];
}

interface SessionValue extends SessionState {
  api: ApiClient;
  can: (...permissions: string[]) => boolean;
  signIn: (state: SessionState) => void;
  signOut: () => void;
  refreshAccess: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const EMPTY: SessionState = {
  token: '',
  apiUrl: DEFAULT_API_URL,
  user: null,
  roleName: '',
  roleId: null,
  isSuperAdmin: false,
  permissions: [],
  permissionCatalogue: []
};

export const SessionProvider: React.FC<{ children: React.ReactNode; onSignOut?: () => void }> = ({
  children,
  onSignOut
}) => {
  const [state, setState] = useState<SessionState>(EMPTY);

  const api = useMemo(() => createClient(state.apiUrl, state.token), [state.apiUrl, state.token]);

  const can = useCallback(
    (...permissions: string[]) => {
      if (state.isSuperAdmin) return true;
      return permissions.some(permission => state.permissions.includes(permission));
    },
    [state.isSuperAdmin, state.permissions]
  );

  const signIn = useCallback((next: SessionState) => setState(next), []);

  const signOut = useCallback(() => {
    setState(current => ({ ...EMPTY, apiUrl: current.apiUrl }));
    onSignOut?.();
  }, [onSignOut]);

  /**
   * Re-reads the caller's access.
   *
   * A Super Admin editing roles is often editing their own colleagues' while
   * those colleagues have the console open; this is how a narrowed role reaches
   * the navigation without a sign-out.
   */
  const refreshAccess = useCallback(async () => {
    const data = await api.get<any>('/admin/me');
    setState(current => ({
      ...current,
      user: data.user,
      roleName: data.role?.name || (data.isSuperAdmin ? 'Super Admin' : 'Unassigned'),
      roleId: data.role?.id || null,
      isSuperAdmin: Boolean(data.isSuperAdmin),
      permissions: data.permissions || [],
      permissionCatalogue: data.permissionCatalogue || []
    }));
  }, [api]);

  const value = useMemo<SessionValue>(
    () => ({ ...state, api, can, signIn, signOut, refreshAccess }),
    [state, api, can, signIn, signOut, refreshAccess]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
