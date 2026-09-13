import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Keeps a staff screen in step with the rest of the platform.
 *
 * These apps had no live channel and no polling at all: a new order, a claimed
 * pickup or a completed delivery only appeared when the user happened to tap
 * refresh. The backend was already emitting every one of these events.
 *
 * The caller keeps its manual refresh as a fallback — websockets are blocked on
 * some mobile networks, and a screen that silently stops updating is worse than
 * one the user can pull.
 */
export type LiveRoom =
  | { kind: 'restaurant'; restaurantId: string }
  | { kind: 'riders' }
  | { kind: 'admin' };

/** The socket server lives at the origin; the REST base carries an /api suffix. */
export function socketOriginFrom(apiUrl: string): string {
  return apiUrl.replace(/\/api(\/v1)?\/?$/, '');
}

export function useLiveUpdates(
  room: LiveRoom | null,
  apiUrl: string | undefined,
  token: string | undefined,
  /** Called whenever anything about the caller's work changed. */
  onChange: (event: string, payload: any) => void
) {
  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const roomKey = room ? JSON.stringify(room) : null;

  useEffect(() => {
    if (!room || !apiUrl || !token) return;

    const socket: Socket = io(socketOriginFrom(apiUrl), {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    const join = () => {
      if (room.kind === 'restaurant') socket.emit('join:restaurant', { restaurantId: room.restaurantId });
      else if (room.kind === 'riders') socket.emit('join:riders');
      else socket.emit('join:admin');
    };

    socket.on('connect', () => {
      setConnected(true);
      join();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    const forward = (event: string) => (payload: any) => onChangeRef.current(event, payload);
    socket.on('order:created', forward('order:created'));
    socket.on('order:status_update', forward('order:status_update'));
    socket.on('order:available', forward('order:available'));
    socket.on('menu:updated', forward('menu:updated'));
    socket.on('kitchen:status_update', forward('kitchen:status_update'));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [roomKey, apiUrl, token]);

  return { connected };
}
