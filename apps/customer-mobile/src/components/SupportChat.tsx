import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLiveSync } from '../lib/liveSync';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useKeyboardOffset } from '../lib/keyboardOffset';

/**
 * Help as a real chat (owner, 19-20 Oct 2026). The person types; a ready answer
 * that matches is sent back at once; still stuck, "Talk to a person" opens a
 * ticket and Operations answers in this same thread, live (the server's `sync`
 * reloads it the moment staff write). "My issue is solved" (or staff resolving it)
 * moves the chat to History and starts a fresh one. The same file in the
 * Customer, Partner and Rider apps: each app passes its own API calls and colours.
 */
export type Topic = { id: string; label: string; category: string };
export type Ticket = {
  id: string;
  status: string;
  subject?: string;
  message: string;
  raisedByUserId: string;
  createdAt: string;
  updatedAt?: string;
  replies: Array<{ byUserId: string; byName: string; body: string; at: string }>;
  /** Live chat (round 6): newest message, and whether each side has seen it. */
  lastMessageAt?: string;
  staffReadAt?: string;
  unreadForUser?: boolean;
};
export interface ChatApi {
  help(): Promise<{ greeting: string; topics: Topic[]; order?: { id: string; orderNumber: string } | null }>;
  answer(topicId: string): Promise<string>;
  match(text: string): Promise<{ topic: Topic | null; answer: string | null }>;
  tickets(): Promise<Ticket[]>;
  ticket(id: string): Promise<Ticket>;
  raise(body: { subject: string; category: string; message: string; helpTopics: string[]; platform: 'android' | 'ios' | 'web'; orderId?: string }): Promise<Ticket>;
  reply(id: string, body: string): Promise<Ticket>;
  /** The person says their issue is solved: the chat moves to History. */
  resolve(id: string): Promise<Ticket>;
  /** The person has seen the chat (Operations sees "Seen"). */
  read(id: string): Promise<unknown>;
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

type Line = { from: 'me' | 'bot' | 'staff'; text: string; at?: string; sending?: boolean };
const OPEN = ['OPEN', 'IN_PROGRESS'];
// Only these end a chat (round 6): anything else, including an answer that could not be read, keeps it open.
const DONE = ['RESOLVED', 'CLOSED'];
const CONNECTED =
  'You are talking to the Quick Bites team. This chat stays open until it is solved: you can close the app and come back any time.';

const clock = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** A ticket's thread as chat lines: the first message and every reply, mine or staff's. */
const threadOf = (t: Ticket): Line[] => [
  { from: 'me', text: t.message, at: t.createdAt },
  ...t.replies.map(r => ({ from: r.byUserId === t.raisedByUserId ? 'me' : 'staff', text: r.body, at: r.at }) as Line)
];

export const SupportChat: React.FC<{ api: ChatApi; colours: ChatColours; font?: string; historyFooter?: React.ReactNode }> = ({
  api,
  colours: c,
  font,
  historyFooter
}) => {
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [lines, setLines] = useState<Line[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [greeting, setGreeting] = useState('');
  // The order Help was opened about ("Ask support to cancel"), carried onto the ticket (R3-9).
  const [about, setAbout] = useState<{ id: string; orderNumber: string } | null>(null);
  const [asked, setAsked] = useState<Topic[]>([]);
  const [typed, setTyped] = useState<string[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [mine, setMine] = useState<Ticket[]>([]);
  const [reading, setReading] = useState<Ticket | null>(null);
  const [offerPerson, setOfferPerson] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Until the person's chats are read, nothing may start a second one (round 6).
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const readUpTo = useRef('');
  const scroll = useRef<ScrollView>(null);
  const keyboardOffset = useKeyboardOffset();
  const s = styles(c, font);

  const say = (line: Line) => setLines(prev => [...prev, { at: new Date().toISOString(), ...line }]);
  const fresh = (hello = greeting) => [{ from: 'bot', text: `${hello} Type your question, or pick one below.` } as Line];

  // Opens on the person's open chat, however old (it stays until solved); otherwise a fresh one.
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const [help, list] = await Promise.all([api.help(), api.tickets()]);
        setTopics(help.topics);
        setGreeting(help.greeting);
        setAbout(help.order || null);
        setMine(list);
        const open = list.find(t => OPEN.includes(t.status));
        if (open) {
          setTicket(open);
          setLines([{ from: 'bot', text: CONNECTED }, ...threadOf(open)]);
        } else {
          setLines([...fresh(help.greeting), ...(help.order ? [{ from: 'bot', text: `About order #${help.order.orderNumber}.` } as Line] : [])]);
        }
        setLoaded(true);
      } catch {
        // Not "you have no chats": an open chat may be there, so nothing starts until it is read.
        setError('Your chats could not be loaded. Check your connection and tap Retry.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // "Seen" for Operations: once per new staff message, only while the chat is on screen.
  useEffect(() => {
    if (tab !== 'chat' || !ticket?.unreadForUser || !ticket.lastMessageAt || readUpTo.current === ticket.lastMessageAt) return;
    readUpTo.current = ticket.lastMessageAt;
    void api.read(ticket.id).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ticket?.id, ticket?.lastMessageAt, ticket?.unreadForUser]);

  /** The chat ends (solved by the person or by staff): it goes to History and a new one starts. */
  const endChat = (closed: Ticket, note: string) => {
    setTicket(null);
    setAsked([]);
    setTyped([]);
    setOfferPerson(false);
    setMine(prev => [closed, ...prev.filter(t => t.id !== closed.id)]);
    setLines([...fresh(), { from: 'bot', text: note }]);
  };

  // Staff replies and decisions arrive live: the server's `sync` re-reads the open chat at once.
  const refresh = async () => {
    if (!ticket) return;
    try {
      const latest = await api.ticket(ticket.id);
      if (DONE.includes(latest?.status)) {
        endChat(latest, 'Quick Bites marked this chat as solved. It is in History. Write here any time to start a new chat.');
        return;
      }
      if (!latest?.replies) return;
      setTicket(latest);
      if (latest.replies.length === ticket.replies.length) return;
      setLines([{ from: 'bot', text: CONNECTED }, ...threadOf(latest)]);
    } catch {
      /* kept as it is; the next change or the fallback below retries */
    }
  };
  useLiveSync(refresh);
  // Fallback for networks that block the live channel.
  useEffect(() => {
    if (!ticket) return;
    const timer = setInterval(() => void refresh(), 15_000);
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
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
      ...(about ? { orderId: about.id } : {})
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
    if (!words || busy || !loaded) return;
    setText('');
    // Shown at once, like any messenger; ticked when the server has it.
    say({ from: 'me', text: words, sending: Boolean(ticket) });
    void run(async () => {
      if (ticket) {
        try {
          const saved = await api.reply(ticket.id, words);
          setTicket(saved);
          setLines([{ from: 'bot', text: CONNECTED }, ...threadOf(saved)]);
        } catch (err) {
          setLines(prev => prev.filter(l => !(l.sending && l.text === words)));
          setText(words);
          throw err;
        }
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

  const solved = () =>
    run(async () => {
      if (!ticket) return;
      const closed = await api.resolve(ticket.id);
      endChat(closed, 'Glad it is sorted. This chat is in History.');
    });

  const history = mine.filter(t => DONE.includes(t.status));
  // "Seen" under my last message once Operations has read past it.
  const lastMine = ticket ? lines.reduce((at, l) => (l.from === 'me' && l.at ? l.at : at), '') : '';
  const seen = Boolean(ticket?.staffReadAt && lastMine && ticket.staffReadAt >= lastMine);

  const bubble = (line: Line, i: number) => (
    <View key={i} style={[s.bubble, line.from === 'me' ? s.mine : s.theirs]}>
      {line.from === 'staff' ? <Text style={s.who}>Quick Bites team</Text> : null}
      <Text style={line.from === 'me' ? s.mineText : s.theirsText}>{line.text}</Text>
      {line.at ? (
        <Text style={[s.meta, line.from === 'me' && { color: 'rgba(255,255,255,0.8)' }]}>
          {clock(line.at)}
          {line.from === 'me' && ticket ? (line.sending ? '  ·  sending' : seen && line.at === lastMine ? '  ✓✓ Seen' : '  ✓') : ''}
        </Text>
      ) : null}
    </View>
  );

  const tabs = (
    <View style={s.tabs}>
      {(['chat', 'history'] as const).map(key => (
        <TouchableOpacity
          key={key}
          style={[s.tab, tab === key && s.tabOn]}
          onPress={() => {
            setTab(key);
            setReading(null);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === key }}
        >
          <Text style={[s.tabText, tab === key && s.tabTextOn]}>
            {key === 'chat' ? 'Chat' : `Request history${history.length ? ` (${history.length})` : ''}`}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (tab === 'history') {
    return (
      <View style={s.root}>
        {tabs}
        {reading ? (
          <ScrollView contentContainerStyle={s.thread}>
            <TouchableOpacity onPress={() => setReading(null)} hitSlop={10}>
              <Text style={s.back}>‹ All requests</Text>
            </TouchableOpacity>
            <Text style={s.histTitle}>{reading.subject || reading.message.slice(0, 60)}</Text>
            <Text style={s.histSub}>
              {day(reading.createdAt)} · {reading.status === 'CLOSED' ? 'Closed' : 'Solved'}
            </Text>
            {threadOf(reading).map(bubble)}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={s.thread}>
            {history.length === 0 ? <Text style={s.histSub}>Solved requests appear here.</Text> : null}
            {history.map(t => (
              <TouchableOpacity key={t.id} style={s.histRow} onPress={() => setReading(t)} accessibilityRole="button">
                <Text style={s.histTitle} numberOfLines={1}>
                  {t.subject || t.message.slice(0, 60)}
                </Text>
                <Text style={s.histSub}>
                  {day(t.updatedAt || t.createdAt)} · {t.status === 'CLOSED' ? 'Closed' : 'Solved'} · {t.replies.length + 1} messages
                </Text>
              </TouchableOpacity>
            ))}
            {historyFooter}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      {...keyboardOffset} style={s.root} behavior="padding">
      {tabs}
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {lines.map(bubble)}
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
        {ticket ? (
          <View style={s.row}>
            <TouchableOpacity style={s.chip} onPress={() => void solved()} disabled={busy}>
              <Text style={s.chipText}>My issue is solved</Text>
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
        {!loaded && error ? (
          <TouchableOpacity style={s.chip} onPress={() => setAttempt(n => n + 1)} accessibilityRole="button">
            <Text style={s.chipText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
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
        <TouchableOpacity style={[s.send, (!text.trim() || busy || !loaded) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || busy || !loaded}>
          {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={s.sendText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = (c: ChatColours, font?: string) =>
  StyleSheet.create({
    root: { flex: 1 },
    tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
    tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: c.brand },
    tabText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: c.muted },
    tabTextOn: { color: c.brand },
    thread: { padding: 16, paddingBottom: 24, gap: 8 },
    bubble: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, maxWidth: '85%' },
    mine: { alignSelf: 'flex-end', backgroundColor: c.brand, borderBottomRightRadius: 4 },
    theirs: { alignSelf: 'flex-start', backgroundColor: c.brandSoft, borderBottomLeftRadius: 4 },
    who: { fontFamily: font, fontSize: 11, fontWeight: '700', color: c.brand, marginBottom: 2 },
    mineText: { fontFamily: font, color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
    theirsText: { fontFamily: font, color: c.text, fontSize: 15, lineHeight: 21 },
    meta: { fontFamily: font, fontSize: 10, color: c.muted, alignSelf: 'flex-end', marginTop: 2 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    chip: { borderWidth: 1, borderColor: c.brand, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: c.card, minHeight: 36 },
    chipStrong: { backgroundColor: c.brand },
    chipText: { fontFamily: font, color: c.brand, fontWeight: '600', fontSize: 13 },
    error: { fontFamily: font, color: c.danger, marginTop: 6 },
    back: { fontFamily: font, color: c.brand, fontWeight: '700', fontSize: 14, marginBottom: 8 },
    histRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    histTitle: { fontFamily: font, color: c.text, fontWeight: '700', fontSize: 15 },
    histSub: { fontFamily: font, color: c.muted, fontSize: 12, marginTop: 2 },
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
