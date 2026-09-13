import React, { useEffect, useRef, useState } from 'react';
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
import { tokens } from '../theme/tokens';
import { useOrderChat } from '../lib/useOrderChat';

const c = tokens.colors;

interface Props {
  visible: boolean;
  onClose: () => void;
  orderId?: string;
  apiUrl?: string;
  token?: string;
  riderName?: string | null;
  /** False once the order is closed: history stays, the composer goes. */
  canSend: boolean;
  currentUserId?: string;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${suffix}`;
}

export const OrderChat: React.FC<Props> = ({
  visible,
  onClose,
  orderId,
  apiUrl,
  token,
  riderName,
  canSend,
  currentUserId
}) => {
  const { messages, loading, sending, error, send } = useOrderChat(orderId, apiUrl, token, canSend);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView | null>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length, visible]);

  const onSend = async () => {
    const text = draft;
    if (!text.trim()) return;
    const ok = await send(text);
    if (ok) setDraft('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Chat with {riderName || 'your delivery partner'}</Text>
              <Text style={styles.subtitle}>About this order only</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
              <X size={19} color={c.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={styles.threadContent}
            keyboardShouldPersistTaps="handled"
          >
            {loading && messages.length === 0 ? (
              <ActivityIndicator color={c.primary[500]} style={{ marginTop: 24 }} />
            ) : messages.length === 0 ? (
              <Text style={styles.empty}>
                No messages yet. Send a delivery instruction — a gate number, a landmark, or where to leave it.
              </Text>
            ) : (
              messages.map(m => {
                const mine = m.senderId === currentUserId;
                return (
                  <View key={m.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      {!mine && <Text style={styles.sender}>{m.senderName}</Text>}
                      <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
                      <Text style={[styles.time, mine && styles.timeMine]}>{timeOf(m.sentAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {canSend ? (
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Message your delivery partner"
                placeholderTextColor={c.text.muted}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]}
                onPress={onSend}
                disabled={!draft.trim() || sending}
                activeOpacity={0.85}
              >
                {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send size={17} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.closedNote}>This order is complete, so the chat is now read-only.</Text>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,16,20,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.app,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '86%',
    minHeight: '55%',
    paddingBottom: 14
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  title: { fontSize: 16.5, fontWeight: '800', color: c.text.primary },
  subtitle: { fontSize: 12, color: c.text.muted, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken
  },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10 },
  empty: { color: c.text.muted, fontSize: 13.5, textAlign: 'center', marginTop: 28, lineHeight: 20 },
  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleTheirs: { backgroundColor: c.surface.card, borderWidth: 1, borderColor: c.border.subtle },
  bubbleMine: { backgroundColor: c.primary[500] },
  sender: { fontSize: 11.5, fontWeight: '700', color: c.text.secondary, marginBottom: 3 },
  body: { fontSize: 14.5, color: c.text.primary, lineHeight: 20 },
  bodyMine: { color: '#FFFFFF' },
  time: { fontSize: 10.5, color: c.text.muted, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.75)' },
  error: { color: c.semantic.error, fontSize: 12.5, paddingHorizontal: 18, paddingBottom: 6, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    backgroundColor: c.surface.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border.medium,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 14.5,
    color: c.text.primary
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.primary[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  closedNote: {
    color: c.text.muted,
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 18,
    paddingTop: 12
  }
});
