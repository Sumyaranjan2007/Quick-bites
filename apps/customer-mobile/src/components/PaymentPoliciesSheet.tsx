import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { X, ChevronLeft, ChevronRight, ScrollText, TriangleAlert } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';

/**
 * What we charge, and how a refund comes back.
 *
 * -------------------------------------------------------------------------
 * FETCHED, NOT BUNDLED
 * -------------------------------------------------------------------------
 * A policy revision has to reach everybody the next time they open a screen,
 * not the next time they install a build. A platform whose published refund
 * policy is three versions behind what its code does is in a worse position
 * than one with no policy at all — it has made a promise it demonstrably does
 * not keep.
 *
 * The figures in the text come from the live configuration for the same reason,
 * so a change to what we charge cannot leave a policy quietly contradicting it.
 *
 * -------------------------------------------------------------------------
 * AND IT SHOWS WHAT IS NOT PUBLISHED
 * -------------------------------------------------------------------------
 * If the formal escalation route has not been published yet, the server says
 * so and this screen shows it rather than hiding it to look finished. Somebody
 * deciding whether to trust us with money is entitled to know what is missing.
 */

const c = tokens.colors;

interface PolicySummary {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
}

interface Policy extends PolicySummary {
  sections: Array<{ heading: string; body: string }>;
}

export const PaymentPoliciesSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  apiUrl?: string;
}> = ({ visible, onClose, apiUrl }) => {
  const [list, setList] = useState<PolicySummary[] | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [open, setOpen] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiUrl) return;
    setLoading(true);
    setError(null);
    try {
      // No token: these are deliberately readable by anybody.
      const res = await apiFetch(`${apiUrl}/policies/payments?audience=customer`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        setError('Our policies could not be loaded just now.');
        return;
      }
      setList(payload.data?.policies || []);
      setGaps(payload.data?.gaps || []);
    } catch {
      setError('We could not reach Quick Bites. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (visible && !list) void load();
  }, [visible, list, load]);

  const openPolicy = async (id: string) => {
    if (!apiUrl) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${apiUrl}/policies/payments/${id}`);
      const payload = await res.json().catch(() => ({}));
      if (payload?.data?.policy) setOpen(payload.data.policy);
    } catch {
      setError('That policy could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setOpen(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={open ? () => setOpen(null) : close}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            {open ? (
              <TouchableOpacity
                onPress={() => setOpen(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={s.backBtn}
              >
                <ChevronLeft size={18} color={c.text.secondary} />
                <Text style={s.backText}>All policies</Text>
              </TouchableOpacity>
            ) : (
              <>
                <ScrollText size={18} color={c.primary[500]} />
                <Text style={s.title}>Payments and refunds</Text>
              </>
            )}
            <TouchableOpacity onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={c.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body}>
            {loading && !list ? (
              <View style={s.centre}>
                <ActivityIndicator color={c.primary[500]} />
              </View>
            ) : error ? (
              <Text style={s.error}>{error}</Text>
            ) : open ? (
              <>
                <Text style={s.docTitle}>{open.title}</Text>
                <Text style={s.docDate}>Last updated {open.updatedAt}</Text>
                {open.sections.map(section => (
                  <View key={section.heading} style={s.section}>
                    <Text style={s.sectionHeading}>{section.heading}</Text>
                    <Text style={s.sectionBody}>{section.body}</Text>
                  </View>
                ))}
              </>
            ) : (
              <>
                {gaps.length > 0 && (
                  <View style={s.gapBox}>
                    <TriangleAlert size={15} color={c.semantic.warning} />
                    <Text style={s.gapText}>
                      {gaps.join(' ')} We are showing you this rather than leaving the section blank.
                    </Text>
                  </View>
                )}

                {(list || []).map(policy => (
                  <TouchableOpacity
                    key={policy.id}
                    style={s.row}
                    onPress={() => void openPolicy(policy.id)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{policy.title}</Text>
                      <Text style={s.rowSummary}>{policy.summary}</Text>
                    </View>
                    <ChevronRight size={18} color={c.text.muted} />
                  </TouchableOpacity>
                ))}

                <Text style={s.footnote}>
                  These are fetched fresh each time, so what you read here is what applies today.
                </Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(23,19,19,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  title: { color: c.text.primary, fontSize: 17, fontWeight: '800', flex: 1 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  backText: { color: c.text.secondary, fontSize: 14, fontWeight: '600' },

  body: { padding: 20, paddingBottom: 36 },
  centre: { paddingVertical: 40, alignItems: 'center' },
  error: { color: c.semantic.error, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 20 },

  gapBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: c.surface.sunken,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16
  },
  gapText: { color: c.text.secondary, fontSize: 12, lineHeight: 17, flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  rowTitle: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  rowSummary: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },

  docTitle: { color: c.text.primary, fontSize: 20, fontWeight: '800' },
  docDate: { color: c.text.muted, fontSize: 12, marginTop: 4, marginBottom: 8 },
  section: { marginTop: 18 },
  sectionHeading: { color: c.text.primary, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  sectionBody: { color: c.text.secondary, fontSize: 14, lineHeight: 21 },

  footnote: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 18, textAlign: 'center' }
});

export default PaymentPoliciesSheet;
