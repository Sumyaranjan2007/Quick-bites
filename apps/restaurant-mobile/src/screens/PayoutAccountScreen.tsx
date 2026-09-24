import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Landmark, ShieldCheck, ShieldAlert, Clock, Smartphone, Info } from 'lucide-react-native';
import { SafeScreen } from '../components/SafeScreen';
import { Card, SectionHeading, Pill, Button, Field, ErrorNote, EmptyState } from '../components/ui';
import { c, spacing, radii } from '../theme';
import {
  fetchPayeeAccounts,
  addPayeeAccount,
  removePayeeAccount,
  type PayeeAccountView
} from '../lib/partnerApi';

/**
 * Where this kitchen's settlements are paid.
 *
 * -------------------------------------------------------------------------
 * THE FORM THIS SCREEN IS BUILT AROUND
 * -------------------------------------------------------------------------
 * An account number is the one input in this whole app where a typo costs real
 * money and cannot be undone. A wrong digit sends a settlement to a stranger
 * who did not ask for it and will not send it back, and the partner finds out
 * a fortnight later when their money has not arrived.
 *
 * So the number is typed twice and the two must match. That costs fifteen
 * seconds, once, and it is the only thing that catches a number which is
 * perfectly valid and belongs to somebody else — a penny drop cannot, because
 * the account it lands in is real.
 *
 * -------------------------------------------------------------------------
 * FOUR STATES, AND THE THIRD ONE IS WHERE IT LIVES
 * -------------------------------------------------------------------------
 * Loading, added-and-verified, refused, and PENDING while the bank is being
 * asked. Pending is not an edge case here; a penny drop takes seconds to
 * minutes, and a partner staring at an unexplained spinner concludes the app is
 * broken and adds the account again. So pending says what is happening, why it
 * takes a moment, and what the partner should do, which is nothing.
 */

const STATUS_COPY: Record<
  PayeeAccountView['validationStatus'],
  { label: string; tone: 'brand' | 'success' | 'danger' | 'warning' | 'muted'; heading: string }
> = {
  VERIFIED: { label: 'Verified', tone: 'success', heading: 'Your settlements come here' },
  PENDING: { label: 'Checking', tone: 'warning', heading: 'We are checking this with your bank' },
  UNVERIFIED: { label: 'Not checked', tone: 'warning', heading: 'Not verified yet' },
  NAME_MISMATCH: { label: 'Being reviewed', tone: 'warning', heading: 'Our team is checking the name' },
  INVALID: { label: 'Refused', tone: 'danger', heading: 'Your bank refused this account' }
};

/**
 * A date in the words a partner reads, or nothing at all.
 *
 * Returns an empty string rather than a dash or "Invalid Date" when the field is
 * missing. A sentence built around an empty string reads a little oddly; one
 * built around "Invalid Date" looks like the app is broken, and this is the
 * screen where a partner least needs to wonder that.
 */
const dateOf = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`;
};

export const PayoutAccountScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PayeeAccountView[]>([]);
  const [registeredName, setRegisteredName] = useState('');
  const [verificationAvailable, setVerificationAvailable] = useState(false);

  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<'BANK' | 'VPA'>('BANK');
  const [holderName, setHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountNumberConfirm, setAccountNumberConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [vpa, setVpa] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (spinner: boolean) => {
    if (spinner) setLoading(true);
    const res = await fetchPayeeAccounts();
    if (res.ok && res.data) {
      setAccounts(res.data.accounts);
      setRegisteredName(res.data.registeredName);
      setVerificationAvailable(res.data.verificationAvailable);
      setLoadError(null);
      // The name the bank will be asked about is the one we hold. Pre-filling
      // it stops a partner typing a shortened version of their own business
      // name and failing a check they were always going to fail.
      setHolderName(current => current || res.data!.registeredName || '');
    } else {
      setLoadError(res.message || 'Could not load your payout account.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const live = accounts.find(a => a.isDefault) || accounts[0] || null;

  /* Checked here as well as on the server, so the partner is told before a
     round trip rather than after one. */
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
    const res = await addPayeeAccount({
      method,
      holderName: holderName.trim(),
      ...(method === 'BANK'
        ? { accountNumber, accountNumberConfirm, ifsc: ifsc.toUpperCase() }
        : { vpa: vpa.trim() })
    });
    setSaving(false);

    if (!res.ok) {
      setSaveError(res.message || 'Could not save that account.');
      return;
    }

    setAdding(false);
    setAccountNumber('');
    setAccountNumberConfirm('');
    setIfsc('');
    setVpa('');
    await load(false);
  };

  const remove = async (accountId: string) => {
    const res = await removePayeeAccount(accountId);
    if (!res.ok) {
      setLoadError(res.message || 'Could not remove that account.');
      return;
    }
    await load(false);
  };

  if (loading) {
    return (
      <SafeScreen>
        <View style={s.centre}>
          <ActivityIndicator color={c.brand} />
          <Text style={s.centreText}>Loading your payout account…</Text>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(false);
            }}
            tintColor={c.brand}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeading
          title="Payouts"
          sub="The account Quick Bites sends your settlements to."
        />

        {!!loadError && <ErrorNote message={loadError} onRetry={() => void load(true)} />}

        {!live && !adding && (
          <EmptyState
            title="No payout account yet"
            body="Add the bank account your settlements should be paid into. Until you do, your earnings are recorded but cannot be sent."
            action={<Button label="Add an account" onPress={() => setAdding(true)} />}
          />
        )}

        {!!live && (
          <Card style={s.accountCard}>
            <View style={s.accountHead}>
              {live.method === 'BANK' ? (
                <Landmark size={20} color={c.brand} />
              ) : (
                <Smartphone size={20} color={c.brand} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.accountTitle}>
                  {live.method === 'BANK'
                    ? `${live.ifsc || 'Bank'} •••• ${live.accountLast4 || '????'}`
                    : live.vpa}
                </Text>
                <Text style={s.accountName}>{live.holderName}</Text>
              </View>
              <Pill
                label={STATUS_COPY[live.validationStatus].label}
                tone={STATUS_COPY[live.validationStatus].tone}
              />
            </View>

            <View style={s.statusBlock}>
              <View style={s.statusRow}>
                {live.validationStatus === 'VERIFIED' ? (
                  <ShieldCheck size={16} color={c.success} />
                ) : live.validationStatus === 'INVALID' ? (
                  <ShieldAlert size={16} color={c.danger} />
                ) : (
                  <Clock size={16} color={c.warning} />
                )}
                <Text style={s.statusHeading}>{STATUS_COPY[live.validationStatus].heading}</Text>
              </View>

              {!!live.validationMessage && <Text style={s.statusBody}>{live.validationMessage}</Text>}

              {/*
                WHEN, NOT JUST WHAT.

                §8.5: a partner whose account is sitting unverified should learn
                it here rather than from a settlement that never arrives. The
                pill above says which state; this says how long it has been in
                it, which is the part that tells them whether to act. "Checking"
                is reassuring on the day it is added and alarming a fortnight
                later, and those are the same word.
              */}
              <Text style={s.since}>
                {live.validationStatus === 'VERIFIED'
                  ? `Connected ${dateOf(live.validatedAt || live.createdAt)}. Replacing it does not affect anything already settled.`
                  : `Added ${dateOf(live.createdAt)}. If this has not changed in a day or two, tell us from the Help Centre.`}
              </Text>

              {/*
                A mismatch is only actionable if the partner can see WHAT did not
                match. "The name does not match" with neither name shown leaves
                them re-submitting the same account and getting the same answer.
              */}
              {live.validationStatus === 'NAME_MISMATCH' && !!live.registeredName && (
                <View style={s.compareBox}>
                  <View style={s.compareRow}>
                    <Text style={s.compareLabel}>Your bank has</Text>
                    <Text style={s.compareValue}>{live.registeredName}</Text>
                  </View>
                  <View style={s.compareRow}>
                    <Text style={s.compareLabel}>We have</Text>
                    <Text style={s.compareValue}>{registeredName || live.holderName}</Text>
                  </View>
                  <Text style={s.compareHelp}>
                    If these are the same person or business, our team will approve it — you need do nothing.
                    If the account is not in your own name, add one that is.
                  </Text>
                </View>
              )}

              {live.validationStatus === 'PENDING' && (
                <Text style={s.statusBody}>
                  Your bank is being asked to confirm this account. It usually takes a few seconds and can
                  take a few minutes. You do not need to do anything, and adding it again will not make it
                  faster.
                </Text>
              )}
            </View>

            <Button
              label="Use a different account"
              variant="ghost"
              onPress={() => {
                setAdding(true);
                setSaveError(null);
              }}
            />
          </Card>
        )}

        {!verificationAvailable && (
          <Card style={s.noticeCard}>
            <View style={s.statusRow}>
              <Info size={16} color={c.info} />
              <Text style={s.noticeText}>
                Automatic bank verification is not switched on for this deployment yet. Our team checks new
                accounts by hand before the first payout, so add yours now — nothing is delayed by this.
              </Text>
            </View>
          </Card>
        )}

        {adding && (
          <Card style={s.formCard}>
            <SectionHeading
              title="Add a payout account"
              sub="It must be in the same name Quick Bites holds for this kitchen."
            />

            <View style={s.methodRow}>
              <Button
                label="Bank account"
                variant={method === 'BANK' ? 'primary' : 'ghost'}
                onPress={() => setMethod('BANK')}
                style={s.methodButton}
              />
              <Button
                label="UPI id"
                variant={method === 'VPA' ? 'primary' : 'ghost'}
                onPress={() => setMethod('VPA')}
                style={s.methodButton}
              />
            </View>

            <Field
              label="Account holder name"
              value={holderName}
              onChangeText={setHolderName}
              placeholder="As it appears at the bank"
              autoCapitalize="words"
              hint={registeredName ? `Quick Bites holds "${registeredName}" for this kitchen.` : undefined}
            />

            {method === 'BANK' ? (
              <>
                <Field
                  label="Account number"
                  value={accountNumber}
                  onChangeText={t => setAccountNumber(t.replace(/[^0-9]/g, ''))}
                  placeholder="Digits only"
                  keyboardType="number-pad"
                  hint="Money sent to a wrong account cannot be recovered. Check it against a statement."
                />
                <Field
                  label="Re-enter the account number"
                  value={accountNumberConfirm}
                  onChangeText={t => setAccountNumberConfirm(t.replace(/[^0-9]/g, ''))}
                  placeholder="Type it again"
                  keyboardType="number-pad"
                  error={numbersDiffer ? 'These two do not match.' : null}
                />
                <Field
                  label="IFSC"
                  value={ifsc}
                  onChangeText={t => setIfsc(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="HDFC0001234"
                  autoCapitalize="characters"
                  hint="Eleven characters. It is on your cheque book and in your banking app."
                  error={ifsc.length > 0 && !ifscShape.test(ifsc) ? 'That IFSC does not look right.' : null}
                />
              </>
            ) : (
              <Field
                label="UPI id"
                value={vpa}
                onChangeText={setVpa}
                placeholder="name@bank"
                autoCapitalize="none"
                hint="The UPI id registered to this kitchen's own account."
              />
            )}

            {!!saveError && <ErrorNote message={saveError} />}

            <Button
              label={saving ? 'Checking with your bank…' : 'Save and verify'}
              onPress={submit}
              disabled={!canSubmit || saving}
              busy={saving}
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

        {accounts.length > 1 && (
          <>
            <SectionHeading title="Previous accounts" sub="Kept because past settlements point at them." />
            {accounts
              .filter(a => a.id !== live?.id)
              .map(account => (
                <Card key={account.id} style={s.pastCard}>
                  <Text style={s.pastText}>
                    {account.method === 'BANK'
                      ? `${account.ifsc || 'Bank'} •••• ${account.accountLast4 || '????'}`
                      : account.vpa}
                  </Text>
                  <Button label="Remove" variant="ghost" onPress={() => void remove(account.id)} />
                </Card>
              ))}
          </>
        )}

        <Text style={s.footnote}>
          Quick Bites does not keep your account number. Once your bank confirms the account, only the last
          four digits are stored so you can recognise it here.
        </Text>
      </ScrollView>
    </SafeScreen>
  );
};

const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centreText: { color: c.textMuted, fontSize: 14 },

  accountCard: { marginBottom: spacing.md },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  accountTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  accountName: { color: c.textSoft, fontSize: 13, marginTop: 2 },

  statusBlock: { marginTop: spacing.md, marginBottom: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusHeading: { color: c.text, fontSize: 14, fontWeight: '700', flex: 1 },
  statusBody: { color: c.textSoft, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  since: { color: c.textMuted, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },

  compareBox: {
    backgroundColor: c.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    marginTop: spacing.md
  },
  compareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  compareLabel: { color: c.textMuted, fontSize: 12 },
  compareValue: { color: c.text, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  compareHelp: { color: c.textSoft, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },

  noticeCard: { marginBottom: spacing.md },
  noticeText: { color: c.textSoft, fontSize: 13, lineHeight: 19, flex: 1 },

  formCard: { marginBottom: spacing.md },
  methodRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  methodButton: { flex: 1 },

  pastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  pastText: { color: c.textSoft, fontSize: 13, flex: 1 },

  footnote: {
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.lg,
    textAlign: 'center'
  }
});

export default PayoutAccountScreen;
