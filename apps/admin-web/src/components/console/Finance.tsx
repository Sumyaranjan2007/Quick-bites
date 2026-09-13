import React from 'react';
import { fetchPayments, fetchRevenue, fetchPayouts } from '../../lib/adminApi';
import { Loading, Failed, Empty, NoPermission, PageHeading, StatCard, StatusTag, Money, useRemote } from './primitives';

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const humanise = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

/** Where the money came from and where it went. */
export const RevenueSection: React.FC = () => {
  const { data, error, denied, loading, reload } = useRemote<any>(fetchRevenue);

  if (denied) return <NoPermission section="revenue" />;
  if (loading) return <Loading />;
  if (error) return <Failed message={error} onRetry={reload} />;

  const periods = data?.periods || {};
  const summary = data?.summary || {};

  return (
    <>
      <PageHeading title="Payments and revenue" sub="Derived from delivered orders" />

      <section className="stat-grid">
        {(['today', 'week', 'month', 'all'] as const).map(key => (
          <StatCard
            key={key}
            label={key === 'all' ? 'All time' : `This ${key}`}
            value={<Money value={periods[key]?.netRevenue ?? 0} compact />}
            sub={`GMV ₹${Math.round(periods[key]?.grossMerchandiseValue ?? 0).toLocaleString('en-IN')}`}
            tone={key === 'today' ? 'brand' : 'default'}
          />
        ))}
      </section>

      <section className="panel">
        <h2>Breakdown</h2>
        <dl className="kv kv-wide">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k}>
              <dt>{humanise(k)}</dt>
              <dd>{typeof v === 'number' ? <Money value={v} /> : String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
};

/** Individual payments, for reconciling a customer's complaint about a charge. */
export const PaymentsSection: React.FC = () => {
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchPayments());

  if (denied) return <NoPermission section="payments" />;

  const payments = data?.payments || [];

  return (
    <>
      <PageHeading title="Payments" sub={data?.totals ? `${payments.length} shown` : undefined} />

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !payments.length ? (
        <Empty title="No payments yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>When</th>
                <th>Method</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any, i: number) => (
                <tr key={p.id || p.orderId || i}>
                  <td className="mono">{p.orderNumber || p.orderId}</td>
                  <td>{when(p.createdAt || p.paidAt)}</td>
                  <td>{String(p.paymentMethod || '—').replace(/_/g, ' ')}</td>
                  <td>
                    <StatusTag status={p.paymentStatus || p.status} />
                  </td>
                  <td className="num">
                    <Money value={p.amount ?? p.totalAmount ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

/** What each rider is owed, and how much company cash they are holding. */
export const PayoutsSection: React.FC = () => {
  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchPayouts());

  if (denied) return <NoPermission section="driver payouts" />;

  const payouts = data?.payouts || [];
  const totals = data?.totals || {};

  return (
    <>
      <PageHeading title="Driver payouts" sub="Earned, paid, and cash collected on delivery" />

      <section className="stat-grid">
        <StatCard label="Owed to riders" value={<Money value={totals.pending ?? 0} compact />} tone="brand" />
        <StatCard label="Paid to date" value={<Money value={totals.paid ?? 0} compact />} tone="good" />
        <StatCard
          label="COD cash held by riders"
          value={<Money value={totals.codOutstanding ?? 0} compact />}
          tone={Number(totals.codOutstanding) > 0 ? 'bad' : 'default'}
          sub="Company money in riders' hands"
        />
      </section>

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !payouts.length ? (
        <Empty title="No riders yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Trips</th>
                <th className="num">Pending</th>
                <th className="num">Paid to date</th>
                <th className="num">COD in hand</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p: any) => (
                <tr key={p.riderId || p.id}>
                  <td>
                    {p.fullName || p.riderName || p.riderId}
                    {!!p.driverCode && <span className="muted small"> · {p.driverCode}</span>}
                  </td>
                  <td>{p.tripCount ?? p.trips ?? '—'}</td>
                  <td className="num">
                    <Money value={p.pendingAmount ?? 0} />
                  </td>
                  <td className="num">
                    <Money value={p.paidToDate ?? 0} />
                  </td>
                  <td className="num">
                    <Money value={p.codCashInHand ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
