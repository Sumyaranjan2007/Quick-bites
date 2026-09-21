import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share
} from 'react-native';
import { X, FileText, Share2 } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';

/**
 * The bill for an order — as a tax invoice where we can issue one, and as a
 * plain receipt where we cannot.
 *
 * -------------------------------------------------------------------------
 * THE DIFFERENCE IS NEVER BLURRED
 * -------------------------------------------------------------------------
 * A tax invoice names a GSTIN and can be used to claim input credit. A receipt
 * says what was paid and claims nothing. Until Quick Bites has completed its
 * GST registration the server will only produce the second, and this screen
 * says which one the customer is looking at rather than presenting a receipt
 * with an empty GSTIN field and letting them assume.
 *
 * That matters to the customer ordering lunch on expenses far more than it
 * looks: handing an accounts department a document that is not an invoice, and
 * finding out in March, is a genuinely bad afternoon.
 */

interface InvoiceLine {
  description: string;
  sac: string;
  taxableValuePaise: number;
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

interface Invoice {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  supplier: { gstin: string; legalName: string; tradeName?: string; address: string; stateName: string };
  recipient: { name: string; address: string; placeOfSupplyStateName: string };
  lines: InvoiceLine[];
  totals: {
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    nonTaxablePaise: number;
    grandTotalPaise: number;
  };
  notes: string[];
}

interface Receipt {
  orderNumber: string;
  date: string;
  restaurantName?: string;
  deliveryAddress: string;
  lines: Array<{ label: string; amount: number }>;
  total: number;
  paidBy: string;
}

const c = tokens.colors;

const money = (paise: number) =>
  '₹' + (Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const rupees = (n: number) =>
  '₹' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const InvoiceSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  orderId: string | null;
  /** Both can be absent while the session is still being restored. */
  apiUrl?: string;
  token?: string;
}> = ({ visible, onClose, orderId, apiUrl, token }) => {
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId || !apiUrl || !token) return;
    setLoading(true);
    setError(null);
    setInvoice(null);
    setReceipt(null);
    try {
      const res = await apiFetch(`${apiUrl}/invoices/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        setError(payload?.error?.message || 'That bill could not be loaded.');
        return;
      }
      if (payload.data?.kind === 'TAX_INVOICE') {
        setInvoice(payload.data.invoice);
      } else {
        setReceipt(payload.data?.receipt || null);
        setNote(payload.data?.message || null);
      }
    } catch {
      setError('We could not reach Quick Bites. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [orderId, apiUrl, token]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  /** Plain text, so it can go into an email or a chat without an attachment. */
  const share = async () => {
    const body = invoice
      ? [
          `${invoice.supplier.legalName}`,
          `GSTIN ${invoice.supplier.gstin}`,
          '',
          `Tax invoice ${invoice.invoiceNumber}`,
          `Order #${invoice.orderNumber} · ${when(invoice.invoiceDate)}`,
          '',
          ...invoice.lines.map(
            l =>
              `${l.description} (SAC ${l.sac})  ${money(l.taxableValuePaise)} + ${money(
                l.cgstPaise + l.sgstPaise + l.igstPaise
              )} tax`
          ),
          '',
          `Total ${money(invoice.totals.grandTotalPaise)}`
        ].join('\n')
      : receipt
      ? [
          `Quick Bites receipt`,
          `Order #${receipt.orderNumber} · ${when(receipt.date)}`,
          '',
          ...receipt.lines.filter(l => l.amount !== 0).map(l => `${l.label}  ${rupees(l.amount)}`),
          '',
          `Total ${rupees(receipt.total)}`,
          '',
          'This is a payment receipt, not a tax invoice.'
        ].join('\n')
      : '';
    if (body) await Share.share({ message: body });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <FileText size={18} color={c.primary[500]} />
            <Text style={s.title}>{invoice ? 'Tax invoice' : 'Receipt'}</Text>
            {(invoice || receipt) && (
              <TouchableOpacity onPress={share} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Share2 size={18} color={c.text.secondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={c.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body}>
            {loading ? (
              <View style={s.centre}>
                <ActivityIndicator color={c.primary[500]} />
              </View>
            ) : error ? (
              <Text style={s.error}>{error}</Text>
            ) : invoice ? (
              <>
                <Text style={s.supplier}>{invoice.supplier.legalName}</Text>
                {!!invoice.supplier.tradeName && (
                  <Text style={s.supplierSub}>trading as {invoice.supplier.tradeName}</Text>
                )}
                <Text style={s.supplierSub}>{invoice.supplier.address}</Text>
                <Text style={s.gstin}>GSTIN {invoice.supplier.gstin}</Text>

                <View style={s.metaBox}>
                  <Meta label="Invoice number" value={invoice.invoiceNumber} />
                  <Meta label="Date" value={when(invoice.invoiceDate)} />
                  <Meta label="Order" value={'#' + invoice.orderNumber} />
                  <Meta label="Place of supply" value={invoice.recipient.placeOfSupplyStateName} />
                </View>

                <Text style={s.sectionLabel}>Billed to</Text>
                <Text style={s.recipient}>{invoice.recipient.name}</Text>
                {!!invoice.recipient.address && <Text style={s.supplierSub}>{invoice.recipient.address}</Text>}

                <Text style={s.sectionLabel}>Supplies</Text>
                {invoice.lines.map(line => (
                  <View key={line.sac + line.description} style={s.lineBlock}>
                    <View style={s.lineTop}>
                      <Text style={s.lineDesc}>{line.description}</Text>
                      <Text style={s.lineTotal}>{money(line.totalPaise)}</Text>
                    </View>
                    <Text style={s.lineMeta}>
                      SAC {line.sac} · {money(line.taxableValuePaise)} taxable at {line.ratePercent}%
                    </Text>
                    <Text style={s.lineMeta}>
                      {line.igstPaise > 0
                        ? `IGST ${money(line.igstPaise)}`
                        : `CGST ${money(line.cgstPaise)} · SGST ${money(line.sgstPaise)}`}
                    </Text>
                  </View>
                ))}

                {invoice.totals.nonTaxablePaise > 0 && (
                  <View style={s.lineBlock}>
                    <View style={s.lineTop}>
                      <Text style={s.lineDesc}>Tip to your delivery partner</Text>
                      <Text style={s.lineTotal}>{money(invoice.totals.nonTaxablePaise)}</Text>
                    </View>
                    <Text style={s.lineMeta}>Paid across in full. Not a taxable supply.</Text>
                  </View>
                )}

                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total</Text>
                  <Text style={s.totalValue}>{money(invoice.totals.grandTotalPaise)}</Text>
                </View>

                {invoice.notes.map(n => (
                  <Text key={n} style={s.note}>
                    {n}
                  </Text>
                ))}
              </>
            ) : receipt ? (
              <>
                <Text style={s.supplier}>Quick Bites</Text>
                <Text style={s.supplierSub}>
                  Order #{receipt.orderNumber} · {when(receipt.date)}
                </Text>
                {!!receipt.restaurantName && <Text style={s.supplierSub}>{receipt.restaurantName}</Text>}

                <View style={{ marginTop: 18 }}>
                  {receipt.lines
                    .filter(line => line.amount !== 0)
                    .map(line => (
                      <View key={line.label} style={s.receiptRow}>
                        <Text style={s.receiptLabel}>{line.label}</Text>
                        <Text style={s.receiptValue}>{rupees(line.amount)}</Text>
                      </View>
                    ))}
                </View>

                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total paid</Text>
                  <Text style={s.totalValue}>{rupees(receipt.total)}</Text>
                </View>

                {!!note && <Text style={s.note}>{note}</Text>}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Meta: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={s.metaRow}>
    <Text style={s.metaLabel}>{label}</Text>
    <Text style={s.metaValue}>{value}</Text>
  </View>
);

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

  body: { padding: 20, paddingBottom: 36 },
  centre: { paddingVertical: 40, alignItems: 'center' },
  error: { color: c.semantic.error, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 20 },

  supplier: { color: c.text.primary, fontSize: 18, fontWeight: '800' },
  supplierSub: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  gstin: { color: c.text.primary, fontSize: 13, fontWeight: '700', marginTop: 6, letterSpacing: 0.4 },

  metaBox: {
    backgroundColor: c.surface.sunken,
    borderRadius: 12,
    padding: 12,
    marginTop: 16
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 12 },
  metaLabel: { color: c.text.muted, fontSize: 12 },
  metaValue: { color: c.text.primary, fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right' },

  sectionLabel: {
    color: c.text.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 6
  },
  recipient: { color: c.text.primary, fontSize: 14, fontWeight: '700' },

  lineBlock: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineDesc: { color: c.text.primary, fontSize: 14, fontWeight: '600', flex: 1 },
  lineTotal: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  lineMeta: { color: c.text.muted, fontSize: 11, marginTop: 3 },

  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  receiptLabel: { color: c.text.secondary, fontSize: 14 },
  receiptValue: { color: c.text.primary, fontSize: 14, fontWeight: '600' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: c.border.medium
  },
  totalLabel: { color: c.text.primary, fontSize: 16, fontWeight: '800' },
  totalValue: { color: c.text.primary, fontSize: 20, fontWeight: '800' },

  note: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 12 }
});

export default InvoiceSheet;
