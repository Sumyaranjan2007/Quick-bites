import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Users, Bike, Store } from 'lucide-react-native';
import {
  Card,
  SearchBar,
  Segmented,
  Badge,
  Button,
  Field,
  Sheet,
  KeyValue,
  Divider,
  Loading,
  EmptyState,
  NoAccess,
  Toggle
} from '../components/ui';
import { tokens, formatMoney, humanise, toneForStatus, timeAgo, formatDateTime } from '../theme/tokens';
import { useSession } from '../lib/session';
import { useResource } from '../lib/useResource';
import { query } from '../lib/api';

const c = tokens.colors;

type Tab = 'customers' | 'drivers' | 'restaurants';

/**
 * Where this partner's money goes.
 *
 * The owner asked that a verified account be "added to their profile which is
 * available in the admin portal so they can pay everything as settlement". This
 * is that block, and it is on the profile rather than only in the Bank queue
 * because the question "why has this rider not been paid" is asked while
 * looking at the rider, not while looking at a queue of bank accounts.
 *
 * It states two things separately and never merges them: whether an account is
 * connected, and whether money can actually leave. An account can be connected
 * and still unpayable -- a rider holding our cash is the common one -- and
 * collapsing that into a single "not payable" sends somebody to ask a partner
 * for bank details that are already correct.
 *
 * Never blank. When there is nothing connected it says so and says what that
 * costs, because this is the screen somebody is already on when they ask.
 */
const PaidIntoCard: React.FC<{ destination: any }> = ({ destination }) => {
  const d = destination;
  const account = d?.account;

  return (
    <Card>
      <Text style={s.cardHeading}>Paid into</Text>

      {!d || !d.connected ? (
        <>
          <Text style={s.muted}>
            {d?.reason || 'No account connected. This partner cannot be paid.'}
          </Text>
          <Text style={[s.muted, { marginTop: 6 }]}>
            They add one from their own app, under Payout account. It appears in Bank for you to
            check and apply.
          </Text>
        </>
      ) : (
        <>
          <KeyValue label="Holder name" value={account.holderName} tone="strong" />
          {account.method === 'VPA' ? (
            <KeyValue label="UPI ID" value={account.vpa} />
          ) : (
            <>
              {/* The last four only. A profile is the screen most likely to be
                  shown to somebody standing beside the desk, and the full
                  number is never stored anyway. */}
              <KeyValue label="Account" value={`Ending ${account.accountLast4 || '----'}`} />
              <KeyValue label="IFSC" value={account.ifsc} />
            </>
          )}
          <KeyValue label="Connected" value={formatDateTime(account.appliedAt)} />
          <KeyValue label="Checked by" value={d.appliedByName || 'An administrator'} />

          {/* Connected but still not payable. Shown as its own line so it reads
              as a blocker to clear rather than as a missing account. */}
          {d.payableNow ? (
            <Text style={[s.muted, { marginTop: 8 }]}>Settlements and payouts go here.</Text>
          ) : (
            <Text style={[s.muted, { marginTop: 8, color: c.state.warning }]}>{d.reason}</Text>
          )}
        </>
      )}
    </Card>
  );
};

/**
 * The directory of everyone on the platform.
 *
 * Three populations on one screen because they are read the same way — find a
 * person, open their file, act on it — and because the questions asked of them
 * cross over constantly ("which rider took this customer's order?").
 */
export const PeopleScreen: React.FC = () => {
  const { can } = useSession();
  const available: Array<{ key: Tab; label: string }> = [
    ...(can('users.customers.view') ? [{ key: 'customers' as Tab, label: 'Customers' }] : []),
    ...(can('users.drivers.view') ? [{ key: 'drivers' as Tab, label: 'Delivery partners' }] : []),
    ...(can('users.restaurants.view') ? [{ key: 'restaurants' as Tab, label: 'Restaurants' }] : [])
  ];
  const [tab, setTab] = useState<Tab>(available[0]?.key || 'customers');

  if (available.length === 0) return <NoAccess permission="users.customers.view" />;

  return (
    <View style={{ flex: 1 }}>
      <View style={s.tabs}>
        <Segmented options={available} value={tab} onChange={next => setTab(next as Tab)} />
      </View>
      {tab === 'customers' ? <CustomersTab /> : null}
      {tab === 'drivers' ? <DriversTab /> : null}
      {tab === 'restaurants' ? <RestaurantsTab /> : null}
    </View>
  );
};

/* -------------------------------- Customers ------------------------------- */

const CustomersTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useResource(
    () => api.get<any>(`/admin/customers${query({ q: submitted, status, pageSize: 50 })}`),
    [submitted, status]
  );

  const customers = list.data?.customers || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Name, email or phone" onSubmit={() => setSubmitted(search.trim())} />
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'ACTIVE', label: 'Active' },
            { key: 'BLOCKED', label: 'Blocked' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {list.loading && customers.length === 0 ? <Loading /> : null}
      {!list.loading && customers.length === 0 ? (
        <EmptyState title="No customers match" message={list.error || 'Try a different search.'} icon={<Users size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {customers.map((customer: any) => (
          <Card key={customer.id} onPress={() => setOpenId(customer.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.name} numberOfLines={1}>
                  {customer.fullName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {customer.email}
                </Text>
              </View>
              {customer.isBlocked ? <Badge label="Blocked" tone="danger" /> : customer.isGold ? <Badge label="Gold" tone="amber" /> : null}
            </View>
            <View style={s.statRow}>
              <MiniStat label="Orders" value={String(customer.orderCount)} />
              <MiniStat label="Lifetime" value={formatMoney(customer.lifetimeValue)} />
              <MiniStat label="Wallet" value={formatMoney(customer.walletBalance)} />
              <MiniStat label="Last order" value={customer.lastOrderAt ? timeAgo(customer.lastOrderAt) : '—'} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <CustomerSheet id={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} canManage={can('users.customers.manage')} />
    </View>
  );
};

const CustomerSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void; canManage: boolean }> = ({
  id,
  onClose,
  onChanged,
  canManage
}) => {
  const { api } = useSession();
  const [mode, setMode] = useState<'view' | 'edit' | 'wallet'>('view');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [busy, setBusy] = useState(false);

  const resource = useResource(() => api.get<any>(`/admin/customers/${id}`), [id], { enabled: Boolean(id) });
  const customer = resource.data?.customer;

  const close = () => {
    setMode('view');
    onClose();
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/customers/${id}`, { fullName, phone });
      await resource.reload();
      onChanged();
      setMode('view');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const setBlocked = async (blocked: boolean) => {
    if (blocked && !blockReason.trim()) {
      Alert.alert('A reason is required', 'Record why this account is being blocked — the customer is shown it.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/customers/${id}`, { isBlocked: blocked, blockReason: blocked ? blockReason : '' });
      await resource.reload();
      onChanged();
      Alert.alert(blocked ? 'Account blocked' : 'Account restored', blocked ? 'They can no longer sign in.' : 'They can sign in again.');
    } catch (err: any) {
      Alert.alert('Could not change the account', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const adjustWallet = async (direction: 'CREDIT' | 'DEBIT') => {
    const amount = Number(creditAmount);
    if (!amount || amount <= 0 || !creditReason.trim()) {
      Alert.alert('Check the details', 'An amount and a reason are both required.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/customers/${id}/wallet`, { amount, direction, reason: creditReason });
      setCreditAmount('');
      setCreditReason('');
      setMode('view');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not adjust the wallet', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={Boolean(id)} onClose={close} title={customer?.fullName || 'Customer'} subtitle={customer?.email}>
      {resource.loading && !resource.data ? <Loading /> : null}
      {!resource.loading && !resource.data ? <EmptyState title="Could not open this customer" message={resource.error || undefined} /> : null}

      {resource.data && mode === 'view' ? (
        <>
          <Card>
            <KeyValue label="Phone" value={customer.phone} />
            <KeyValue label="Joined" value={formatDateTime(customer.createdAt)} />
            <KeyValue label="Gold member" value={customer.isGold ? 'Yes' : 'No'} />
            <KeyValue label="Status" value={customer.isBlocked ? `Blocked — ${customer.blockReason || 'no reason recorded'}` : 'Active'} />
          </Card>

          <Card>
            <Text style={s.cardHeading}>Trade</Text>
            <KeyValue label="Orders placed" value={resource.data.stats.total} tone="strong" />
            <KeyValue label="Delivered" value={resource.data.stats.delivered} />
            <KeyValue label="Cancelled" value={resource.data.stats.cancelled} />
            <KeyValue label="Lifetime spend" value={formatMoney(resource.data.stats.spend)} tone="money" />
            <Divider />
            <KeyValue label="Wallet balance" value={formatMoney(resource.data.wallet?.balance)} tone="money" />
          </Card>

          {(resource.data.addresses || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>Saved addresses</Text>
              {resource.data.addresses.map((address: any) => (
                <KeyValue key={address.id} label={address.label || 'Address'} value={address.addressLine} />
              ))}
            </Card>
          ) : null}

          <Card>
            <Text style={s.cardHeading}>Recent orders</Text>
            {(resource.data.orders || []).slice(0, 8).map((order: any) => (
              <View key={order.id} style={s.miniRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.miniTitle} numberOfLines={1}>
                    #{order.orderNumber} · {order.restaurantName}
                  </Text>
                  <Text style={s.miniMeta}>{timeAgo(order.createdAt)}</Text>
                </View>
                <Text style={s.miniValue}>{formatMoney(order.totalAmount)}</Text>
              </View>
            ))}
            {(resource.data.orders || []).length === 0 ? <Text style={s.muted}>No orders yet.</Text> : null}
          </Card>

          {canManage ? (
            <Card>
              <Text style={s.cardHeading}>Manage</Text>
              <View style={s.actionRow}>
                <Button
                  label="Edit details"
                  variant="secondary"
                  full
                  onPress={() => {
                    setFullName(customer.fullName || '');
                    setPhone(customer.phone || '');
                    setMode('edit');
                  }}
                />
                <Button label="Adjust wallet" variant="secondary" full onPress={() => setMode('wallet')} />
              </View>
              <Divider />
              {customer.isBlocked ? (
                <Button label="Restore this account" variant="success" loading={busy} onPress={() => setBlocked(false)} />
              ) : (
                <>
                  <Field label="Reason for blocking" value={blockReason} onChangeText={setBlockReason} placeholder="Repeated fraudulent refund claims" />
                  <Button label="Block this account" variant="danger" loading={busy} onPress={() => setBlocked(true)} />
                </>
              )}
            </Card>
          ) : null}
        </>
      ) : null}

      {resource.data && mode === 'edit' ? (
        <Card>
          <Text style={s.cardHeading}>Edit customer</Text>
          <Field label="Full name" value={fullName} onChangeText={setFullName} />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint="The email address is the login and cannot be changed here." />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setMode('view')} />
            <Button label="Save" full loading={busy} onPress={save} />
          </View>
        </Card>
      ) : null}

      {resource.data && mode === 'wallet' ? (
        <Card>
          <Text style={s.cardHeading}>Adjust wallet</Text>
          <Text style={s.muted}>Current balance {formatMoney(resource.data.wallet?.balance)}</Text>
          <View style={{ height: tokens.space[4] }} />
          <Field label="Amount (₹)" value={creditAmount} onChangeText={setCreditAmount} keyboardType="numeric" />
          <Field label="Reason" value={creditReason} onChangeText={setCreditReason} placeholder="Goodwill credit for a late delivery" />
          <View style={s.actionRow}>
            <Button label="Debit" variant="danger" full loading={busy} onPress={() => adjustWallet('DEBIT')} />
            <Button label="Credit" variant="success" full loading={busy} onPress={() => adjustWallet('CREDIT')} />
          </View>
          <View style={{ height: tokens.space[3] }} />
          <Button label="Back" variant="ghost" onPress={() => setMode('view')} />
        </Card>
      ) : null}
    </Sheet>
  );
};

/* --------------------------------- Drivers -------------------------------- */

const DriversTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useResource(() => api.get<any>(`/admin/drivers${query({ q: submitted, status })}`), [submitted, status]);
  const drivers = list.data?.drivers || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Name, partner ID or phone" onSubmit={() => setSubmitted(search.trim())} />
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'ONLINE', label: 'Online' },
            { key: 'ACTIVE', label: 'Approved' },
            { key: 'PENDING', label: 'Pending' },
            { key: 'SUSPENDED', label: 'Suspended' },
            { key: 'BLOCKED', label: 'Blocked' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {list.loading && drivers.length === 0 ? <Loading /> : null}
      {!list.loading && drivers.length === 0 ? (
        <EmptyState title="No delivery partners match" message={list.error || 'Try a different filter.'} icon={<Bike size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {drivers.map((driver: any) => (
          <Card key={driver.id} onPress={() => setOpenId(driver.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.name} numberOfLines={1}>
                  {driver.fullName}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {driver.driverCode} · {humanise(driver.vehicleType)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge label={driver.kycStatus} tone={toneForStatus(driver.kycStatus)} />
                {/* Shown above the shift badge because it outranks it: a blocked
                    rider cannot be on shift, and the two states answer different
                    questions about the same person. */}
                {driver.isBlocked ? <Badge label="Blocked" tone="danger" /> : null}
                {driver.isOnline ? <Badge label="On shift" tone="success" /> : null}
              </View>
            </View>
            <View style={s.statRow}>
              <MiniStat label="Trips" value={String(driver.trips)} />
              <MiniStat label="Earned" value={formatMoney(driver.earnings)} />
              <MiniStat label="Rating" value={driver.rating ? driver.rating.toFixed(1) : '—'} />
              <MiniStat label="Accepts" value={`${driver.acceptanceRate}%`} />
            </View>
            {/* Shown only when it has happened. A "No-shows: 0" on every rider
                is a column of zeroes nobody reads, and the one row that is not
                zero stops standing out. */}
            {driver.noShowCount ? (
              <Text style={s.noShowFlag}>
                {driver.noShowCount} no-show{driver.noShowCount === 1 ? '' : 's'} — accepted a trip and never collected
              </Text>
            ) : null}
            {driver.activeOrderNumber ? (
              <Text style={s.activeTrip}>Currently delivering #{driver.activeOrderNumber}</Text>
            ) : null}
          </Card>
        ))}
      </ScrollView>

      <DriverSheet id={openId} onClose={() => setOpenId(null)} onChanged={list.silentReload} canManage={can('users.drivers.manage')} />
    </View>
  );
};

const DriverSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void; canManage: boolean }> = ({
  id,
  onClose,
  onChanged,
  canManage
}) => {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const resource = useResource(() => api.get<any>(`/admin/drivers/${id}`), [id], { enabled: Boolean(id) });
  const driver = resource.data?.driver;

  const setKyc = async (kycStatus: string) => {
    setBusy(true);
    try {
      await api.patch(`/admin/drivers/${id}`, { kycStatus, reason });
      setReason('');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Blocking the login account, which is a different thing from suspending.
   *
   * A suspended rider cannot take trips but can still sign in to see why and
   * fix it — which is what almost every suspension needs. Blocking locks them
   * out of the platform, takes them off shift and out of the dispatch pool
   * immediately, and applies to the session they already have open rather
   * than at a next sign-in that is never going to happen.
   */
  const setBlocked = async (isBlocked: boolean) => {
    if (isBlocked && !reason.trim()) {
      Alert.alert('Reason required', 'Blocking an account is recorded against your name. Say why.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/drivers/${id}`, { isBlocked, blockReason: isBlocked ? reason.trim() : '' });
      setReason('');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={Boolean(id)} onClose={onClose} title={driver?.fullName || 'Delivery partner'} subtitle={driver?.driverCode}>
      {resource.loading && !resource.data ? <Loading /> : null}
      {resource.data ? (
        <>
          <Card>
            <KeyValue label="Phone" value={driver.phone} />
            <KeyValue label="Vehicle" value={`${humanise(driver.vehicleType)} · ${driver.vehicleRcNumber || 'no RC on file'}`} />
            <KeyValue label="Licence" value={driver.licenseNumber} />
            <KeyValue label="Status" value={humanise(driver.kycStatus)} tone="strong" />
            <KeyValue
              label="Account"
              value={
                resource.data?.account?.isBlocked
                  ? `Blocked — ${resource.data.account.blockReason || 'no reason recorded'}`
                  : 'Can sign in'
              }
              tone={resource.data?.account?.isBlocked ? 'strong' : undefined}
            />
            <KeyValue label="On shift" value={driver.isOnline ? `Yes, since ${formatDateTime(driver.onlineSince)}` : 'No'} />
            <KeyValue label="Last seen" value={timeAgo(driver.lastPingAt)} />
          </Card>

          <Card>
            <Text style={s.cardHeading}>Earnings</Text>
            <KeyValue label="Trips delivered" value={resource.data.stats.trips} tone="strong" />
            <KeyValue label="Earned in trip fees" value={formatMoney(resource.data.stats.earnings)} tone="money" />
            <KeyValue label="Paid out to date" value={formatMoney(resource.data.stats.paidOut)} />
            <KeyValue label="Cash in hand (COD)" value={formatMoney(resource.data.stats.codCashInHand)} />
            <KeyValue label="Wallet balance" value={formatMoney(resource.data.wallet?.balance)} />
          </Card>

          <PaidIntoCard destination={resource.data.payoutDestination} />

          <Card>
            <Text style={s.cardHeading}>Documents</Text>
            {(resource.data.documents || []).map((doc: any) => (
              <View key={doc.id} style={s.miniRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.miniTitle}>{humanise(doc.documentType)}</Text>
                  <Text style={s.miniMeta}>{doc.documentNumber || 'No number recorded'}</Text>
                </View>
                <Badge label={doc.status} />
              </View>
            ))}
            {(resource.data.documents || []).length === 0 ? <Text style={s.muted}>No documents on file.</Text> : null}
          </Card>

          <Card>
            <Text style={s.cardHeading}>Recent trips</Text>
            {(resource.data.trips || []).slice(0, 8).map((trip: any) => (
              <View key={trip.id} style={s.miniRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.miniTitle} numberOfLines={1}>
                    #{trip.orderNumber} · {trip.restaurantName}
                  </Text>
                  <Text style={s.miniMeta}>
                    {humanise(trip.status)} · {timeAgo(trip.createdAt)}
                  </Text>
                </View>
                <Text style={s.miniValue}>{formatMoney(trip.totalAmount)}</Text>
              </View>
            ))}
            {(resource.data.trips || []).length === 0 ? <Text style={s.muted}>No trips yet.</Text> : null}
          </Card>

          {(resource.data.payouts || []).length > 0 ? (
            <Card>
              <Text style={s.cardHeading}>Payout history</Text>
              {resource.data.payouts.map((payout: any) => (
                <View key={payout.id} style={s.miniRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.miniTitle}>{formatMoney(payout.netAmount)}</Text>
                    <Text style={s.miniMeta}>
                      {payout.tripsCompleted} trips · {formatDateTime(payout.createdAt)}
                    </Text>
                  </View>
                  <Badge label={payout.status} />
                </View>
              ))}
            </Card>
          ) : null}

          {canManage ? (
            <Card>
              <Text style={s.cardHeading}>Manage</Text>
              <Field label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} placeholder="Repeated late deliveries" />
              <View style={s.actionRow}>
                {driver.kycStatus === 'SUSPENDED' ? (
                  <Button label="Reinstate" variant="success" full loading={busy} onPress={() => setKyc('ACTIVE')} />
                ) : (
                  <Button label="Suspend" variant="danger" full loading={busy} onPress={() => setKyc('SUSPENDED')} />
                )}
                {driver.kycStatus === 'PENDING_APPROVAL' ? (
                  <Button label="Approve" variant="success" full loading={busy} onPress={() => setKyc('ACTIVE')} />
                ) : null}
              </View>

              <Divider />
              <Text style={s.muted}>
                Suspending stops them delivering. Blocking locks them out of the app entirely and takes effect
                straight away, on the session they already have open.
              </Text>
              <View style={s.actionRow}>
                {resource.data?.account?.isBlocked ? (
                  <Button
                    label="Unblock account"
                    variant="success"
                    full
                    loading={busy}
                    onPress={() => setBlocked(false)}
                  />
                ) : (
                  <Button
                    label="Block account"
                    variant="danger"
                    full
                    loading={busy}
                    onPress={() => setBlocked(true)}
                  />
                )}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
};

/* ------------------------------- Restaurants ------------------------------ */

const RestaurantsTab: React.FC = () => {
  const { api, can } = useSession();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useResource(() => api.get<any>(`/admin/restaurants${query({ q: submitted, status })}`), [submitted, status]);
  const restaurants = list.data?.restaurants || [];

  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Name, city or phone" onSubmit={() => setSubmitted(search.trim())} />
        <Segmented
          options={[
            { key: 'ALL', label: 'All' },
            { key: 'ACTIVE', label: 'Active' },
            { key: 'PENDING_APPROVAL', label: 'Pending' },
            { key: 'SUSPENDED', label: 'Suspended' },
            { key: 'CLOSED', label: 'Closed' },
            { key: 'BLOCKED', label: 'Blocked' }
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>

      {list.loading && restaurants.length === 0 ? <Loading /> : null}
      {!list.loading && restaurants.length === 0 ? (
        <EmptyState title="No restaurants match" message={list.error || 'Try a different filter.'} icon={<Store size={34} color={c.text.muted} />} />
      ) : null}

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand.amber} />}
      >
        {restaurants.map((restaurant: any) => (
          <Card key={restaurant.id} onPress={() => setOpenId(restaurant.id)}>
            <View style={s.rowTop}>
              <View style={{ flex: 1, paddingRight: tokens.space[3] }}>
                <Text style={s.name} numberOfLines={1}>
                  {restaurant.name}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {restaurant.city} · {(restaurant.cuisineTags || []).slice(0, 3).join(', ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge label={restaurant.status} tone={toneForStatus(restaurant.status)} />
                {restaurant.isBlocked ? <Badge label="Owner blocked" tone="danger" /> : null}
                {restaurant.isOpen ? <Badge label="Open" tone="success" /> : <Badge label="Closed" tone="neutral" />}
              </View>
            </View>
            <View style={s.statRow}>
              <MiniStat label="Orders" value={String(restaurant.orders)} />
              <MiniStat label="Revenue" value={formatMoney(restaurant.revenue)} />
              <MiniStat label="Rating" value={restaurant.rating ? restaurant.rating.toFixed(1) : '—'} />
              <MiniStat label="Dishes" value={String(restaurant.menuItems)} />
            </View>
          </Card>
        ))}
      </ScrollView>

      <RestaurantSheet
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={list.silentReload}
        canManage={can('users.restaurants.manage', 'catalog.restaurants.approve')}
      />
    </View>
  );
};

const RestaurantSheet: React.FC<{ id: string | null; onClose: () => void; onChanged: () => void; canManage: boolean }> = ({
  id,
  onClose,
  onChanged,
  canManage
}) => {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [packagingFee, setPackagingFee] = useState('');

  const resource = useResource(() => api.get<any>(`/admin/restaurants/${id}`), [id], { enabled: Boolean(id) });
  const restaurant = resource.data?.restaurant;

  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      await api.patch(`/admin/restaurants/${id}`, { status, reason });
      setReason('');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Blocking the OWNER'S login account, which is not the same as suspending
   * the restaurant.
   *
   * Suspending takes a kitchen out of the customer feed and stops it going
   * online, while the owner can still sign in, read why, and re-send a
   * rejected licence. Blocking locks the owner out of the partner app
   * altogether — for fraud, not for a hygiene complaint somebody is expected
   * to fix.
   */
  const setBlocked = async (isBlocked: boolean) => {
    if (isBlocked && !reason.trim()) {
      Alert.alert('Reason required', 'Blocking an account is recorded against your name. Say why.');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/restaurants/${id}`, { isBlocked, blockReason: isBlocked ? reason.trim() : '' });
      setReason('');
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not update', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/restaurants/${id}`, {
        name,
        phone,
        ...(packagingFee ? { packagingFee: Number(packagingFee) } : {})
      });
      setEditing(false);
      await resource.reload();
      onChanged();
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={Boolean(id)} onClose={onClose} title={restaurant?.name || 'Restaurant'} subtitle={restaurant?.addressLine}>
      {resource.loading && !resource.data ? <Loading /> : null}
      {resource.data && !editing ? (
        <>
          <Card>
            <KeyValue label="Owner" value={resource.data.owner?.fullName} />
            <KeyValue label="Owner email" value={resource.data.owner?.email} />
            <KeyValue
              label="Owner account"
              value={
                resource.data.owner?.isBlocked
                  ? `Blocked — ${resource.data.owner.blockReason || 'no reason recorded'}`
                  : 'Can sign in'
              }
              tone={resource.data.owner?.isBlocked ? 'strong' : undefined}
            />
            <KeyValue label="Phone" value={restaurant.phone} />
            <KeyValue label="City" value={`${restaurant.city} ${restaurant.pincode || ''}`} />
            <KeyValue label="FSSAI" value={restaurant.fssaiLicenseNumber} />
            <KeyValue label="Status" value={humanise(restaurant.status)} tone="strong" />
            <KeyValue label="Kitchen" value={restaurant.isOpen ? 'Open' : 'Closed'} />
            <KeyValue label="Packaging fee" value={formatMoney(restaurant.packagingFee)} />
          </Card>

          <Card>
            <Text style={s.cardHeading}>Trade</Text>
            <KeyValue label="Orders" value={resource.data.stats.orders} tone="strong" />
            <KeyValue label="Delivered" value={resource.data.stats.delivered} />
            <KeyValue label="Cancelled" value={resource.data.stats.cancelled} />
            <KeyValue label="Revenue billed" value={formatMoney(resource.data.stats.revenue)} tone="money" />
            <KeyValue label="Owed to this partner" value={formatMoney(resource.data.stats.payable)} />
            <Divider />
            <KeyValue label="Rating" value={restaurant.ratingAverage ? `${restaurant.ratingAverage} from ${restaurant.ratingCount}` : 'Not rated yet'} />
          </Card>

          {/* Directly under what they are owed, because those two lines are read
              together: the amount, and where it would go. */}
          <PaidIntoCard destination={resource.data.payoutDestination} />

          <Card>
            <Text style={s.cardHeading}>Documents</Text>
            {(resource.data.documents || []).map((doc: any) => (
              <View key={doc.id} style={s.miniRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.miniTitle}>{humanise(doc.documentType)}</Text>
                  <Text style={s.miniMeta}>{doc.documentNumber || 'No number recorded'}</Text>
                </View>
                <Badge label={doc.status} />
              </View>
            ))}
            {(resource.data.documents || []).length === 0 ? <Text style={s.muted}>No documents on file.</Text> : null}
          </Card>

          {canManage ? (
            <Card>
              <Text style={s.cardHeading}>Manage</Text>
              <Button
                label="Edit details"
                variant="secondary"
                onPress={() => {
                  setName(restaurant.name);
                  setPhone(restaurant.phone);
                  setPackagingFee(String(restaurant.packagingFee ?? ''));
                  setEditing(true);
                }}
              />
              <Divider />
              <Field label="Reason (recorded in the audit log)" value={reason} onChangeText={setReason} placeholder="Hygiene complaint under investigation" />
              <View style={s.actionRow}>
                {restaurant.status === 'ACTIVE' ? (
                  <Button label="Suspend" variant="danger" full loading={busy} onPress={() => setStatus('SUSPENDED')} />
                ) : (
                  <Button label="Activate" variant="success" full loading={busy} onPress={() => setStatus('ACTIVE')} />
                )}
              </View>
              <Text style={s.muted}>
                A restaurant that is not ACTIVE is hidden from customers, cannot take orders, and cannot switch
                itself online.
              </Text>

              <Divider />
              <Text style={s.muted}>
                Blocking locks the owner out of the partner app entirely and takes effect straight away, on the
                session they already have open. Suspending leaves them able to sign in and fix what is wrong.
              </Text>
              <View style={s.actionRow}>
                {resource.data?.owner?.isBlocked ? (
                  <Button
                    label="Unblock owner"
                    variant="success"
                    full
                    loading={busy}
                    onPress={() => setBlocked(false)}
                  />
                ) : (
                  <Button
                    label="Block owner"
                    variant="danger"
                    full
                    loading={busy}
                    onPress={() => setBlocked(true)}
                  />
                )}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {resource.data && editing ? (
        <Card>
          <Text style={s.cardHeading}>Edit restaurant</Text>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Packaging fee (₹)" value={packagingFee} onChangeText={setPackagingFee} keyboardType="numeric" />
          <View style={s.actionRow}>
            <Button label="Back" variant="secondary" full onPress={() => setEditing(false)} />
            <Button label="Save" full loading={busy} onPress={save} />
          </View>
        </Card>
      ) : null}
    </Sheet>
  );
};

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={s.miniStat}>
    <Text style={s.miniStatValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={s.miniStatLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const s = StyleSheet.create({
  tabs: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[4] },
  controls: { paddingHorizontal: tokens.space[5], paddingTop: tokens.space[2] },
  list: { paddingHorizontal: tokens.space[5], paddingBottom: tokens.space[8] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  name: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 3 },
  statRow: {
    flexDirection: 'row',
    marginTop: tokens.space[3],
    paddingTop: tokens.space[3],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: tokens.space[2]
  },
  miniStat: { flex: 1, minWidth: 0 },
  miniStatValue: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  miniStatLabel: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2 },
  activeTrip: { marginTop: tokens.space[3], fontSize: tokens.font.size.xs, color: c.state.info },
  noShowFlag: {
    marginTop: tokens.space[3],
    fontSize: tokens.font.size.xs,
    fontWeight: '700',
    color: c.state.danger
  },
  cardHeading: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.heavy,
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: tokens.space[2]
  },
  actionRow: { flexDirection: 'row', gap: tokens.space[3] },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[3],
    paddingVertical: tokens.space[2],
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  miniTitle: { fontSize: tokens.font.size.sm, color: c.text.primary },
  miniMeta: { fontSize: tokens.font.size.xxs, color: c.text.muted, marginTop: 2 },
  miniValue: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.bold, color: c.brand.amberText },
  muted: { fontSize: tokens.font.size.sm, color: c.text.muted }
});
