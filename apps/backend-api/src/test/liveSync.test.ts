/**
 * Real time everywhere (round 3, item 1): a successful write tells exactly the
 * accounts it touched, plus every Operations console, to reload — and nobody else.
 */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { config } from '../config/env.ts';
import { initSocketServer, closeSocketServer } from '../sockets/socketServer.ts';
import { affectedUsers, topicOf } from '../sockets/liveSync.ts';

const PORT = 5277;
const URL = `http://127.0.0.1:${PORT}`;
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
const tokenFor = (sub: string, role: string) => jwt.sign({ sub, role }, config.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });

await seedDatabase();
const server = createApp().listen(PORT, '127.0.0.1');
initSocketServer(server);
await new Promise(r => setTimeout(r, 300));

check('a kitchen id reaches its owner; an unknown id reaches nobody', () => {
  assert.deepEqual(affectedUsers(['rst_bbh_01']), ['usr_partner_01']);
  assert.deepEqual(affectedUsers(['nothing_here']), []);
});
check('topics name what changed', () => {
  assert.equal(topicOf('/api/v1/admin/restaurants/rst_bbh_01'), 'admin/restaurants');
  assert.equal(topicOf('/api/orders/ord_1/status'), 'orders');
});

const connect = (sub: string, role: string) =>
  new Promise<{ socket: Socket; heard: any[] }>(resolve => {
    const socket = ioClient(URL, { auth: { token: tokenFor(sub, role) }, transports: ['websocket'] });
    const heard: any[] = [];
    socket.on('sync', p => heard.push(p));
    socket.on('connect', () => resolve({ socket, heard }));
  });

const partner = await connect('usr_partner_01', 'restaurant_owner');
const customer = await connect('usr_customer_01', 'customer');
const admin = await connect('usr_admin_01', 'admin');

const res = await fetch(`${URL}/api/admin/restaurants/rst_bbh_01`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor('usr_admin_01', 'admin')}` },
  body: JSON.stringify({ acceptsCash: true })
});
await new Promise(r => setTimeout(r, 400));

check('the admin write succeeded', () => assert.equal(res.status, 200));
check('the kitchen owner is told to reload', () => assert.equal(partner.heard.at(-1)?.topic, 'admin/restaurants'));
check('every Operations console is told', () => assert.equal(admin.heard.at(-1)?.topic, 'admin/restaurants'));
check('an unrelated customer hears nothing', () => assert.equal(customer.heard.length, 0));

const refused = await fetch(`${URL}/api/admin/restaurants/rst_bbh_01`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor('usr_customer_01', 'customer')}` },
  body: JSON.stringify({ acceptsCash: false })
});
const before = partner.heard.length;
await new Promise(r => setTimeout(r, 300));
check('a refused write tells nobody', () => {
  assert.ok(refused.status >= 400);
  assert.equal(partner.heard.length, before);
});

for (const c of [partner, customer, admin]) c.socket.disconnect();
await closeSocketServer();
server.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL LIVE SYNC CHECKS PASSED');
process.exit(failed ? 1 : 0);
