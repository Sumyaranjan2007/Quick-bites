import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Plus, X } from 'lucide-react-native';

import { c, spacing, radii } from '../theme';

/**
 * When the kitchen is open, as the partner declares it.
 *
 * The platform closes a kitchen when its hours end, which is the whole reason
 * this exists: the most common complaint a food platform gets is not a bad
 * dish, it is an order accepted by a restaurant that was shut because somebody
 * forgot to press Offline. So this screen has to be quick enough that a
 * partner actually fills it in — a seven-day form nobody completes leaves them
 * exactly where they started.
 *
 * Hence "Copy to every day": almost every kitchen has one set of hours, and
 * typing them seven times is how a partner gives up on the third.
 *
 * Times are edited as HH:MM text and converted at the edge. The server stores
 * minutes from midnight, because every question worth asking of this data is
 * arithmetic, and doing arithmetic on strings is where the off-by-one lives.
 */

export interface Window {
  opensAt: number;
  closesAt: number;
}

export type Week = Record<string, Window[]>;

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Returns minutes from midnight, or null. Null means "leave it alone". */
function parse(text: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const TimeBox: React.FC<{ value: number; onChange: (v: number) => void; label: string }> = ({
  value,
  onChange,
  label
}) => {
  const [text, setText] = React.useState(clock(value));

  // Kept in step when the value changes from outside — "copy to every day"
  // rewrites six of these at once, and without this they keep showing what was
  // typed into them before.
  React.useEffect(() => setText(clock(value)), [value]);

  return (
    <View style={styles.timeBox}>
      <Text style={styles.timeLabel}>{label}</Text>
      <TextInput
        style={styles.timeInput}
        value={text}
        onChangeText={setText}
        onBlur={() => {
          const parsed = parse(text);
          // Reverted rather than accepted-as-something-else. A kitchen whose
          // hours were silently "fixed" by the app is a kitchen whose partner
          // believes something untrue about when they are open, and they find
          // out from a customer.
          if (parsed === null) setText(clock(value));
          else onChange(parsed);
        }}
        placeholder="HH:MM"
        placeholderTextColor={c.textMuted}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
    </View>
  );
};

export const OpeningHoursEditor: React.FC<{
  days: string[];
  week: Week;
  maxWindowsPerDay: number;
  onChange: (week: Week) => void;
}> = ({ days, week, maxWindowsPerDay, onChange }) => {
  const set = (day: string, windows: Window[]) => onChange({ ...week, [day]: windows });

  const addWindow = (day: string) => {
    const existing = week[day] || [];
    const last = existing[existing.length - 1];
    // A second window is almost always the evening service after a lunch
    // break, so it starts where a sensible evening starts rather than at 00:00.
    const opensAt = last ? Math.min(last.closesAt + 60, 22 * 60) : 11 * 60;
    set(day, [...existing, { opensAt, closesAt: Math.min(opensAt + 4 * 60, 23 * 60 + 59) }]);
  };

  const copyToAll = (day: string) => {
    const source = week[day] || [];
    const next: Week = {};
    for (const d of days) next[d] = source.map(w => ({ ...w }));
    onChange(next);
  };

  return (
    <View>
      {days.map(day => {
        const windows = week[day] || [];
        const closed = windows.length === 0;
        const label = day[0] + day.slice(1).toLowerCase();

        return (
          <View key={day} style={styles.day}>
            <View style={styles.dayHead}>
              <Text style={styles.dayName}>{label}</Text>

              <View style={styles.dayActions}>
                {!closed && (
                  <TouchableOpacity onPress={() => copyToAll(day)}>
                    <Text style={styles.linkText}>Copy to all</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => set(day, closed ? [{ opensAt: 11 * 60, closesAt: 23 * 60 }] : [])}>
                  <Text style={[styles.linkText, closed ? styles.linkOpen : styles.linkClose]}>
                    {closed ? 'Open this day' : 'Closed'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {closed ? (
              <Text style={styles.closedText}>Closed all day.</Text>
            ) : (
              <>
                {windows.map((w, i) => (
                  <View key={i} style={styles.windowRow}>
                    <TimeBox
                      label="Opens"
                      value={w.opensAt}
                      onChange={v => set(day, windows.map((x, j) => (j === i ? { ...x, opensAt: v } : x)))}
                    />
                    <TimeBox
                      label="Closes"
                      value={w.closesAt}
                      onChange={v => set(day, windows.map((x, j) => (j === i ? { ...x, closesAt: v } : x)))}
                    />
                    {windows.length > 1 && (
                      <TouchableOpacity
                        style={styles.removeWindow}
                        onPress={() => set(day, windows.filter((_, j) => j !== i))}
                      >
                        <X size={14} color={c.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                {/* A closing time at or before the opening time runs past
                    midnight, which is a real and common kitchen — said here so
                    a partner does not think they have made a mistake. */}
                {windows.some(w => w.closesAt <= w.opensAt) && (
                  <Text style={styles.hint}>This runs past midnight, which is fine.</Text>
                )}

                {windows.length < maxWindowsPerDay && (
                  <TouchableOpacity style={styles.addWindow} onPress={() => addWindow(day)}>
                    <Plus size={13} color={c.brand} />
                    <Text style={styles.addWindowText}>Add a break</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
};

/** The wire format: "HH:MM" strings, which is what the server parses. */
export function toWirePayload(week: Week, timezone = 'Asia/Kolkata') {
  const out: Record<string, Array<{ opensAt: string; closesAt: string }>> = {};
  for (const [day, windows] of Object.entries(week)) {
    out[day] = windows.map(w => ({ opensAt: clock(w.opensAt), closesAt: clock(w.closesAt) }));
  }
  return { week: out, timezone };
}

const styles = StyleSheet.create({
  day: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayName: { color: c.text, fontSize: 14, fontWeight: '700' },
  dayActions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  linkText: { fontSize: 12.5, fontWeight: '700', color: c.brand },
  linkOpen: { color: c.success },
  linkClose: { color: c.textMuted },

  closedText: { color: c.textMuted, fontSize: 12.5, marginTop: 6 },

  windowRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  timeBox: { flex: 1 },
  timeLabel: { color: c.textMuted, fontSize: 11, marginBottom: 3 },
  timeInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: c.text,
    fontSize: 14.5,
    backgroundColor: c.surface
  },
  removeWindow: { paddingBottom: 10, paddingHorizontal: 4 },

  hint: { color: c.textMuted, fontSize: 11.5, marginTop: 6 },
  addWindow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  addWindowText: { color: c.brand, fontSize: 12.5, fontWeight: '700' }
});

export default OpeningHoursEditor;
