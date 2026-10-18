import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { tokens } from '../theme/tokens';
import { Button } from './ui';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;
type Topic = { id: string; label: string; category: string };

/**
 * Help chat (master plan B8, owner Q3: fixed answers, no AI). Pick a topic,
 * read the answer filled with your latest order; still stuck, "Talk to us"
 * sends a ticket carrying the chat, so support does not ask again.
 */
export const HelpChat: React.FC<{ apiUrl?: string; token?: string; onSent?: () => void }> = ({ apiUrl, token, onSent }) => {
  const [greeting, setGreeting] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [chat, setChat] = useState<Array<{ topic: Topic; answer: string }>>([]);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!apiUrl || !token) return;
    apiFetch(`${apiUrl}/support/help`, { headers })
      .then(r => r.json())
      .then(data => {
        if (!data?.success) throw new Error(data?.error?.message);
        setGreeting(data.data.greeting);
        setTopics(data.data.topics);
      })
      .catch(() => setError('Help could not be loaded. Check your connection.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token]);

  const pick = async (topic: Topic) => {
    setError(null);
    try {
      const data = await apiFetch(`${apiUrl}/support/help/${encodeURIComponent(topic.id)}`, { headers }).then(r => r.json());
      if (!data?.success) throw new Error(data?.error?.message);
      setChat(prev => [...prev, { topic, answer: data.data.answer }]);
    } catch (err: any) {
      setError(err?.message || 'That answer could not be loaded.');
    }
  };

  const send = async () => {
    const last = chat[chat.length - 1]?.topic;
    if (message.trim().length < 10) {
      setError('Describe the problem in a sentence so our team can act on it.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch(`${apiUrl}/support/tickets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject: last?.label || 'Help',
          category: last?.category || 'OTHER',
          message: message.trim(),
          helpTopics: chat.map(step => step.topic.id),
          platform: Platform.OS === 'ios' ? 'ios' : 'android'
        })
      }).then(r => r.json());
      if (!data?.success) throw new Error(data?.error?.message);
      setDone('Sent. Our team has this chat and will reply here soon.');
      setAsking(false);
      setMessage('');
      onSent?.();
    } catch (err: any) {
      setError(err?.message || 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) return null;
  return (
    <View>
      {!!greeting && <Text style={s.greeting}>{greeting}</Text>}
      {chat.map((step, i) => (
        <View key={i}>
          <View style={[s.bubble, s.mine]}>
            <Text style={s.mineText}>{step.topic.label}</Text>
          </View>
          <View style={[s.bubble, s.theirs]}>
            <Text style={s.theirsText}>{step.answer}</Text>
          </View>
        </View>
      ))}
      {!!error && <Text style={s.error}>{error}</Text>}
      {!!done && <Text style={s.done}>{done}</Text>}
      {!asking && (
        <View style={s.chips}>
          {topics.map(topic => (
            <TouchableOpacity key={topic.id} style={s.chip} onPress={() => void pick(topic)}>
              <Text style={s.chipText}>{topic.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {chat.length > 0 && !asking ? <Button label="Still need help? Talk to us" variant="outline" onPress={() => setAsking(true)} /> : null}
      {asking ? (
        <>
          <TextInput
            style={s.input}
            value={message}
            onChangeText={setMessage}
            multiline
            placeholder="Tell us what happened."
            placeholderTextColor={c.text.muted}
          />
          <Button label="Send to Quick Bites" loading={busy} onPress={() => void send()} />
        </>
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  greeting: { fontFamily: tokens.font.family, fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.bold, color: c.text.primary, marginBottom: 10 },
  bubble: { padding: 12, borderRadius: tokens.radii.lg, marginBottom: 8, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', backgroundColor: c.primary[600] },
  mineText: { color: c.text.inverse, fontWeight: tokens.font.weight.semibold },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.primary[50] },
  theirsText: { color: c.text.primary, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  chip: { borderWidth: 1, borderColor: c.primary[600], borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: c.primary[600], fontWeight: tokens.font.weight.semibold, fontFamily: tokens.font.family, fontSize: tokens.font.size.sm },
  input: {
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: tokens.radii.lg,
    padding: 12,
    minHeight: 90,
    color: c.text.primary,
    marginBottom: 10,
    textAlignVertical: 'top'
  },
  error: { color: c.semantic.error, marginVertical: 6 },
  done: { color: c.semantic.success, marginVertical: 6 }
});
