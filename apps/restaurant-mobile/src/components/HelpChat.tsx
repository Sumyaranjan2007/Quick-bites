import React, { useMemo } from 'react';
import { View } from 'react-native';
import { c, FONT_FAMILY } from '../theme';
import {
  fetchHelpTopics,
  fetchHelpAnswer,
  matchHelp,
  fetchSupportTickets,
  fetchSupportTicket,
  raiseSupportTicket,
  replySupportTicket, resolveSupportTicket, markSupportTicketRead,
  type ApiResult
} from '../lib/partnerApi';
import { SupportChat, type ChatApi } from './SupportChat';

/** The result's data, or the server's message as an error. */
async function data<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const res = await call;
  if (!res.ok || !res.data) throw new Error(res.message || 'That did not go through. Try again.');
  return res.data;
}

/** Help as a real chat (owner, 19 Oct 2026): `SupportChat` with the Partner app's calls and colours. */
export const HelpChat: React.FC<{ onSent?: () => void; historyFooter?: React.ReactNode }> = ({ onSent, historyFooter }) => {
  const api = useMemo<ChatApi>(
    () => ({
      help: () => data(fetchHelpTopics()),
      answer: async id => (await data(fetchHelpAnswer(id))).answer,
      match: text => data(matchHelp(text)),
      tickets: async () => (await data(fetchSupportTickets())).tickets,
      ticket: async id => (await data(fetchSupportTicket(id))).ticket,
      raise: async body => {
        const made = (await data(raiseSupportTicket(body))).ticket;
        onSent?.();
        return made;
      },
      reply: async (id, body) => (await data(replySupportTicket(id, body))).ticket,
      resolve: async id => (await data(resolveSupportTicket(id))).ticket,
      read: id => markSupportTicketRead(id)
    }),
    [onSent]
  );
  return (
    <View style={{ flex: 1 }}>
      <SupportChat
        api={api}
        historyFooter={historyFooter}
        font={FONT_FAMILY}
        colours={{ brand: c.brand, brandSoft: c.brandSoft, text: c.text, muted: c.textMuted, border: c.border, card: c.surface, danger: c.danger }}
      />
    </View>
  );
};
