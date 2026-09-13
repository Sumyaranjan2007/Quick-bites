import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { ShieldCheck, UserCog, ScrollText } from 'lucide-react-native';
import {
  Card,
  Segmented,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  NoAccess,
  CheckRow,
  SearchBar
} from '../components/ui';
import { tokens, formatDateTime, timeAgo, humanise } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

type Tab = 'roles' | 'admins' | 'audit';

/**
 * Access control.
 *
 * Roles are permission sets, admins hold one each, and the audit log is the
 * record of what those permissions were used for. The three belong on one screen
 * because the question is always the same one: who can do this, and what have
 * they done with it.
 */
export const RolesScreen: React.FC = () => {
  const { can, isSuperAdmin } = useSession();
  const tabs: Array<{ key: Tab; label: string }> = [
    ...(can('admin.roles.manage') ? [{ key: 'roles' as Tab, label: 'Roles' }] : []),
    ...(can('admin.accounts.manage', 'admin.roles.manage') ? [{ key: 'admins' as Tab, label: 'Admins' }] : []),
    ...(can('admin.audit.view') ? [{ key: 'audit' as Tab, label: 'Audit log' }] : [])
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key || 'roles');

  if (tabs.length === 0) return <NoAccess permission="admin.roles.manage" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented options={tabs} value={tab} onChange={next => setTab(next as Tab)} />
      </View>
      {tab === 'roles' ? <RolesTab isSuperAdmin={isSuperAdmin} /> : null}
      {tab === 'admins' ? <AdminsTab isSuperAdmin={isSuperAdmin} /> : null}
      {tab === 'audit' ? <AuditTab /> : null}
    </View>
  );
};

/* ---------------------------------- Roles --------------------------------- */

const RolesTab: React.FC<{ isSuperAdmin: boolean }> = ({ isSuperAdmin }) => {
  const { api } = useSession();
  const [editing, setEditing] = useState<any | null>(null);
  const [composing, setComposing] = useState(false);
  const list = useResource(() => api.get<any>('/admin/roles'), []);
  const roles = list.data?.roles || [];
  const catalogue = list.data?.permissionCatalogue || [];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {isSuperAdmin ? (
          <Button label="Create a role" onPress={() => setComposing(true)} style={{ marginBottom: tokens.space[4] }} />
        ) : (
          <Card>
            <Text style={s.note}>
              Only a Super Admin can create or change roles. You can see what each one grants.
            </Text>
          </Card>
        )}

        {list.loading && roles.length === 0 ? <Loading /> : null}

        {roles.map((role: any) => (
          <Card key={role.id} onPress={isSuperAdmin ? () => setEditing(role) : undefined}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {role.name}
                </Text>
                <Text style={s.sub} numberOfLines={2}>
                  {role.description}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {role.isSystem ? <Badge label="Built in" tone="info" /> : null}
                {!role.isActive ? <Badge label="Disabled" tone="danger" /> : null}
              </View>
            </View>
            <Divider />
            <KeyValue label="Permissions" value={`${role.permissions.length} granted`} tone="strong" />
            <KeyValue label="Assigned to" value={`${role.assignedCount} admin${role.assignedCount === 1 ? '' : 's'}`} />
          </Card>
        ))}
      </ScrollView>

      <RoleSheet
        role={editing}
        composing={composing}
        catalogue={catalogue}
        onClose={() => {
          setEditing(null);
          setComposing(false);
        }}
        onChanged={list.reload}
      />
    </View>
  );
};

const RoleSheet: React.FC<{
  role: any | null;
  composing: boolean;
  catalogue: any[];
  onClose: () => void;
  onChanged: () => void;
}> = ({ role, composing, catalogue, onClose, onChanged }) => {
  const { api, refreshAccess } = useSession();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [initialised, setInitialised] = useState<string | null>(null);

  const visible = Boolean(role) || composing;
  const key = role?.id || (composing ? 'new' : null);

  // Seeds the form the first time a particular role is opened, without clobbering
  // edits on every render.
  if (visible && key && initialised !== key) {
    setInitialised(key);
    setName(role?.name || '');
    setDescription(role?.description || '');
    setSelected(role?.permissions || []);
  }
  if (!visible && initialised !== null) setInitialised(null);

  const toggle = (permission: string) => {
    setSelected(current =>
      current.includes(permission) ? current.filter(p => p !== permission) : [...current, permission]
    );
  };

  const save = async () => {
    if (!name.trim() || selected.length === 0) {
      Alert.alert('Check the details', 'A role needs a name and at least one permission.');
      return;
    }
    setBusy(true);
    try {
      if (role) await api.patch(`/admin/roles/${role.id}`, { name, description, permissions: selected });
      else await api.post('/admin/roles', { name, description, permissions: selected });
      onChanged();
      // The editor may have just changed their own colleagues' access — and
      // possibly a role they hold themselves.
      await refreshAccess().catch(() => undefined);
      onClose();
    } catch (err: any) {
      Alert.alert('Could not save the role', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (isActive: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/admin/roles/${role.id}`, { isActive });
      onChanged();
      onClose();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    Alert.alert('Delete this role?', `"${role.name}" will be removed. Admins holding it must be moved first.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/admin/roles/${role.id}`);
            onChanged();
            onClose();
          } catch (err: any) {
            Alert.alert('Could not delete the role', err?.message || 'Nothing was changed.');
          }
        }
      }
    ]);
  };

  const locked = Boolean(role?.isSystem);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={role ? role.name : 'New admin role'}
      subtitle={locked ? 'Built-in role — permissions cannot be changed' : `${selected.length} permission(s) selected`}
      footer={
        !locked ? (
          <>
            <Button label="Cancel" variant="secondary" full onPress={onClose} />
            <Button label="Save role" full loading={busy} onPress={save} />
          </>
        ) : undefined
      }
    >
      <Card>
        <Field label="Role name" value={name} onChangeText={setName} placeholder="Night Operations" />
        <Field
          label="What this role is for"
          value={description}
          onChangeText={setDescription}
          placeholder="Handles orders and deliveries on the night shift."
          multiline
        />
      </Card>

      {catalogue.map((group: any) => (
        <Card key={group.key}>
          <Text style={s.cardHeading}>{group.label}</Text>
          {group.permissions.map((permission: any) => (
            <CheckRow
              key={permission.id}
              checked={selected.includes(permission.id)}
              onToggle={() => (locked ? undefined : toggle(permission.id))}
              title={permission.label}
              description={permission.description}
            />
          ))}
        </Card>
      ))}

      {role && !locked ? (
        <Card>
          <Text style={s.cardHeading}>Danger zone</Text>
          <View style={s.actionRow}>
            <Button
              label={role.isActive ? 'Disable this role' : 'Enable this role'}
              variant="secondary"
              full
              loading={busy}
              onPress={() => setActive(!role.isActive)}
            />
            <Button label="Delete" variant="danger" full onPress={remove} />
          </View>
          <Text style={s.note}>
            Disabling a role locks its holders out of the console on their very next request — it does not wait for
            their session to expire.
          </Text>
        </Card>
      ) : null}
    </Sheet>
  );
};

/* --------------------------------- Admins --------------------------------- */

const AdminsTab: React.FC<{ isSuperAdmin: boolean }> = ({ isSuperAdmin }) => {
  const { api, user } = useSession();
  const [composing, setComposing] = useState(false);
  const [assigning, setAssigning] = useState<any | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', roleId: '' });
  const [busy, setBusy] = useState(false);

  const list = useResource(() => api.get<any>('/admin/admins'), []);
  const admins = list.data?.admins || [];
  const roles = list.data?.roles || [];

  const create = async () => {
    if (!form.email.trim() || !form.fullName.trim() || form.password.length < 8 || !form.roleId) {
      Alert.alert('Check the details', 'An email, a name, a password of at least 8 characters and a role are all required.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/admins', {
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        password: form.password,
        roleId: form.roleId
      });
      setForm({ email: '', fullName: '', password: '', roleId: '' });
      setComposing(false);
      await list.reload();
      Alert.alert('Admin created', 'Give them the password you set — they can change it from their profile.');
    } catch (err: any) {
      Alert.alert('Could not create the account', err?.message || 'Nothing was created.');
    } finally {
      setBusy(false);
    }
  };

  const assign = async (roleId: string | null) => {
    setBusy(true);
    try {
      await api.patch(`/admin/admins/${assigning.id}`, { roleId });
      setAssigning(null);
      await list.reload();
    } catch (err: any) {
      Alert.alert('Could not change the role', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {isSuperAdmin ? (
          <Button label="Add an admin" onPress={() => setComposing(true)} style={{ marginBottom: tokens.space[4] }} />
        ) : null}

        {list.loading && admins.length === 0 ? <Loading /> : null}

        {admins.map((admin: any) => (
          <Card key={admin.id} onPress={isSuperAdmin && admin.id !== user?.id ? () => setAssigning(admin) : undefined}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.title} numberOfLines={1}>
                  {admin.fullName}
                  {admin.id === user?.id ? ' (you)' : ''}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {admin.email}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge label={admin.roleName} tone={admin.isSuperAdmin ? 'amber' : 'info'} />
                {admin.isBlocked ? <Badge label="Blocked" tone="danger" /> : null}
              </View>
            </View>
            <Divider />
            <KeyValue label="Permissions" value={`${admin.permissionCount} granted`} />
            <KeyValue label="Joined" value={formatDateTime(admin.createdAt)} />
          </Card>
        ))}
      </ScrollView>

      <Sheet
        visible={composing}
        onClose={() => setComposing(false)}
        title="Add an admin"
        subtitle="They can sign in immediately with the password you set."
        footer={
          <>
            <Button label="Cancel" variant="secondary" full onPress={() => setComposing(false)} />
            <Button label="Create account" full loading={busy} onPress={create} />
          </>
        }
      >
        <Card>
          <Field label="Full name" value={form.fullName} onChangeText={v => setForm(f => ({ ...f, fullName: v }))} />
          <Field label="Email" value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" />
          <Field
            label="Temporary password"
            value={form.password}
            onChangeText={v => setForm(f => ({ ...f, password: v }))}
            secureTextEntry
            hint="At least 8 characters. They can change it from their own profile."
          />
        </Card>
        <Card>
          <Text style={s.cardHeading}>Role</Text>
          {roles.map((role: any) => (
            <CheckRow
              key={role.id}
              checked={form.roleId === role.id}
              onToggle={() => setForm(f => ({ ...f, roleId: role.id }))}
              title={role.name}
              description={role.isSystem ? 'Built-in role' : 'Custom role'}
            />
          ))}
        </Card>
      </Sheet>

      <Sheet
        visible={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        title={assigning?.fullName || 'Admin'}
        subtitle={`Currently ${assigning?.roleName}`}
      >
        <Card>
          <Text style={s.cardHeading}>Move to another role</Text>
          {roles.map((role: any) => (
            <CheckRow
              key={role.id}
              checked={assigning?.roleId === role.id}
              onToggle={() => assign(role.id)}
              title={role.name}
              description={role.isActive ? (role.isSystem ? 'Built-in role' : 'Custom role') : 'This role is currently disabled'}
            />
          ))}
        </Card>
        <Card>
          <Text style={s.note}>
            Removing an admin's role leaves them on the default Operations set rather than with no access. To stop
            someone using the console entirely, move them to a role you have disabled.
          </Text>
        </Card>
      </Sheet>
    </View>
  );
};

/* -------------------------------- Audit log ------------------------------- */

const AuditTab: React.FC = () => {
  const { api } = useSession();
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const list = useResource(() => api.get<any>(`/admin/audit-log${query({ entityType, limit: 200 })}`), [entityType]);

  const entries = (list.data?.entries || []).filter((entry: any) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      String(entry.summary).toLowerCase().includes(needle) ||
      String(entry.actorName).toLowerCase().includes(needle) ||
      String(entry.action).toLowerCase().includes(needle)
    );
  });

  const types = list.data?.entityTypes || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Who, what or which action" />
        <Segmented
          options={[{ key: '', label: 'Everything' }, ...types.map((t: string) => ({ key: t, label: humanise(t) }))]}
          value={entityType}
          onChange={setEntityType}
        />
      </View>

      {list.loading && entries.length === 0 ? <Loading /> : null}
      {!list.loading && entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" message={list.error || 'Administrative actions appear here as they happen.'} icon={<ScrollText size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {entries.map((entry: any) => (
          <Card key={entry.id}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.auditSummary}>{entry.summary}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {entry.actorName} · {entry.actorRole}
                </Text>
              </View>
              <Text style={s.auditWhen}>{timeAgo(entry.createdAt)}</Text>
            </View>
            <View style={s.auditTags}>
              <Badge label={entry.action} tone="neutral" />
              <Badge label={entry.entityType} tone="info" />
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3, lineHeight: 16 },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  note: { fontSize: tokens.font.size.xs, color: c.text.muted, lineHeight: 17, marginTop: tokens.space[2] },
  auditSummary: { fontSize: tokens.font.size.sm, color: c.text.primary, lineHeight: 19 },
  auditWhen: { fontSize: tokens.font.size.xxs, color: c.text.muted },
  auditTags: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[3], flexWrap: 'wrap' }
});
