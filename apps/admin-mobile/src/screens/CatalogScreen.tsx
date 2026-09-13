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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState<any | null>(null);

  const list = useResource(() => api.get<any>(`/admin/menu-requests${query({ status })}`), [status]);
  const requests = list.data?.requests || [];
  const canReview = can('catalog.menus.review');

  const review = async (request: any, action: 'APPROVE' | 'REJECT', rejectionReason?: string) => {
    setBusyId(request.id);
    try {
      await api.post(`/admin/menu-requests/${request.id}/review`, {
        action,
        ...(rejectionReason ? { rejectionReason } : {})
      });
      setRejecting(null);
      setReason('');
      await list.reload();
      Alert.alert(
        action === 'APPROVE' ? 'Approved' : 'Rejected',
        action === 'APPROVE'
          ? `"${request.payload.name}" is now on the live menu and visible to customers.`
          : 'The partner has been told why, so they can correct and resubmit.'
      );
    } catch (err: any) {
      Alert.alert('Could not review the request', err?.message || 'Nothing was changed.');
    } finally {
      setBusyId(null);
    }
  };

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

      {list.loading && requests.length === 0 ? <Loading /> : null}
      {!list.loading && requests.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          message="Partner menu changes appear here before they reach customers."
          icon={<Inbox size={34} color={c.text.muted} />}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {requests.map((request: any) => (
          <Card key={request.id}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {request.payload.name}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {request.restaurantName || request.restaurantId} · {humanise(request.kind)}
                </Text>
              </View>
              <Badge label={request.status} />
            </View>

            <Divider />
            <KeyValue label="Price" value={formatMoney(request.payload.price)} tone="money" />
            <KeyValue label="Category" value={request.payload.categoryName} />
            <KeyValue label="Diet" value={request.payload.isVeg ? 'Vegetarian' : 'Non-vegetarian'} />
            {request.payload.description ? <KeyValue label="Description" value={request.payload.description} /> : null}
            <KeyValue label="Submitted" value={timeAgo(request.submittedAt)} />
            {request.rejectionReason ? <KeyValue label="Rejected because" value={request.rejectionReason} /> : null}

            {request.status === 'PENDING' && canReview ? (
              rejecting?.id === request.id ? (
                <>
                  <Divider />
                  <Field label="Why is it being rejected?" value={reason} onChangeText={setReason} placeholder="The price looks like a typo — ₹2800 for a starter." multiline />
                  <View style={s.actionRow}>
                    <Button label="Back" variant="secondary" full onPress={() => setRejecting(null)} />
                    <Button
                      label="Reject"
                      variant="danger"
                      full
                      loading={busyId === request.id}
                      onPress={() => {
                        if (!reason.trim()) {
                          Alert.alert('A reason is required', 'The partner is shown this so they can fix it.');
                          return;
                        }
                        review(request, 'REJECT', reason.trim());
                      }}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Divider />
                  <View style={s.actionRow}>
                    <Button label="Reject" variant="danger" full onPress={() => setRejecting(request)} />
                    <Button label="Approve" variant="success" full loading={busyId === request.id} onPress={() => review(request, 'APPROVE')} />
                  </View>
                </>
              )
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </View>
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
  dishName: { fontSize: tokens.font.size.sm, color: c.text.primary, fontWeight: tokens.font.weight.semibold },
  dishMeta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 3 },
  dishActions: { flexDirection: 'row', gap: tokens.space[2] }
});
