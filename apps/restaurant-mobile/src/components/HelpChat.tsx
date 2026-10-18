import { FONT_FAMILY } from '../theme';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { c, radii, spacing } from '../theme';
import { Button, Field, ErrorNote } from './ui';
import { fetchHelpTopics, fetchHelpAnswer, raiseSupportTicket } from '../lib/partnerApi';

type Topic = { id: string; label: string; category: string };

/**
 * Help chat (master plan B8, owner Q3: fixed answers, no AI). Pick a topic, read
 * the answer filled with your own data; still stuck, "Talk to us" sends a
 * ticket that carries the chat, so support does not ask again.
 */
export const HelpChat: React.FC<{ onSent?: () => void }> = ({ onSent }) => {
  const [greeting, setGreeting] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [chat, setChat] = useState<Array<{ topic: Topic; answer: string }>>([]);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void fetchHelpTopics().then(res => {
      if (res.ok && res.data) {
        setGreeting(res.data.greeting);
        setTopics(res.data.topics);
      } else setError(res.message || 'Help could not be loaded.');
    });
  }, []);

  const pick = async (topic: Topic) => {
    setError(null);
    const res = await fetchHelpAnswer(topic.id);
    if (!res.ok || !res.data) {
      setError(res.message || 'That answer could not be loaded.');
      return;
    }
    setChat(prev => [...prev, { topic, answer: res.data!.answer }]);
  };

  const send = async () => {
    const last = chat[chat.length - 1]?.topic;
    if (message.trim().length < 10) {
      setError('Describe the problem in a sentence so our team can act on it.');
      return;
    }
    setBusy(true);
    const res = await raiseSupportTicket({
      subject: last?.label || 'Help',
      category: last?.category || 'OTHER',
      message: message.trim(),
      helpTopics: chat.map(step => step.topic.id),
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android'
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message || 'Could not send your message.');
      return;
    }
    setDone('Sent. Our team has this chat and replies within a few hours during trading time.');
    setAsking(false);
    setMessage('');
    onSent?.();
  };

  return (
    <View>
      {!!greeting && <Text style={styles.greeting}>{greeting}</Text>}
      {chat.map((step, i) => (
        <View key={i}>
          <View style={[styles.bubble, styles.mine]}>
            <Text style={styles.mineText}>{step.topic.label}</Text>
          </View>
          <View style={[styles.bubble, styles.theirs]}>
            <Text style={styles.theirsText}>{step.answer}</Text>
          </View>
        </View>
      ))}
      {!!error && <ErrorNote message={error} />}
      {!!done && <Text style={styles.done}>{done}</Text>}
      {!asking && (
        <View style={styles.chips}>
          {topics.map(topic => (
            <TouchableOpacity key={topic.id} style={styles.chip} onPress={() => void pick(topic)}>
              <Text style={styles.chipText}>{topic.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {chat.length > 0 && !asking && <Button label="Still need help? Talk to us" variant="ghost" onPress={() => setAsking(true)} />}
      {asking && (
        <>
          <Field label="What is the problem?" value={message} onChangeText={setMessage} multiline placeholder="Tell us what happened." />
          <Button label="Send to Quick Bites" busy={busy} onPress={() => void send()} />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  greeting: { fontFamily: FONT_FAMILY, fontSize: 15, fontWeight: '700', color: c.text, marginBottom: spacing.sm },
  bubble: { padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.sm, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', backgroundColor: c.brand },
  mineText: { color: '#FFFFFF', fontWeight: '600' },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.brandSoft },
  theirsText: { color: c.text, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  chip: { borderWidth: 1, borderColor: c.brand, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: c.brand, fontWeight: '600', fontFamily: FONT_FAMILY, fontSize: 13 },
  done: { color: c.success, marginVertical: spacing.sm }
});
