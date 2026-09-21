import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput, Alert } from 'react-native';
import { Banknote, TriangleAlert, CircleCheck, Clock, Building2, Ban } from 'lucide-react-native';
import { t } from '../theme';
import { Card, SectionTitle, Pill, Button, EmptyState, LoadingBlock, ProgressBar, Divider } from '../components/ui';
import { cashApi, type ApiContext, type CashStandingView, type CashDepositView } from '../lib/api';

/**
 * The cash a rider is carrying, and getting it off them.
 *
 * -------------------------------------------------------------------------
 * WHY THIS SCREEN EXISTS AT ALL
 * -------------------------------------------------------------------------
 * Cash-on-delivery money is the platform's money sitting in a stranger's bag.
 * Until it is counted in an office it is at risk from theft, from honest
 * miscounting, and from a rider who quietly stops answering the phone. Every
 * hour it stays out there is exposure, and the only lever that shortens that
 * hour is a rider who can see exactly how much they are holding and how close
 * they are to being unable to earn.
 *
 * -------------------------------------------------------------------------
 * THE CEILING IS SHOWN LONG BEFORE IT BITES
 * -------------------------------------------------------------------------
 * A rider who discovers the limit at the moment an order is refused loses a
 * delivery and blames the app. So the bar is on screen from the first rupee,
 * the warning arrives while there is still room to work, and the refusal — when
 * it comes — says the number, says the fix, and does not pretend to be a bug.
 *
 * -------------------------------------------------------------------------
 * DECLARING IS NOT DEPOSITING
 * -------------------------------------------------------------------------
 * Nothing on this screen moves money. A declaration is a statement made BEFORE
 * the counting, which is the only thing that makes it evidence: one made
 * afterwards just agrees with whatever was found. The rider's balance drops
 * when an administrator confirms what they actually counted, and by that
 * counted amount — never by the declared one.
 */

const money = (rupees: number) =>
  '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const paise = (value: number) => money(Math.round(value) / 100);

const STATUS_PILL: Record<CashDepositView['status'], { label: string; tone: 'go' | 'money' | 'danger' | 'neutral' }> = {
  DECLARED: { label: 'Waiting to be counted', tone: 'money' },
  CONFIRMED: { label: 'Counted and cleared', tone: 'go' },
  VARIANCE: { label: 'Counted — amount differed', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' }
};

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const CashScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [data, setData] = useState<CashStandingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await cashApi.standing(ctx);
        setData(next);
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Could not load your cash balance.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ctx]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  /*
   * The field is pre-filled with everything they are holding.
   *
   * Partial deposits are allowed — a rider may genuinely have spent a note and
   * be bringing the rest — but the overwhelmingly common case is "all of it",
   * and a rider typing a figure from memory at the end of a shift is a rider
   * who mistypes it. Pre-filling makes the honest case one tap.
   */
  const inHand = data?.cashInHand ?? 0;
  useEffect(() => {
    if (data && !data.pendingDeposit && amount === '' && inHand > 0) {
      setAmount(String(inHand));
    }
  }, [data, inHand, amount]);

  const parsed = Number(amount.replace(/[^0-9.]/g, ''));
  const amountValid = Number.isFinite(parsed) && parsed > 0 && parsed <= 1000000;
  const overstated = amountValid && parsed > inHand + 0.005;

  const declare = async () => {
    if (!amountValid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await cashApi.declareDeposit(ctx, Number(parsed.toFixed(2)));
      setAmount('');
      await load('refresh');
    } catch (err: any) {
      setSaveError(err?.message || 'That could not be recorded. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = (deposit: CashDepositView) => {
    Alert.alert(
      'Withdraw this declaration?',
      'Only do this if you are not bringing the cash in today. You can declare again later.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            try {
              await cashApi.cancelDeposit(ctx, deposit.id);
              await load('refresh');
            } catch (err: any) {
              Alert.alert('Could not withdraw', err?.message || 'Try again in a moment.');
            }
          }
        }
      ]
    );
  };

  const settled = useMemo(
    () => (data?.history || []).filter(d => d.status !== 'DECLARED'),
    [data]
  );

  if (loading) return <LoadingBlock label="Checking your cash…" />;

  const blocked = data ? !data.canTakeCod : false;
  const warn = data ? data.shouldWarn : false;
  const tone = blocked ? t.color.danger : warn ? t.color.money : t.color.go;

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={t.color.brand} />
      }
      keyboardShouldPersistTaps="handled"
    >
      {!!error && (
        <Card>
          <Text style={s.errorText}>{error}</Text>
          <Button label="Try again" variant="secondary" onPress={() => void load('refresh')} style={{ marginTop: 12 }} />
        </Card>
      )}

      {data && (
        <>
          {/* ---------------------------- What you hold ---------------------------- */}
          <Card>
            <View style={s.head}>
              <Banknote size={20} color={tone} />
              <Text style={s.title}>Cash in your bag</Text>
            </View>

            <Text style={[s.big, { color: tone }]}>{money(data.cashInHand)}</Text>
            <Text style={s.sub}>
              {data.cashInHand > 0
                ? 'This is the platform’s money. It is yours to carry, not to keep.'
                : 'Nothing to bring in. Every order you took was paid online.'}
            </Text>

            <View style={{ marginTop: 14 }}>
              <ProgressBar value={Math.min(data.cashInHand, data.ceiling)} max={data.ceiling || 1} tone={tone} />
              <View style={s.limitRow}>
                <Text style={s.limitText}>Limit {money(data.ceiling)}</Text>
                <Text style={s.limitText}>
                  {Math.max(0, data.ceiling - data.cashInHand) > 0
                    ? money(Math.max(0, data.ceiling - data.cashInHand)) + ' of room left'
                    : 'No room left'}
                </Text>
              </View>
            </View>

            {(blocked || warn) && (
              <View style={[s.notice, blocked ? s.noticeStop : s.noticeWarn]}>
                {blocked ? (
                  <Ban size={16} color={t.color.danger} />
                ) : (
                  <TriangleAlert size={16} color={t.color.money} />
                )}
                <Text style={[s.noticeText, { color: blocked ? t.color.danger : t.color.money }]}>
                  {data.message ||
                    (blocked
                      ? 'You cannot take cash orders until you deposit. Online-paid orders still come through.'
                      : 'You are close to the cash limit. Deposit soon so cash orders keep coming.')}
                </Text>
              </View>
            )}

            {blocked && (
              <Text style={s.blockedHelp}>
                Nothing about your account is suspended. Bring the cash to the office, an administrator counts it,
                and cash orders start again the moment it is confirmed.
              </Text>
            )}
          </Card>

          {/* --------------------------- Pending deposit --------------------------- */}
          {data.pendingDeposit ? (
            <Card>
              <View style={s.head}>
                <Clock size={18} color={t.color.money} />
                <Text style={s.title}>You said you are bringing in</Text>
              </View>
              <Text style={s.pendingAmount}>{paise(data.pendingDeposit.declaredPaise)}</Text>
              <Text style={s.sub}>Declared {when(data.pendingDeposit.declaredAt)}</Text>

              <View style={s.steps}>
                <Text style={s.step}>1. Bring the cash to the office.</Text>
                <Text style={s.step}>2. An administrator counts it in front of you.</Text>
                <Text style={s.step}>3. Your balance drops by what was counted, and cash orders resume.</Text>
              </View>

              <Text style={s.footnote}>
                Your balance has not changed yet. It changes when the money is counted, and by the counted amount.
              </Text>

              <Button
                label="Withdraw this declaration"
                variant="ghost"
                onPress={() => withdraw(data.pendingDeposit!)}
                style={{ marginTop: 12 }}
              />
            </Card>
          ) : (
            /* ----------------------------- Declare ----------------------------- */
            <Card>
              <View style={s.head}>
                <Building2 size={18} color={t.color.brand} />
                <Text style={s.title}>Bringing cash in</Text>
              </View>
              <Text style={s.body}>
                Tell us what you are bringing before you set off. It is what an administrator checks against when
                they count, and it is what protects you if the count comes out differently.
              </Text>

              <Text style={s.label}>Amount you are bringing</Text>
              <TextInput
                style={[s.input, (overstated || (!!amount && !amountValid)) && s.inputError]}
                value={amount}
                onChangeText={text => {
                  setAmount(text.replace(/[^0-9.]/g, ''));
                  setSaveError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={t.color.textMuted}
                editable={!saving && inHand > 0}
              />
              {overstated && (
                <Text style={s.fieldError}>
                  That is more than the {money(inHand)} our records say you are holding. Check the figure — if you
                  really have more, bring it in and say so at the counter.
                </Text>
              )}
              {!!amount && !amountValid && <Text style={s.fieldError}>Enter an amount greater than zero.</Text>}
              {!!saveError && <Text style={s.errorText}>{saveError}</Text>}

              {inHand <= 0 ? (
                <Text style={s.footnote}>You have no cash to bring in.</Text>
              ) : (
                <Button
                  label={amountValid ? 'Declare ' + money(parsed) : 'Declare deposit'}
                  variant="money"
                  onPress={declare}
                  disabled={!amountValid}
                  loading={saving}
                  style={{ marginTop: 14 }}
                />
              )}
            </Card>
          )}

          {/* ------------------------------ History ------------------------------ */}
          <SectionTitle>Past deposits</SectionTitle>
          {settled.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CircleCheck size={28} color={t.color.textMuted} />}
                title="Nothing yet"
                message="Deposits appear here once an administrator has counted them."
              />
            </Card>
          ) : (
            settled.map((d, index) => {
              const pill = STATUS_PILL[d.status];
              const counted = typeof d.receivedPaise === 'number' ? d.receivedPaise : null;
              const differs = counted !== null && counted !== d.declaredPaise;
              return (
                <Card key={d.id}>
                  <View style={s.historyHead}>
                    <Text style={s.historyAmount}>{paise(counted ?? d.declaredPaise)}</Text>
                    <Pill label={pill.label} tone={pill.tone} />
                  </View>
                  <Text style={s.sub}>
                    {d.status === 'CANCELLED'
                      ? 'Declared ' + when(d.declaredAt)
                      : 'Counted ' + when(d.confirmedAt || d.declaredAt)}
                  </Text>

                  {differs && (
                    <View style={s.variance}>
                      <Text style={s.varianceLine}>You declared {paise(d.declaredPaise)}</Text>
                      <Text style={s.varianceLine}>Counted {paise(counted!)}</Text>
                      {!!d.varianceNote && <Text style={s.varianceNote}>{d.varianceNote}</Text>}
                      <Text style={s.varianceHelp}>
                        Your balance moved by the counted figure. If you think the count is wrong, raise it with
                        support — the declaration and the count are both on record.
                      </Text>
                    </View>
                  )}
                  {index === settled.length - 1 ? null : <Divider style={{ marginTop: 12 }} />}
                </Card>
              );
            })
          )}

          <Text style={s.footnote}>
            Cash you collect belongs to Quick Bites from the moment it is handed over. Taking UPI at the door
            instead means there is nothing to carry, nothing to deposit, and no limit to run into.
          </Text>
        </>
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: t.color.text, fontSize: 16, fontWeight: '700', flex: 1 },
  body: { color: t.color.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  sub: { color: t.color.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },

  big: { fontSize: 40, fontWeight: '800', marginTop: 12, letterSpacing: -1 },

  limitRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  limitText: { color: t.color.textMuted, fontSize: 12 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginTop: 14
  },
  noticeWarn: { backgroundColor: t.color.moneySoft },
  noticeStop: { backgroundColor: t.color.dangerSoft },
  noticeText: { fontSize: 12, lineHeight: 17, flex: 1, fontWeight: '600' },
  blockedHelp: { color: t.color.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 10 },

  pendingAmount: { color: t.color.text, fontSize: 30, fontWeight: '800', marginTop: 10 },
  steps: { marginTop: 14, gap: 6 },
  step: { color: t.color.textSecondary, fontSize: 13, lineHeight: 18 },

  label: { color: t.color.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.color.text,
    fontSize: 20,
    fontWeight: '700'
  },
  inputError: { borderColor: t.color.danger },
  fieldError: { color: t.color.danger, fontSize: 12, marginTop: 6, lineHeight: 17 },
  errorText: { color: t.color.danger, fontSize: 13, marginTop: 8, lineHeight: 18 },

  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyAmount: { color: t.color.text, fontSize: 20, fontWeight: '800' },

  variance: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    gap: 3
  },
  varianceLine: { color: t.color.text, fontSize: 13, fontWeight: '600' },
  varianceNote: { color: t.color.textSecondary, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  varianceHelp: { color: t.color.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },

  footnote: { color: t.color.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 }
});

export default CashScreen;
