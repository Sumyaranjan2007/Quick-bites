import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { CircleAlert, Phone, ShieldAlert, TriangleAlert } from 'lucide-react-native';
import { t } from '../theme';
import { Button, Card, Divider, Pill, SectionTitle } from '../components/ui';
import { dayAndTime, titleCase } from '../lib/format';
import { api, type ApiContext, type SosAlert } from '../lib/api';

/**
 * Safety & SOS.
 *
 * Deliberately not styled like the rest of the app: red, unmissable, and
 * separated from ordinary support so nobody taps it by accident and nobody
 * hunts for it in an emergency. The first thing on the screen is the national
 * emergency number, because an app alert is not an ambulance.
 */
const CATEGORIES: Array<{ code: string; label: string; description: string }> = [
  { code: 'ACCIDENT', label: 'Accident', description: 'A collision or a fall, with or without injury.' },
  { code: 'MEDICAL', label: 'Medical emergency', description: 'You or someone near you needs medical help.' },
  { code: 'UNSAFE_LOCATION', label: 'Unsafe location', description: 'The address or the area does not feel safe.' },
  { code: 'HARASSMENT', label: 'Harassment or threat', description: 'A customer, partner or bystander is threatening you.' },
  { code: 'VEHICLE_BREAKDOWN', label: 'Vehicle breakdown', description: 'Your vehicle cannot continue the trip.' },
  { code: 'OTHER', label: 'Something else', description: 'Anything else that needs operations right now.' }
];

export const SafetyScreen: React.FC<{ ctx: ApiContext; activeOrderId?: string }> = ({ ctx, activeOrderId }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<SosAlert[]>([]);

  const loadHistory = () => {
    api
      .sosHistory(ctx)
      .then(result => setHistory(result.alerts))
      .catch(() => setHistory([]));
  };

  useEffect(loadHistory, [ctx.apiUrl, ctx.token]);

  const raise = async (category: string) => {
    setSending(true);
    let coords: { lat?: number; lng?: number } = {};
    try {
      // Best effort: an alert without coordinates still reaches the control
      // room, so a slow or refused fix must not block the send.
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      }
    } catch {
      /* send without a position */
    }

    try {
      await api.raiseSos(ctx, { category, note: note.trim() || undefined, orderId: activeOrderId, ...coords });
      setSelected(null);
      setNote('');
      loadHistory();
      Alert.alert(
        'Operations alerted',
        'The control room has your location and your trip. Somebody will call you on your registered number. If you are in danger, call 112 now.'
      );
    } catch (err: any) {
      Alert.alert('Could not send the alert', `${err.message}\n\nIf this is an emergency, call 112 directly.`);
    } finally {
      setSending(false);
    }
  };

  const confirm = (category: string, label: string) => {
    Alert.alert('Send SOS?', `This alerts Quick Bites operations immediately: ${label}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send SOS', style: 'destructive', onPress: () => raise(category) }
    ]);
  };

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <TouchableOpacity
        style={s.emergencyCard}
        activeOpacity={0.9}
        onPress={() => Linking.openURL('tel:112')}
      >
        <View style={s.emergencyIcon}>
          <Phone size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, marginLeft: t.space[4] }}>
          <Text style={s.emergencyTitle}>Call 112 — emergency services</Text>
          <Text style={s.emergencyBody}>
            For injury, fire or immediate danger, call this first. Quick Bites cannot dispatch an ambulance.
          </Text>
        </View>
      </TouchableOpacity>

      <SectionTitle style={{ marginTop: t.space[6] }}>Alert Quick Bites operations</SectionTitle>
      <Card>
        <View style={s.sosHead}>
          <ShieldAlert size={18} color={t.color.danger} />
          <Text style={s.sosHeadText}>
            Sends your name, live location and current trip to the control room straight away. A member of staff
            will call you.
          </Text>
        </View>

        <Text style={s.fieldLabel}>What is happening?</Text>
        {CATEGORIES.map(category => (
          <TouchableOpacity
            key={category.code}
            style={[s.category, selected === category.code && s.categoryActive]}
            onPress={() => setSelected(category.code)}
            activeOpacity={0.85}
          >
            <CircleAlert size={16} color={selected === category.code ? t.color.danger : t.color.textMuted} />
            <View style={{ flex: 1, marginLeft: t.space[3] }}>
              <Text style={[s.categoryLabel, selected === category.code && { color: t.color.danger }]}>
                {category.label}
              </Text>
              <Text style={s.categoryDescription}>{category.description}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={[s.fieldLabel, { marginTop: t.space[4] }]}>Anything the control room should know</Text>
        <TextInput
          style={s.input}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Optional — a landmark, a vehicle number, how you are"
          placeholderTextColor={t.color.textMuted}
        />

        <Button
          label="Send SOS"
          variant="danger"
          size="lg"
          loading={sending}
          disabled={!selected}
          icon={<TriangleAlert size={18} color="#FFFFFF" />}
          onPress={() => {
            const category = CATEGORIES.find(c => c.code === selected);
            if (category) confirm(category.code, category.label);
          }}
          style={{ marginTop: t.space[5] }}
        />
      </Card>

      {history.length > 0 ? (
        <>
          <SectionTitle style={{ marginTop: t.space[6] }}>Your alerts</SectionTitle>
          <Card>
            {history.map((alert, index) => (
              <View key={alert.id}>
                {index > 0 ? <Divider /> : null}
                <View style={s.historyRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyCategory}>{titleCase(alert.category)}</Text>
                    <Text style={s.historyDate}>{dayAndTime(alert.raisedAt)}</Text>
                    {alert.note ? (
                      <Text style={s.historyNote} numberOfLines={2}>
                        {alert.note}
                      </Text>
                    ) : null}
                  </View>
                  <Pill
                    label={titleCase(alert.status)}
                    tone={alert.status === 'RESOLVED' ? 'go' : alert.status === 'OPEN' ? 'danger' : 'money'}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={s.footnote}>
        Trips you could not finish because of an incident are excluded from your acceptance rate once operations
        close the report.
      </Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: t.space[4], paddingBottom: 132 },
  emergencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.danger,
    borderRadius: t.radius.lg,
    padding: t.space[4],
    ...t.shadow.lifted
  },
  emergencyIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emergencyTitle: { color: '#FFFFFF', fontSize: t.font.size.md, fontWeight: t.font.weight.extrabold },
  emergencyBody: { color: 'rgba(255,255,255,0.9)', fontSize: t.font.size.sm, marginTop: 3, lineHeight: 18 },
  sosHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space[5] },
  sosHeadText: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginLeft: t.space[3], flex: 1, lineHeight: 19 },
  fieldLabel: { color: t.color.textSecondary, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold, marginBottom: t.space[3] },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: t.space[3],
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    marginBottom: t.space[2]
  },
  categoryActive: { borderColor: t.color.danger, backgroundColor: t.color.dangerSoft },
  categoryLabel: { color: t.color.text, fontSize: t.font.size.sm, fontWeight: t.font.weight.bold },
  categoryDescription: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  input: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    minHeight: 80,
    padding: t.space[4],
    color: t.color.text,
    fontSize: t.font.size.base,
    textAlignVertical: 'top'
  },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: t.space[3] },
  historyCategory: { color: t.color.text, fontSize: t.font.size.sm, fontWeight: t.font.weight.bold },
  historyDate: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  historyNote: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: 4, lineHeight: 18 },
  footnote: {
    color: t.color.textMuted,
    fontSize: t.font.size.xs,
    marginTop: t.space[6],
    lineHeight: 17,
    textAlign: 'center'
  }
});
