import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { ShieldAlert, Activity } from 'lucide-react-native';
import {
  Card,
  Badge,
  Button,
  Field,
  Sheet,
  Toggle,
  Divider,
  Loading,
  NoAccess,
  SectionTitle
} from '../components/ui';
import { tokens, timeAgo } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { GrievanceCard } from './GrievanceCard';

const c = tokens.colors;

interface Flag {
  key: string;
  label: string;
  description: string;
  blockedMessage: string;
  defaultEnabled: boolean;
  enabled: boolean;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
}

interface Dependency {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  openedAt: string | null;
}

/**
 * The switches, and what the platform currently thinks of its dependencies.
 *
 * This screen exists because the alternative is a deploy. The gateway starts
 * failing at eight in the evening; the fix is to stop offering card payment and
 * let everyone pay cash for twenty minutes. Without a switch that is a code
 * change, a build, a review and a deploy — forty minutes on a good day, during
 * which every affected customer has already ordered somewhere else.
 *
 * Two deliberate frictions, because these are the most consequential controls in
 * the product:
 *
 *   - Turning something OFF asks for confirmation and shows the exact sentence
 *     the affected person will be told. Turning it back on does not: restoring
 *     service should never be the slower action.
 *   - A note is asked for. It is optional, and it is the thing that answers
 *     "why is ordering off?" at 2am when whoever switched it is asleep.
 */
/**
 * A kind of notification, and whether the owner wants it.
 *
 * `hasAlwaysOn` is carried from the server rather than decided here, because
 * WHICH events ignore a switch is the notifier's business and a second copy of
 * that list in the app is a copy that goes stale silently — the screen would keep
 * promising to mute something the server had started sending again, or the
 * reverse.
 */
interface NotificationCategory {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  hasAlwaysOn: boolean;
  alwaysOnNote?: string;
  changedAt?: string;
}

export const SettingsScreen: React.FC = () => {
  const { api, can } = useSession();
  const allowed = can('admin.settings.manage');

  const settings = useResource<{
    flags: Flag[];
    dependencies: Dependency[];
    notifications: NotificationCategory[];
  }>(() => api.get('/admin/settings').then(r => r.data), [], { enabled: allowed });

  const [pending, setPending] = useState<Flag | null>(null);
  const [mutingKey, setMutingKey] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!allowed) return <NoAccess permission="admin.settings.manage" />;
  if (settings.loading && !settings.data) return <Loading label="Reading the platform switches…" />;

  const apply = async (flag: Flag, enabled: boolean, withNote?: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.put(`/admin/settings/flags/${flag.key}`, {
        enabled,
        note: withNote?.trim() || undefined
      });
      // The server returns the whole catalogue, so the screen reflects what the
      // platform actually holds rather than what this device assumed.
      settings.setData({
        flags: result.data.flags,
        dependencies: settings.data?.dependencies || [],
        notifications: settings.data?.notifications || []
      });
      setPending(null);
      setNote('');
      void settings.silentReload();
    } catch (err: any) {
      setSaveError(err?.message || 'That switch could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const onToggle = (flag: Flag, next: boolean) => {
    setSaveError(null);
    // Off is the dangerous direction and is confirmed. On is not.
    if (!next) {
      setNote('');
      setPending(flag);
      return;
    }
    void apply(flag, true);
  };

  /*
   * Muting a notification is not confirmed the way switching off a feature is.
   *
   * Closing ordering costs money for as long as nobody notices. Muting a
   * notification is reversible in one tap and costs nothing until something
   * happens — so a confirmation sheet here would be ceremony, and ceremony on a
   * harmless action is what teaches somebody to tap through the one that matters.
   */
  const setNotificationCategory = async (category: NotificationCategory, enabled: boolean) => {
    setMutingKey(category.key);
    setNotifyError(null);
    try {
      const result = await api.put(`/admin/settings/notifications/${category.key}`, { enabled });
      settings.setData({
        flags: settings.data?.flags || [],
        dependencies: settings.data?.dependencies || [],
        notifications: result.data.notifications
      });
    } catch (err: any) {
      setNotifyError(err?.message || 'That switch could not be changed.');
    } finally {
      setMutingKey(null);
    }
  };

  const flags = settings.data?.flags || [];
  const dependencies = settings.data?.dependencies || [];
  const notifications = settings.data?.notifications || [];
  const mutedCount = notifications.filter(n => !n.enabled).length;
  const offCount = flags.filter(f => !f.enabled).length;

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={settings.loading} onRefresh={settings.reload} />}
      >
        {/*
          Above the switches on purpose. A feature flag is something you change
          when you want to; an unpublished grievance officer is something that
          has to be fixed before customers arrive. Below a list of toggles it
          would read as one more optional setting.

          It renders itself as nothing when the signed-in administrator cannot
          see finance settings, so it does not leave a heading over an empty
          space for people who cannot act on it.
        */}
        <GrievanceCard />

        {!!settings.error && (
          <Card style={s.errorCard}>
            <Text style={s.errorText}>{settings.error}</Text>
          </Card>
        )}

        {offCount > 0 && (
          <Card style={s.warnCard}>
            <View style={s.warnRow}>
              <ShieldAlert size={18} color={c.state.warning} />
              <Text style={s.warnText}>
                {offCount === 1
                  ? 'One capability is switched off right now.'
                  : `${offCount} capabilities are switched off right now.`}
              </Text>
            </View>
          </Card>
        )}

        <SectionTitle
          title="Platform switches"
          subtitle="Take something offline without a deployment. Orders already placed are never affected."
        />

        {flags.map(flag => (
          <Card key={flag.key} style={s.flagCard}>
            <View style={s.flagHead}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.flagLabel}>{flag.label}</Text>
                <Text style={s.flagDescription}>{flag.description}</Text>
              </View>
              <Toggle value={flag.enabled} onChange={next => onToggle(flag, next)} />
            </View>

            {!flag.enabled && (
              <>
                <Divider style={{ marginVertical: 10 }} />
                <View style={s.offRow}>
                  <Badge label="OFF" tone="danger" />
                  <Text style={s.offMessage}>“{flag.blockedMessage}”</Text>
                </View>
              </>
            )}

            {!!flag.updatedAt && (
              <Text style={s.meta}>
                {flag.enabled ? 'Restored' : 'Switched off'} {timeAgo(flag.updatedAt)}
                {flag.updatedBy ? ` by ${flag.updatedBy}` : ''}
                {flag.note ? ` — ${flag.note}` : ''}
              </Text>
            )}
          </Card>
        ))}

        <SectionTitle
          title="What you hear about"
          subtitle={
            mutedCount === 0
              ? 'Everything is on. You are told about every problem the platform notices.'
              : `${mutedCount} of these are muted. You will not hear about them until you switch them back on.`
          }
        />

        {/*
          The error is rendered. Fourteen admin screens read a failure into a
          variable and show nothing, so a failed load looks like an empty page —
          and on this screen an empty page reads as "no switches exist", which is
          indistinguishable from every switch being on.
        */}
        {!!notifyError && (
          <Card style={s.flagCard}>
            <Text style={s.offMessage}>{notifyError}</Text>
          </Card>
        )}

        {notifications.length === 0 ? (
          <Card>
            <Text style={s.meta}>
              {settings.error
                ? 'These could not be loaded, which is not the same as everything being on. Pull down to try again.'
                : 'Nothing to report.'}
            </Text>
          </Card>
        ) : (
          notifications.map(category => (
            <Card key={category.key} style={s.flagCard}>
              <View style={s.flagHead}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.flagLabel}>{category.label}</Text>
                  <Text style={s.flagDescription}>{category.description}</Text>
                </View>
                {/*
                  Toggle has no disabled state, so the guard is in the handler: a
                  second tap while the first is in flight would fire a second PUT
                  and the two could land in either order, leaving the screen
                  showing the opposite of what was stored.
                */}
                <Toggle
                  value={category.enabled}
                  onChange={next => {
                    if (mutingKey) return;
                    void setNotificationCategory(category, next);
                  }}
                />
              </View>

              {/*
                Said whether it is on or off, and said on the screen rather than
                discovered afterwards. Somebody who mutes Deliveries and then
                receives a stranded order concludes the switch is broken — and a
                switch you believe is broken is one you stop trusting for the
                things it DOES control.
              */}
              {category.hasAlwaysOn && !!category.alwaysOnNote && (
                <View style={s.offRow}>
                  <Badge label="ALWAYS ON" tone="info" />
                  <Text style={s.offMessage}>{category.alwaysOnNote}</Text>
                </View>
              )}

              {!category.enabled && !category.hasAlwaysOn && (
                <>
                  <Divider style={{ marginVertical: 10 }} />
                  <View style={s.offRow}>
                    <Badge label="MUTED" tone="danger" />
                    <Text style={s.offMessage}>You will not be told about these at all.</Text>
                  </View>
                </>
              )}

              {!!category.changedAt && (
                <Text style={s.meta}>
                  {category.enabled ? 'Switched on' : 'Muted'} {timeAgo(category.changedAt)}
                </Text>
              )}
            </Card>
          ))
        )}

        <SectionTitle
          title="Dependencies"
          subtitle="Nobody switched these. The platform stopped calling them by itself."
        />

        {dependencies.length === 0 ? (
          <Card>
            <Text style={s.meta}>Nothing to report.</Text>
          </Card>
        ) : (
          dependencies.map(dependency => (
            <Card key={dependency.name} style={s.flagCard}>
              <View style={s.depRow}>
                <Activity
                  size={16}
                  color={dependency.state === 'closed' ? c.state.success : c.state.danger}
                />
                <Text style={s.flagLabel}>{dependency.name}</Text>
                <View style={{ flex: 1 }} />
                <Badge
                  label={dependency.state === 'closed' ? 'Healthy' : dependency.state === 'open' ? 'Paused' : 'Checking'}
                  tone={dependency.state === 'closed' ? 'success' : 'danger'}
                />
              </View>
              <Text style={s.flagDescription}>
                {dependency.state === 'closed'
                  ? 'Answering normally.'
                  : dependency.state === 'open'
                    ? `Stopped being called after ${dependency.failures} failures in a row${
                        dependency.openedAt ? ` — ${timeAgo(dependency.openedAt)}` : ''
                      }. It will be retried automatically.`
                    : 'One trial call is being made to see whether it has recovered.'}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>

      <Sheet
        visible={pending !== null}
        onClose={() => {
          setPending(null);
          setSaveError(null);
        }}
        title={pending ? `Switch off ${pending.label.toLowerCase()}?` : ''}
      >
        {pending && (
          <View style={{ gap: 12 }}>
            <Text style={s.confirmBody}>{pending.description}</Text>

            <Card style={s.quoteCard}>
              <Text style={s.quoteLabel}>Everyone affected will be told:</Text>
              <Text style={s.quoteText}>“{pending.blockedMessage}”</Text>
            </Card>

            <Field
              label="Why (optional, but read it back to yourself at 2am)"
              value={note}
              onChangeText={setNote}
              placeholder="gateway 5xx, ticket 4412"
            />

            {!!saveError && <Text style={s.errorText}>{saveError}</Text>}

            <Button
              label={saving ? 'Switching off…' : `Switch off ${pending.label.toLowerCase()}`}
              variant="danger"
              loading={saving}
              disabled={saving}
              full
              onPress={() => apply(pending, false, note)}
            />
            <Button
              label="Leave it on"
              variant="ghost"
              disabled={saving}
              full
              onPress={() => {
                setPending(null);
                setSaveError(null);
              }}
            />
          </View>
        )}
      </Sheet>
    </>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  flagCard: { gap: 6 },
  flagHead: { flexDirection: 'row', alignItems: 'flex-start' },
  flagLabel: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  flagDescription: { fontSize: 12, color: c.text.secondary, marginTop: 3, lineHeight: 17 },
  offRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offMessage: { flex: 1, fontSize: 12, color: c.text.secondary, fontStyle: 'italic' },
  meta: { fontSize: 11, color: c.text.secondary, marginTop: 6 },
  depRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warnCard: { backgroundColor: c.bg.sunken },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warnText: { flex: 1, fontSize: 13, color: c.text.primary, fontWeight: '600' },
  errorCard: { backgroundColor: c.bg.sunken },
  errorText: { fontSize: 13, color: c.state.danger },
  confirmBody: { fontSize: 13, color: c.text.secondary, lineHeight: 19 },
  quoteCard: { backgroundColor: c.bg.sunken, gap: 4 },
  quoteLabel: { fontSize: 11, color: c.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  quoteText: { fontSize: 14, color: c.text.primary, lineHeight: 20 }
});
