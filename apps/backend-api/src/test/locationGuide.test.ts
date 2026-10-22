/**
 * The first-time location guide (owner, 22 Oct 2026, round 6): only a signed-in
 * customer with no saved address sees it, once per phone; it never flashes before
 * the addresses are read, and an existing customer never sees it.
 */
import assert from 'node:assert/strict';
import { locationGuideStep } from '../../../customer-mobile/src/lib/locationGuide.ts';

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
const newCustomer = { signedIn: true, addressesLoaded: true, savedCount: 0, picked: false, guideDone: false, justSaved: false };

check('A new signed-in customer starts at "find you"', () => assert.equal(locationGuideStep(newCustomer), 'find'));
check('A spot picked but not saved moves to "save"', () => assert.equal(locationGuideStep({ ...newCustomer, picked: true }), 'save'));
check('Just saved shows "done" for a moment', () => assert.equal(locationGuideStep({ ...newCustomer, picked: true, justSaved: true }), 'done'));
check('An existing customer with an address never sees it', () => assert.equal(locationGuideStep({ ...newCustomer, savedCount: 1 }), 'hidden'));
check('Never again once finished on this phone, even with no address', () =>
  assert.equal(locationGuideStep({ ...newCustomer, guideDone: true }), 'hidden'));
check('Not before the addresses are read (offline is not "none")', () =>
  assert.equal(locationGuideStep({ ...newCustomer, addressesLoaded: false }), 'hidden'));
check('A guest is not guided (they keep the browse block)', () => assert.equal(locationGuideStep({ ...newCustomer, signedIn: false }), 'hidden'));

console.log(failed ? `\n${failed} FAILED` : '\nALL LOCATION GUIDE CHECKS PASSED');
process.exit(failed ? 1 : 0);
