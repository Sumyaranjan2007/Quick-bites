import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Modal, TouchableOpacity, RefreshControl, Image } from 'react-native';
import { Plus, Clock3, CheckCircle2, XCircle, Camera, Image as ImageIcon, X } from 'lucide-react-native';
import { c, radii, spacing } from '../theme';
import { Card, SectionHeading, Button, Field, Pill, ErrorNote, EmptyState } from '../components/ui';
import { fetchMenu, setDishStock, submitMenuRequest, fetchMenuRequests } from '../lib/partnerApi';
import { pickDishPhoto } from '../lib/photo';

interface Props {
  restaurantId: string;
  refreshSignal: number;
}

/**
 * The menu, and requests to change it.
 *
 * A partner can take a dish off sale themselves — that is a stock decision and
 * needs to be instant. Adding a dish or changing its price goes to review, because
 * it changes what a customer is charged and what the kitchen is committed to. The
 * screen makes that split explicit rather than leaving the partner to wonder why
 * one control works immediately and the other does not.
 */
export const MenuScreen: React.FC<Props> = ({ restaurantId, refreshSignal }) => {
  const [categories, setCategories] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDish, setBusyDish] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', categoryName: '', isVeg: true });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState(false);

  /**
   * The dish photo, as a data URI, or null.
   *
   * Optional on purpose. A kitchen adding twenty dishes on a Tuesday evening
   * should not be blocked on photographing each one, and a menu with no
   * pictures is still a menu — where a menu that could not be added at all is
   * nothing.
   */
  const [photo, setPhoto] = useState<string | null>(null);
  // F05: the dish being edited (null = a new dish), and its sizes and extras.
  const [editing, setEditing] = useState<{ dishId: string } | null>(null);
  const [sizes, setSizes] = useState<Array<{ name: string; price: string }>>([]);
  const [extras, setExtras] = useState<Array<{ name: string; price: string }>>([]);

  /** Opens the form empty for a new dish, or filled in from one on the menu. */
  const openComposer = (item?: any, categoryName?: string) => {
    setSubmitError(null);
    setFormErrors({});
    setPhoto(null);
    if (!item) {
      setEditing(null);
      setForm({ name: '', description: '', price: '', categoryName: '', isVeg: true });
      setSizes([]);
      setExtras([]);
    } else {
      const base = Number(item.price) || 0;
      const groups: any[] = item.optionGroups || [];
      const toRows = (kind: string, withBase: boolean) =>
        (groups.find(g => g.kind === kind)?.options || []).map((o: any) => ({
          name: String(o.name),
          price: String(Math.round(((withBase ? base : 0) + (Number(o.priceDelta) || 0)) * 100) / 100)
        }));
      setEditing({ dishId: item.id });
      setForm({
        name: item.name || '',
        description: item.description || '',
        price: String(base),
        categoryName: categoryName || '',
        isVeg: item.isVeg !== false
      });
      setSizes(toRows('SIZE', true));
      setExtras(toRows('EXTRAS', false));
    }
    setComposerOpen(true);
  };

  const filled = (rows: Array<{ name: string; price: string }>) =>
    rows.filter(r => r.name.trim() || r.price.trim());
  const [photoBusy, setPhotoBusy] = useState(false);

  const choosePhoto = async (source: 'camera' | 'library') => {
    setPhotoBusy(true);
    setSubmitError(null);
    try {
      const uri = await pickDishPhoto(source);
      if (uri) setPhoto(uri);
    } catch (err: any) {
      setSubmitError(err?.message || 'That photo could not be used.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);

      const [menuRes, reqRes] = await Promise.all([fetchMenu(restaurantId), fetchMenuRequests(restaurantId)]);

      if (!menuRes.ok) setError(menuRes.message || 'Could not load your menu.');
      else {
        setError(null);
        setCategories(menuRes.data?.menu?.categories || []);
      }
      if (reqRes.ok) setRequests(reqRes.data?.requests || []);

      setRefreshing(false);
    },
    [restaurantId]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  useEffect(() => {
    if (refreshSignal > 0) load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const toggleStock = async (dishId: string, next: boolean) => {
    setBusyDish(dishId);
    // Optimistic, then reconciled: the switch must feel instant during a rush.
    setCategories(prev =>
      prev.map(cat => ({
        ...cat,
        items: cat.items.map((it: any) => (it.id === dishId ? { ...it, isAvailable: next } : it))
      }))
    );

    const res = await setDishStock(restaurantId, dishId, next);
    setBusyDish(null);

    if (!res.ok) {
      setError(res.message || 'Could not change availability.');
      // Put it back, so the screen never shows a state the server did not accept.
      setCategories(prev =>
        prev.map(cat => ({
          ...cat,
          items: cat.items.map((it: any) => (it.id === dishId ? { ...it, isAvailable: !next } : it))
        }))
      );
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (form.name.trim().length < 2) errs.name = 'Give the dish a name.';
    const sizeRows = filled(sizes);
    const extraRows = filled(extras);
    const badRow = (r: { name: string; price: string }) =>
      !r.name.trim() || !(Number(r.price) > 0) || Number(r.price) > 100000;
    const dupes = (rows: Array<{ name: string }>) =>
      new Set(rows.map(r => r.name.trim().toLowerCase())).size !== rows.length;
    if (sizeRows.length === 1) errs.sizes = 'Give at least 2 sizes (for example Half and Full), or none.';
    else if (sizeRows.some(badRow)) errs.sizes = 'Every size needs a name and a price above zero.';
    else if (dupes(sizeRows)) errs.sizes = 'Two sizes have the same name.';
    if (extraRows.some(badRow)) errs.extras = 'Every extra needs a name and a price above zero.';
    else if (dupes(extraRows)) errs.extras = 'Two extras have the same name.';
    // With sizes, the customer always picks one, so the plain price is not used.
    if (sizeRows.length < 2) {
      const price = Number(form.price);
      if (!Number.isFinite(price) || price <= 0) errs.price = 'Enter a price greater than zero.';
      if (price > 100000) errs.price = 'That price looks wrong.';
    }
    if (form.categoryName.trim().length < 1) errs.categoryName = 'Which section of the menu?';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const send = async () => {
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    const sizeList = filled(sizes).map(r => ({ name: r.name.trim(), price: Number(r.price) }));
    const extraList = filled(extras).map(r => ({ name: r.name.trim(), price: Number(r.price) }));
    const res = await submitMenuRequest(restaurantId, {
      kind: editing ? 'EDIT_ITEM' : 'ADD_ITEM',
      ...(editing ? { dishId: editing.dishId } : {}),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      // With sizes the cheapest one is the dish price; the server works it out
      // the same way.
      price: sizeList.length >= 2 ? Math.min(...sizeList.map(s => s.price)) : Number(form.price),
      // An edit always says what the sizes and extras are now ([] removes them).
      ...(editing || sizeList.length ? { sizes: sizeList } : {}),
      ...(editing || extraList.length ? { extras: extraList } : {}),
      isVeg: form.isVeg,
      categoryName: form.categoryName.trim(),
      ...(photo ? { imageUrl: photo } : {})
    });
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError(res.message || 'Could not send your request.');
      return;
    }
    setComposerOpen(false);
    setForm({ name: '', description: '', price: '', categoryName: '', isVeg: true });
    setPhoto(null);
    setEditing(null);
    setSizes([]);
    setExtras([]);
    setSentNote(true);
    setTimeout(() => setSentNote(false), 4000);
    load('initial');
  };

  const pending = requests.filter(r => r.status === 'PENDING');
  const decided = requests.filter(r => r.status !== 'PENDING').slice(0, 6);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={c.brand} />}
      >
        {!!error && <ErrorNote message={error} onRetry={() => load('initial')} />}
        {sentNote && (
          <View style={styles.sentNote}>
            <Text style={styles.sentNoteText}>
              Sent for review. The dish appears on your menu once it is approved.
            </Text>
          </View>
        )}

        <Button
          label="Request a new dish"
          onPress={() => openComposer()}
          style={{ marginBottom: spacing.lg }}
        />

        {pending.length > 0 && (
          <Card>
            <SectionHeading title="Awaiting approval" sub="With our team now" />
            {pending.map(r => (
              <View key={r.id} style={styles.requestRow}>
                <Clock3 size={15} color={c.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{r.payload.name}</Text>
                  <Text style={styles.requestMeta}>
                    Rs {Number(r.payload.price).toFixed(2)} · {r.payload.categoryName}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {decided.length > 0 && (
          <Card>
            <SectionHeading title="Recent decisions" />
            {decided.map(r => (
              <View key={r.id} style={styles.requestRow}>
                {r.status === 'APPROVED' ? (
                  <CheckCircle2 size={15} color={c.success} />
                ) : (
                  <XCircle size={15} color={c.danger} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{r.payload.name}</Text>
                  {r.status === 'REJECTED' && !!r.rejectionReason && (
                    <Text style={styles.rejectReason}>{r.rejectionReason}</Text>
                  )}
                  {r.status === 'APPROVED' && <Text style={styles.requestMeta}>Now on your menu</Text>}
                </View>
              </View>
            ))}
          </Card>
        )}

        {categories.length === 0 ? (
          <EmptyState
            title="No menu yet"
            body="Request your first dish and it will appear here once our team approves it."
          />
        ) : (
          categories.map(cat => (
            <Card key={cat.id || cat.name}>
              <SectionHeading title={cat.name} sub={`${(cat.items || []).length} item${(cat.items || []).length === 1 ? '' : 's'}`} />
              {(cat.items || []).map((item: any) => (
                <View key={item.id} style={styles.dishRow}>
                  <View style={[styles.dietDot, { backgroundColor: item.isVeg ? c.veg : c.nonVeg }]} />
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => openComposer(item, cat.name)} activeOpacity={0.7}>
                    <Text style={[styles.dishName, !item.isAvailable && styles.dishNameOff]}>{item.name}</Text>
                    <Text style={styles.dishPrice}>
                      {(() => {
                        const size = (item.optionGroups || []).find((g: any) => g.kind === 'SIZE');
                        return size
                          ? size.options
                              .map((o: any) => `${o.name} Rs ${(Number(item.price) + Number(o.priceDelta || 0)).toFixed(0)}`)
                              .join(' · ')
                          : `Rs ${Number(item.price).toFixed(2)}`;
                      })()}
                      {'  ·  Edit'}
                    </Text>
                  </TouchableOpacity>
                  <Switch
                    value={item.isAvailable !== false}
                    onValueChange={next => toggleStock(item.id, next)}
                    disabled={busyDish === item.id}
                    trackColor={{ true: c.success, false: c.border }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              ))}
            </Card>
          ))
        )}

        <Text style={styles.footnote}>
          Turning a dish off takes it out of stock immediately. Adding a dish or changing a price needs approval,
          because it changes what customers are charged.
        </Text>
      </ScrollView>

      <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing ? 'Change this dish' : 'Request a new dish'}</Text>
              <Text style={styles.sheetBody}>
                Our team checks new dishes before they go live, usually within a working day.
              </Text>

              {!!submitError && <ErrorNote message={submitError} />}

              <Field
                label="Dish name"
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder="Mutton Biryani"
                error={formErrors.name}
              />
              <Field
                label="Menu section"
                value={form.categoryName}
                onChangeText={v => setForm(f => ({ ...f, categoryName: v }))}
                placeholder="Biryani"
                hint="An existing section, or a new one."
                error={formErrors.categoryName}
              />
              {filled(sizes).length < 2 ? (
                <Field
                  label="Price"
                  value={form.price}
                  onChangeText={v => setForm(f => ({ ...f, price: v }))}
                  placeholder="320"
                  keyboardType="decimal-pad"
                  error={formErrors.price}
                />
              ) : null}

              {/* F05: sizes, each with its REAL price. The customer picks one. */}
              <Text style={styles.photoLabel}>Sizes (optional)</Text>
              <Text style={styles.rowHint}>
                For Half / Full plate and the like. Type what each size costs; customers choose one.
              </Text>
              {sizes.map((row, i) => (
                <View key={`s${i}`} style={styles.choiceRow}>
                  <View style={{ flex: 2 }}>
                    <Field
                      label={`Size ${i + 1}`}
                      value={row.name}
                      onChangeText={v => setSizes(list => list.map((r, j) => (j === i ? { ...r, name: v } : r)))}
                      placeholder={i === 0 ? 'Half' : 'Full'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Price"
                      value={row.price}
                      onChangeText={v => setSizes(list => list.map((r, j) => (j === i ? { ...r, price: v } : r)))}
                      placeholder={i === 0 ? '120' : '200'}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.choiceRemove}
                    onPress={() => setSizes(list => list.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove size"
                  >
                    <X size={16} color={c.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
              {!!formErrors.sizes && <Text style={styles.rowError}>{formErrors.sizes}</Text>}
              {sizes.length < 4 && (
                <TouchableOpacity
                  style={styles.addRow}
                  onPress={() =>
                    setSizes(list =>
                      list.length === 0
                        ? [{ name: 'Half', price: '' }, { name: 'Full', price: '' }]
                        : [...list, { name: '', price: '' }]
                    )
                  }
                >
                  <Plus size={15} color={c.brand} />
                  <Text style={styles.photoBtnText}>{sizes.length === 0 ? 'Add sizes (Half / Full)' : 'Add another size'}</Text>
                </TouchableOpacity>
              )}

              <Text style={styles.photoLabel}>Extras (optional)</Text>
              <Text style={styles.rowHint}>Things a customer can add, like extra raita. Type the extra price.</Text>
              {extras.map((row, i) => (
                <View key={`e${i}`} style={styles.choiceRow}>
                  <View style={{ flex: 2 }}>
                    <Field
                      label={`Extra ${i + 1}`}
                      value={row.name}
                      onChangeText={v => setExtras(list => list.map((r, j) => (j === i ? { ...r, name: v } : r)))}
                      placeholder="Extra raita"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Price"
                      value={row.price}
                      onChangeText={v => setExtras(list => list.map((r, j) => (j === i ? { ...r, price: v } : r)))}
                      placeholder="30"
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.choiceRemove}
                    onPress={() => setExtras(list => list.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove extra"
                  >
                    <X size={16} color={c.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
              {!!formErrors.extras && <Text style={styles.rowError}>{formErrors.extras}</Text>}
              {extras.length < 10 && (
                <TouchableOpacity style={styles.addRow} onPress={() => setExtras(list => [...list, { name: '', price: '' }])}>
                  <Plus size={15} color={c.brand} />
                  <Text style={styles.photoBtnText}>Add an extra</Text>
                </TouchableOpacity>
              )}
              <Field
                label="Description"
                value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))}
                placeholder="Slow-cooked with saffron and fried onions"
                multiline
              />

              {/* The photo. Optional, and last, so it never blocks a kitchen
                  adding twenty dishes on a Tuesday evening. */}
              <Text style={styles.photoLabel}>Photo (optional)</Text>
              {photo ? (
                <View style={styles.photoWrap}>
                  <Image source={{ uri: photo }} style={styles.photoPreview} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => setPhoto(null)}
                    accessibilityLabel="Remove photo"
                  >
                    <X size={16} color={c.surface} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.photoActions}>
                  <TouchableOpacity
                    style={styles.photoBtn}
                    onPress={() => choosePhoto('camera')}
                    disabled={photoBusy}
                  >
                    <Camera size={16} color={c.brand} />
                    <Text style={styles.photoBtnText}>Take a photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoBtn}
                    onPress={() => choosePhoto('library')}
                    disabled={photoBusy}
                  >
                    <ImageIcon size={16} color={c.brand} />
                    <Text style={styles.photoBtnText}>Choose one</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.vegRow}>
                <Text style={styles.vegLabel}>Vegetarian</Text>
                <Switch
                  value={form.isVeg}
                  onValueChange={v => setForm(f => ({ ...f, isVeg: v }))}
                  trackColor={{ true: c.veg, false: c.border }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <Button label="Send for approval" onPress={send} busy={submitting} />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setComposerOpen(false)}
                style={{ marginTop: spacing.md, marginBottom: spacing.xl }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  photoLabel: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: spacing.lg },
  photoActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.brand,
    backgroundColor: c.surface
  },
  photoBtnText: { color: c.brand, fontSize: 13, fontWeight: '700' },
  photoWrap: { marginTop: spacing.sm },
  // 4:3, the aspect the picker crops to, so the preview is what gets sent.
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radii.md, backgroundColor: c.bg },
  photoRemove: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)'
  },
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: spacing.xl, paddingBottom: 48 },
  sentNote: { backgroundColor: c.successSoft, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  sentNoteText: { color: c.success, fontSize: 13, lineHeight: 18 },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  requestName: { fontSize: 14, color: c.text, fontWeight: '600' },
  requestMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  rejectReason: { fontSize: 12, color: c.danger, marginTop: 3, lineHeight: 17 },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border
  },
  dietDot: { width: 10, height: 10, borderRadius: 2 },
  dishName: { fontSize: 14, color: c.text, fontWeight: '600' },
  dishNameOff: { color: c.textMuted, textDecorationLine: 'line-through' },
  dishPrice: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  footnote: { fontSize: 12, color: c.textMuted, lineHeight: 18, marginTop: spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xxl,
    maxHeight: '88%'
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: c.text },
  sheetBody: { fontSize: 13, color: c.textMuted, marginTop: 6, marginBottom: spacing.xl, lineHeight: 19 },
  vegRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl
  },
  vegLabel: { fontSize: 14, color: c.textSoft, fontWeight: '700' },
  rowHint: { fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 17 },
  rowError: { fontSize: 12, color: c.danger, marginTop: 4 },
  choiceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  choiceRemove: { padding: spacing.sm, marginBottom: spacing.md },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingVertical: 6 }
});
