import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator
} from 'react-native';
import { Camera, X, Clock, CircleAlert, CircleCheck, Hourglass } from 'lucide-react-native';

import { Card, SectionHeading, Pill, Button, Field, ErrorNote } from '../components/ui';
import { c, spacing, radii } from '../theme';
import { chooseProfilePhoto } from '../lib/photo';
import { OpeningHoursEditor, toWirePayload, type Week } from '../components/OpeningHoursEditor';
import {
  fetchProfile,
  submitProfileChanges,
  fetchProfileEdits,
  setHoursOverride,
  type EditableProfileView,
  type ProfileResponse,
  type ProfileRules
} from '../lib/partnerApi';

/**
 * How the restaurant presents itself to customers.
 *
 * The reported problem was that a partner could not give their restaurant a
 * face: the cover photo existed in the data model and was display-only, there
 * was no description, no opening hours, and no way to change any of it without
 * an administrator editing the record by hand.
 *
 * THE ONE THING THIS SCREEN MUST NOT DO is imply a change is live. Everything
 * here goes for review, and the live record does not move until a human
 * approves it. So the screen shows two states for every field at once - what
 * customers see, and what is waiting - and says which is which. A partner who
 * edits their name, sees it on their own screen, and assumes customers see it
 * too will find out days later from somebody who searched for the new name.
 */

const REVIEW_TONE: Record<string, 'brand' | 'success' | 'danger' | 'warning' | 'muted'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'warning',
  REJECTED: 'danger',
  SUPERSEDED: 'muted'
};

const REVIEW_WORD: Record<string, string> = {
  PENDING: 'In review',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Partly approved',
  REJECTED: 'Not approved',
  SUPERSEDED: 'Replaced'
};

/** Server field names, in the partner's words. */
const FIELD_WORD: Record<string, string> = {
  name: 'Restaurant name',
  description: 'About',
  phone: 'Phone number',
  addressLine: 'Address',
  city: 'City',
  pincode: 'Pincode',
  coordinates: 'Map pin',
  cuisineTags: 'Cuisines',
  costForTwo: 'Cost for two',
  bannerUrl: 'Cover photo',
  galleryUrls: 'Photos',
  openingHours: 'Opening hours'
};

interface Draft {
  name: string;
  description: string;
  phone: string;
  addressLine: string;
  city: string;
  pincode: string;
  cuisineTags: string;
  costForTwo: string;
  bannerUrl: string;
  galleryUrls: string[];
  week: Week;
}

function toDraft(published: EditableProfileView): Draft {
  return {
    name: published.name ?? '',
    description: published.description ?? '',
    phone: published.phone ?? '',
    addressLine: published.addressLine ?? '',
    city: published.city ?? '',
    pincode: published.pincode ?? '',
    cuisineTags: (published.cuisineTags ?? []).join(', '),
    costForTwo: published.costForTwo ? String(published.costForTwo) : '',
    bannerUrl: published.bannerUrl ?? '',
    galleryUrls: published.galleryUrls ?? [],
    // An ABSENT week is not a closed one. A restaurant that has never declared
    // hours is governed entirely by its Online switch, exactly as the platform
    // behaved before hours existed, and an empty object here preserves that.
    week: (published.openingHours?.week as Week) ?? {}
  };
}

export const ProfileEditScreen: React.FC<{ restaurantId: string }> = ({ restaurantId }) => {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      const [p, h] = await Promise.all([fetchProfile(restaurantId), fetchProfileEdits(restaurantId)]);

      if (!p.ok || !p.data) {
        setError(p.message || 'Could not load your profile.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setProfile(p.data);
      // The form is seeded from what is PUBLISHED, not from what is pending.
      // Seeding it from the pending edit would show the partner their
      // unreviewed values as though they were the restaurant's, which is the
      // exact confusion this screen exists to prevent.
      setDraft(toDraft(p.data.published));
      if (h.ok && h.data) setHistory(h.data.edits);

      setLoading(false);
      setRefreshing(false);
    },
    [restaurantId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const rules: ProfileRules | null = profile?.rules ?? null;
  const pendingFields = useMemo(
    () => new Set(profile?.pending?.fields ?? []),
    [profile?.pending?.fields]
  );

  /** The most recent refusal for a field, so the partner is told what to fix. */
  const refusalFor = useCallback(
    (field: string): string | null => {
      for (const edit of history) {
        const hit = (edit.rejections || []).find((r: any) => r.field === field);
        if (hit) return hit.reason;
        if ((edit.approvedFields || []).includes(field)) return null;
      }
      return null;
    },
    [history]
  );

  const set = (key: keyof Draft, value: any) =>
    setDraft(d => (d ? { ...d, [key]: value } : d));

  const addPhoto = async (target: 'cover' | 'gallery') => {
    setPhotoBusy(true);
    setError(null);
    try {
      const uri = await chooseProfilePhoto(
        target === 'cover' ? 'Cover photo' : 'Add a photo'
      );
      if (!uri) return;
      if (target === 'cover') set('bannerUrl', uri);
      else
        setDraft(d =>
          d ? { ...d, galleryUrls: [...d.galleryUrls, uri].slice(0, rules?.maxGalleryImages ?? 4) } : d
        );
    } catch (err: any) {
      // Surfaced rather than swallowed: the helper rejects with something the
      // partner can act on ("too detailed", "try a plainer background"), and a
      // silent failure looks like the button not working.
      setError(err?.message || 'That photo could not be used.');
    } finally {
      setPhotoBusy(false);
    }
  };

  /**
   * Sends the whole form and lets the SERVER decide what changed.
   *
   * Diffing here would put this app's idea of "changed" in front of the
   * server's, and the two would drift. The server keeps only genuinely
   * different fields and says whether anything was submitted at all.
   */
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const changes: EditableProfileView = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      phone: draft.phone.trim(),
      addressLine: draft.addressLine.trim(),
      city: draft.city.trim(),
      pincode: draft.pincode.trim(),
      cuisineTags: draft.cuisineTags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
      galleryUrls: draft.galleryUrls
    };
    // Only sent once the partner has declared something. Sending an empty week
    // would record "no hours declared" as a deliberate choice and put it
    // through review, when in fact they simply have not filled it in.
    if (Object.keys(draft.week).length > 0) {
      changes.openingHours = toWirePayload(draft.week) as any;
    }
    if (draft.costForTwo.trim()) changes.costForTwo = Number(draft.costForTwo);
    if (draft.bannerUrl) changes.bannerUrl = draft.bannerUrl;

    const res = await submitProfileChanges(restaurantId, changes);
    setSaving(false);

    if (!res.ok) {
      setError(res.message || 'Could not send those changes for review.');
      return;
    }
    setNotice(res.data?.message ?? null);
    await load(true);
  };

  const overrideHours = async (minutes: number) => {
    const res = await setHoursOverride(restaurantId, minutes);
    if (!res.ok) {
      setError(res.message || 'Could not change your opening override.');
      return;
    }
    setNotice(res.data?.message ?? null);
    await load(true);
  };

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  if (!profile || !draft || !rules) {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorNote message={error || 'Could not load your profile.'} onRetry={() => void load()} />
      </ScrollView>
    );
  }

  const gallery = draft.galleryUrls;
  const canAddMore = gallery.length < rules.maxGalleryImages;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(true);
          }}
          tintColor={c.brand}
        />
      }
    >
      {/* Said once, at the top, in the server's own words - so the rule cannot
          be changed on the server and left contradicted by this app. */}
      <Card style={styles.noticeCard}>
        <View style={styles.noticeRow}>
          <CircleAlert size={16} color={c.info} />
          <Text style={styles.noticeText}>{rules.reviewNotice}</Text>
        </View>
      </Card>

      {!!error && <ErrorNote message={error} />}
      {!!notice && (
        <Card style={styles.okCard}>
          <View style={styles.noticeRow}>
            <CircleCheck size={16} color={c.success} />
            <Text style={styles.okText}>{notice}</Text>
          </View>
        </Card>
      )}

      {profile.pending && (
        <Card style={styles.pendingCard}>
          <SectionHeading
            title="Waiting for review"
            sub={`Sent ${new Date(profile.pending.submittedAt).toLocaleDateString()}. Customers still see your current details.`}
            right={<Pill label="In review" tone="warning" />}
          />
          <View style={styles.chipWrap}>
            {profile.pending.fields.map(f => (
              <View key={f} style={styles.chip}>
                <Hourglass size={12} color={c.warning} />
                <Text style={styles.chipText}>{FIELD_WORD[f] ?? f}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {/* ------------------------------------------------------------ photos */}
      <Card>
        <SectionHeading
          title="Cover photo"
          sub="The picture customers see on your card. Cropped to a wide shape so every card matches."
        />
        {draft.bannerUrl ? (
          <View>
            <Image source={{ uri: draft.bannerUrl }} style={styles.cover} resizeMode="cover" />
            <View style={styles.coverActions}>
              <Button label="Replace" variant="ghost" onPress={() => void addPhoto('cover')} busy={photoBusy} />
              <Button label="Remove" variant="danger" onPress={() => set('bannerUrl', '')} />
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.coverEmpty} onPress={() => void addPhoto('cover')} activeOpacity={0.8}>
            <Camera size={22} color={c.brand} />
            <Text style={styles.coverEmptyText}>Add a cover photo</Text>
            <Text style={styles.coverEmptyHint}>
              Until you do, customers see your food photos instead.
            </Text>
          </TouchableOpacity>
        )}
        {!!refusalFor('bannerUrl') && (
          <Text style={styles.refusal}>Last refused: {refusalFor('bannerUrl')}</Text>
        )}
      </Card>

      <Card>
        <SectionHeading
          title="More photos"
          sub={`Up to ${rules.maxGalleryImages}. Shown on your page when a customer opens it.`}
          right={<Pill label={`${gallery.length}/${rules.maxGalleryImages}`} tone="muted" />}
        />
        <View style={styles.galleryRow}>
          {gallery.map((uri, i) => (
            <View key={`${i}-${uri.slice(-12)}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
              <TouchableOpacity
                style={styles.thumbRemove}
                onPress={() =>
                  setDraft(d => (d ? { ...d, galleryUrls: d.galleryUrls.filter((_, j) => j !== i) } : d))
                }
              >
                <X size={13} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))}
          {canAddMore && (
            <TouchableOpacity style={styles.thumbAdd} onPress={() => void addPhoto('gallery')} activeOpacity={0.8}>
              <Camera size={18} color={c.brand} />
            </TouchableOpacity>
          )}
        </View>
      </Card>

      {/* -------------------------------------------------------------- text */}
      <Card>
        <SectionHeading title="About your restaurant" />
        <Field
          label="Restaurant name"
          value={draft.name}
          onChangeText={v => set('name', v)}
          hint={pendingFields.has('name') ? 'A change to this is in review.' : undefined}
          error={refusalFor('name')}
        />
        <Field
          label="About"
          value={draft.description}
          onChangeText={v => set('description', v)}
          multiline
          placeholder="What you are known for, in a sentence or two."
          hint={`${draft.description.length}/${rules.maxDescriptionChars}`}
          error={refusalFor('description')}
        />
        <Field
          label="Cuisines"
          value={draft.cuisineTags}
          onChangeText={v => set('cuisineTags', v)}
          placeholder="Biryani, Mughlai, Kebabs"
          hint={`Separated by commas. Up to ${rules.maxCuisineTags}. This is how customers find you.`}
          error={refusalFor('cuisineTags')}
        />
        <Field
          label="Cost for two"
          value={draft.costForTwo}
          onChangeText={v => set('costForTwo', v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          hint="Roughly what two people spend. Shown on your card."
          error={refusalFor('costForTwo')}
        />
      </Card>

      <Card>
        <SectionHeading title="Where you are" sub="Used to work out who you can deliver to." />
        <Field
          label="Address"
          value={draft.addressLine}
          onChangeText={v => set('addressLine', v)}
          multiline
          error={refusalFor('addressLine')}
        />
        <Field label="City" value={draft.city} onChangeText={v => set('city', v)} error={refusalFor('city')} />
        <Field
          label="Pincode"
          value={draft.pincode}
          onChangeText={v => set('pincode', v.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          error={refusalFor('pincode')}
        />
        <Field
          label="Phone number"
          value={draft.phone}
          onChangeText={v => set('phone', v.replace(/[^0-9]/g, '').slice(0, 10))}
          keyboardType="phone-pad"
          hint="Where customers and our team reach the kitchen."
          error={refusalFor('phone')}
        />
      </Card>

      <Button
        label={saving ? 'Sending…' : 'Send changes for review'}
        onPress={() => void save()}
        busy={saving}
        style={{ marginTop: spacing.sm }}
      />

      {/* ------------------------------------------------------------- hours */}
      <Card style={{ marginTop: spacing.lg }}>
        <SectionHeading
          title="When you are open"
          sub="We close your kitchen for you when these end, so a forgotten switch never takes an order you cannot cook."
          right={pendingFields.has('openingHours') ? <Pill label="In review" tone="warning" /> : undefined}
        />
        <OpeningHoursEditor
          days={rules.daysOfWeek}
          week={draft.week}
          maxWindowsPerDay={rules.maxWindowsPerDay}
          onChange={w => set('week', w)}
        />
        {Object.keys(draft.week).length === 0 && (
          <Text style={styles.hoursEmpty}>
            You have not set any hours yet, so your Online switch decides everything. Set them and we will
            close the kitchen for you.
          </Text>
        )}
        {!!refusalFor('openingHours') && (
          <Text style={styles.refusal}>Last refused: {refusalFor('openingHours')}</Text>
        )}
        <Button
          label={saving ? 'Sending\u2026' : 'Send hours for review'}
          onPress={() => void save()}
          busy={saving}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card style={{ marginTop: spacing.lg }}>
        <SectionHeading
          title="Staying open late"
          sub="Your declared hours close the kitchen for you. This keeps it open past them, just for tonight."
        />
        <View style={styles.hoursRow}>
          <Clock size={15} color={c.textMuted} />
          <Text style={styles.hoursText}>
            {profile.kitchen.forceOpenUntil
              ? `Open until ${new Date(profile.kitchen.forceOpenUntil).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}`
              : profile.kitchen.withinDeclaredHours === null
                ? 'You have not set opening hours yet, so your Online switch decides everything.'
                : profile.kitchen.withinDeclaredHours
                  ? 'You are inside your normal hours.'
                  : 'You are outside your normal hours.'}
          </Text>
        </View>
        {!profile.kitchen.canGoOnline ? (
          <Text style={styles.lockedText}>
            Your restaurant is still being verified, so this is locked until our team approves you.
          </Text>
        ) : (
          <View style={styles.overrideRow}>
            <Button label="+1 hour" variant="ghost" onPress={() => void overrideHours(60)} />
            <Button label="+3 hours" variant="ghost" onPress={() => void overrideHours(180)} />
            {!!profile.kitchen.forceOpenUntil && (
              <Button label="Stop" variant="danger" onPress={() => void overrideHours(0)} />
            )}
          </View>
        )}
      </Card>

      {/* ----------------------------------------------------------- history */}
      {history.length > 0 && (
        <Card style={{ marginTop: spacing.lg }}>
          <SectionHeading title="What you have sent" sub="Newest first." />
          {history.slice(0, 8).map(edit => (
            <View key={edit.id} style={styles.historyRow}>
              <View style={styles.historyHead}>
                <Text style={styles.historyDate}>
                  {new Date(edit.submittedAt).toLocaleDateString()}
                </Text>
                <Pill
                  label={REVIEW_WORD[edit.status] ?? edit.status}
                  tone={REVIEW_TONE[edit.status] ?? 'muted'}
                />
              </View>
              <Text style={styles.historyFields}>
                {edit.fields.map((f: string) => FIELD_WORD[f] ?? f).join(', ')}
              </Text>
              {(edit.rejections || []).map((r: any) => (
                <Text key={r.field} style={styles.refusal}>
                  {FIELD_WORD[r.field] ?? r.field}: {r.reason}
                </Text>
              ))}
            </View>
          ))}
        </Card>
      )}

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  noticeCard: { backgroundColor: '#EAF2FB', borderColor: '#C6DBF2' },
  okCard: { backgroundColor: c.successSoft, borderColor: '#BFE5D2' },
  noticeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1, color: c.textSoft, fontSize: 13, lineHeight: 18 },
  okText: { flex: 1, color: c.success, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  pendingCard: { borderColor: '#EAD3A8', backgroundColor: '#FFF9EE' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAD3A8',
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md
  },
  chipText: { fontSize: 12, color: c.warning, fontWeight: '600' },

  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md, backgroundColor: c.bg },
  coverActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  coverEmpty: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.bg
  },
  coverEmptyText: { color: c.brand, fontWeight: '700', fontSize: 14 },
  coverEmptyHint: { color: c.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xl },

  galleryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  thumbWrap: { width: 84, height: 60 },
  thumb: { width: 84, height: 60, borderRadius: radii.sm, backgroundColor: c.bg },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: c.danger,
    borderRadius: radii.pill,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center'
  },
  thumbAdd: {
    width: 84,
    height: 60,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center'
  },

  refusal: { color: c.danger, fontSize: 12, marginTop: 6, lineHeight: 17 },
  hoursEmpty: { color: c.textMuted, fontSize: 12.5, marginTop: spacing.md, lineHeight: 18 },

  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  hoursText: { flex: 1, color: c.textSoft, fontSize: 13, lineHeight: 18 },
  overrideRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  lockedText: { color: c.textMuted, fontSize: 12.5, marginTop: spacing.sm, lineHeight: 18 },

  historyRow: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyDate: { color: c.textMuted, fontSize: 12.5 },
  historyFields: { color: c.text, fontSize: 13.5, marginTop: 4 }
});

export default ProfileEditScreen;
