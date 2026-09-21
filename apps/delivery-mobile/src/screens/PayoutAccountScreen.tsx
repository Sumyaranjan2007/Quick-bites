import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { Landmark, ShieldCheck, ShieldAlert, Clock, Smartphone, Info } from 'lucide-react-native';
import { t } from '../theme';
import { Card, SectionTitle, Pill, Button, EmptyState, LoadingBlock, Divider } from '../components/ui';
import { api, type ApiContext, type PayeeAccount, type PayeeAccountsResponse } from '../lib/api';

/**
 * Where this rider's earnings are sent.
 *
 * -------------------------------------------------------------------------
 * WHY THE NUMBER IS TYPED TWICE
 * -------------------------------------------------------------------------
 * This is the one form in the app where a typo costs real money and cannot be
 * taken back. A wrong digit sends a week's earnings to a stranger, and the
 * rider finds out on payday. A penny drop catches an account that does not
 * exist; it cannot catch an account that exists and belongs to somebody else.
 * Typing it twice is the only thing that does, and it costs fifteen seconds
 * once.
 *
 * -------------------------------------------------------------------------
 * AND WHY IT MATTERS MORE HERE THAN ANYWHERE
 * -------------------------------------------------------------------------
 * A rider is often the person on this platform who can least afford a fortnight
 * of chasing a misdirected payment. Every refusal on this screen therefore says
 * what is wrong and what to do about it, and the pending state says plainly
 * that nothing is required of them, because a rider who thinks a screen is
 * broken will submit the same account three more times.
 */

const STATUS: Record<
  PayeeAccount['validationStatus'],
  { label: string; tone: 'go' | 'money' | 'danger' | 'neutral'; heading: string }
> = {
  VERIFIED: { label: 'Verified', tone: 'go', heading: 'Your earnings come here' },
  PENDING: { label: 'Checking', tone: 'money', heading: 'Your bank is being checked' },
  UNVERIFIED: { label: 'Not checked', tone: 'money', heading: 'Not verified yet' },
  NAME_MISMATCH: { label: 'Being reviewed', tone: 'money', heading: 'Our team is checking the name' },
  INVALID: { label: 'Refused', tone: 'danger', heading: 'Your bank refused this account' }
};

export const PayoutAccountScreen: React.FC<{ ctx: ApiContext }> = ({ ctx }) => {
  const [data, setData] = useState<PayeeAccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<'BANK' | 'VPA'>('BANK');
  const [holderName, setHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountNumberConfirm, setAccountNumberConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [vpa, setVpa] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await api.payeeAccounts(ctx);
        setData(next);
        setHolderName(current => current || next.registeredName || '');
        setError(null);
      } catch (err: any) {
        setError(err?.message || 'Could not load your payout account.');
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

  const live = data?.accounts.find(a => a.isDefault) || data?.accounts[0] || null;

  const digitsOnly = /^[0-9]{6,20}$/;
  const ifscShape = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
  const numbersDiffer =
    accountNumber.length > 0 && accountNumberConfirm.length > 0 && accountNumber !== accountNumberConfirm;

  const canSubmit =
    holderName.trim().length >= 3 &&
    (method === 'BANK'
      ? digitsOnly.test(accountNumber) && accountNumber === accountNumberConfirm && ifscShape.test(ifsc)
      : /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/.test(vpa));

  const submit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.addPayeeAccount(ctx, {
        method,
        holderName: holderName.trim(),
        ...(method === 'BANK'
          ? { accountNumber, accountNumberConfirm, ifsc: ifsc.toUpperCase() }
          : { vpa: vpa.trim() })
      });
      setAdding(false);
      setAccountNumber('');
      setAccountNumberConfirm('');
      setIfsc('');
      setVpa('');
      await load('refresh');
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save that account.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading your payout account…" />;

  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={t.color.brand} />
      }
      keyboardShouldPersistTaps="handled"
    >
      <SectionTitle>Where you get paid</SectionTitle>

      {!!error && (
        <Card>
          <Text style={s.errorText}>{error}</Text>
          <Button label="Try again" variant="secondary" onPress={() => void load('initial')} />
        </Card>
      )}

      {!live && !adding && (
        <EmptyState
          title="No payout account yet"
          message="Add the bank account your earnings should be sent to. Your trips are still counted without it, but nothing can be paid out."
          action={<Button label="Add an account" onPress={() => setAdding(true)} />}
        />
      )}

      {!!live && (
        <Card>
          <View style={s.head}>
            {live.method === 'BANK' ? (
              <Landmark size={20} color={t.color.brand} />
            ) : (
              <Smartphone size={20} color={t.color.brand} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.title}>
                {live.method === 'BANK'
                  ? `${live.ifsc || 'Bank'} •••• ${live.accountLast4 || '????'}`
                  : live.vpa}
              </Text>
              <Text style={s.sub}>{live.holderName}</Text>
            </View>
            <Pill label={STATUS[live.validationStatus].label} tone={STATUS[live.validationStatus].tone} />
          </View>

          <Divider style={{ marginVertical: 12 }} />

          <View style={s.statusRow}>
            {live.validationStatus === 'VERIFIED' ? (
              <ShieldCheck size={16} color={t.color.go} />
            ) : live.validationStatus === 'INVALID' ? (
              <ShieldAlert size={16} color={t.color.danger} />
            ) : (
              <Clock size={16} color={t.color.money} />
            )}
            <Text style={s.statusHeading}>{STATUS[live.validationStatus].heading}</Text>
          </View>

          {!!live.validationMessage && <Text style={s.body}>{live.validationMessage}</Text>}

          {/* A mismatch the rider cannot see is a mismatch they cannot fix. */}
          {live.validationStatus === 'NAME_MISMATCH' && !!live.registeredName && (
            <View style={s.compare}>
              <View style={s.compareRow}>
                <Text style={s.compareLabel}>Your bank has</Text>
                <Text style={s.compareValue}>{live.registeredName}</Text>
              </View>
              <View style={s.compareRow}>
                <Text style={s.compareLabel}>We have</Text>
                <Text style={s.compareValue}>{data?.registeredName || live.holderName}</Text>
              </View>
              <Text style={s.compareHelp}>
                If that is you, our team will approve it and you need do nothing. If the account is not in
                your own name, add one that is — we can only pay you into your own account.
              </Text>
            </View>
          )}

          {live.validationStatus === 'PENDING' && (
            <Text style={s.body}>
              Your bank is confirming this account. It usually takes seconds. You do not need to do anything,
              and adding it again will not make it faster.
            </Text>
          )}

          <Button
            label="Use a different account"
            variant="ghost"
            onPress={() => {
              setAdding(true);
              setSaveError(null);
            }}
            style={{ marginTop: 12 }}
          />
        </Card>
      )}

      {data && !data.verificationAvailable && (
        <Card>
          <View style={s.statusRow}>
            <Info size={16} color={t.color.info} />
            <Text style={s.body}>
              Automatic bank checks are not switched on yet. Our team verifies new accounts by hand before
              your first payout, so add yours now — nothing is held up by this.
            </Text>
          </View>
        </Card>
      )}

      {adding && (
        <Card>
          <SectionTitle>Add a payout account</SectionTitle>
          <Text style={s.body}>It must be in your own name — the same name Quick Bites holds for you.</Text>

          <View style={s.methodRow}>
            <Button
              label="Bank account"
              variant={method === 'BANK' ? 'primary' : 'ghost'}
              onPress={() => setMethod('BANK')}
              style={{ flex: 1 }}
            />
            <Button
              label="UPI id"
              variant={method === 'VPA' ? 'primary' : 'ghost'}
              onPress={() => setMethod('VPA')}
              style={{ flex: 1 }}
            />
          </View>

          <Text style={s.label}>Account holder name</Text>
          <TextInput
            style={s.input}
            value={holderName}
            onChangeText={setHolderName}
            placeholder="As it appears at the bank"
            placeholderTextColor={t.color.textMuted}
            autoCapitalize="words"
          />
          {!!data?.registeredName && (
            <Text style={s.hint}>Quick Bites holds “{data.registeredName}” for you.</Text>
          )}

          {method === 'BANK' ? (
            <>
              <Text style={s.label}>Account number</Text>
              <TextInput
                style={s.input}
                value={accountNumber}
                onChangeText={v => setAccountNumber(v.replace(/[^0-9]/g, ''))}
                placeholder="Digits only"
                placeholderTextColor={t.color.textMuted}
                keyboardType="number-pad"
              />
              <Text style={s.hint}>
                Money sent to the wrong account cannot be recovered. Check it against your passbook.
              </Text>

              <Text style={s.label}>Re-enter the account number</Text>
              <TextInput
                style={[s.input, numbersDiffer && s.inputError]}
                value={accountNumberConfirm}
                onChangeText={v => setAccountNumberConfirm(v.replace(/[^0-9]/g, ''))}
                placeholder="Type it again"
                placeholderTextColor={t.color.textMuted}
                keyboardType="number-pad"
              />
              {numbersDiffer && <Text style={s.fieldError}>These two do not match.</Text>}

              <Text style={s.label}>IFSC</Text>
              <TextInput
                style={[s.input, ifsc.length > 0 && !ifscShape.test(ifsc) && s.inputError]}
                value={ifsc}
                onChangeText={v => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="HDFC0001234"
                placeholderTextColor={t.color.textMuted}
                autoCapitalize="characters"
              />
              <Text style={s.hint}>Eleven characters. It is on your passbook and in your banking app.</Text>
            </>
          ) : (
            <>
              <Text style={s.label}>UPI id</Text>
              <TextInput
                style={s.input}
                value={vpa}
                onChangeText={setVpa}
                placeholder="name@bank"
                placeholderTextColor={t.color.textMuted}
                autoCapitalize="none"
              />
              <Text style={s.hint}>The UPI id registered to your own bank account.</Text>
            </>
          )}

          {!!saveError && <Text style={s.errorText}>{saveError}</Text>}

          <Button
            label={saving ? 'Checking with your bank…' : 'Save and verify'}
            onPress={submit}
            disabled={!canSubmit || saving}
            loading={saving}
            style={{ marginTop: 12 }}
          />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setAdding(false);
              setSaveError(null);
            }}
          />
        </Card>
      )}

      <Text style={s.footnote}>
        Quick Bites does not keep your account number. Once your bank confirms it, only the last four digits
        are stored so you can recognise it here.
      </Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: t.color.text, fontSize: 16, fontWeight: '700' },
  sub: { color: t.color.textSecondary, fontSize: 13, marginTop: 2 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusHeading: { color: t.color.text, fontSize: 14, fontWeight: '700', flex: 1 },
  body: { color: t.color.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },

  compare: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: 10,
    padding: 12,
    marginTop: 12
  },
  compareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  compareLabel: { color: t.color.textMuted, fontSize: 12 },
  compareValue: { color: t.color.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  compareHelp: { color: t.color.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8 },

  methodRow: { flexDirection: 'row', gap: 8, marginVertical: 12 },

  label: { color: t.color.text, fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.color.text,
    fontSize: 15
  },
  inputError: { borderColor: t.color.danger },
  hint: { color: t.color.textMuted, fontSize: 11, marginTop: 4, lineHeight: 15 },
  fieldError: { color: t.color.danger, fontSize: 12, marginTop: 4 },
  errorText: { color: t.color.danger, fontSize: 13, marginTop: 8 },

  footnote: { color: t.color.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8 }
});

export default PayoutAccountScreen;
