/**
 * A restaurant's menu, run by Quick Bites (owner, 2 Oct 2026).
 *
 * Opened from Catalogue → Menus and from the restaurant's own profile in
 * People, so an administrator can help a partner wherever they are looking:
 *
 *   - the live menu, with the partner's own dish editor — photo, sizes,
 *     extras, veg, description — for dishes that are already approved;
 *   - "Upload a menu": the whole-menu builder, typed or read from photos,
 *     followed by "Approve all now".
 *
 * Every direct change goes live at once and the partner is told (the server
 * sends the push and lists it in their Recent decisions).
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Modal } from 'react-native';
import { MenuBuilder, DishEditorSheet, dishProblems, type DraftDish, type BuilderPalette } from './MenuBuilder';
import { pickDishPhoto, pickMenuPages } from '../lib/photo';
import { Card, Button, Sheet, Loading, EmptyState, ResourceError } from './ui';
import { tokens, formatMoney } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

export const builderPalette: BuilderPalette = {
  bg: c.bg.base,
  card: c.bg.card,
  text: c.text.primary,
  muted: c.text.muted,
  border: c.border.subtle,
  brand: c.brand.maroon,
  onBrand: '#FFFFFF',
  veg: c.state.success,
  nonVeg: c.state.danger,
  warn: c.state.warning,
  warnBg: c.state.warningBg,
  danger: c.state.danger
};

const dishCount = (n: number) => `${n} dish${n === 1 ? '' : 'es'}`;

/** A live dish as the editor's draft: sizes and extras read back from its option groups. */
function toDraft(dish: any): DraftDish {
  const groups: any[] = dish.optionGroups || [];
  const sizeGroup = groups.find(g => g.kind === 'SIZE') || groups.find(g => g.isRequired && g.maxSelections === 1);
  const extraGroups = groups.filter(g => g !== sizeGroup && (g.kind === 'EXTRAS' || !g.isRequired));
  const base = Number(dish.price) || 0;
  return {
    id: dish.id,
    name: dish.name || '',
    description: dish.description || '',
    price: dish.price != null ? String(dish.price) : '',
    isVeg: typeof dish.isVeg === 'boolean' ? dish.isVeg : null,
    sizes: (sizeGroup?.options || []).map((o: any) => ({
      name: String(o.name),
      price: String(Math.round((base + (Number(o.priceDelta) || 0)) * 100) / 100)
    })),
    extras: extraGroups.flatMap(g => g.options || []).map((o: any) => ({ name: String(o.name), price: String(Number(o.priceDelta) || 0) })),
    imageUrl: dish.imageUrl || undefined,
    flags: []
  };
}

/** The editor's draft as the admin route's body. */
function toBody(d: DraftDish, sectionName: string, hadPhoto: boolean) {
  const sizes = d.sizes.filter(r => r.name.trim()).map(r => ({ name: r.name.trim(), price: Number(r.price) }));
  const extras = d.extras.filter(r => r.name.trim()).map(r => ({ name: r.name.trim(), price: Number(r.price) }));
  return {
    name: d.name.trim(),
    description: d.description.trim() || undefined,
    price: sizes.length >= 2 ? Math.min(...sizes.map(x => x.price)) : Number(d.price),
    isVeg: Boolean(d.isVeg),
    categoryName: sectionName,
    sizes,
    extras,
    // An empty string removes a photo the dish had; absent leaves it alone.
    ...(d.imageUrl ? { imageUrl: d.imageUrl } : hadPhoto ? { imageUrl: '' } : {})
  };
}

const blankDish = (): DraftDish => ({
  id: `new_${Date.now()}`,
  name: '',
  description: '',
  price: '',
  isVeg: null,
  sizes: [],
  extras: [],
  flags: []
});

/* ------------------------------------------------------------------------- */

export const RestaurantMenuSheet: React.FC<{
  restaurantId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenBuilder: (restaurantId: string, name: string) => void;
}> = ({ restaurantId, onClose, onChanged, onOpenBuilder }) => {
  const { api, can } = useSession();
  const canEdit = can('catalog.menus.edit');
  const [editing, setEditing] = useState<{ section: string; dish: DraftDish; isNew: boolean; hadPhoto: boolean } | null>(null);

  const resource = useResource(() => api.get<any>(`/admin/menus/${restaurantId}`), [restaurantId], {
    enabled: Boolean(restaurantId)
  });
  const menu = resource.data?.menu;
  const restaurantName = resource.data?.restaurant?.name || 'this restaurant';

  const save = async (draft: DraftDish) => {
    if (!editing || !restaurantId) return;
    const problems = dishProblems(draft, editing.section);
    if (problems.length > 0) {
      Alert.alert('Check this dish', problems.map(p => `• ${p}`).join('\n'));
      return;
    }
    const body = toBody(draft, editing.section, editing.hadPhoto);
    // Spelled out so the body-contract check can read every key sent.
    const { name, description, price, isVeg, categoryName, sizes, extras, imageUrl } = body as any;
    try {
      if (editing.isNew) {
        await api.post(`/admin/menus/${restaurantId}/items`, { name, description, price, isVeg, categoryName, sizes, extras, imageUrl });
      } else {
        await api.patch(`/admin/menus/${restaurantId}/items/${draft.id}`, { name, description, price, isVeg, categoryName, sizes, extras, imageUrl });
      }
      setEditing(null);
      await resource.reload();
      onChanged();
      Alert.alert('Saved', `"${body.name}" is live. ${restaurantName} has been told.`);
    } catch (err: any) {
      Alert.alert('Could not save the dish', err?.message || 'Nothing was changed.');
    }
  };

  const setStock = async (dishId: string, isAvailable: boolean) => {
    try {
      await api.post(`/admin/menus/${restaurantId}/items/${dishId}/stock`, { isAvailable });
      await resource.silentReload();
    } catch (err: any) {
      Alert.alert('Could not change availability', err?.message || 'Nothing was changed.');
    }
  };

  const remove = (dish: { id: string; name: string }) => {
    Alert.alert('Remove this dish?', `"${dish.name}" will no longer appear for customers.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Take off sale',
        onPress: async () => {
          await api.del(`/admin/menus/${restaurantId}/items/${dish.id}?soft=true`).catch(() => undefined);
          setEditing(null);
          await resource.reload();
          onChanged();
        }
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/admin/menus/${restaurantId}/items/${dish.id}`);
            setEditing(null);
            await resource.reload();
            onChanged();
          } catch (err: any) {
            Alert.alert('Could not delete', err?.message || 'Nothing was changed.');
          }
        }
      }
    ]);
  };

  return (
    <>
      <Sheet
        visible={Boolean(restaurantId) && !editing}
        onClose={() => {
          setEditing(null);
          onClose();
        }}
        title={resource.data?.restaurant?.name || 'Menu'}
        subtitle={menu ? dishCount((menu.categories || []).reduce((n: number, cat: any) => n + cat.items.length, 0)) : undefined}
        footer={
          canEdit ? (
            <View style={{ flex: 1 }}>
              {/* The whole-menu builder: sections, sizes, extras, photos, AI from photos. */}
              <Button
                label="Upload a menu (or read it from photos)"
                style={{ alignSelf: 'stretch' }}
                onPress={() => restaurantId && onOpenBuilder(restaurantId, restaurantName)}
              />
            </View>
          ) : undefined
        }
      >
        <ResourceError resource={resource} what="This menu" />
        {resource.loading && !resource.data ? <Loading /> : null}

        {menu
          ? (menu.categories || []).map((category: any) => (
              <Card key={category.id}>
                <Text style={s.cardHeading}>{category.name}</Text>
                {category.items.map((dish: any) => (
                  <View key={dish.id} style={s.dishRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.dishName} numberOfLines={1}>
                        {dish.isVeg ? '🟢 ' : '🔴 '}
                        {dish.name}
                      </Text>
                      <Text style={s.dishMeta} numberOfLines={1}>
                        {formatMoney(dish.price)} · {dish.isAvailable ? 'In stock' : 'Out of stock'}
                        {dish.imageUrl ? ' · photo' : ' · no photo'}
                        {(dish.optionGroups || []).length ? ' · options' : ''}
                      </Text>
                    </View>
                    {canEdit ? (
                      <View style={s.dishActions}>
                        <Button
                          label={dish.isAvailable ? 'Sold out' : 'Restock'}
                          size="sm"
                          variant="secondary"
                          onPress={() => setStock(dish.id, !dish.isAvailable)}
                        />
                        <Button
                          label="Edit"
                          size="sm"
                          variant="secondary"
                          onPress={() =>
                            setEditing({ section: category.name, dish: toDraft(dish), isNew: false, hadPhoto: Boolean(dish.imageUrl) })
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
                {canEdit ? (
                  <Button
                    label={`+ Add a dish to ${category.name}`}
                    size="sm"
                    variant="secondary"
                    style={{ marginTop: tokens.space[2] }}
                    onPress={() => setEditing({ section: category.name, dish: blankDish(), isNew: true, hadPhoto: false })}
                  />
                ) : null}
              </Card>
            ))
          : null}

        {menu && (menu.categories || []).length === 0 ? (
          <EmptyState
            title="This partner has no dishes yet"
            message="Use Upload a menu to add sections and dishes, typed or read from photos."
          />
        ) : null}
      </Sheet>

      {editing ? (
        <DishEditorSheet
          palette={builderPalette}
          sectionName={editing.section}
          dish={editing.dish}
          pickDishPhoto={pickDishPhoto}
          onCancel={() => setEditing(null)}
          onSave={save}
          onRemove={() => (editing.isNew ? setEditing(null) : remove({ id: editing.dish.id, name: editing.dish.name }))}
        />
      ) : null}
    </>
  );
};

/* ------------------------------------------------------------------------- */

/** The whole-menu builder for a restaurant, then "Approve all now". */
export const MenuUploadModal: React.FC<{
  target: { id: string; name: string } | null;
  onClose: () => void;
  onChanged: () => void;
}> = ({ target, onClose, onChanged }) => {
  const { api } = useSession();
  const uploadedIds = useRef<string[]>([]);
  const palette = useMemo(() => builderPalette, []);

  return (
    <Modal visible={Boolean(target)} animationType="slide" onRequestClose={onClose}>
      {target ? (
        <MenuBuilder
          storageKey={`admin-menu-builder:${target.id}`}
          title={`Menu for ${target.name}`}
          subtitle="Uploaded on the restaurant's behalf. Reviewed like any menu request."
          palette={palette}
          pickDishPhoto={pickDishPhoto}
          pickMenuPages={pickMenuPages}
          readMenuPhoto={async image => {
            const out = await api.post<any>(`/admin/menus/${target.id}/ai-read`, { image });
            return out.draft;
          }}
          sendBatch={async batch => {
            const out = await api.post<any>(`/admin/menus/${target.id}/bulk`, {
              batchId: batch.batchId,
              startIndex: batch.startIndex,
              items: batch.items,
              final: batch.final,
              fromAiDraft: batch.fromAiDraft
            });
            uploadedIds.current.push(...(out.requestIds || []));
          }}
          sendLabel="Upload menu for review"
          onSent={count => {
            const ids = [...uploadedIds.current];
            uploadedIds.current = [];
            onClose();
            onChanged();
            Alert.alert(
              `${count} dish${count === 1 ? '' : 'es'} uploaded`,
              `They are waiting in Menu requests for ${target.name}. Approve them all now?`,
              [
                { text: 'Review later', style: 'cancel' },
                {
                  text: 'Approve all now',
                  onPress: async () => {
                    try {
                      const result = await api.post<any>('/admin/menu-requests/bulk-review', {
                        restaurantId: target.id,
                        expectedRequestIds: ids
                      });
                      onChanged();
                      Alert.alert(
                        'Menu is live',
                        `${result.approvedCount} approved${result.failed?.length ? `, ${result.failed.length} could not be applied` : ''}.`
                      );
                    } catch (err: any) {
                      Alert.alert('Could not approve', err?.message || 'Approve them from Menu requests.');
                    }
                  }
                }
              ]
            );
          }}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
};

const s = StyleSheet.create({
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[3],
    paddingVertical: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    flexWrap: 'wrap'
  },
  dishName: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold, flexShrink: 1 },
  dishMeta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 3 },
  dishActions: { flexDirection: 'row', gap: tokens.space[2] }
});
