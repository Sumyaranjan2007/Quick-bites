import React from 'react';
import { fetchDashboard } from '../../lib/adminApi';
import { Loading, Failed, NoPermission, PageHeading, StatCard, Money, useRemote } from './primitives';

/**
 * The control tower's first screen.
 *
 * Counts, money and queue depths, all computed server-side from the real
 * records. Where a number is zero it says zero rather than being hidden, because
 * "no refunds outstanding" is information an operator needs as much as a backlog.
 */
export const Overview: React.FC = () => {
  const { data, error, denied, loading, reload } = useRemote<any>(fetchDashboard);

  if (denied) return <NoPermission section="the dashboard" />;
  if (loading) return <Loading label="Loading the control tower" />;
  if (error) return <Failed message={error} onRetry={reload} />;
  if (!data) return null;

  const { orders, people, money, payments, queues, catalogue, reviews, revenueTrend } = data;
  const peak = Math.max(1, ...(revenueTrend || []).map((p: any) => p.revenue || 0));

  return (
    <>
      <PageHeading
        title="Control tower"
        sub={`Updated ${new Date(data.generatedAt).toLocaleTimeString('en-IN')}`}
      />

      <section className="stat-grid">
        <StatCard label="Orders today" value={orders.today} sub={`${orders.total} all time`} tone="brand" />
        <StatCard label="Live now" value={orders.live} sub={`${orders.inTransit} with a rider`} />
        <StatCard
          label="Revenue today"
          value={<Money value={money.netRevenueToday} compact />}
          sub={`GMV ${'₹'}${Math.round(money.gmvToday).toLocaleString('en-IN')}`}
          tone="good"
        />
        <StatCard
          label="Completion"
          value={`${orders.completionRate}%`}
          sub={`${orders.cancellationRate}% cancelled`}
          tone={orders.cancellationRate > 15 ? 'bad' : 'default'}
        />
      </section>

      <div className="panel-grid">
        <section className="panel">
          <h2>Money</h2>
          <dl className="kv">
            <div><dt>Gross merchandise value</dt><dd><Money value={money.grossMerchandiseValue} /></dd></div>
            <div><dt>Net revenue</dt><dd><Money value={money.netRevenue} /></dd></div>
            <div><dt>Commission</dt><dd><Money value={money.commission} /></dd></div>
            <div><dt>Delivery fees</dt><dd><Money value={money.deliveryFees} /></dd></div>
            <div><dt>Platform fees</dt><dd><Money value={money.platformFees} /></dd></div>
            <div><dt>Tax collected</dt><dd><Money value={money.taxCollected} /></dd></div>
            <div><dt>Discounts given</dt><dd><Money value={money.discountsGiven} /></dd></div>
            <div><dt>Average order</dt><dd><Money value={orders.averageOrderValue} /></dd></div>
          </dl>
        </section>

        <section className="panel">
          <h2>People</h2>
          <dl className="kv">
            <div><dt>Customers</dt><dd>{people.totalCustomers}</dd></div>
            <div><dt>New today</dt><dd>{people.newCustomersToday}</dd></div>
            <div><dt>Drivers</dt><dd>{people.totalDrivers}</dd></div>
            <div><dt>Drivers online</dt><dd>{people.onlineDrivers} of {people.activeDrivers} active</dd></div>
            <div><dt>Restaurants</dt><dd>{people.totalRestaurants}</dd></div>
            <div><dt>Kitchens open</dt><dd>{people.openRestaurants} of {people.activeRestaurants} active</dd></div>
          </dl>
        </section>

        {!!queues && (
          <section className="panel">
            <h2>Waiting for you</h2>
            <dl className="kv">
              {Object.entries(queues).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</dt>
                  <dd className={Number(value) > 0 ? 'kv-attention' : undefined}>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {!!payments && (
          <section className="panel">
            <h2>Payments</h2>
            <dl className="kv">
              {Object.entries(payments).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</dt>
                  <dd>{typeof value === 'number' && key.toLowerCase().includes('value')
                    ? <Money value={value as number} />
                    : String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {Array.isArray(revenueTrend) && revenueTrend.length > 0 && (
        <section className="panel">
          <h2>Last 14 days</h2>
          <div className="trend">
            {revenueTrend.map((point: any) => (
              <div className="trend-col" key={point.date} title={`${point.date}: ₹${point.revenue}`}>
                <div
                  className={`trend-bar${point.revenue === 0 ? ' trend-bar-empty' : ''}`}
                  style={{ height: `${Math.max(2, (point.revenue / peak) * 100)}%` }}
                />
                <span>{String(point.date).slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!catalogue && (
        <section className="panel">
          <h2>Catalogue and reviews</h2>
          <dl className="kv kv-wide">
            {Object.entries({ ...catalogue, ...(reviews || {}) }).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
};
