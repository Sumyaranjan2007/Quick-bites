import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { ArrowLeft, Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight, Info } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { Card, EmptyState } from '../components/ui';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

interface Props {
  onBack: () => void;
  apiUrl?: string;
  token?: string;
}

interface WalletTransaction {
  id: string;
  type?: string;
  amount: number;
  description?: string;
  createdAt?: string;
  balanceAfter?: number;
}

const rupees = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

/**
 * The Quick Bites wallet.
 *
 * The profile listed a wallet row with a balance on it, but the row had no
 * action attached, so tapping it did nothing — the feature was advertised and
 * then withheld. A refund lands here, so a customer chasing one needs to be able
 * to open it and see the credit arrive with the order it came from.
 *
 * Read-only by design. Money enters a wallet from a settled refund or a
 * platform credit, never on the client's say-so; the server refuses a top-up
 * from anyone but staff, and a "Add money" button that always failed would be
 * worse than none.
 */
export const WalletScreen: React.FC<Props> = ({ onBack, apiUrl, token }) => {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiUrl || !token) {
      setError('Sign in to see your wallet.');
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch(`${apiUrl}/wallets/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error?.message || data?.error || 'Your wallet could not be loaded.');
      }
      const wallet = data.data?.wallet;
      setBalance(Number(wallet?.balance ?? 0));
      setTransactions(Array.isArray(data.data?.transactions) ? data.data.transactions : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Your wallet could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={22} color={c.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quick Bites wallet</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={c.primary[500]}
          />
        }
      >
        <Card style={styles.balanceCard}>
          <View style={styles.balanceHead}>
            <WalletIcon size={18} color={c.dietary.gold} />
            <Text style={styles.balanceLabel}>Available balance</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={c.primary[500]} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
          ) : (
            <Text style={styles.balanceValue}>{rupees(balance ?? 0)}</Text>
          )}
          <Text style={styles.balanceSub}>
            Used automatically against your next order. Refunds are credited here.
          </Text>
        </Card>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={load}>
              <Text style={styles.retry}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionLabel}>Activity</Text>

        {loading ? null : transactions.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing here yet"
              subtitle="Credits and refunds will show up here with the order they came from."
            />
          </Card>
        ) : (
          <Card padded={false}>
            {transactions.map((tx, index) => {
              const credit = (Number(tx.amount) || 0) >= 0 && tx.type !== 'DEBIT';
              const magnitude = Math.abs(Number(tx.amount) || 0);
              return (
                <View
                  key={tx.id || String(index)}
                  style={[styles.txRow, index < transactions.length - 1 && styles.txDivider]}
                >
                  <View
                    style={[
                      styles.txIcon,
                      { backgroundColor: credit ? c.dietary.vegBg : c.dietary.nonvegBg }
                    ]}
                  >
                    {credit ? (
                      <ArrowDownLeft size={15} color={c.dietary.veg} />
                    ) : (
                      <ArrowUpRight size={15} color={c.dietary.nonveg} />
                    )}
                  </View>
                  <View style={styles.txText}>
                    <Text style={styles.txDesc} numberOfLines={2}>
                      {tx.description || (credit ? 'Credit' : 'Payment')}
                    </Text>
                    <Text style={styles.txWhen}>{when(tx.createdAt)}</Text>
                  </View>
                  <Text
                    style={[styles.txAmount, { color: credit ? c.dietary.veg : c.text.primary }]}
                  >
                    {credit ? '+' : '−'}
                    {rupees(magnitude)}
                  </Text>
                </View>
              );
            })}
          </Card>
        )}

        <View style={styles.note}>
          <Info size={14} color={c.text.muted} />
          <Text style={styles.noteText}>
            Money can only be added to your wallet by Quick Bites — as a refund, or a credit from support.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: c.surface.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.text.primary },
  body: { padding: 20, gap: 16, paddingBottom: 48 },
  balanceCard: { backgroundColor: c.surface.card },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceLabel: { fontSize: 13, color: c.text.secondary, fontWeight: '700' },
  balanceValue: { fontSize: 34, fontWeight: '800', color: c.text.primary, marginTop: 8 },
  balanceSub: { fontSize: 12, color: c.text.muted, marginTop: 6, lineHeight: 18 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase'
  },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  txDivider: { borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  txIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  txText: { flex: 1, gap: 2 },
  txDesc: { fontSize: 13, color: c.text.primary, fontWeight: '600' },
  txWhen: { fontSize: 11, color: c.text.muted },
  txAmount: { fontSize: 14, fontWeight: '800', flexShrink: 0 },
  errorBox: { backgroundColor: c.dietary.nonvegBg, borderRadius: 12, padding: 14, gap: 8 },
  errorText: { color: c.semantic.error, fontSize: 13, lineHeight: 19 },
  retry: { color: c.primary[500], fontWeight: '800', fontSize: 13 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 11, color: c.text.muted, lineHeight: 17 }
});
