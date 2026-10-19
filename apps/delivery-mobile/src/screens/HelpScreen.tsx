import React, { useMemo } from 'react';
import { FONT_FAMILY, t } from '../theme';
import { api, type ApiContext } from '../lib/api';
import { SupportChat, type ChatApi } from '../components/SupportChat';

/** Help as a real chat (owner, 19 Oct 2026): `SupportChat` with the Rider app's calls and colours. */
export const HelpScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const chat = useMemo<ChatApi>(
    () => ({
      help: () => api.helpTopics(ctx),
      answer: async id => (await api.helpAnswer(ctx, id)).answer,
      match: text => api.helpMatch(ctx, text),
      tickets: async () => (await api.supportTickets(ctx)).tickets,
      ticket: async id => (await api.supportTicket(ctx, id)).ticket,
      raise: async body => (await api.raiseSupportTicket(ctx, body)).ticket,
      reply: async (id, body) => (await api.replySupportTicket(ctx, id, body)).ticket,
      resolve: async id => (await api.resolveSupportTicket(ctx, id)).ticket
    }),
    [ctx]
  );
  return (
    <SupportChat
      api={chat}
      font={FONT_FAMILY}
      colours={{
        brand: t.color.brand,
        brandSoft: t.color.brandSoft,
        text: t.color.text,
        muted: t.color.textMuted,
        border: t.color.border,
        card: t.color.surface,
        danger: t.color.danger
      }}
    />
  );
};
