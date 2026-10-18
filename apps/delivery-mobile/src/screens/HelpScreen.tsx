import { FONT_FAMILY } from '../theme';
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { t } from '../theme';
import { Button, Card } from '../components/ui';
import { api, type ApiContext } from '../lib/api';

type Topic = { id: string; label: string; category: string };

/**
 * Help chat (master plan B8, owner Q3: fixed answers, no AI). Pick a topic, read
 * the answer filled with your own trips and payouts; still stuck, "Talk to us"
 * sends a ticket that carries the chat, so support does not ask again.
 */
export const HelpScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [greeting, setGreeting] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [chat, setChat] = useState<Array<{ topic: Topic; answer: string }>>([]);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api
      .helpTopics(ctx)
      .then(data => {
        setGreeting(data.greeting);
        setTopics(data.topics);
      })
      .catch(err => setError(err?.message || 'Help could not be loaded.'));
  }, [ctx]);

  const pick = async (topic: Topic) => {
    setError(null);
    try {
      const data = await api.helpAnswer(ctx, topic.id);
      setChat(prev => [...prev, { topic, answer: data.answer }]);
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
      await api.raiseSupportTicket(ctx, {
        subject: last?.label || 'Help',
        category: last?.category || 'OTHER',
        message: message.trim(),
        helpTopics: chat.map(step => step.topic.id),
        platform: Platform.OS === 'ios' ? 'ios' : 'android'
      });
      setDone('Sent. Our team has this chat and will reply soon.');
      setAsking(false);
      setMessage('');
    } catch (err: any) {
      setError(err?.message || 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Card>
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
        {chat.length > 0 && !asking ? <Button label="Still need help? Talk to us" variant="secondary" onPress={() => setAsking(true)} /> : null}
        {asking ? (
          <>
            <TextInput
              style={s.input}
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="Tell us what happened."
              placeholderTextColor={t.color.textMuted}
            />
            <Button label="Send to Quick Bites" loading={busy} onPress={() => void send()} />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[5] },
  greeting: { fontFamily: FONT_FAMILY, fontSize: 16, fontWeight: '700', color: t.color.text, marginBottom: t.space[3] },
  bubble: { padding: t.space[3], borderRadius: t.radius.md, marginBottom: t.space[2], maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', backgroundColor: t.color.brand },
  mineText: { color: '#FFFFFF', fontWeight: '600' },
  theirs: { alignSelf: 'flex-start', backgroundColor: t.color.brandSoft },
  theirsText: { color: t.color.text, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2], marginVertical: t.space[3] },
  chip: { borderWidth: 1, borderColor: t.color.brand, borderRadius: t.radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: t.color.brand, fontWeight: '600', fontFamily: FONT_FAMILY, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    padding: t.space[3],
    minHeight: 90,
    color: t.color.text,
    marginBottom: t.space[3],
    textAlignVertical: 'top'
  },
  error: { color: t.color.danger, marginVertical: t.space[2] },
  done: { color: t.color.goText, marginVertical: t.space[2] }
});
