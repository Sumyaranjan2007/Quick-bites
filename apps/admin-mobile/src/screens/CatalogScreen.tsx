import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { UtensilsCrossed, Inbox, Tag } from 'lucide-react-native';
import {
  Card,
  Segmented,
  SearchBar,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  ResourceError,
  NoAccess,
  Toggle
} from '../components/ui';
import { tokens, formatMoney, humanise, formatDateTime, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

type Tab = 'menus' | 'requests' | 'categories';

/** Menus, the partner change requests waiting on a decision, and categories. */
export const CatalogScreen: React.FC = () => {
  const { can } = useSession();
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(can('catalog.menus.view') ? [{ key: 'menus' as Tab, label: 'Menus' }] : []),
    ...(can('catalog.menus.review', 'catalog.menus.view') ? [{ key: 'requests' as Tab, label: 'Menu requests' }] : []),
    ...(can('catalog.categories.manage', 'catalog.menus.view') ? [{ key: 'categories' as Tab, label: 'Categories' }] : [])
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key || 'menus');

  if (tabs.length === 0) return <NoAccess permission="catalog.menus.view" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented options={tabs} value={tab} onChange={next => setTab(next as Tab)} />
      </View>
      {tab === 'menus' ? <MenusTab /> : null}
      {tab === 'requests' ? <RequestsTab /> : null}
      {tab === 'categories' ? <CategoriesTab /> : null}
    </View>
  );
};

/* ---------------------------------- Menus --------------------------------- */

const MenusTab: React.FC = () => {
  const { api } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useResource(() => api.get<any>(`/admin/menus${query({ q: submitted })}`), [submitted]);
  const menus = list.data?.menus || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Restaurant or city" onSubmit={() => setSubmitted(search.trim())} />
      </View>
      {list.loading && menus.length === 0 ? <Loading /> : null}
      {!list.loading && menus.length === 0 ? (
        <EmptyState title="No menus" message={list.error || undefined} icon={<UtensilsCrossed size={34} color={c.text.muted} />} />
      ) : null}
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {menus.map((menu: any) => (
          <Card key={menu.restaurantId} onPress={() => setOpenId(menu.restaurantId)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {menu.restaurantName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {menu.itemCount} dishes in {menu.categoryCount} categories
                  {menu.outOfStock ? ` · ${menu.outOfStock} out of stock` : ''}
                </Text>
              </View>
              {menu.pendingRequests > 0 ? (
                <Badge label={`${menu.pendingRequests} pending`} tone="warning" />
              ) : (
                <Badge label={menu.isOpen ? 'Open' : 'Closed'} tone={menu.isOpen ? 'success' : 'neutral'} />
              )}
            </View>
          </Card>
        ))}
      </ScrollView>

      <MenuSheet restaurantId={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} />
    </View>
  );
};

const MenuSheet: React.FC<{ restaurantId: string | null; onClose: () => void; onChanged: () => void }> = ({
  restaurantId,
  onClose,
  onChanged
}) => {
  const { api, can } = useSession();
  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', categoryName: '', description: '', isVeg: true });
  const [busy, setBusy] = useState(false);

  const resource = useResource(() => api.get<any>(`/admin/menus/${restaurantId}`), [restaurantId], {
    enabled: Boolean(restaurantId)
  });
  const canEdit = can('catalog.menus.edit');

  const reset = () => {
    setEditing(null);
    setAdding(false);
    setForm({ name: '', price: '', categoryName: '', description: '', isVeg: true });
  };

  const save = async () => {
    if (!form.name.trim() || !Number(form.price) || !form.categoryName.trim()) {
      Alert.alert('Check the details', 'A name, a price and a category are all required.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        price: Number(form.price),
        categoryName: form.categoryName.trim(),
        description: form.description.trim() || undefined,
        isVeg: form.isVeg
      };
      if (editing) await api.patch(`/admin/menus/${restaurantId}/items/${editing.id}`, body);
      else await api.post(`/admin/menus/${restaurantId}/items`, body);
      reset();
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not save the dish', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
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

  const remove = (dish: any) => {
    Alert.alert('Remove this dish?', `"${dish.name}" will no longer appear for customers.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Take off sale',
        onPress: async () => {
          await api.del(`/admin/menus/${restaurantId}/items/${dish.id}?soft=true`).catch(() => undefined);
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
            await resource.reload();
            onChanged();
          } catch (err: any) {
            Alert.alert('Could not delete', err?.message || 'Nothing was changed.');
          }
        }
      }
    ]);
  };

  const menu = resource.data?.menu;

  return (
    <Sheet
      visible={Boolean(restaurantId)}
      onClose={() => {
        reset();
        onClose();
      }}
      title={resource.data?.restaurant?.name || 'Menu'}
      subtitle={menu ? `${(menu.categories || []).reduce((n: number, cat: any) => n + cat.items.length, 0)} dishes` : undefined}
      footer={
        canEdit && !editing && !adding ? (
          <Button label="Add a dish" full onPress={() => setAdding(true)} />
        ) : undefined
      }
    >
      <ResourceError resource={resource} what="This menu" />
      {resource.loading && !resource.data ? <Loading /> : null}

      {(editing || adding) && canEdit ? (
        <Card>
          <Text style={s.cardHeading}>{editing ? 'Edit dish' : 'Add a dish'}</Text>
          <Field label="Name" value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
          <Field label="Price (₹)" value={form.price} onChangeText={v => setForm(f => ({ ...f, price: v }))} keyboardType="numeric" />
          <Field label="Category" value={form.categoryName} onChangeText={v => setForm(f => ({ ...f, categoryName: v }))} placeholder="Biryani" />
          <Field label="Description" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} multiline />
          <Toggle label="Vegetarian" value={form.isVeg} onChange={v => setForm(f => ({ ...f, isVeg: v }))} />
          <View style={{ height: tokens.space[4] }} />
          <View style={s.actionRow}>
            <Button label="Cancel" variant="secondary" full onPress={reset} />
            <Button label="Save" full loading={busy} onPress={save} />
          </View>
        </Card>
      ) : null}

      {menu && !editing && !adding
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
                        onPress={() => {
                          setEditing(dish);
                          setForm({
                            name: dish.name,
                            price: String(dish.price),
                            categoryName: category.name,
                            description: dish.description || '',
                            isVeg: dish.isVeg
                          });
                        }}
                      />
                      <Button label="Remove" size="sm" variant="danger" onPress={() => remove(dish)} />
                    </View>
                  ) : null}
                </View>
              ))}
            </Card>
          ))
        : null}

      {menu && (menu.categories || []).length === 0 && !adding ? (
        <EmptyState title="This partner has no dishes yet" message="Add the first one, or wait for their own submission." />
      ) : null}
    </Sheet>
  );
};

/* ------------------------------ Menu requests ----------------------------- */

const RequestsTab: React.FC = () => {
  const { api, can } = useSession();
  const [status, setStatus] = useState('PENDING');
  const [openRestaurant, setOpenRestaurant] = useState<any | null>(null);

  const list = useResource(() => api.get<any>(`/admin/menu-requests/grouped${query({ status })}`), [status]);
  const groups = list.data?.groups || [];
  const canReview = can('catalog.menus.review');

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <Segmented
          options={[
            { key: 'PENDING', label: 'Waiting' },
            { key: 'APPROVED', label: 'Approved' },
            { key: 'REJECTED', label: 'Rejected' },
            { key: 'ALL', label: 'All' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {list.loading && groups.length === 0 ? <Loading /> : null}
      {!list.loading && groups.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          message="Partner menu changes appear here before they reach customers, grouped by restaurant."
          icon={<Inbox size={34} color={c.text.muted} />}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {/* How much work is actually waiting, in the unit the work is done in:
            kitchens, not dishes. */}
        {groups.length > 0 && status === 'PENDING' ? (
          <Text style={s.queueSummary}>
            {list.data?.totalPending} dish{list.data?.totalPending === 1 ? '' : 'es'} from{' '}
            {list.data?.restaurantsWaiting} restaurant{list.data?.restaurantsWaiting === 1 ? '' : 's'}
          </Text>
        ) : null}

        {groups.map((group: any) => (
          <Card key={group.restaurantId} onPress={canReview ? () => setOpenRestaurant(group) : undefined}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {group.restaurantName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {[group.city, `oldest ${timeAgo(group.oldestSubmittedAt)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {group.pendingCount > 0 ? (
                <Badge label={`${group.pendingCount} waiting`} tone="warning" />
              ) : (
                <Badge label="Settled" tone="success" />
              )}
            </View>

            {/* A kitchen with no menu at all is submitting its opening list. It
                is a different judgement from a kitchen adding one dish, and the
                administrator should not have to work that out themselves. */}
            {group.isFirstMenu ? (
              <>
                <Divider />
                <Text style={s.firstMenuNote}>
                  This is this restaurant's opening menu — nothing of theirs is live yet.
                </Text>
              </>
            ) : null}

            <Divider />
            {group.requests.slice(0, 4).map((request: any) => (
              <View key={request.id} style={s.dishLine}>
                <Text style={s.dishName} numberOfLines={1}>
                  {request.payload.name}
                </Text>
                <Text style={s.dishPrice}>
                  {request.payload.sizes?.length
                    ? request.payload.sizes.map((z: any) => `${z.name} ${formatMoney(z.price)}`).join(' · ')
                    : formatMoney(request.payload.price)}
                </Text>
              </View>
            ))}
            {group.requests.length > 4 ? (
              <Text style={s.muted}>and {group.requests.length - 4} more</Text>
            ) : null}

            {canReview && group.pendingCount > 0 ? (
              <>
                <Divider />
                <Button label={`Review ${group.pendingCount} dish${group.pendingCount === 1 ? '' : 'es'}`} full onPress={() => setOpenRestaurant(group)} />
              </>
            ) : null}
          </Card>
        ))}
      </ScrollView>

      <RestaurantReviewSheet
        group={openRestaurant}
        onClose={() => setOpenRestaurant(null)}
        onReviewed={() => {
          setOpenRestaurant(null);
          void list.reload();
        }}
      />
    </View>
  );
};

/**
 * One restaurant's submission, judged together.
 *
 * The administrator marks the dishes they are turning down and says why, then
 * approves in one action: everything unmarked goes live. That is the shape of
 * the actual decision — you read a kitchen's list, find the two that are wrong,
 * and pass the rest — and it replaces a flat queue where a hundred interleaved
 * dish cards had to be approved one at a time with no way to tell whether you
 * had finished a restaurant.
 */
const RestaurantReviewSheet: React.FC<{
  group: any | null;
  onClose: () => void;
  onReviewed: () => void;
}> = ({ group, onClose, onReviewed }) => {
  const { api } = useSession();
  const [rejections, setRejections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // The sheet is keyed by restaurant, so marks from a previous restaurant never
  // leak into this one.
  const key = group?.restaurantId || '';
  const [markedFor, setMarkedFor] = useState('');
  if (key !== markedFor) {
    setMarkedFor(key);
    setRejections({});
  }

  const pending = (group?.requests || []).filter((r: any) => r.status === 'PENDING');
  const rejectedIds = Object.keys(rejections);
  const approvingCount = pending.length - rejectedIds.length;

  const toggleReject = (requestId: string) => {
    setRejections(prev => {
      const next = { ...prev };
      if (next[requestId] !== undefined) delete next[requestId];
      else next[requestId] = '';
      return next;
    });
  };

  const submit = async () => {
    const missingReason = rejectedIds.find(id => !rejections[id].trim());
    if (missingReason) {
      Alert.alert(
        'Say why it was turned down',
        'The partner is shown this so they can correct the dish and resubmit it.'
      );
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<any>('/admin/menu-requests/bulk-review', {
        restaurantId: group.restaurantId,
        rejections: rejectedIds.map(id => ({ requestId: id, rejectionReason: rejections[id].trim() })),
        // Anything submitted since this screen loaded is left for the next pass
        // rather than approved without being read.
        expectedRequestIds: pending.map((r: any) => r.id)
      });

      const parts = [`${result.approvedCount} approved`];
      if (result.rejectedCount) parts.push(`${result.rejectedCount} turned down`);
      if (result.failed?.length) parts.push(`${result.failed.length} could not be applied`);
      if (result.skippedUnseen) parts.push(`${result.skippedUnseen} arrived after you opened this and are still waiting`);

      onReviewed();
      Alert.alert(`${result.restaurantName} reviewed`, parts.join(', ') + '.');
    } catch (err: any) {
      Alert.alert('Could not review the menu', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={Boolean(group)}
      onClose={onClose}
      title={group?.restaurantName || 'Menu review'}
      subtitle={group ? `${pending.length} dish${pending.length === 1 ? '' : 'es'} waiting` : undefined}
    >
      {group ? (
        <>
          {group.isFirstMenu ? (
            <Card>
              <Text style={s.firstMenuNote}>
                This is {group.restaurantName}'s opening menu. Nothing of theirs is live yet, so approving here is what
                puts them in front of customers.
              </Text>
            </Card>
          ) : null}

          {pending.map((request: any) => {
            const isRejected = rejections[request.id] !== undefined;
            return (
              <Card key={request.id}>
                <View style={s.rowTop}>
                  <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                    <Text style={s.title} numberOfLines={2}>
                      {request.payload.name}
                    </Text>
                    <Text style={s.sub} numberOfLines={1}>
                      {humanise(request.kind)} · {timeAgo(request.submittedAt)}
                    </Text>
                  </View>
                  <Badge label={isRejected ? 'Rejecting' : 'Approving'} tone={isRejected ? 'danger' : 'success'} />
                </View>

                <Divider />
                <KeyValue label="Price" value={formatMoney(request.payload.price)} tone="money" />
                {/* F05: what the partner asked for, exactly as the customer will see it. */}
                {(request.payload.sizes || []).map((z: any) => (
                  <KeyValue key={`size-${z.name}`} label={`Size: ${z.name}`} value={formatMoney(z.price)} tone="money" />
                ))}
                {(request.payload.extras || []).map((x: any) => (
                  <KeyValue key={`extra-${x.name}`} label={`Extra: ${x.name}`} value={`+${formatMoney(x.price)}`} />
                ))}
                <KeyValue label="Category" value={request.payload.categoryName} />
                <KeyValue label="Diet" value={request.payload.isVeg ? 'Vegetarian' : 'Non-vegetarian'} />
                {request.payload.description ? (
                  <KeyValue label="Description" value={request.payload.description} />
                ) : null}

                <Divider />
                <Toggle
                  label="Turn this dish down"
                  value={isRejected}
                  onChange={() => toggleReject(request.id)}
                />
                {isRejected ? (
                  <Field
                    label="Why?"
                    value={rejections[request.id]}
                    onChangeText={text => setRejections(prev => ({ ...prev, [request.id]: text }))}
                    placeholder="The price looks like a typo — Rs 2800 for a starter."
                    multiline
                  />
                ) : null}
              </Card>
            );
          })}

          <Card>
            <Text style={s.cardHeading}>What this will do</Text>
            <KeyValue label="Go live now" value={`${approvingCount} dish${approvingCount === 1 ? '' : 'es'}`} tone="strong" />
            <KeyValue label="Sent back to the partner" value={`${rejectedIds.length}`} />
            <View style={{ height: tokens.space[4] }} />
            <Button
              label={
                approvingCount > 0
                  ? `Approve ${approvingCount} and finish`
                  : rejectedIds.length > 0
                    ? `Reject all ${rejectedIds.length} and finish`
                    : 'Nothing to review'
              }
              variant={approvingCount > 0 ? 'success' : 'danger'}
              disabled={pending.length === 0}
              loading={busy}
              full
              onPress={submit}
            />
          </Card>
        </>
      ) : null}
    </Sheet>
  );
};

/* -------------------------------- Categories ------------------------------ */

const CategoriesTab: React.FC = () => {
  const { api, can } = useSession();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useResource(() => api.get<any>('/admin/categories'), []);
  const canManage = can('catalog.categories.manage');
  const categories = list.data?.categories || [];
  const usage = list.data?.usage || {};

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/categories', { name: name.trim() });
      setName('');
      setAdding(false);
      await list.reload();
    } catch (err: any) {
      Alert.alert('Could not create the category', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (category: any) => {
    try {
      await api.patch(`/admin/categories/${category.id}`, { isActive: !category.isActive });
      await list.silentReload();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    }
  };

  const remove = (category: any) => {
    Alert.alert('Delete this category?', `"${category.name}" will no longer be offered for discovery or coupons.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/admin/categories/${category.id}`);
            await list.reload();
          } catch (err: any) {
            Alert.alert('Could not delete', err?.message || 'Nothing was changed.');
          }
        }
      }
    ]);
  };

  return (
    <ScrollView
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
    >
      {canManage ? (
        adding ? (
          <Card>
            <Text style={s.cardHeading}>New category</Text>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Late Night" />
            <View style={s.actionRow}>
              <Button label="Cancel" variant="secondary" full onPress={() => setAdding(false)} />
              <Button label="Create" full loading={busy} onPress={create} />
            </View>
          </Card>
        ) : (
          <Button label="Add a category" onPress={() => setAdding(true)} style={{ marginBottom: tokens.space[4] }} />
        )
      ) : null}

      {list.loading && categories.length === 0 ? <Loading /> : null}
      {!list.loading && categories.length === 0 ? (
        <EmptyState title="No categories yet" message="Categories organise discovery and let a campaign target a cuisine." icon={<Tag size={34} color={c.text.muted} />} />
      ) : null}

      {categories.map((category: any) => (
        <Card key={category.id}>
          <View style={s.rowTop}>
            <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
              <Text style={s.title} numberOfLines={1}>
                {category.name}
              </Text>
              <Text style={s.sub}>
                {usage[category.slug] || 0} restaurant{(usage[category.slug] || 0) === 1 ? '' : 's'} carry this cuisine
              </Text>
            </View>
            <Badge label={category.isActive ? 'Active' : 'Hidden'} tone={category.isActive ? 'success' : 'neutral'} />
          </View>
          {canManage ? (
            <>
              <Divider />
              <View style={s.actionRow}>
                <Button label={category.isActive ? 'Hide' : 'Show'} size="sm" variant="secondary" full onPress={() => toggle(category)} />
                <Button label="Delete" size="sm" variant="danger" full onPress={() => remove(category)} />
              </View>
            </>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[3],
    paddingVertical: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    flexWrap: 'wrap'
  },
  // flexShrink lets a long dish name yield to the price beside it rather than
  // pushing the amount off the row.
  dishName: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold, flexShrink: 1 },
  dishMeta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 3 },
  queueSummary: {
    fontSize: tokens.font.size.sm,
    color: c.text.secondary,
    marginBottom: tokens.space[3],
    fontWeight: '600'
  },
  firstMenuNote: { fontSize: tokens.font.size.sm, color: c.brand.amberText, lineHeight: 20 },
  dishLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4
  },
  dishPrice: { fontSize: tokens.font.size.sm, color: c.text.secondary, flexShrink: 0 },
  muted: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 4 },
  dishActions: { flexDirection: 'row', gap: tokens.space[2] }
});
