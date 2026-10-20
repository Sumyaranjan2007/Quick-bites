import React, { useMemo } from 'react';
import { View } from 'react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import { SupportChat, type ChatApi } from './SupportChat';

const c = tokens.colors;

/**
 * Help as a real chat (owner, 19 Oct 2026): `SupportChat` with the Customer
 * app's calls and colours.
 */
export const HelpChat: React.FC<{ apiUrl?: string; token?: string; onSent?: () => void; historyFooter?: React.ReactNode; orderId?: string | null }> = ({ apiUrl, token, onSent, historyFooter, orderId }) => {
  const api = useMemo<ChatApi>(() => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const data = async (res: Response) => {
      const body = await res.json().catch(() => null);
      if (!body?.success) throw new Error(body?.error?.message || 'That did not go through. Try again.');
      return body.data;
    };
    return {
      // Two literal paths, so the API contract check can read them.
      help: async () =>
        data(
          await apiFetch(orderId ? `${apiUrl}/support/help?orderId=${encodeURIComponent(orderId)}` : `${apiUrl}/support/help`, { headers })
        ),
      answer: async id => (await data(await apiFetch(`${apiUrl}/support/help/${encodeURIComponent(id)}`, { headers }))).answer,
      match: async text => data(await apiFetch(`${apiUrl}/support/help/match`, { method: 'POST', headers, body: JSON.stringify({ text }) })),
      tickets: async () => (await data(await apiFetch(`${apiUrl}/support/tickets`, { headers }))).tickets,
      ticket: async id => (await data(await apiFetch(`${apiUrl}/support/tickets/${id}`, { headers }))).ticket,
      raise: async body => {
        const made = (
          await data(
            await apiFetch(`${apiUrl}/support/tickets`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
              subject: body.subject,
              category: body.category,
              message: body.message,
              helpTopics: body.helpTopics,
              platform: body.platform,
              ...(body.orderId ? { orderId: body.orderId } : {})
            })
          }))
        ).ticket;
        onSent?.();
        return made;
      },
      reply: async (id, body) =>
        (await data(await apiFetch(`${apiUrl}/support/tickets/${id}/reply`, { method: 'POST', headers, body: JSON.stringify({ body }) }))).ticket,
      resolve: async id =>
        (await data(await apiFetch(`${apiUrl}/support/tickets/${id}/resolve`, { method: 'POST', headers }))).ticket
    };
  }, [apiUrl, token, onSent, orderId]);

  return (
    <View style={{ flex: 1 }}>
      <SupportChat
        api={api}
        historyFooter={historyFooter}
        font={tokens.font.family}
        colours={{
          brand: c.primary[500],
          brandSoft: c.primary[50],
          text: c.text.primary,
          muted: c.text.muted,
          border: c.border.subtle,
          card: c.surface.card,
          danger: c.semantic.error
        }}
      />
    </View>
  );
};
