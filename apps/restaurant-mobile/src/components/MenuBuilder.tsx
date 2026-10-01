/**
 * The Menu Builder: a whole menu, laid out and sent at once (owner, 1 Oct 2026).
 *
 * SHARED, WORD FOR WORD, BY THE PARTNER APP AND THE ADMIN APP
 * (restaurant-mobile/src/components/MenuBuilder.tsx and
 * admin-mobile/src/components/MenuBuilder.tsx). Everything app-specific — the
 * colours, how a photo is taken, which server route reads a menu photo or
 * receives a batch — comes in through props, so the two copies stay identical
 * and a fix to one is a copy to the other. A source check asserts they match.
 *
 * What it does:
 *   - sections → dishes, each with name, description, price, Veg/Non-veg
 *     (required, no default), sizes (2–4), extras, photo;
 *   - "Read menu photos": each page photo goes to OUR server, which asks the AI
 *     to read it, and the result is merged into this draft. Nothing is sent
 *     for approval until a person has checked it and pressed Send;
 *   - the draft is kept on the phone as it is typed, photos in their own files,
 *     so closing the app loses nothing;
 *   - Send checks every dish against the same rules the server enforces, then
 *     sends the menu in small batches under one batch id. A batch that was
 *     received but whose answer was lost is not duplicated on retry.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

/* ------------------------------------------------------------------------- */
/*                               Types and rules                             */
/* ------------------------------------------------------------------------- */

export interface BuilderPalette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  brand: string;
  onBrand: string;
  veg: string;
  nonVeg: string;
  warn: string;
  warnBg: string;
  danger: string;
}

interface Choice {
  name: string;
  price: string;
}

export interface DraftDish {
  id: string;
  name: string;
  description: string;
  price: string;
  isVeg: boolean | null;
  sizes: Choice[];
  extras: Choice[];
  /** Kept in its own file on the phone; loaded with the draft. */
  imageUrl?: string;
  /** Things the AI was unsure of, for the person to check. Cleared on edit. */
  flags: string[];
}

export interface DraftSection {
  id: string;
  name: string;
  dishes: DraftDish[];
}

interface Draft {
  sections: DraftSection[];
  /** Fixed once a send starts, so a retry re-sends the same batch. */
  batchId?: string;
  /** How many dishes the server has already accepted from this batch. */
  sentCount?: number;
  fromAi?: boolean;
}

export interface MenuBatchPayload {
  batchId: string;
  startIndex: number;
  items: Array<{
    name: string;
    description?: string;
    price: number;
    isVeg: boolean;
    categoryName: string;
    imageUrl?: string;
    sizes?: Array<{ name: string; price: number }>;
    extras?: Array<{ name: string; price: number }>;
  }>;
  final: boolean;
  fromAiDraft?: boolean;
}

export interface AiDraftSection {
  name: string;
  items: Array<{
    name: string;
    description?: string;
    price: number | null;
    isVeg: boolean | null;
    sizes: Array<{ name: string; price: number }>;
    extras: Array<{ name: string; price: number }>;
    flags: string[];
  }>;
}

export interface MenuBuilderProps {
  /** Where the draft is kept on this phone, e.g. `menu-draft:<restaurantId>`. */
  storageKey: string;
  title: string;
  subtitle?: string;
  palette: BuilderPalette;
  /** Takes or chooses ONE dish photo; returns a data URI or null. */
  pickDishPhoto: (source: 'camera' | 'library') => Promise<string | null>;
  /** Takes one page, or chooses several; returns data URIs. */
  pickMenuPages: (source: 'camera' | 'library') => Promise<string[]>;
  /** Reads one page photo on the server. Throws an Error with a readable message. */
  readMenuPhoto: (dataUri: string) => Promise<{ sections: AiDraftSection[]; warnings: string[] }>;
  /** Sends one batch. Throws an Error with a readable message. */
  sendBatch: (batch: MenuBatchPayload) => Promise<void>;
  /** Called once the whole menu is sent. */
  onSent: (dishCount: number) => void;
  onClose: () => void;
  /** The words on the send button and the confirmation. */
  sendLabel?: string;
}

const DISHES_PER_BATCH = 4;
const MAX_PAGES = 8;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const money = (v: string) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
};
const filled = (rows: Choice[]) => rows.filter(r => r.name.trim() || r.price.trim());

/** Every rule the server applies to a dish, in words a partner can act on. */
export function dishProblems(d: DraftDish, sectionName: string): string[] {
  const out: string[] = [];
  if (!sectionName.trim()) out.push('The section needs a name.');
  if (sectionName.trim().length > 80) out.push('The section name is too long.');
  if (d.name.trim().length < 1) out.push('Give the dish a name.');
  if (d.name.trim().length > 120) out.push('The dish name is too long.');
  if (d.description.trim().length > 400) out.push('The description is too long (400 letters at most).');
  if (d.isVeg === null) out.push('Choose Veg or Non-veg.');
  const sizes = filled(d.sizes);
  const extras = filled(d.extras);
  if (sizes.length === 1) out.push('Give at least 2 sizes, or none.');
  if (sizes.length > 4) out.push('At most 4 sizes.');
  if (sizes.some(s => !s.name.trim() || money(s.price) === null)) out.push('Every size needs a name and a price.');
  if (new Set(sizes.map(s => s.name.trim().toLowerCase())).size !== sizes.length) out.push('Two sizes have the same name.');
  if (extras.length > 10) out.push('At most 10 extras.');
  if (extras.some(s => !s.name.trim() || money(s.price) === null)) out.push('Every extra needs a name and a price.');
  if (new Set(extras.map(s => s.name.trim().toLowerCase())).size !== extras.length) out.push('Two extras have the same name.');
  if (sizes.length < 2 && money(d.price) === null) out.push('Enter a price.');
  return out;
}

/** The dish as the server's schema expects it. */
function toPayload(d: DraftDish, sectionName: string): MenuBatchPayload['items'][number] {
  const sizes = filled(d.sizes).map(s => ({ name: s.name.trim(), price: money(s.price)! }));
  const extras = filled(d.extras).map(s => ({ name: s.name.trim(), price: money(s.price)! }));
  return {
    name: d.name.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    price: sizes.length >= 2 ? Math.min(...sizes.map(s => s.price)) : money(d.price)!,
    isVeg: d.isVeg === true,
    categoryName: sectionName.trim(),
    ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
    ...(sizes.length >= 2 ? { sizes } : {}),
    ...(extras.length ? { extras } : {})
  };
}

/** Folds one AI-read page into the draft: sections by name, dishes appended. */
export function mergeAiPage(draft: Draft, page: AiDraftSection[]): Draft {
  const sections = draft.sections.map(s => ({ ...s, dishes: [...s.dishes] }));
  for (const section of page) {
    let target = sections.find(s => s.name.trim().toLowerCase() === section.name.trim().toLowerCase());
    if (!target) {
      target = { id: uid(), name: section.name, dishes: [] };
      sections.push(target);
    }
    for (const item of section.items) {
      target.dishes.push({
        id: uid(),
        name: item.name,
        description: item.description || '',
        price: item.price !== null && item.price !== undefined ? String(item.price) : '',
        isVeg: item.isVeg,
        sizes: (item.sizes || []).map(s => ({ name: s.name, price: String(s.price) })),
        extras: (item.extras || []).map(s => ({ name: s.name, price: String(s.price) })),
        flags: item.flags || []
      });
    }
  }
  return { ...draft, sections, fromAi: true };
}

/* ------------------------------------------------------------------------- */
/*                         The draft, kept on the phone                      */
/* ------------------------------------------------------------------------- */

const photoDir = (key: string) =>
  `${FileSystem.documentDirectory}menu-builder/${key.replace(/[^A-Za-z0-9_-]/g, '_')}/`;

async function saveDraft(key: string, draft: Draft): Promise<void> {
  const dir = photoDir(key);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const wanted = new Set<string>();
  const slim: Draft = {
    ...draft,
    sections: draft.sections.map(s => ({
      ...s,
      dishes: s.dishes.map(d => {
        if (d.imageUrl) {
          wanted.add(`${d.id}.txt`);
          return { ...d, imageUrl: 'file' };
        }
        return d;
      })
    }))
  };
  for (const s of draft.sections) {
    for (const d of s.dishes) {
      if (!d.imageUrl) continue;
      const path = `${dir}${d.id}.txt`;
      const info = await FileSystem.getInfoAsync(path).catch(() => ({ exists: false }) as any);
      if (!info.exists) await FileSystem.writeAsStringAsync(path, d.imageUrl);
    }
  }
  // Photos of dishes that were removed are deleted with them.
  const present = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  for (const name of present) {
    if (!wanted.has(name)) await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => undefined);
  }
  await AsyncStorage.setItem(key, JSON.stringify(slim));
}

async function loadDraft(key: string): Promise<Draft | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Draft;
    const dir = photoDir(key);
    for (const s of draft.sections) {
      for (const d of s.dishes) {
        if (d.imageUrl === 'file') {
          d.imageUrl = await FileSystem.readAsStringAsync(`${dir}${d.id}.txt`).catch(() => undefined);
        }
      }
    }
    return draft;
  } catch {
    return null;
  }
}

async function clearDraft(key: string): Promise<void> {
  await AsyncStorage.removeItem(key).catch(() => undefined);
  await FileSystem.deleteAsync(photoDir(key), { idempotent: true }).catch(() => undefined);
}

/* ------------------------------------------------------------------------- */
/*                                The screen                                 */
/* ------------------------------------------------------------------------- */

export const MenuBuilder: React.FC<MenuBuilderProps> = props => {
  const { palette: p } = props;
  const s = useMemo(() => makeStyles(p), [p]);

  const [draft, setDraft] = useState<Draft>({ sections: [] });
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ sectionId: string; dish: DraftDish } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadDraft(props.storageKey).then(d => {
      if (cancelled) return;
      if (d) setDraft(d);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [props.storageKey]);

  // Saved shortly after every change, so a closed app loses at most a keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDraft(props.storageKey, draft).catch(() => undefined);
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, loaded, props.storageKey]);

  const dishCount = draft.sections.reduce((t, sec) => t + sec.dishes.length, 0);
  const problems = useMemo(() => {
    const list: Array<{ sectionId: string; dish: DraftDish; problems: string[] }> = [];
    for (const sec of draft.sections) {
      for (const d of sec.dishes) {
        const pr = dishProblems(d, sec.name);
        if (pr.length) list.push({ sectionId: sec.id, dish: d, problems: pr });
      }
    }
    return list;
  }, [draft]);
  const flagged = draft.sections.reduce((t, sec) => t + sec.dishes.filter(d => d.flags.length).length, 0);

  const updateSection = (id: string, patch: Partial<DraftSection>) =>
    setDraft(d => ({ ...d, sections: d.sections.map(sec => (sec.id === id ? { ...sec, ...patch } : sec)) }));

  const addSection = () =>
    setDraft(d => ({ ...d, sections: [...d.sections, { id: uid(), name: '', dishes: [] }] }));

  const removeSection = (sec: DraftSection) => {
    const go = () => setDraft(d => ({ ...d, sections: d.sections.filter(x => x.id !== sec.id) }));
    if (sec.dishes.length === 0) return go();
    Alert.alert('Remove this section?', `${sec.name || 'This section'} and its ${sec.dishes.length} dish(es) will be removed from the draft.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go }
    ]);
  };

  const newDish = (sectionId: string) =>
    setEditing({
      sectionId,
      dish: { id: uid(), name: '', description: '', price: '', isVeg: null, sizes: [], extras: [], flags: [] }
    });

  const saveDish = (sectionId: string, dish: DraftDish) => {
    setDraft(d => ({
      ...d,
      sections: d.sections.map(sec => {
        if (sec.id !== sectionId) return sec;
        const exists = sec.dishes.some(x => x.id === dish.id);
        return { ...sec, dishes: exists ? sec.dishes.map(x => (x.id === dish.id ? dish : x)) : [...sec.dishes, dish] };
      })
    }));
    setEditing(null);
  };

  const removeDish = (sectionId: string, dishId: string) => {
    setDraft(d => ({
      ...d,
      sections: d.sections.map(sec => (sec.id === sectionId ? { ...sec, dishes: sec.dishes.filter(x => x.id !== dishId) } : sec))
    }));
    setEditing(null);
  };

  /* ------------------------------ AI reading ----------------------------- */

  const readPages = async (source: 'camera' | 'library') => {
    setGuideOpen(false);
    let pages: string[] = [];
    try {
      pages = (await props.pickMenuPages(source)).slice(0, MAX_PAGES);
    } catch (err: any) {
      Alert.alert('Could not use that photo', err?.message || 'Try again.');
      return;
    }
    if (pages.length === 0) return;
    setReading({ done: 0, total: pages.length });
    const failures: string[] = [];
    let found = 0;
    for (let i = 0; i < pages.length; i++) {
      try {
        const result = await props.readMenuPhoto(pages[i]);
        found += result.sections.reduce((t, sec) => t + sec.items.length, 0);
        setDraft(d => mergeAiPage(d, result.sections));
        if (result.sections.length === 0) failures.push(`Page ${i + 1}: ${result.warnings[0] || 'nothing could be read.'}`);
      } catch (err: any) {
        failures.push(`Page ${i + 1}: ${err?.message || 'could not be read.'}`);
        // The reader being off or the day's limit being reached will not
        // change for the next page.
        if (/not switched on|daily limit/i.test(String(err?.message))) break;
      }
      setReading({ done: i + 1, total: pages.length });
    }
    setReading(null);
    Alert.alert(
      found ? `${found} dish${found === 1 ? '' : 'es'} read` : 'Nothing was read',
      [
        found ? 'Check every dish, add photos, then send the menu. Dishes marked in amber need a look.' : '',
        ...failures
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  };

  /* -------------------------------- Sending ------------------------------ */

  const send = async () => {
    if (dishCount === 0) {
      Alert.alert('Nothing to send', 'Add at least one dish first.');
      return;
    }
    if (problems.length) {
      setShowProblems(true);
      Alert.alert(
        `${problems.length} dish${problems.length === 1 ? ' needs' : 'es need'} a fix`,
        'They are listed at the top. Tap one to fix it.'
      );
      return;
    }
    const batchId = draft.batchId || `mb_${uid()}`;
    if (!draft.batchId) setDraft(d => ({ ...d, batchId, sentCount: 0 }));

    const all = draft.sections.flatMap(sec => sec.dishes.map(d => toPayload(d, sec.name)));
    let sent = draft.sentCount || 0;
    setSending({ done: sent, total: all.length });
    try {
      while (sent < all.length) {
        const items = all.slice(sent, sent + DISHES_PER_BATCH);
        await props.sendBatch({
          batchId,
          startIndex: sent,
          items,
          final: sent + items.length >= all.length,
          ...(draft.fromAi ? { fromAiDraft: true } : {})
        });
        sent += items.length;
        setDraft(d => ({ ...d, batchId, sentCount: sent }));
        setSending({ done: sent, total: all.length });
      }
    } catch (err: any) {
      setSending(null);
      Alert.alert(
        'The menu was not fully sent',
        `${sent} of ${all.length} dishes reached us. ${err?.message || ''}\n\nPress Send again to send the rest — nothing will be sent twice.`
      );
      return;
    }
    setSending(null);
    await clearDraft(props.storageKey);
    setDraft({ sections: [] });
    props.onSent(all.length);
  };

  /* -------------------------------- Render ------------------------------- */

  if (!loaded) {
    return (
      <View style={[s.screen, s.centre]}>
        <ActivityIndicator color={p.brand} />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{props.title}</Text>
          {!!props.subtitle && <Text style={s.subtitle}>{props.subtitle}</Text>}
        </View>
        <TouchableOpacity onPress={props.onClose} style={s.closeBtn} accessibilityLabel="Close the menu builder">
          <Text style={s.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.cardTitle}>Read your printed menu with AI</Text>
          <Text style={s.cardBody}>
            Photograph each page. The AI fills in sections, dishes, prices, sizes and Veg/Non-veg. You check it, add
            dish photos, then send. Nothing goes live until it is approved.
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => setGuideOpen(true)} disabled={!!reading}>
            <Text style={s.primaryText}>{reading ? `Reading page ${reading.done + 1} of ${reading.total}…` : 'Read menu photos'}</Text>
          </TouchableOpacity>
        </View>

        {showProblems && problems.length > 0 && (
          <View style={[s.card, { borderColor: p.danger }]}>
            <Text style={[s.cardTitle, { color: p.danger }]}>Fix these before sending</Text>
            {problems.slice(0, 20).map(pr => (
              <TouchableOpacity key={pr.dish.id} onPress={() => setEditing({ sectionId: pr.sectionId, dish: pr.dish })}>
                <Text style={s.problemLine}>
                  • {pr.dish.name || 'Unnamed dish'}: {pr.problems[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {draft.sections.map(sec => (
          <View key={sec.id} style={s.card}>
            <View style={s.sectionHead}>
              <TextInput
                style={s.sectionInput}
                value={sec.name}
                onChangeText={name => updateSection(sec.id, { name })}
                placeholder="Section name, e.g. Starters"
                placeholderTextColor={p.muted}
                maxLength={80}
              />
              <TouchableOpacity onPress={() => removeSection(sec)} accessibilityLabel="Remove section">
                <Text style={s.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
            {sec.dishes.map(d => {
              const sizes = filled(d.sizes);
              const priceText =
                sizes.length >= 2
                  ? sizes.map(x => `${x.name} Rs ${x.price}`).join(' · ')
                  : d.price
                    ? `Rs ${d.price}`
                    : 'No price';
              const bad = dishProblems(d, sec.name).length > 0;
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[s.dishRow, (d.flags.length > 0 || bad) && { backgroundColor: p.warnBg }]}
                  onPress={() => setEditing({ sectionId: sec.id, dish: d })}
                >
                  <View
                    style={[
                      s.dietBox,
                      { borderColor: d.isVeg === null ? p.muted : d.isVeg ? p.veg : p.nonVeg }
                    ]}
                  >
                    <View style={[s.dietDot, { backgroundColor: d.isVeg === null ? p.muted : d.isVeg ? p.veg : p.nonVeg }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dishName} numberOfLines={1}>
                      {d.name || 'Unnamed dish'}
                    </Text>
                    <Text style={s.dishMeta} numberOfLines={1}>
                      {priceText}
                      {filled(d.extras).length ? ` · ${filled(d.extras).length} extra${filled(d.extras).length === 1 ? '' : 's'}` : ''}
                    </Text>
                    {(d.flags.length > 0 || bad) && (
                      <Text style={s.flagLine} numberOfLines={1}>
                        {d.flags[0] || dishProblems(d, sec.name)[0]}
                      </Text>
                    )}
                  </View>
                  {d.imageUrl ? <Image source={{ uri: d.imageUrl }} style={s.thumb} /> : <Text style={s.noPhoto}>No photo</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={s.ghostBtn} onPress={() => newDish(sec.id)}>
              <Text style={s.ghostText}>+ Add a dish</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={s.ghostBtn} onPress={addSection}>
          <Text style={s.ghostText}>+ Add a section</Text>
        </TouchableOpacity>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={s.footer}>
        <Text style={s.footerText}>
          {dishCount} dish{dishCount === 1 ? '' : 'es'} in {draft.sections.length} section{draft.sections.length === 1 ? '' : 's'}
          {flagged ? ` · ${flagged} to check` : ''}
        </Text>
        <TouchableOpacity style={[s.primaryBtn, { marginTop: 8 }, (sending || dishCount === 0) && { opacity: 0.6 }]} onPress={send} disabled={!!sending}>
          {sending ? (
            <Text style={s.primaryText}>
              Sending {sending.done} of {sending.total}…
            </Text>
          ) : (
            <Text style={s.primaryText}>{props.sendLabel || 'Send whole menu for approval'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* How to photograph a menu — said BEFORE the camera opens. */}
      <Modal visible={guideOpen} transparent animationType="fade" onRequestClose={() => setGuideOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Clear photos read best</Text>
            {[
              'Lay the page flat, in good light, with no shadow across it.',
              'Fit the whole page in the frame, one page per photo.',
              'Hold the phone straight above the page and keep it steady.',
              'Avoid glare from a laminated menu: tilt it away from the light.',
              `Up to ${MAX_PAGES} pages at a time.`
            ].map(line => (
              <Text key={line} style={s.guideLine}>
                • {line}
              </Text>
            ))}
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 14 }]} onPress={() => readPages('camera')}>
              <Text style={s.primaryText}>Take a photo of a page</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ghostBtn, { marginTop: 8 }]} onPress={() => readPages('library')}>
              <Text style={s.ghostText}>Choose page photos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ghostBtn, { marginTop: 4, borderWidth: 0 }]} onPress={() => setGuideOpen(false)}>
              <Text style={[s.ghostText, { color: p.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {editing && (
        <DishEditor
          palette={p}
          styles={s}
          sectionName={draft.sections.find(x => x.id === editing.sectionId)?.name || ''}
          dish={editing.dish}
          pickDishPhoto={props.pickDishPhoto}
          onCancel={() => setEditing(null)}
          onSave={dish => saveDish(editing.sectionId, dish)}
          onRemove={() => removeDish(editing.sectionId, editing.dish.id)}
        />
      )}
    </View>
  );
};

/* ------------------------------------------------------------------------- */
/*                              One dish, edited                             */
/* ------------------------------------------------------------------------- */

const DishEditor: React.FC<{
  palette: BuilderPalette;
  styles: ReturnType<typeof makeStyles>;
  sectionName: string;
  dish: DraftDish;
  pickDishPhoto: MenuBuilderProps['pickDishPhoto'];
  onCancel: () => void;
  onSave: (dish: DraftDish) => void;
  onRemove: () => void;
}> = ({ palette: p, styles: s, sectionName, dish, pickDishPhoto, onCancel, onSave, onRemove }) => {
  const [d, setD] = useState<DraftDish>(dish);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const problems = dishProblems(d, sectionName || 'x');

  const setRow = (key: 'sizes' | 'extras', i: number, patch: Partial<Choice>) =>
    setD(x => ({ ...x, [key]: x[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const photo = useCallback(
    async (source: 'camera' | 'library') => {
      setBusyPhoto(true);
      try {
        const uri = await pickDishPhoto(source);
        if (uri) setD(x => ({ ...x, imageUrl: uri }));
      } catch (err: any) {
        Alert.alert('Could not use that photo', err?.message || 'Try another one.');
      } finally {
        setBusyPhoto(false);
      }
    },
    [pickDishPhoto]
  );

  const field = (label: string, value: string, onChange: (v: string) => void, opts: any = {}) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, opts.multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={p.muted}
        {...opts}
      />
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { maxHeight: '92%' }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.sheetTitle}>{dish.name ? 'Edit dish' : 'New dish'}</Text>
            {d.flags.length > 0 && (
              <View style={s.flagBox}>
                {d.flags.map(f => (
                  <Text key={f} style={s.flagLine}>
                    • {f}
                  </Text>
                ))}
              </View>
            )}

            {field('Dish name', d.name, v => setD(x => ({ ...x, name: v })), { placeholder: 'e.g. Chicken Biryani', maxLength: 120 })}

            <Text style={s.label}>Veg or non-veg?</Text>
            <View style={s.dietRow}>
              {([
                { v: true, label: 'Veg', color: p.veg },
                { v: false, label: 'Non-veg', color: p.nonVeg }
              ] as const).map(o => {
                const on = d.isVeg === o.v;
                return (
                  <TouchableOpacity
                    key={o.label}
                    style={[s.dietBtn, on && { backgroundColor: o.color, borderColor: o.color }]}
                    onPress={() => setD(x => ({ ...x, isVeg: o.v }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[s.dietBtnText, on && { color: '#FFFFFF' }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {filled(d.sizes).length < 2 &&
              field('Price (Rs)', d.price, v => setD(x => ({ ...x, price: v.replace(/[^0-9.]/g, '') })), {
                keyboardType: 'decimal-pad',
                placeholder: 'e.g. 180'
              })}

            <Text style={s.label}>Sizes (optional) — e.g. Half / Full, each with its own price</Text>
            {d.sizes.map((r, i) => (
              <View key={`size-${i}`} style={s.choiceRow}>
                <TextInput style={[s.input, { flex: 1.4 }]} value={r.name} onChangeText={v => setRow('sizes', i, { name: v })} placeholder="Size" placeholderTextColor={p.muted} maxLength={40} />
                <TextInput style={[s.input, { flex: 1 }]} value={r.price} onChangeText={v => setRow('sizes', i, { price: v.replace(/[^0-9.]/g, '') })} placeholder="Rs" placeholderTextColor={p.muted} keyboardType="decimal-pad" />
                <TouchableOpacity onPress={() => setD(x => ({ ...x, sizes: x.sizes.filter((_, j) => j !== i) }))}>
                  <Text style={s.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {d.sizes.length < 4 && (
              <TouchableOpacity
                onPress={() =>
                  setD(x => ({
                    ...x,
                    sizes: x.sizes.length === 0 ? [{ name: 'Half', price: '' }, { name: 'Full', price: '' }] : [...x.sizes, { name: '', price: '' }]
                  }))
                }
              >
                <Text style={s.linkText}>{d.sizes.length === 0 ? '+ Add sizes (Half / Full)' : '+ Add another size'}</Text>
              </TouchableOpacity>
            )}

            <Text style={[s.label, { marginTop: 12 }]}>Extras (optional) — things a customer can add</Text>
            {d.extras.map((r, i) => (
              <View key={`extra-${i}`} style={s.choiceRow}>
                <TextInput style={[s.input, { flex: 1.4 }]} value={r.name} onChangeText={v => setRow('extras', i, { name: v })} placeholder="Extra" placeholderTextColor={p.muted} maxLength={40} />
                <TextInput style={[s.input, { flex: 1 }]} value={r.price} onChangeText={v => setRow('extras', i, { price: v.replace(/[^0-9.]/g, '') })} placeholder="Rs" placeholderTextColor={p.muted} keyboardType="decimal-pad" />
                <TouchableOpacity onPress={() => setD(x => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))}>
                  <Text style={s.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {d.extras.length < 10 && (
              <TouchableOpacity onPress={() => setD(x => ({ ...x, extras: [...x.extras, { name: '', price: '' }] }))}>
                <Text style={s.linkText}>+ Add an extra</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 12 }} />
            {field('Description (optional)', d.description, v => setD(x => ({ ...x, description: v })), {
              multiline: true,
              maxLength: 400,
              placeholder: 'A line about the dish'
            })}

            <Text style={s.label}>Photo</Text>
            {d.imageUrl ? <Image source={{ uri: d.imageUrl }} style={s.photo} /> : null}
            <View style={s.choiceRow}>
              <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => photo('camera')} disabled={busyPhoto}>
                <Text style={s.ghostText}>{busyPhoto ? 'Working…' : 'Take a photo'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ghostBtn, { flex: 1 }]} onPress={() => photo('library')} disabled={busyPhoto}>
                <Text style={s.ghostText}>Choose one</Text>
              </TouchableOpacity>
            </View>
            {d.imageUrl ? (
              <TouchableOpacity onPress={() => setD(x => ({ ...x, imageUrl: undefined }))}>
                <Text style={s.removeText}>Remove photo</Text>
              </TouchableOpacity>
            ) : null}

            {problems.length > 0 && (
              <View style={[s.flagBox, { marginTop: 12 }]}>
                {problems.map(pr => (
                  <Text key={pr} style={s.flagLine}>
                    • {pr}
                  </Text>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[s.primaryBtn, { marginTop: 14 }]}
              // Checked again on Send; saving an unfinished dish is allowed so
              // a partner can come back to it.
              onPress={() => onSave({ ...d, flags: [] })}
            >
              <Text style={s.primaryText}>Save dish</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ghostBtn, { marginTop: 8 }]} onPress={onCancel}>
              <Text style={s.ghostText}>Cancel</Text>
            </TouchableOpacity>
            {!!dish.name && (
              <TouchableOpacity style={{ marginTop: 12, alignSelf: 'center' }} onPress={onRemove}>
                <Text style={[s.removeText, { color: p.danger }]}>Remove this dish</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

function makeStyles(p: BuilderPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    centre: { alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: p.border },
    title: { fontSize: 19, fontWeight: '800', color: p.text },
    subtitle: { fontSize: 12.5, color: p.muted, marginTop: 2 },
    closeBtn: { paddingHorizontal: 12, paddingVertical: 8 },
    closeText: { color: p.brand, fontWeight: '800', fontSize: 14 },
    body: { padding: 16, gap: 12 },
    card: { backgroundColor: p.card, borderRadius: 16, borderWidth: 1, borderColor: p.border, padding: 14, gap: 8 },
    cardTitle: { fontSize: 15.5, fontWeight: '800', color: p.text },
    cardBody: { fontSize: 13, color: p.muted, lineHeight: 19 },
    problemLine: { fontSize: 13, color: p.danger, paddingVertical: 4 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionInput: { flex: 1, fontSize: 16, fontWeight: '800', color: p.text, borderBottomWidth: 1, borderBottomColor: p.border, paddingVertical: 6 },
    removeText: { color: p.muted, fontWeight: '700', fontSize: 13, paddingVertical: 6, paddingHorizontal: 4 },
    dishRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
    dietBox: { width: 16, height: 16, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
    dietDot: { width: 7, height: 7, borderRadius: 4 },
    dishName: { fontSize: 14.5, fontWeight: '700', color: p.text },
    dishMeta: { fontSize: 12.5, color: p.muted, marginTop: 2 },
    flagLine: { fontSize: 12, color: p.warn, marginTop: 2 },
    thumb: { width: 48, height: 36, borderRadius: 6 },
    noPhoto: { fontSize: 11, color: p.muted },
    ghostBtn: { borderWidth: 1, borderColor: p.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
    ghostText: { color: p.brand, fontWeight: '800', fontSize: 14 },
    primaryBtn: { backgroundColor: p.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    primaryText: { color: p.onBrand, fontWeight: '800', fontSize: 15 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: p.card, borderTopWidth: 1, borderTopColor: p.border, padding: 14 },
    footerText: { fontSize: 13, color: p.muted, textAlign: 'center' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: p.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: p.text, marginBottom: 10 },
    guideLine: { fontSize: 14, color: p.text, lineHeight: 21, marginTop: 4 },
    label: { fontSize: 12.5, fontWeight: '700', color: p.muted, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: p.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: p.text, backgroundColor: p.bg },
    dietRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    dietBtn: { flex: 1, borderWidth: 1.5, borderColor: p.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
    dietBtnText: { fontWeight: '800', color: p.text, fontSize: 15 },
    choiceRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
    linkText: { color: p.brand, fontWeight: '800', fontSize: 13.5, paddingVertical: 6 },
    flagBox: { backgroundColor: p.warnBg, borderRadius: 10, padding: 10, marginBottom: 10 },
    photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginBottom: 8 }
  });
}

/**
 * The same dish editor, on its own, for a dish that is already live
 * (owner, 2 Oct 2026): the admin app edits a restaurant's menu with exactly
 * the form and rules a partner uses — photo, sizes, extras, veg, description.
 */
export const DishEditorSheet: React.FC<{
  palette: BuilderPalette;
  sectionName: string;
  dish: DraftDish;
  pickDishPhoto: MenuBuilderProps['pickDishPhoto'];
  onCancel: () => void;
  onSave: (dish: DraftDish) => void;
  onRemove: () => void;
}> = props => {
  const styles = useMemo(() => makeStyles(props.palette), [props.palette]);
  return <DishEditor {...props} styles={styles} />;
};
