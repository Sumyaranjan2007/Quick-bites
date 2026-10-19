import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * Help as a real chat (owner, 19 Oct 2026). The person types; a ready answer
 * that matches is sent back at once; still stuck, "Talk to a person" opens a
 * ticket and Operations answers in this same thread (polled every 6 s), and both
 * keep writing. The same file in the Customer, Partner and Rider apps: each app
 * passes its own API calls and colours.
 */
export type Topic = { id: string; label: string; category: string };
export type Ticket = {
  id: string;
  status: string;
  message: string;
  raisedByUserId: string;
  createdAt: string;
  replies: Array<{ byUserId: string; byName: string; body: string; at: string }>;
};
export interface ChatApi {
  help(): Promise<{ greeting: string; topics: Topic[] }>;
  answer(topicId: string): Promise<string>;
  match(text: string): Promise<{ topic: Topic | null; answer: string | null }>;
  tickets(): Promise<Ticket[]>;
  ticket(id: string): Promise<Ticket>;
  raise(body: { subject: string; category: string; message: string; helpTopics: string[]; platform: 'android' | 'ios' | 'web' }): Promise<Ticket>;
  reply(id: string, body: string): Promise<Ticket>;
}
export interface ChatColours {
  brand: string;
  brandSoft: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  danger: string;
}

type Line = { from: 'me' | 'bot' | 'staff'; text: string };
const OPEN = ['OPEN', 'IN_PROGRESS'];
const RESUME_MS = 7 * 24 * 3_600_000;

export const SupportChat: React.FC<{ api: ChatApi; colours: ChatColours; font?: string }> = ({ api, colours: c, font }) => {
  const [lines, setLines] = useState<Line[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [asked, setAsked] = useState<Topic[]>([]);
  const [typed, setTyped] = useState<string[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [offerPerson, setOfferPerson] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const s = styles(c, font);

  const say = (line: Line) => setLines(prev => [...prev, line]);

  // A ticket's thread as chat lines: the first message and every reply, mine or staff's.
  const threadOf = (t: Ticket): Line[] => [
    { from: 'me', text: t.message },
    ...t.replies.map(r => ({ from: r.byUserId === t.raisedByUserId ? 'me' : 'staff', text: r.body }) as Line)
  ];

  useEffect(() => {
    (async () => {
      try {
        const [help, mine] = await Promise.all([api.help(), api.tickets().catch(() => [] as Ticket[])]);
        setTopics(help.topics);
        const open = mine.find(t => OPEN.includes(t.status) && Date.now() - Date.parse(t.createdAt) < RESUME_MS);
        if (open) {
          setTicket(open);
          setLines([{ from: 'bot', text: 'You are talking to the Quick Bites team. Write here and we will reply in this chat.' }, ...threadOf(open)]);
        } else {
          setLines([{ from: 'bot', text: `${help.greeting} Type your question, or pick one below.` }]);
        }
      } catch {
        setError('Help could not be loaded. Check your connection.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While connected to a person, their replies arrive here.
  useEffect(() => {
    if (!ticket) return;
    const timer = setInterval(() => {
      api
        .ticket(ticket.id)
        .then(fresh => {
          if (fresh.replies.length === ticket.replies.length) return;
          setTicket(fresh);
          setLines(prev => [...prev.filter(l => l.from === 'bot').slice(0, 1), ...threadOf(fresh)]);
        })
        .catch(() => undefined);
    }, 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.replies.length]);

  const connect = async (lastWords?: string) => {
    const words = [...typed, ...(lastWords ? [lastWords] : [])].join('\n');
    const about = asked[asked.length - 1];
    const message = words.length >= 10 ? words : `I need help with: ${about?.label || 'something else'}. ${words}`.trim();
    const made = await api.raise({
      subject: (about?.label || words.split('\n')[0] || 'Help').slice(0, 120).padEnd(3, '.'),
      category: about?.category || 'OTHER',
      message: message.slice(0, 2000),
      helpTopics: asked.map(t => t.id),
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android'
    });
    setTicket(made);
    setOfferPerson(false);
    say({ from: 'bot', text: 'You are now connected to the Quick Bites team. They have this chat and will reply here.' });
  };

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err: any) {
      setError(err?.message || 'That did not go through. Try again.');
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const send = () => {
    const words = text.trim();
    if (!words || busy) return;
    setText('');
    say({ from: 'me', text: words });
    void run(async () => {
      if (ticket) {
        setTicket(await api.reply(ticket.id, words));
        return;
      }
      setTyped(prev => [...prev, words]);
      const found = await api.match(words);
      if (found.topic && found.answer) {
        setAsked(prev => [...prev, found.topic!]);
        say({ from: 'bot', text: found.answer });
        setOfferPerson(true);
      } else {
        say({ from: 'bot', text: 'Let me get someone from our team for you.' });
        await connect(words);
      }
    });
  };

  const pick = (topic: Topic) =>
    run(async () => {
      say({ from: 'me', text: topic.label });
      setAsked(prev => [...prev, topic]);
      say({ from: 'bot', text: await api.answer(topic.id) });
      setOfferPerson(true);
    });

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={80}>
      <ScrollView ref={scroll} contentContainerStyle={s.thread} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {lines.map((line, i) => (
          <View key={i} style={[s.bubble, line.from === 'me' ? s.mine : s.theirs]}>
            {line.from === 'staff' ? <Text style={s.who}>Quick Bites team</Text> : null}
            <Text style={line.from === 'me' ? s.mineText : s.theirsText}>{line.text}</Text>
          </View>
        ))}
        {offerPerson && !ticket ? (
          <View style={s.row}>
            <TouchableOpacity style={s.chip} onPress={() => setOfferPerson(false)}>
              <Text style={s.chipText}>That helped</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.chip, s.chipStrong]} onPress={() => void run(() => connect())}>
              <Text style={[s.chipText, { color: '#FFFFFF' }]}>Talk to a person</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!ticket && topics.length ? (
          <View style={s.row}>
            {topics.map(t => (
              <TouchableOpacity key={t.id} style={s.chip} onPress={() => void pick(t)} disabled={busy}>
                <Text style={s.chipText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={ticket ? 'Write to the Quick Bites team' : 'Type your question'}
          placeholderTextColor={c.muted}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity style={[s.send, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={s.sendText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = (c: ChatColours, font?: string) =>
  StyleSheet.create({
    root: { flex: 1 },
    thread: { padding: 16, paddingBottom: 24, gap: 8 },
    bubble: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, maxWidth: '85%' },
    mine: { alignSelf: 'flex-end', backgroundColor: c.brand, borderBottomRightRadius: 4 },
    theirs: { alignSelf: 'flex-start', backgroundColor: c.brandSoft, borderBottomLeftRadius: 4 },
    who: { fontFamily: font, fontSize: 11, fontWeight: '700', color: c.brand, marginBottom: 2 },
    mineText: { fontFamily: font, color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
    theirsText: { fontFamily: font, color: c.text, fontSize: 15, lineHeight: 21 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    chip: { borderWidth: 1, borderColor: c.brand, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13, backgroundColor: c.card },
    chipStrong: { backgroundColor: c.brand },
    chipText: { fontFamily: font, color: c.brand, fontWeight: '600', fontSize: 13 },
    error: { fontFamily: font, color: c.danger, marginTop: 6 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontFamily: font,
      fontSize: 15,
      color: c.text
    },
    send: { height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' },
    sendText: { fontFamily: font, color: '#FFFFFF', fontWeight: '700', fontSize: 15 }
  });
