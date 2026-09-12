import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Subscribes to live updates for a single order.
 *
 * The backend has always emitted these events; nothing consumed them, so every
 * screen fell back to polling and updates lagged by up to the poll interval.
 *
 * Polling is deliberately kept as a fallback by the caller: websockets get
 * blocked on some mobile networks and captive portals, and a tracker that
 * silently stops updating is worse than a slow one.
 */
export interface RiderLocation {
  orderId: string;
  lat: number;
  lng: number;
  bearing?: number;
  updatedAt: string;
}

export interface OrderStatusUpdate {
  orderId: string;
  status: string;
  updatedAt: string;
}

/** The socket server lives at the origin; the REST base carries an /api suffix. */
export function socketOriginFrom(apiUrl: string): string {
  return apiUrl.replace(/\/api(\/v1)?\/?$/, '');
}

export function useOrderSocket(
  orderId: string | undefined,
  apiUrl: string | undefined,
  token: string | undefined,
  handlers: {
    onStatus?: (u: OrderStatusUpdate) => void;
    onRiderLocation?: (l: RiderLocation) => void;
  }
) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Keep the latest callbacks without forcing a reconnect on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!orderId || !apiUrl) return;

    const socket = io(socketOriginFrom(apiUrl), {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join:order', { orderId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('order:status_update', (u: OrderStatusUpdate) => handlersRef.current.onStatus?.(u));
    socket.on('rider:location_update', (l: RiderLocation) => handlersRef.current.onRiderLocation?.(l));

    return () => {
      socket.emit('leave:order', { orderId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [orderId, apiUrl, token]);

  return { connected };
}
