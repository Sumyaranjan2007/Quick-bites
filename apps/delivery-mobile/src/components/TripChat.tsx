import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native';
import { X, Send } from 'lucide-react-native';
import { t } from '../theme';
import { api, type ApiContext, type OrderMessage } from '../lib/api';

/**
 * The rider's half of the customer conversation.
 *
 * The customer app has been able to message its rider for some time. The rider
 * app had no chat at all — no screen, no socket subscription, nothing — so
 * messages were accepted by the server, stored, and broadcast to a room with
 * nobody in it. From the customer's side that looked like a rider ignoring them.
 *
 * History arrives over HTTP so a reopened thread is complete; new messages
 * arrive on the order's socket room, the same channel the customer app uses. A
 * sent message is not echoed locally — it comes back through the socket like
 * any other, so both ends agree on the order of the conversation.
 */
interface Props {
  visible: boolean;
  onClose: () => void;
  ctx: ApiContext;
  orderId?: string;
  customerName?: string | null;
  /** Closed trips keep their history but take no new messages. */
  canSend: boolean;
  selfUserId?: string;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const TripChat: React.FC<Props> = ({
  visible,
  onClose,
  ctx,
  orderId,
  customerName,
  canSend,
  selfUserId
}) => {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const socketRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!orderId || !ctx.apiUrl || !ctx.token) return;
    setLoading(true);
    try {
      const data = await api.orderMessages(ctx, orderId);
      setMessages(data.messages || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the conversation.');
    } finally {
      setLoading(false);
    }
  }, [orderId, ctx.apiUrl, ctx.token]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // The socket is held only while the thread is open. A rider spends most of a
  // shift not reading messages, and a second always-on connection per trip is a
  // battery cost with nothing to show for it.
  useEffect(() => {
    if (!visible || !orderId || !ctx.apiUrl || !ctx.token) return;

    const { io } = require('socket.io-client');
    const origin = ctx.apiUrl.replace(/\/api(\/v1)?\/?$/, '');
    const socket = io(origin, {
      transports: ['websocket', 'polling'],
      auth: { token: ctx.token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join:order', { orderId }));
    socket.on('order:message', (message: OrderMessage) => {
      if (message?.orderId !== orderId) return;
      setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));
    });

    return () => {
      socket.emit('leave:order', { orderId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [visible, orderId, ctx.apiUrl, ctx.token]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages.length, visible]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !orderId || sending) return;
    setSending(true);
    try {
      await api.sendOrderMessage(ctx, orderId, body);
      setDraft('');
      setError(null);
      // The socket echo is authoritative, but a message must never look lost if
      // the socket is down; reloading covers that without duplicating a message
      // that did arrive, because the merge is by id.
      if (!socketRef.current?.connected) await load();
    } catch (err: any) {
      setError(err?.message || 'That message did not send.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.sheet}
        >
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>
                {customerName || 'Customer'}
              </Text>
              <Text style={s.subtitle}>Messages about this delivery</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={22} color={t.color.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView ref={scrollRef} contentContainerStyle={s.thread}>
            {loading && messages.length === 0 ? (
              <ActivityIndicator color={t.color.go} style={{ marginTop: t.space[6] }} />
            ) : messages.length === 0 ? (
              <Text style={s.empty}>
                No messages yet. Tell the customer if you are held up, or ask for directions to the door.
              </Text>
            ) : (
              messages.map(message => {
                const mine = message.senderId === selfUserId || message.senderRole === 'rider';
                return (
                  <View key={message.id} style={[s.bubbleRow, mine ? s.bubbleRowMine : null]}>
                    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                      {!mine && <Text style={s.sender}>{message.senderName}</Text>}
                      <Text style={[s.body, mine ? s.bodyMine : null]}>{message.body}</Text>
                      <Text style={[s.time, mine ? s.timeMine : null]}>{timeOf(message.sentAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {!!error && <Text style={s.error}>{error}</Text>}

          {canSend ? (
            <View style={s.composer}>
              <TextInput
                style={s.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Message the customer…"
                placeholderTextColor={t.color.textMuted}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[s.sendButton, (!draft.trim() || sending) && s.sendButtonOff]}
                onPress={send}
                disabled={!draft.trim() || sending}
                activeOpacity={0.85}
              >
                {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send size={18} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={s.closed}>This delivery is complete. The conversation is read-only.</Text>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    minHeight: '62%'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space[3],
    padding: t.space[4],
    borderBottomWidth: 1,
    borderBottomColor: t.color.border
  },
  title: { fontSize: 16, fontWeight: '800', color: t.color.text },
  subtitle: { fontSize: 11, color: t.color.textMuted, marginTop: 2 },
  thread: { padding: t.space[4], gap: t.space[3], flexGrow: 1 },
  empty: { color: t.color.textMuted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: t.space[6] },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: t.space[3], paddingVertical: t.space[2], gap: 2 },
  bubbleTheirs: { backgroundColor: t.color.surfaceRaised, borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: t.color.go, borderTopRightRadius: 4 },
  sender: { fontSize: 10, fontWeight: '800', color: t.color.textMuted },
  body: { fontSize: 14, color: t.color.text, lineHeight: 20 },
  bodyMine: { color: '#04301F' },
  time: { fontSize: 9, color: t.color.textMuted, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(4,48,31,0.6)' },
  error: { color: t.color.danger, fontSize: 12, paddingHorizontal: t.space[4], paddingBottom: t.space[2] },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: t.space[2],
    padding: t.space[3],
    borderTopWidth: 1,
    borderTopColor: t.color.border
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    backgroundColor: t.color.surfaceSunken,
    borderRadius: 14,
    paddingHorizontal: t.space[3],
    paddingVertical: t.space[2],
    color: t.color.text,
    fontSize: 14
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.color.go,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sendButtonOff: { opacity: 0.4 },
  closed: {
    padding: t.space[4],
    fontSize: 12,
    color: t.color.textMuted,
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: t.color.border
  }
});
