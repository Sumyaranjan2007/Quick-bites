/**
 * Every call each phone app makes, sent to a real server as that app's user.
 * Not a gate suite: it writes a report of what each call answered, so a person
 * can see which buttons reach a working route and which are refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { appCalls, mountedRoutes, normalisePath } from './helpers/routeContract.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import { razorpayAdapter } from '../modules/payments/razorpayAdapter.ts';

const PORT = 5299;
const API = `http://127.0.0.1:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const appsDir = path.resolve(here, '../../..');

await seedDatabase();
const app = createApp();
const server = app.listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 400));
(fcmDispatcher as any).sendPushNotification = async (p: any) => ({ ...p, sentAt: new Date().toISOString() });
(razorpayAdapter as any).refund = async (id: string) => ({ id: `rfnd_${id}`, status: 'processed' });

async function call(method: string, p: string, token?: string, body?: any) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
    ...(method !== 'GET' && method !== 'DELETE' ? { body: JSON.stringify(body ?? {}) } : {})
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, code: json?.error?.code || '', message: json?.error?.message || '' };
}
const login = async (email: string) =>
  (await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pass123' }) })).json() as any)?.data?.token as string;

const tokens: Record<string, string> = {
  'customer-mobile': await login('customer@quickbite.app'),
  'restaurant-mobile': await login('partner@quickbite.app'),
  'delivery-mobile': await login('rider@quickbite.app'),
  'admin-mobile': await login('admin@quickbite.app')
};
const staff: Record<string, string> = {
  ops: await login('ops@quickbite.app'),
  finance: await login('finance@quickbite.app'),
  support: await login('support@quickbite.app')
};

// A real order for :param holes, placed and left live.
const placed: any = await (await fetch(`${API}/api/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens['customer-mobile']}` },
  body: JSON.stringify({ restaurantId: 'rst_bbh_01', deliveryAddressId: 'addr_sample_01', items: [{ dishId: 'dish_ck_biryani', quantity: 1, selectedOptions: [] }], paymentMethod: 'CASH_ON_DELIVERY', idempotencyKey: crypto.randomUUID() })
})).json();
const orderId = placed?.data?.order?.id ?? placed?.data?.id;
const riderId = (Array.from(memoryStore.riders.values()) as any[])[0]?.id;
const customerId = 'usr_customer_01';

/** Fills :param holes with real ids by what the segment before names. */
function fill(p: string): string {
  const parts = p.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== ':param') continue;
    const prev = parts[i - 1] || '';
    parts[i] =
      /restaurant/.test(prev) ? 'rst_bbh_01'
      : /order/.test(prev) ? orderId
      : /rider|driver/.test(prev) ? riderId
      : /customer|user/.test(prev) ? customerId
      : /profile/.test(prev) ? tokenUser
      : 'probe_missing_id';
  }
  return parts.join('/');
}
let tokenUser = '';

const mounted = mountedRoutes(app);
const rows: any[] = [];
for (const appName of ['customer-mobile', 'restaurant-mobile', 'delivery-mobile', 'admin-mobile']) {
  const { calls } = appCalls(appName, path.join(appsDir, appName, 'src'));
  const extra = fs.existsSync(path.join(appsDir, appName, 'App.tsx')) ? appCalls(appName, path.join(appsDir, appName)).calls.filter(c => c.file === 'App.tsx') : [];
  const seen = new Set<string>();
  tokenUser = appName === 'delivery-mobile' ? 'usr_rider_01' : appName === 'restaurant-mobile' ? 'usr_partner_01' : customerId;
  for (const c of [...calls, ...extra]) {
    const withApi = c.path.startsWith('/api') ? c.path : `/api${c.path}`;
    const key = `${c.method} ${normalisePath(withApi)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Signing out would end the probe's own session.
    if (/logout|\/auth\/me$/.test(withApi) && (c.method === 'DELETE' || /logout/.test(withApi))) {
      rows.push({ app: appName, file: c.file, method: c.method, path: withApi, status: 'skipped', code: 'SIGN_OUT' });
      continue;
    }
    const target = fill(normalisePath(withApi)).replace(/\?.*$/, '');
    const r = await call(c.method, target, tokens[appName]);
    const row: any = { app: appName, file: c.file, method: c.method, path: withApi, status: r.status, code: r.code, message: r.message };
    if (appName === 'admin-mobile' && (r.status === 200 || r.status === 201 || r.status === 400 || r.status === 404 || r.status === 409)) {
      for (const [role, t] of Object.entries(staff)) row[role] = (await call(c.method, target, t)).status;
    }
    rows.push(row);
  }
}
fs.writeFileSync(process.env.PROBE_OUT || '/tmp/probe.json', JSON.stringify({ rows, mounted: mounted.length }, null, 2));
console.log(`probed ${rows.length} calls`);
server.close();
process.exit(0);
