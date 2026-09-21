import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { FileText, TriangleAlert, ShieldCheck, Landmark, Download, Info } from 'lucide-react-native';
import {
  Card,
  Button,
  Field,
  Sheet,
  Divider,
  Loading,
  NoAccess,
  EmptyState,
  SectionTitle,
  Segmented
} from '../components/ui';
import { tokens } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';

const c = tokens.colors;

interface TaxIdentity {
  gstin: string;
  legalName: string;
  tradeName?: string;
  addressLine: string;
  city: string;
  stateCode: string;
  stateName: string;
  pincode: string;
  pan?: string;
  tan?: string;
  invoicePrefix: string;
}

interface IdentityPayload {
  identity: TaxIdentity | null;
  gaps: string[];
  canIssueInvoices: boolean;
}

interface SummaryPayload {
  month: string;
  ordersCounted: number;
  outward: {
    restaurantServiceTaxable: number;
    restaurantServiceTax: number;
    platformFeeTaxable: number;
    platformFeeTax: number;
    commissionTaxable: number;
    commissionTax: number;
    totalTax: number;
  };
  tcs: { netSupplies: number; collected: number; ratePercent: number };
  tds: Array<{
    restaurantId: string;
    restaurantName: string;
    ordersCounted: number;
    grossSupplies: number;
    deducted: number;
  }>;
  tdsTotal: number;
  warnings: string[];
}

const rupees = (n: number) =>
  `Rs ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The last six months, newest first, as `2026-09`. */
function recentMonths(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const MONTH_LABEL = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(m || 1) - 1]} ${String(y).slice(2)}`;
};

/**
 * Tax: who the platform is, and what a month's return is built from.
 *
 * -------------------------------------------------------------------------
 * THE REGISTRATION IS THE FIRST THING ON THE SCREEN, AND IT IS BLOCKING
 * -------------------------------------------------------------------------
 * Until a real GSTIN is entered, no customer has ever been issued a tax
 * invoice — they have been given receipts. That is the correct behaviour and it
 * is also a compliance problem accruing quietly in the background, so it is
 * stated at the top in the strongest terms the screen has, with the form to fix
 * it one tap away.
 *
 * -------------------------------------------------------------------------
 * THE WARNINGS ARE NOT DECORATION
 * -------------------------------------------------------------------------
 * A summary that looks clean because it silently dropped the awkward orders is
 * how a wrong return gets filed confidently. Anything the server could not
 * account for is shown above the numbers, not below them, because somebody
 * about to file reads the top of the page.
 */
export const TaxScreen: React.FC = () => {
  const { api, can } = useSession();
  const canView = can('finance.ledger.view', 'finance.config.edit');
  const canEdit = can('finance.config.edit');

  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);

  const identity = useResource<IdentityPayload>(() => api.get('/admin/tax/identity').then(r => r.data), [], {
    enabled: canView
  });
  const summary = useResource<SummaryPayload>(
    () => api.get(`/admin/tax/summary?month=${month}`).then(r => r.data),
    [month],
    { enabled: canView }
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<TaxIdentity>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canView) return <NoAccess permission="finance.ledger.view" />;
  if (identity.loading && !identity.data) return <Loading label="Reading your tax settings…" />;

  const openForm = () => {
    setForm(identity.data?.identity || { invoicePrefix: 'INV' });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/admin/tax/identity', {
        gstin: (form.gstin || '').trim().toUpperCase(),
        legalName: form.legalName,
        tradeName: form.tradeName || undefined,
        addressLine: form.addressLine,
        city: form.city,
        stateName: form.stateName,
        pincode: form.pincode,
        pan: form.pan || undefined,
        tan: form.tan || undefined,
        invoicePrefix: form.invoicePrefix || 'INV'
      });
      setEditing(false);
      await identity.reload();
      void summary.silentReload();
    } catch (err: any) {
      setError(err?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const ready = identity.data?.canIssueInvoices;
  const gaps = identity.data?.gaps || [];
  const data = summary.data;

  const canSubmit =
    (form.gstin || '').trim().length === 15 &&
    (form.legalName || '').trim().length >= 3 &&
    (form.addressLine || '').trim().length >= 5 &&
    (form.city || '').trim().length >= 2 &&
    (form.stateName || '').trim().length >= 2 &&
    /^[0-9]{6}$/.test((form.pincode || '').trim());

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={summary.loading}
            onRefresh={() => {
              void identity.reload();
              void summary.reload();
            }}
          />
        }
      >
        {/* ------------------------- Registration ------------------------- */}
        <Card style={ready ? s.okCard : s.blockCard}>
          <View style={s.head}>
            {ready ? (
              <ShieldCheck size={18} color={c.state.success} />
            ) : (
              <TriangleAlert size={18} color={c.state.danger} />
            )}
            <Text style={s.headTitle}>
              {ready ? 'GST registration on file' : 'No GST registration — invoices are not being issued'}
            </Text>
          </View>

          {ready && identity.data?.identity ? (
            <>
              <Text style={s.gstin}>{identity.data.identity.gstin}</Text>
              <Text style={s.sub}>
                {identity.data.identity.legalName} · {identity.data.identity.stateName} (
                {identity.data.identity.stateCode})
              </Text>
              <Text style={s.note}>
                Invoices are numbered {identity.data.identity.invoicePrefix}/YYYY-YY/00001 and restart each
                financial year in April.
              </Text>
            </>
          ) : (
            <>
              <Text style={s.blockBody}>
                Customers are being given payment receipts instead of tax invoices. That is deliberate — an
                invoice with a made-up GSTIN is a false document, not a draft — but it is a compliance gap that
                grows with every order.
              </Text>
              {gaps.map(gap => (
                <View key={gap} style={s.gapRow}>
                  <Info size={13} color={c.state.danger} />
                  <Text style={s.gapText}>{gap}</Text>
                </View>
              ))}
            </>
          )}

          {canEdit && (
            <Button
              label={ready ? 'Change these details' : 'Enter your GST details'}
              variant={ready ? 'ghost' : 'primary'}
              onPress={openForm}
              style={{ marginTop: 12 }}
            />
          )}
        </Card>

        {/* --------------------------- The month --------------------------- */}
        <SectionTitle title="What a return is filed from" subtitle="Delivered orders only, by the month they were delivered in." />

        <Segmented
          options={months.map(m => ({ key: m, label: MONTH_LABEL(m) }))}
          value={month}
          onChange={setMonth}
        />

        {summary.loading && !data ? (
          <Loading label="Adding up the month…" />
        ) : !data ? (
          <EmptyState title="Nothing to show" message={summary.error || 'That month could not be read.'} />
        ) : (
          <>
            {data.warnings.length > 0 && (
              <Card style={s.warnCard}>
                {data.warnings.map(warning => (
                  <View key={warning} style={s.gapRow}>
                    <TriangleAlert size={13} color={c.state.warning} />
                    <Text style={s.warnText}>{warning}</Text>
                  </View>
                ))}
                <Text style={s.warnFoot}>
                  Read these before filing. A summary that looks clean because it dropped the awkward orders is
                  how a wrong return gets filed confidently.
                </Text>
              </Card>
            )}

            <Card>
              <View style={s.head}>
                <FileText size={16} color={c.text.secondary} />
                <Text style={s.headTitle}>Outward supplies</Text>
              </View>
              <Text style={s.sub}>{data.ordersCounted} orders delivered</Text>
              <Divider style={{ marginVertical: 10 }} />

              <Row label="Restaurant service" value={rupees(data.outward.restaurantServiceTaxable)} tax={rupees(data.outward.restaurantServiceTax)} />
              <Row label="Platform fee" value={rupees(data.outward.platformFeeTaxable)} tax={rupees(data.outward.platformFeeTax)} />
              <Row label="Our commission" value={rupees(data.outward.commissionTaxable)} tax={rupees(data.outward.commissionTax)} />

              <Divider style={{ marginVertical: 10 }} />
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Tax on outward supplies</Text>
                <Text style={s.totalValue}>{rupees(data.outward.totalTax)}</Text>
              </View>
            </Card>

            <Card>
              <View style={s.head}>
                <Landmark size={16} color={c.text.secondary} />
                <Text style={s.headTitle}>Tax collected at source</Text>
              </View>
              <Text style={s.sub}>
                Section 52, at {data.tcs.ratePercent}% of what partners supplied through the platform — not of
                what customers paid us.
              </Text>
              <Divider style={{ marginVertical: 10 }} />
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Net supplies</Text>
                <Text style={s.totalValue}>{rupees(data.tcs.netSupplies)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Collected</Text>
                <Text style={s.totalValue}>{rupees(data.tcs.collected)}</Text>
              </View>
            </Card>

            <SectionTitle
              title="Tax deducted at source"
              subtitle={`Section 194-O, per partner — which is how it is filed. ${rupees(data.tdsTotal)} in total.`}
            />

            {data.tds.length === 0 ? (
              <EmptyState title="Nothing deducted" message="No partner supplied anything in this month." />
            ) : (
              data.tds.map(row => (
                <Card key={row.restaurantId} style={s.tdsCard}>
                  <View style={s.tdsHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.tdsName}>{row.restaurantName}</Text>
                      <Text style={s.sub}>
                        {row.ordersCounted} orders · {rupees(row.grossSupplies)} supplied
                      </Text>
                    </View>
                    <Text style={s.tdsAmount}>{rupees(row.deducted)}</Text>
                  </View>
                </Card>
              ))
            )}

            <Card>
              <View style={s.head}>
                <Download size={16} color={c.text.secondary} />
                <Text style={s.headTitle}>For your accountant</Text>
              </View>
              <Text style={s.note}>
                The per-partner deduction list is available as a CSV at{'\n'}
                <Text style={s.mono}>/api/admin/tax/summary/tds.csv?month={month}</Text>
                {'\n'}with your admin session. It opens in any spreadsheet.
              </Text>
            </Card>

            <Text style={s.footnote}>
              Tax on restaurant service supplied through this platform is payable by us under section 9(5) of
              the CGST Act, which is why our GSTIN appears on invoices for a kitchen’s food. These figures are
              derived from delivered orders and their frozen bills. Have your accountant confirm the treatment
              against the current rules before the first return.
            </Text>
          </>
        )}
      </ScrollView>

      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="GST registration"
        subtitle="What appears on every invoice"
      >
        <Text style={s.sheetNote}>
          Enter these exactly as they appear on the registration certificate. The state code is taken from the
          GSTIN itself, so there is nothing to mistype.
        </Text>

        <Field
          label="GSTIN"
          value={form.gstin || ''}
          onChangeText={text => setForm(f => ({ ...f, gstin: text.toUpperCase().replace(/\s/g, '') }))}
          placeholder="29AABCU9603R1ZM"
          autoCapitalize="none"
          hint="Fifteen characters. The first two are your state."
        />
        <Field
          label="Legal name"
          value={form.legalName || ''}
          onChangeText={text => setForm(f => ({ ...f, legalName: text }))}
          placeholder="Quick Bites Foods Private Limited"
          hint="The name on the registration, which is not always the brand."
        />
        <Field
          label="Trading name (optional)"
          value={form.tradeName || ''}
          onChangeText={text => setForm(f => ({ ...f, tradeName: text }))}
          placeholder="Quick Bites"
        />
        <Field
          label="Registered address"
          value={form.addressLine || ''}
          onChangeText={text => setForm(f => ({ ...f, addressLine: text }))}
          multiline
          placeholder="4th Floor, 12 Residency Road"
        />
        <Field
          label="City"
          value={form.city || ''}
          onChangeText={text => setForm(f => ({ ...f, city: text }))}
          placeholder="Bengaluru"
        />
        <Field
          label="State"
          value={form.stateName || ''}
          onChangeText={text => setForm(f => ({ ...f, stateName: text }))}
          placeholder="Karnataka"
        />
        <Field
          label="Pincode"
          value={form.pincode || ''}
          onChangeText={text => setForm(f => ({ ...f, pincode: text.replace(/[^0-9]/g, '').slice(0, 6) }))}
          keyboardType="numeric"
          placeholder="560025"
        />
        <Field
          label="PAN (optional)"
          value={form.pan || ''}
          onChangeText={text => setForm(f => ({ ...f, pan: text.toUpperCase() }))}
          autoCapitalize="none"
          hint="Appears on every TDS certificate you issue."
        />
        <Field
          label="TAN (optional)"
          value={form.tan || ''}
          onChangeText={text => setForm(f => ({ ...f, tan: text.toUpperCase() }))}
          autoCapitalize="none"
          hint="For the section 194-O return."
        />
        <Field
          label="Invoice prefix"
          value={form.invoicePrefix || ''}
          onChangeText={text => setForm(f => ({ ...f, invoicePrefix: text.toUpperCase().slice(0, 12) }))}
          autoCapitalize="none"
          hint="Invoices are numbered PREFIX/2026-27/00001 and restart each April."
        />

        {!!error && <Text style={s.errorText}>{error}</Text>}

        <Button
          label={busy ? 'Saving…' : 'Save registration'}
          onPress={save}
          disabled={busy || !canSubmit}
        />
      </Sheet>
    </>
  );
};

const Row: React.FC<{ label: string; value: string; tax: string }> = ({ label, value, tax }) => (
  <View style={s.supplyRow}>
    <Text style={s.supplyLabel}>{label}</Text>
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={s.supplyValue}>{value}</Text>
      <Text style={s.supplyTax}>{tax} tax</Text>
    </View>
  </View>
);

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headTitle: { color: c.text.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  sub: { color: c.text.secondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  note: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  mono: { color: c.text.secondary, fontSize: 11 },

  okCard: { marginBottom: 12, borderColor: c.state.success },
  blockCard: { marginBottom: 12, borderColor: c.state.danger },
  blockBody: { color: c.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
  gstin: { color: c.text.primary, fontSize: 20, fontWeight: '800', marginTop: 10, letterSpacing: 0.5 },

  gapRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8 },
  gapText: { color: c.state.danger, fontSize: 12, lineHeight: 17, flex: 1 },

  warnCard: { marginBottom: 12, borderColor: c.state.warning },
  warnText: { color: c.state.warning, fontSize: 12, lineHeight: 17, flex: 1 },
  warnFoot: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },

  supplyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 },
  supplyLabel: { color: c.text.secondary, fontSize: 13, flex: 1 },
  supplyValue: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  supplyTax: { color: c.text.muted, fontSize: 11, marginTop: 1 },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { color: c.text.secondary, fontSize: 13 },
  totalValue: { color: c.text.primary, fontSize: 15, fontWeight: '800' },

  tdsCard: { marginBottom: 8 },
  tdsHead: { flexDirection: 'row', alignItems: 'center' },
  tdsName: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  tdsAmount: { color: c.text.primary, fontSize: 16, fontWeight: '800' },

  sheetNote: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  errorText: { color: c.state.danger, fontSize: 13, marginBottom: 10 },
  footnote: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 14 }
});

export default TaxScreen;
