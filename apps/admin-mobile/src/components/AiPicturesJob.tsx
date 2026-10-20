import { FONT_FAMILY, tokens } from '../theme/tokens';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, ResourceError } from './ui';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

/**
 * "Generate pictures for dishes without one" for a kitchen's live menu or its pending requests (owner, 20 Oct 2026).
 * Runs on the server dish by dish; this shows the progress live, and when the AI's limit stops it, the reason and
 * a Resume button (after a new key is added on Railway it carries on from the next dish).
 */
export const AiPicturesJob: React.FC<{ restaurantId: string; scope: 'MENU' | 'REQUESTS' }> = ({ restaurantId, scope }) => {
  const { api, can } = useSession();
  const [busy, setBusy] = useState(false);
  const jobs = useResource(() => api.get<any>(`/admin/ai-images/jobs?restaurantId=${encodeURIComponent(restaurantId)}`), [restaurantId]);
  const job = scope === 'MENU' ? jobs.data?.menu : jobs.data?.requests;
  if (!can('catalog.menus.edit')) return null;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await jobs.silentReload();
    } catch (err: any) {
      Alert.alert('Pictures', err?.message || 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const start = () => act(() => api.post('/admin/ai-images/jobs', { restaurantId, scope }));
  const resume = () => act(() => api.post(`/admin/ai-images/jobs/${job.id}/resume`));

  const made = job ? job.done - job.reused : 0;
  return (
    <View style={s.box}>
      <ResourceError resource={jobs} what="Picture progress" />
      {job?.status === 'RUNNING' ? (
        <Text style={s.text}>
          Making pictures: {job.done + job.skipped} of {job.total}…
        </Text>
      ) : job?.status === 'PAUSED' ? (
        <>
          <Text style={[s.text, { color: tokens.colors.state.danger }]}>
            Stopped at {job.done + job.skipped} of {job.total}. {job.pauseReason}
          </Text>
          <Button label="Resume" onPress={resume} loading={busy} />
        </>
      ) : (
        <>
          {job?.status === 'DONE' ? (
            <Text style={s.text}>
              Last run: {made} new, {job.reused} reused, {job.skipped} already had a photo
              {job.failed?.length ? `, ${job.failed.length} not drawn (${job.failed.map((f: any) => f.name).join(', ')})` : ''}.
            </Text>
          ) : null}
          <Button
            label={scope === 'MENU' ? 'Generate pictures for dishes without one' : 'Generate pictures for requested dishes without one'}
            variant="secondary"
            onPress={start}
            loading={busy}
          />
        </>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  box: { gap: tokens.space[2], marginBottom: tokens.space[3] },
  text: { fontFamily: FONT_FAMILY, fontSize: tokens.font.size.xs, color: tokens.colors.text.secondary }
});
