import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react-native';
import { t } from '../theme';
import { Card, Divider, EmptyState, LoadingBlock } from '../components/ui';
import { api, type ApiContext, type Policy, type PolicySummary } from '../lib/api';
import { cacheJson, readCachedJson } from '../lib/session';

/**
 * The policy library.
 *
 * Fetched from the server so a revision reaches riders without a new build, and
 * cached on the device so the screen still opens in a basement car park.
 */
export const PoliciesScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [list, setList] = useState<PolicySummary[] | null>(null);
  const [open, setOpen] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .policies(ctx)
      .then(result => {
        if (cancelled) return;
        setList(result.policies);
        cacheJson('policies', result.policies);
      })
      .catch(async err => {
        if (cancelled) return;
        const cached = await readCachedJson<PolicySummary[]>('policies');
        if (cached) setList(cached);
        else setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.apiUrl, ctx.token]);

  const openPolicy = async (id: string) => {
    setLoadingDocument(true);
    try {
      const result = await api.policy(ctx, id);
      setOpen(result.policy);
      cacheJson(`policy.${id}`, result.policy);
    } catch {
      const cached = await readCachedJson<Policy>(`policy.${id}`);
      if (cached) setOpen(cached);
    } finally {
      setLoadingDocument(false);
    }
  };

  if (open) {
    return (
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.back} onPress={() => setOpen(null)} activeOpacity={0.7}>
          <ChevronLeft size={18} color={t.color.goText} />
          <Text style={s.backText}>All policies</Text>
        </TouchableOpacity>

        <Text style={s.docTitle}>{open.title}</Text>
        <Text style={s.docUpdated}>Last updated {open.updatedAt}</Text>

        {open.sections.map(section => (
          <View key={section.heading} style={s.section}>
            <Text style={s.sectionHeading}>{section.heading}</Text>
            <Text style={s.sectionBody}>{section.body}</Text>
          </View>
        ))}

        <Text style={s.contact}>Questions about this policy: partners@quickbites.app</Text>
      </ScrollView>
    );
  }

  if (error && !list) return <EmptyState title="Could not load policies" message={error} />;
  if (!list) return <LoadingBlock label="Loading policies…" />;

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Card style={{ paddingVertical: 0 }}>
        {list.map((policy, index) => (
          <View key={policy.id}>
            {index > 0 ? <Divider /> : null}
            <TouchableOpacity
              style={s.row}
              onPress={() => openPolicy(policy.id)}
              activeOpacity={0.7}
              disabled={loadingDocument}
            >
              <ScrollText size={18} color={t.color.textSecondary} />
              <View style={{ flex: 1, marginLeft: t.space[3] }}>
                <Text style={s.rowTitle}>{policy.title}</Text>
                <Text style={s.rowSummary}>{policy.summary}</Text>
              </View>
              <ChevronRight size={18} color={t.color.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>
      <Text style={s.footnote}>
        These are the terms your partner account is held to. Quick Bites will tell you before any of them change.
      </Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space[4] },
  rowTitle: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.semibold },
  rowSummary: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: 2, lineHeight: 18 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: t.space[4] },
  backText: { color: t.color.goText, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, marginLeft: 2 },
  docTitle: { color: t.color.text, fontSize: t.font.size.xl, fontWeight: t.font.weight.extrabold },
  docUpdated: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: t.space[2] },
  section: { marginTop: t.space[6] },
  sectionHeading: { color: t.color.goText, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  sectionBody: { color: t.color.textSecondary, fontSize: t.font.size.base, marginTop: t.space[2], lineHeight: 23 },
  contact: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: t.space[8], textAlign: 'center' },
  footnote: {
    color: t.color.textMuted,
    fontSize: t.font.size.xs,
    marginTop: t.space[5],
    textAlign: 'center',
    lineHeight: 17
  }
});
