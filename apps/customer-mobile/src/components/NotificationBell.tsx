import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Bell, X, BellOff } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { useNotifications } from '../lib/useNotifications';

const c = tokens.colors;

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * The bell, its unread count, and the history behind it.
 *
 * The header already had a bell drawn on it that did nothing; this makes it the
 * real thing. Opening the panel marks everything read, because the panel is the
 * reading.
 */
export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAllRead, clear, enabled } = useNotifications();
  const [open, setOpen] = useState(false);

  const openPanel = () => {
    setOpen(true);
    markAllRead();
  };

  return (
    <>
      <TouchableOpacity style={styles.bell} onPress={openPanel} activeOpacity={0.8} accessibilityLabel="Notifications">
        {enabled ? <Bell size={19} color={c.text.primary} /> : <BellOff size={19} color={c.text.muted} />}
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Notifications</Text>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={clear} activeOpacity={0.75} style={{ marginRight: 10 }}>
                  <Text style={styles.clear}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn} activeOpacity={0.8}>
                <X size={19} color={c.text.secondary} />
              </TouchableOpacity>
            </View>

            {!enabled && (
              <Text style={styles.mutedNote}>
                Notifications are turned off in your profile. Order updates will not alert you.
              </Text>
            )}

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {notifications.length === 0 ? (
                <Text style={styles.empty}>
                  Nothing yet. Updates about your orders will appear here.
                </Text>
              ) : (
                notifications.map(n => (
                  <View key={n.id} style={styles.item}>
                    <View style={[styles.dot, n.read && { backgroundColor: c.border.strong }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{n.title}</Text>
                      <Text style={styles.itemBody}>{n.body}</Text>
                      <Text style={styles.itemTime}>{ago(n.at)}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: c.semantic.error,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(26,16,20,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.app,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 26
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: c.text.primary },
  clear: { fontSize: 13, fontWeight: '700', color: c.primary[500] },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken
  },
  mutedNote: {
    fontSize: 12.5,
    color: c.accent[600],
    backgroundColor: c.accent[50],
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    lineHeight: 17
  },
  empty: { color: c.text.muted, fontSize: 13.5, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
  item: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: c.surface.card,
    borderRadius: 13,
    padding: 13,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary[500], marginTop: 6 },
  itemTitle: { fontSize: 14.5, fontWeight: '800', color: c.text.primary },
  itemBody: { fontSize: 13, color: c.text.secondary, marginTop: 3, lineHeight: 18 },
  itemTime: { fontSize: 11, color: c.text.muted, marginTop: 5 }
});
