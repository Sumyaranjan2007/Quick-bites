import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiFetch } from './apiFetch';
import { socketOriginFrom } from './useOrderSocket';

/**
 * The conversation between a customer and the rider carrying their order.
 *
 * History comes over HTTP so a reopened screen shows what was already said;
 * new messages arrive on the order's socket room, the same channel the status
 * and rider position already use. A message the caller sends is not echoed into
 * the list locally - it comes back through the socket like everyone else's, so
 * there is one ordering of the thread rather than two that can disagree.
 */
export interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  body: string;
  sentAt: string;
}

export function useOrderChat(
  orderId: string | undefined,
  apiUrl: string | undefined,
  token: string | undefined,
  /** Closed orders keep their history but accept no new messages. */
  canSend: boolean
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    if (!orderId || !apiUrl || !token) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/orders/${orderId}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.messages)) {
        setMessages(data.data.messages);
        setError(null);
      }
    } catch {
      setError('Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [orderId, apiUrl, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!orderId || !apiUrl || !token) return;

    const socket = io(socketOriginFrom(apiUrl), {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join:order', { orderId }));
    socket.on('order:message', (message: ChatMessage) => {
      if (message?.orderId !== orderId) return;
      setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));
    });

    return () => {
      socket.emit('leave:order', { orderId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [orderId, apiUrl, token]);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      const text = body.trim();
      if (!text || !orderId || !apiUrl || !token || !canSend) return false;
      setSending(true);
      setError(null);
      try {
        const res = await apiFetch(`${apiUrl}/orders/${orderId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ body: text })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(data?.error?.message || 'Message could not be sent.');
          return false;
        }
        // The socket delivers it; adding it here too would duplicate it.
        return true;
      } catch {
        setError('Message could not be sent. Check your connection.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [orderId, apiUrl, token, canSend]
  );

  return { messages, loading, sending, error, send, reload: load };
}
