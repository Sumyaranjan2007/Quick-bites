/**
 * Live help chat (round 6, owner 22 Oct 2026): a chat stays open until it is
 * solved, one live chat per person per app, "Seen" both ways, Operations told when
 * the person writes again, the person told in the right app when it is solved,
 * no message floods, photos only as attachments. Plus a temporary password that
 * expires (review C1), and the app files that make the chat persistent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore } from '../db/client.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';
import { supportRepository } from '../db/repositories/supportRepository.ts';
import { userRepository } from '../db/repositories/userRepository.ts';
import { fcmDispatcher, forApp } from '../notifications/fcmDispatcher.ts';

const PORT = 5297;
const API = `http://127.0.0.1:${PORT}/api`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
};
async function api(p: string, init: any = {}, token?: string) {
  const res = await fetch(`${API}${p}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const login = async (email: string) =>
  (await api('/auth/login', { method: 'POST', body: { email, password: 'pass123' } })).json?.data?.token as string;

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));
resetAuthRateLimit();
const pushes: any[] = [];
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  pushes.push(p);
  return { ...p, sentAt: new Date().toISOString() };
};

try {
  const customer = await login('customer@quickbite.app');
  const partner = await login('partner@quickbite.app');
  const admin = await login('admin@quickbite.app');
  const raise = (token: string, message: string, extra: any = {}) =>
    api('/support/tickets', { method: 'POST', body: { subject: 'Help with an order', category: 'OTHER', message, ...extra } }, token);

  console.log('-- The chat stays open after Operations replies');
  const first = (await raise(customer, 'My food has not arrived yet, please check.')).json?.data?.ticket;
  const replied = await api(`/admin/support/tickets/${first.id}/reply`, { method: 'POST', body: { body: 'Looking into it now.' } }, admin);
  const seenByMe = (await api(`/support/tickets/${first.id}`, {}, customer)).json?.data?.ticket;
  check('A staff reply keeps the chat in progress, never solved', () => {
    assert.equal(replied.status, 200);
    assert.equal(seenByMe.status, 'IN_PROGRESS');
    assert.equal(seenByMe.replies.length, 1);
  });
  check('...and the person sees it as unread, written by staff', () => {
    assert.equal(seenByMe.lastMessageBy, 'STAFF');
    assert.equal(seenByMe.unreadForUser, true);
  });

  console.log('\n-- One live chat per person per app');
  const again = await raise(customer, 'Still waiting for my order, it is very late.');
  check('A second request while one is open goes into the same chat', () => {
    assert.equal(again.status, 200, JSON.stringify(again.json).slice(0, 200));
    assert.equal(again.json?.data?.ticket?.id, first.id);
    assert.equal(again.json?.data?.reused, true);
    assert.equal(again.json?.data?.ticket?.replies.at(-1)?.body, 'Still waiting for my order, it is very late.');
  });
  const toStaffFirst = pushes.filter(p => p.title === 'New message in a help chat');
  const doubleTap = await raise(customer, 'Still waiting for my order, it is very late.');
  check('A double tap does not add the same words twice', () =>
    assert.equal(doubleTap.json?.data?.ticket?.replies.length, again.json?.data?.ticket?.replies.length));

  // The same person's chat in another app (here: a customer-app chat of the partner) is a separate chat.
  const partnerUser = (Array.from(memoryStore.users.values()) as any[]).find(u => u.email === 'partner@quickbite.app');
  const customerAppChat = await supportRepository.create({
    raisedByUserId: partnerUser.id,
    raisedByRole: 'customer' as any,
    raisedByName: partnerUser.fullName,
    subject: 'A food order',
    category: 'ORDER',
    message: 'Asked from the Customer app.',
    attachments: []
  } as any);
  const partnerChat = (await raise(partner, 'A question about my payout this week.')).json?.data?.ticket;
  check("A partner's Partner-app chat is not their Customer-app chat", () => {
    assert.ok(partnerChat?.id);
    assert.notEqual(partnerChat.id, customerAppChat.id);
  });
  // Builds 42-47 sent the help topic as the order (round 7 B1): "That order could not be found" for every partner.
  const topicAsOrder = await raise(partner, 'I need help with: Payouts. When am I paid?', { helpTopics: ['PAYOUTS'], orderId: 'PAYOUTS' });
  const notMine = await raise(partner, 'About this order please.', { orderId: 'ord_somebody_else_entirely' });
  check('A help topic sent as the order is ignored, not refused; a real unknown order still is', () => {
    assert.equal(topicAsOrder.status, 200, JSON.stringify(topicAsOrder.json).slice(0, 200));
    assert.equal(notMine.json?.error?.code, 'ORDER_NOT_FOUND');
  });

  console.log('\n-- Seen, both ways');
  const iRead = await api(`/support/tickets/${first.id}/read`, { method: 'POST' }, customer);
  const stranger = await api(`/support/tickets/${partnerChat.id}/read`, { method: 'POST' }, customer);
  check('The person marks the chat read; someone else cannot', () => {
    assert.equal(iRead.json?.data?.ticket?.unreadForUser, false);
    assert.equal(stranger.status, 404);
  });
  const queue = (await api('/admin/support/tickets?status=ACTIVE', {}, admin)).json?.data;
  check('Operations sees it unread, at the top, with a preview and the kitchen of a partner', () => {
    assert.equal(queue?.tickets?.[0]?.unreadForStaff, true);
    assert.ok(queue.tickets.every((t: any) => ['OPEN', 'IN_PROGRESS'].includes(t.status)));
    assert.ok(queue.counts.unread >= 2);
    assert.equal(queue.tickets.find((t: any) => t.id === first.id)?.preview, 'Still waiting for my order, it is very late.');
    assert.ok(queue.tickets.find((t: any) => t.id === partnerChat.id)?.kitchens?.length > 0);
  });
  const staffRead = await api(`/admin/support/tickets/${first.id}/read`, { method: 'POST' }, admin);
  const view = (await api(`/admin/support/tickets/${partnerChat.id}`, {}, admin)).json?.data;
  check('Operations marking it read clears the dot; the detail names the People record', () => {
    assert.equal(staffRead.json?.data?.ticket?.unreadForStaff, false);
    assert.equal(view?.raiser?.record?.kind, 'restaurant');
  });

  console.log('\n-- Operations hears the person write again, once per chat per ten minutes');
  pushes.length = 0;
  await api(`/support/tickets/${first.id}/reply`, { method: 'POST', body: { body: 'Hello, any news?' } }, customer);
  await api(`/support/tickets/${first.id}/reply`, { method: 'POST', body: { body: 'Hello again?' } }, customer);
  const toStaff = pushes.filter(p => p.title === 'New message in a help chat');
  check('A message from the person reaches Operations; more within ten minutes add no second push', () => {
    assert.ok(toStaffFirst.length >= 1, 'no push to Operations');
    assert.equal(toStaff.length, 0, 'Operations was pushed again for the same chat');
  });

  console.log('\n-- Solved by Operations: the person is told in the app the chat is in');
  pushes.length = 0;
  await api(`/admin/support/tickets/${partnerChat.id}/reply`, { method: 'POST', body: { body: 'Paid this morning.' } }, admin);
  await api(`/admin/support/tickets/${partnerChat.id}/status`, { method: 'POST', body: { status: 'RESOLVED' } }, admin);
  const reply = pushes.find(p => p.data?.type === 'SUPPORT_REPLY');
  const solved = pushes.find(p => p.data?.type === 'SUPPORT_RESOLVED');
  check('Reply and "solved" pushes name the Partner app', () => {
    assert.equal(reply?.appRole, 'restaurant_owner');
    assert.equal(solved?.appRole, 'restaurant_owner');
    assert.equal(solved?.userId, partnerUser.id);
  });
  const devices = [{ role: 'customer', token: 'a' }, { role: 'restaurant_owner', token: 'b' }];
  check('...so only that app rings on a phone with both apps', () =>
    assert.deepEqual(forApp(devices, undefined, 'restaurant_owner').map(d => d.token), ['b']));

  console.log('\n-- Limits');
  await api(`/admin/support/tickets/${partnerChat.id}/status`, { method: 'POST', body: { status: 'CLOSED' } }, admin);
  const closed = await api(`/support/tickets/${partnerChat.id}/reply`, { method: 'POST', body: { body: 'one more thing' } }, partner);
  check('A closed chat takes no more messages', () => assert.equal(closed.status, 409));
  resetRequestRateLimit();
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await api(`/support/tickets/${first.id}/reply`, { method: 'POST', body: { body: `message ${i}` } }, customer)).status;
  check('More than 20 messages in a minute are refused', () => assert.equal(last, 429));
  const linked = await raise(partner, 'Here is a picture of the problem.', { attachments: ['https://example.com/x.png'] });
  check('An attachment that is a link is refused (only photos)', () => assert.equal(linked.status, 400));

  console.log('\n-- A temporary password stops working after 7 days (review C1)');
  await userRepository.update(partnerUser.id, { passwordTemporaryUntil: new Date(Date.now() - 1000).toISOString() } as any);
  resetAuthRateLimit();
  const expired = await api('/auth/login', { method: 'POST', body: { email: 'partner@quickbite.app', password: 'pass123' } });
  const stored = memoryStore.users.get(partnerUser.id) as any;
  await userRepository.update(partnerUser.id, { passwordHash: stored.passwordHash });
  const afterOwn = await api('/auth/login', { method: 'POST', body: { email: 'partner@quickbite.app', password: 'pass123' } });
  check('Expired temporary password refused; a password the person sets works', () => {
    assert.equal(expired.status, 401);
    assert.match(JSON.stringify(expired.json), /Forgot password/);
    assert.equal(afterOwn.status, 200);
  });

  console.log('\n-- The app chat keeps an open chat until it is solved');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const copies = ['customer-mobile', 'restaurant-mobile', 'delivery-mobile'].map(app =>
    fs.readFileSync(path.join(ROOT, 'apps', app, 'src/components/SupportChat.tsx'), 'utf8'));
  check('The three SupportChat copies are identical', () => assert.ok(copies.every(c => c === copies[0])));
  const code = strip(copies[0]);
  check('No age limit on resuming a chat; it ends only on RESOLVED or CLOSED; a failed load is not "no chats"', () => {
    assert.ok(!/RESUME_MS/.test(code));
    assert.ok(/DONE\.includes\(/.test(code));
    assert.ok(!/tickets\(\)\.catch\(\(\) => \[\]/.test(code));
  });
  check('"Talk to a person" sends the order Help was opened about, never the help topic (round 7 B1)', () => {
    assert.ok(!/const about = asked/.test(code));
    assert.ok(/const topic = asked\[asked\.length - 1\]/.test(code));
  });

  console.log('\n-- Notifications ask after the channels exist; one permissions card; zoom stops following');
  const read = (rel: string) => strip(fs.readFileSync(path.join(ROOT, 'apps', rel), 'utf8'));
  for (const app of ['restaurant-mobile', 'delivery-mobile']) {
    const alert = read(`${app}/src/lib/orderAlert.ts`);
    check(`${app}: the channels are created before the permission is asked`, () => {
      const channel = alert.indexOf('setNotificationChannelAsync(');
      const ask = alert.indexOf('requestPermissionsAsync(');
      assert.ok(channel > 0 && ask > channel, 'asked before any channel exists');
    });
  }
  const riderApp = read('delivery-mobile/App.tsx');
  check('Rider registers for pushes only after the channels exist', () => {
    // Sign-in and start-up; the permissions card's call runs later, when notifications were just allowed.
    const bare = riderApp
      .replace(/prepareOrderAlerts\(\)\.then\(\(\) => registerForPush\(/g, '')
      .replace(/onNotificationsAllowed=\{.*$/gm, '');
    assert.ok(!/(?<!un)registerForPush\(/.test(bare), 'a registerForPush call runs before the channels');
  });
  const cards = ['customer-mobile', 'restaurant-mobile', 'delivery-mobile', 'admin-mobile'].map(app =>
    fs.readFileSync(path.join(ROOT, 'apps', app, 'src/components/AppPermissions.tsx'), 'utf8'));
  check('The permissions card is the same file in all four apps', () => assert.ok(cards.every(card => card === cards[0])));
  const maps = ['customer-mobile', 'restaurant-mobile', 'delivery-mobile'].map(app =>
    fs.readFileSync(path.join(ROOT, 'apps', app, 'src/lib/nativeMap.ts'), 'utf8'));
  check('The live tracking map stops following on any gesture (pinch, double-tap), not only a drag', () => {
    assert.ok(maps.every(m => m === maps[0]), 'nativeMap copies differ');
    assert.ok(/onRegionChangeStart[\s\S]{0,120}isGesture/.test(strip(maps[0])));
    assert.ok(/onUserMove=\{onDrag\}/.test(read('customer-mobile/src/components/LiveOrderMap.tsx')));
  });
} finally {
  await new Promise(r => server.close(() => r(null)));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL LIVE HELP CHAT CHECKS PASSED');
setTimeout(() => process.exit(failed ? 1 : 0), 100);
