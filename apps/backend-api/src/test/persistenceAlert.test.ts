/**
 * A write the backstop had to save reaches the owner, once, by name.
 *
 * S1 saves only documents set() marked. The 10-minute full-diff backstop saves
 * anything changed in place without set(), and until now said so only in a log
 * line (DIRTY_MISS) nobody reads. It now joins the payments-health message: one
 * push naming the collection, repeated only when the set of findings changes.
 *
 * Driven through the real flush path: flushStore('full') → saveStoreToDatabase.
 * With no database attached it reports what it finds and keeps the marks, which
 * is what lets this run without Postgres.
 *
 * Run: node --experimental-strip-types src/test/persistenceAlert.test.ts
 */
import assert from 'node:assert/strict';
import { seedDatabase } from '../db/seed.ts';
import { memoryStore, setPersistenceBackend, flushStore } from '../db/client.ts';
import { saveStoreToDatabase, markEverythingPersistedForTesting } from '../db/postgresStore.ts';
import { fcmDispatcher } from '../notifications/fcmDispatcher.ts';
import {
  notifyAdminsPaymentsHealth,
  resetPaymentsHealthNotificationForTesting,
  resetAdminNotificationDedupeForTesting,
  setPersistenceClockForTesting
} from '../notifications/adminNotifier.ts';

console.log('====================================================');
console.log('  A WRITE NOBODY MARKED REACHES THE OWNER, ONCE     ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 600)}`);
  }
}

const OWNER = 'usr_admin_01';
const pushes: Array<{ title: string; body: string }> = [];
(fcmDispatcher as any).sendPushNotification = async (p: any) => {
  if (p.userId === OWNER && p.data?.type === 'ADMIN_PAYMENTS_HEALTH') pushes.push({ title: p.title, body: p.body });
  return { ...p, sentAt: new Date().toISOString() };
};
const settle = () => new Promise(r => setTimeout(r, 50));
async function backstop() {
  await flushStore('full');
  await settle();
}

try {
  await seedDatabase();
  setPersistenceBackend({ save: saveStoreToDatabase });
  resetAdminNotificationDedupeForTesting();
  resetPaymentsHealthNotificationForTesting();
  markEverythingPersistedForTesting();

  const orderId = [...memoryStore.orders.keys()][0] ?? (() => {
    memoryStore.orders.set('ord_persist_1', { id: 'ord_persist_1', orderNumber: 'QB-P1', items: [], status: 'DELIVERED' } as any);
    markEverythingPersistedForTesting();
    return 'ord_persist_1';
  })();
  const riderId = [...memoryStore.riders.keys()][0];

  await backstop();
  it('Control: a backstop that finds nothing unmarked sends nothing', () => {
    assert.equal(pushes.length, 0, JSON.stringify(pushes));
  });

  // A writer that forgot its set().
  (memoryStore.orders.get(orderId) as any).note = 'changed in place, never marked';
  await backstop();
  it('An unmarked change found by the backstop sends ONE message, naming the collection', () => {
    assert.equal(pushes.length, 1, JSON.stringify(pushes));
    assert.match(pushes[0].body, /orders/);
    assert.match(pushes[0].body, /backstop/);
  });

  await backstop();
  it('and the same miss found again sends nothing more', () => {
    assert.equal(pushes.length, 1, JSON.stringify(pushes));
  });

  (memoryStore.riders.get(riderId) as any).note = 'also changed in place';
  await backstop();
  it('A DIFFERENT set of misses is news: one more message, naming both', () => {
    assert.equal(pushes.length, 2, JSON.stringify(pushes));
    assert.match(pushes[1].body, /orders/);
    assert.match(pushes[1].body, /riders/);
  });

  // The payments sweep runs meanwhile with a finding of its own.
  await notifyAdminsPaymentsHealth({ alerts: ['The ledger does not balance.'], worst: 'The ledger does not balance.' });
  it('A payments finding joins the SAME message rather than sending its own', () => {
    assert.equal(pushes.length, 3, JSON.stringify(pushes));
    assert.match(pushes[2].title, /\(2\)/);
    assert.match(pushes[2].body, /ledger/);
  });
  await backstop();
  it('and the backstop finding the same misses again does not repeat it', () => {
    assert.equal(pushes.length, 3, JSON.stringify(pushes));
  });

  // Fixed: the documents are saved and nothing is unmarked any more.
  await notifyAdminsPaymentsHealth({ alerts: [], worst: '' });
  markEverythingPersistedForTesting();
  await backstop();
  // Cleared means cleared: the next payments message does not carry it.
  const beforePayout = pushes.length;
  await notifyAdminsPaymentsHealth({ alerts: ['A payout has been queued for two days.'], worst: 'A payout has been queued for two days.' });
  it('Once a clean save clears it, a later payments message no longer mentions it', () => {
    assert.equal(pushes.length, beforePayout + 1, JSON.stringify(pushes.slice(beforePayout)));
    const last = pushes[pushes.length - 1];
    // One finding, not two: the body shows only the worst and counts the rest,
    // so a stale backstop finding would show as "(2)" and "And 1 more".
    assert.doesNotMatch(last.title, /\(\d+\)/, last.title);
    assert.doesNotMatch(last.body, /orders|riders|backstop|more\./, last.body);
  });
  await notifyAdminsPaymentsHealth({ alerts: [], worst: '' });

  const beforeRecurrence = pushes.length;
  /*
   * Full saves run on every money request, so a writer that skips set() goes
   * miss → clean → miss all day. The same collections coming back within a day
   * are the SAME defect, not news.
   */
  (memoryStore.orders.get(orderId) as any).note = 'changed in place again';
  (memoryStore.riders.get(riderId) as any).note = 'and again';
  await backstop();
  it('The same collections back within 24 hours, after clearing, send nothing', () => {
    assert.equal(pushes.length, beforeRecurrence, JSON.stringify(pushes.slice(beforeRecurrence)));
  });
  await notifyAdminsPaymentsHealth({ alerts: [], worst: '' });
  it('and an empty payments sweep does not announce them through the back door', () => {
    assert.equal(pushes.length, beforeRecurrence, JSON.stringify(pushes.slice(beforeRecurrence)));
  });

  // A day later, still happening: worth saying again.
  setPersistenceClockForTesting(() => Date.now() + 25 * 60 * 60_000);
  await backstop();
  it('The same collections a day later are announced again, by name', () => {
    assert.equal(pushes.length, beforeRecurrence + 1, JSON.stringify(pushes.slice(beforeRecurrence)));
    assert.match(pushes[pushes.length - 1].body, /orders, riders/);
    assert.match(pushes[pushes.length - 1].body, /tell Claude/);
  });
} catch (err: any) {
  failed++;
  console.log(`[FAIL] The suite could not complete: ${err?.stack || err}`);
} finally {
  setPersistenceBackend(null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
