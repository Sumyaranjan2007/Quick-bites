/**
 * Deploy overlap (master plan A4, devops F-6): what the outgoing server wrote
 * after the new one loaded is adopted, unless the new one changed the same
 * document itself (then it keeps its own, and the conflict is logged).
 */
import assert from 'node:assert/strict';
import { memoryStore } from '../db/client.ts';
import { adoptRowsFromOtherServer, markEverythingPersistedForTesting, computeChanges } from '../db/postgresStore.ts';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 400)}`);
  }
}

const orders = memoryStore.orders as Map<string, any>;
orders.set('ord_a', { id: 'ord_a', status: 'ORDER_PLACED' });
orders.set('ord_b', { id: 'ord_b', status: 'ORDER_PLACED' });
markEverythingPersistedForTesting(); // as loaded from the database at boot

// This server changes ord_b; the old one, after our load, changed ord_a and ord_b and placed ord_c.
orders.set('ord_b', { id: 'ord_b', status: 'CANCELLED' });
const result = adoptRowsFromOtherServer([
  { collection: 'orders', id: 'ord_a', data: { id: 'ord_a', status: 'ACCEPTED' } },
  { collection: 'orders', id: 'ord_b', data: { id: 'ord_b', status: 'ACCEPTED' } },
  { collection: 'orders', id: 'ord_c', data: { id: 'ord_c', status: 'ORDER_PLACED' } },
  { collection: 'noSuchCollection', id: 'x', data: {} }
]);

it("A document only the old server changed is taken (its order is accepted here too)", () =>
  assert.equal(orders.get('ord_a').status, 'ACCEPTED'));
it('A document the old server created after our load appears here', () => assert.ok(orders.has('ord_c')));
it('A document both changed keeps this server’s version, counted as a conflict', () => {
  assert.equal(orders.get('ord_b').status, 'CANCELLED');
  assert.deepEqual(result, { adopted: 2, conflicts: 1 });
});
it('What was adopted is not written back (it is already in the database); ours still is', () => {
  const ids = computeChanges('full').upserts.map(u => u.id);
  assert.ok(!ids.includes('ord_a') && !ids.includes('ord_c'), ids.join(','));
  assert.ok(ids.includes('ord_b'), ids.join(','));
});
it('Our own saved rows coming back are not counted', () =>
  assert.deepEqual(adoptRowsFromOtherServer([{ collection: 'orders', id: 'ord_a', data: { id: 'ord_a', status: 'ACCEPTED' } }]), { adopted: 0, conflicts: 0 }));

console.log(`\n  ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 100);
