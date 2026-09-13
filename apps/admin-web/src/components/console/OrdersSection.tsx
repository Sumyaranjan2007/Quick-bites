import React from 'react';
import { fetchOrders, fetchOrderDetail, fetchLiveDeliveries } from '../../lib/adminApi';
import { Loading, Failed, Empty, NoPermission, PageHeading, StatusTag, Money, useRemote } from './primitives';

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Every order, with the detail an operator needs to answer a complaint. */
export const AllOrders: React.FC = () => {
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);

  const query = React.useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`status=${encodeURIComponent(status)}`);
    if (search.trim()) parts.push(`search=${encodeURIComponent(search.trim())}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }, [status, search]);

  const { data, error, denied, loading, reload } = useRemote<any>(() => fetchOrders(query), [query]);

  if (denied) return <NoPermission section="orders" />;

  return (
    <>
      <PageHeading
        title="All orders"
        sub={data?.totals ? `${data.totals.count ?? data.orders?.length ?? 0} orders` : undefined}
        actions={
          <>
            <input
              className="input"
              placeholder="Order number, customer, restaurant"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Every status</option>
              {['ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED'].map(
                s => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                )
              )}
            </select>
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !data?.orders?.length ? (
        <Empty title="No orders match" body="Try a different status or search term." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Placed</th>
                <th>Customer</th>
                <th>Restaurant</th>
                <th>Rider</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o: any) => (
                <tr key={o.id}>
                  <td className="mono">{o.orderNumber}</td>
                  <td>{when(o.createdAt)}</td>
                  <td>{o.customerName || '—'}</td>
                  <td>{o.restaurantName || '—'}</td>
                  <td>{o.riderName || <span className="muted">unassigned</span>}</td>
                  <td>
                    <StatusTag status={o.status} />
                  </td>
                  <td className="num">
                    <Money value={o.totalAmount ?? o.bill?.totalAmount ?? 0} />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelected(o.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!selected && <OrderDetail id={selected} onClose={() => setSelected(null)} />}
    </>
  );
};

const OrderDetail: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { data, error, denied, loading } = useRemote<any>(() => fetchOrderDetail(id), [id]);
  const order = data?.order ?? data;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{order?.orderNumber || 'Order'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {denied ? (
          <NoPermission section="order detail" />
        ) : loading ? (
          <Loading />
        ) : error ? (
          <Failed message={error} />
        ) : !order ? (
          <Empty title="Order not found" />
        ) : (
          <div className="drawer-body">
            <StatusTag status={order.status} />

            <h3>Items</h3>
            <ul className="plain-list">
              {(order.items || []).map((it: any, i: number) => (
                <li key={i}>
                  <span>
                    {it.quantity}× {it.name}
                  </span>
                  <span className="mono">
                    <Money value={it.totalPrice ?? 0} />
                  </span>
                </li>
              ))}
            </ul>

            <h3>Bill</h3>
            <dl className="kv">
              {Object.entries(order.bill || {}).map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</dt>
                  <dd>
                    <Money value={Number(v) || 0} />
                  </dd>
                </div>
              ))}
            </dl>

            <h3>People</h3>
            <dl className="kv">
              <div><dt>Customer</dt><dd>{order.customerName || '—'}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</dd></div>
              <div><dt>Restaurant</dt><dd>{order.restaurantName || '—'}</dd></div>
              <div><dt>Rider</dt><dd>{order.riderName || 'Unassigned'}</dd></div>
              <div><dt>Deliver to</dt><dd>{order.deliveryAddressText || '—'}</dd></div>
              <div><dt>Payment</dt><dd>{order.paymentMethod} · {order.paymentStatus}</dd></div>
            </dl>

            <h3>Timeline</h3>
            <dl className="kv">
              <div><dt>Placed</dt><dd>{when(order.createdAt)}</dd></div>
              {!!order.riderAssignedAt && <div><dt>Rider assigned</dt><dd>{when(order.riderAssignedAt)}</dd></div>}
              {!!order.pickedUpAt && <div><dt>Picked up</dt><dd>{when(order.pickedUpAt)}</dd></div>}
              {!!order.deliveredAt && <div><dt>Delivered</dt><dd>{when(order.deliveredAt)}</dd></div>}
              {!!order.cancelledAt && <div><dt>Cancelled</dt><dd>{when(order.cancelledAt)}</dd></div>}
              {!!order.cancellationReason && <div><dt>Reason</dt><dd>{order.cancellationReason}</dd></div>}
            </dl>

            {typeof order.rating === 'number' && (
              <>
                <h3>Customer rating</h3>
                <p className="muted">
                  {order.rating}/5{order.ratingComment ? ` — "${order.ratingComment}"` : ''}
                </p>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

/** Orders currently with a rider, refreshed on a timer while the tab is open. */
export const LiveDeliveries: React.FC = () => {
  const [tick, setTick] = React.useState(0);
  const { data, error, denied, loading, reload } = useRemote<any>(fetchLiveDeliveries, [tick]);

  React.useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 20000);
    return () => clearInterval(timer);
  }, []);

  if (denied) return <NoPermission section="live deliveries" />;

  const rows = data?.deliveries || data?.orders || [];

  return (
    <>
      <PageHeading title="Live deliveries" sub="Refreshes every 20 seconds" />
      {loading && !rows.length ? (
        <Loading />
      ) : error ? (
        <Failed message={error} onRetry={reload} />
      ) : !rows.length ? (
        <Empty title="Nothing in transit" body="Orders appear here once a rider has collected them." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Restaurant</th>
                <th>Rider</th>
                <th>Status</th>
                <th>Last seen</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d: any) => (
                <tr key={d.id || d.orderId}>
                  <td className="mono">{d.orderNumber}</td>
                  <td>{d.restaurantName || '—'}</td>
                  <td>{d.riderName || <span className="muted">unassigned</span>}</td>
                  <td>
                    <StatusTag status={d.status} />
                  </td>
                  <td>{d.riderLocationUpdatedAt ? when(d.riderLocationUpdatedAt) : <span className="muted">no fix yet</span>}</td>
                  <td className="num">
                    <Money value={d.totalAmount ?? d.bill?.totalAmount ?? 0} />
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
