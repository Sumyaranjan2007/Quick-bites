/**
 * Cash a rider is carrying: the ceiling, the deposit, and the two numbers.
 *
 * The property this file exists to defend is that the platform always knows how
 * much of its money is in somebody's pocket, and that a rider cannot reduce
 * that figure by saying so.
 *
 * The declaration/confirmation split is the whole design and most of these
 * checks are about it. One number recorded by one party is that party's word,
 * and when a bag is Rs 500 light there is then no way to tell whether it was
 * short when it left or short when it arrived.
 */
import assert from 'node:assert';
import { memoryStore } from '../db/client.ts';
import { ledger, accountFor, resetLedgerForTesting } from '../modules/payments/ledger.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';
import { createVersion, resetConfigsForTesting } from '../modules/payments/pricingConfig.ts';
import {
  cashStanding,
  canTakeCodOrder,
  declareDeposit,
  cancelDeposit,
  confirmDeposit,
  listDeposits,
  cashInHandPaise,
  cashAgeing,
  resetCashDepositsForTesting
} from '../modules/payments/cashDeposits.ts';
import { assertCollectable } from '../modules/payments/doorPayment.ts';

console.log('====================================================');
console.log('  CASH IN HAND, AND GETTING IT BACK                 ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message || err}`);
  }
}

function throws(name: string, code: string, fn: () => unknown): void {
  check(name, () => {
    try {
      fn();
    } catch (err: any) {
      assert.equal(err?.code ?? err?.errorCode, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
      return;
    }
    assert.fail(`expected this to be refused with ${code}, and it was allowed`);
  });
}

const RIDER = 'rdr_cash_1';
const USER = 'usr_rider_cash_1';
const ADMIN = 'usr_admin_1';

function setCash(rupees: number): void {
  memoryStore.riders.set(RIDER, { id: RIDER, fullName: 'Rahul Sharma', codCashInHand: rupees });
}

resetLedgerForTesting();
resetConfigsForTesting();
resetCashDepositsForTesting();
memoryStore.riders.clear();

/* ------------------------------------------------------------------ *
 *  THE CEILING                                                        *
 * ------------------------------------------------------------------ */

check('A rider carrying nothing can take cash orders', () => {
  setCash(0);
  assert.equal(canTakeCodOrder(RIDER), true);
  assert.equal(cashStanding(RIDER).message, null, 'a rider with no cash was warned about cash');
});

check('Below the warning threshold they are not nagged', () => {
  setCash(1000); // Default ceiling 3000, warn at 80% = 2400.
  const standing = cashStanding(RIDER);
  assert.equal(standing.shouldWarn, false);
  assert.equal(standing.canTakeCod, true);
  assert.equal(standing.message, null);
});

check('Approaching the ceiling they are warned, and told the number', () => {
  setCash(2500);
  const standing = cashStanding(RIDER);
  assert.equal(standing.shouldWarn, true);
  assert.equal(standing.canTakeCod, true, 'warned and blocked are not the same thing');
  assert.match(standing.message || '', /2,?500|2500/);
});

check('At the ceiling cash orders stop', () => {
  setCash(3000);
  const standing = cashStanding(RIDER);
  assert.equal(standing.canTakeCod, false);
  assert.match(standing.message || '', /limit/i);
});

check('but they are told online orders still come to them', () => {
  // The ceiling exists to stop cash accumulating, not to stop somebody
  // working. A blocked rider who thinks they have been suspended stops
  // opening the app.
  assert.match(cashStanding(RIDER).message || '', /online/i);
});

check('The ceiling is whatever an administrator set, not a constant', () => {
  createVersion({ codCashCeiling: 10000 }, { userId: ADMIN }, 'Higher ceiling');
  assert.equal(canTakeCodOrder(RIDER), true, 'raising the ceiling did not unblock the rider');
  createVersion({ codCashCeiling: 3000 }, { userId: ADMIN }, 'Back');
  assert.equal(canTakeCodOrder(RIDER), false);
});

/* ------------------------------------------------------------------ *
 *  DECLARING                                                          *
 * ------------------------------------------------------------------ */

check('A rider declares what they are bringing', () => {
  setCash(3000);
  const deposit = declareDeposit({
    riderId: RIDER,
    riderUserId: USER,
    riderName: 'Rahul Sharma',
    amountPaise: toPaise(3000)
  });
  assert.equal(deposit.status, 'DECLARED');
  assert.equal(deposit.declaredPaise, toPaise(3000));
  assert.equal(deposit.cashInHandAtDeclarationPaise, toPaise(3000), 'what they held was not recorded');
});

check('and nothing has moved yet', () => {
  // A declaration is a statement of intent. If it reduced the figure, a rider
  // could clear their balance from a sofa.
  assert.equal(cashInHandPaise(RIDER), toPaise(3000));
  assert.equal(ledger.audit().entryCount, 0);
});

throws('A second declaration while one is open is refused', 'DEPOSIT_ALREADY_DECLARED', () =>
  declareDeposit({ riderId: RIDER, riderUserId: USER, amountPaise: toPaise(100) })
);

check('but it can be withdrawn and re-declared', () => {
  const open = listDeposits({ riderId: RIDER, status: 'DECLARED' })[0];
  cancelDeposit(open.id, RIDER);
  assert.equal(listDeposits({ riderId: RIDER, status: 'DECLARED' }).length, 0);
  declareDeposit({ riderId: RIDER, riderUserId: USER, riderName: 'Rahul Sharma', amountPaise: toPaise(3000) });
});

throws('Declaring more than they are carrying is refused', 'DEPOSIT_EXCEEDS_CASH_IN_HAND', () => {
  const open = listDeposits({ riderId: RIDER, status: 'DECLARED' })[0];
  cancelDeposit(open.id, RIDER);
  return declareDeposit({ riderId: RIDER, riderUserId: USER, amountPaise: toPaise(9999) });
});

throws('Declaring nothing is refused', 'INVALID_DEPOSIT_AMOUNT', () =>
  declareDeposit({ riderId: RIDER, riderUserId: USER, amountPaise: 0 })
);

throws('One rider cannot cancel another rider’s declaration', 'DEPOSIT_NOT_FOUND', () => {
  const mine = declareDeposit({
    riderId: RIDER,
    riderUserId: USER,
    riderName: 'Rahul Sharma',
    amountPaise: toPaise(3000)
  });
  return cancelDeposit(mine.id, 'rdr_somebody_else');
});

/* ------------------------------------------------------------------ *
 *  CONFIRMING — WHERE THE MONEY ACTUALLY MOVES                        *
 * ------------------------------------------------------------------ */

check('An administrator confirms what was counted, and the cash moves', () => {
  const open = listDeposits({ riderId: RIDER, status: 'DECLARED' })[0];
  const { deposit, variancePaise, remainingPaise } = confirmDeposit({
    depositId: open.id,
    receivedPaise: toPaise(3000),
    actorUserId: ADMIN
  });

  assert.equal(deposit.status, 'CONFIRMED');
  assert.equal(variancePaise, 0);
  assert.equal(remainingPaise, 0);
  assert.equal(cashInHandPaise(RIDER), 0, 'the rider still shows as carrying cash they handed in');

  /*
   * The OFFICE receives it, not the bank.
   *
   * This assertion used to read PLATFORM_BANK, and it was right about the code
   * and wrong about the world: handing cash to somebody at a desk does not put
   * it in a bank account, and the ledger said it did from that moment until
   * whenever a person next walked to the branch. Banking it is a separate
   * physical act and is now a separate posting, so the assertion moved with the
   * behaviour rather than being relaxed to accommodate it.
   */
  assert.equal(ledger.balanceOf('PLATFORM_CASH'), toPaise(3000), 'the office did not receive it');
  assert.equal(ledger.balanceOf('PLATFORM_BANK'), 0,
    'the bank received money nobody has taken to a bank');
  assert.equal(ledger.audit().balanced, true);
});

check('and they can take cash orders again', () => {
  assert.equal(canTakeCodOrder(RIDER), true);
});

throws('The same deposit cannot be confirmed twice', 'DEPOSIT_ALREADY_SETTLED', () => {
  const settled = listDeposits({ riderId: RIDER })[0];
  return confirmDeposit({ depositId: settled.id, receivedPaise: toPaise(3000), actorUserId: ADMIN });
});

/* ------------------------------------------------------------------ *
 *  WHEN THE TWO NUMBERS DISAGREE                                      *
 * ------------------------------------------------------------------ */

check('A short bag is refused without an explanation', () => {
  setCash(2000);
  const open = declareDeposit({
    riderId: RIDER,
    riderUserId: USER,
    riderName: 'Rahul Sharma',
    amountPaise: toPaise(2000)
  });

  let refused = false;
  try {
    confirmDeposit({ depositId: open.id, receivedPaise: toPaise(1500), actorUserId: ADMIN });
  } catch (err: any) {
    refused = err?.code === 'VARIANCE_NOTE_REQUIRED';
    // The refusal has to name both figures, or the administrator cannot write
    // a useful note about it.
    assert.match(err.message, /2,?000|2000/);
    assert.match(err.message, /1,?500|1500/);
  }
  assert.ok(refused, 'a short deposit was recorded with no account of why');
});

check('With an explanation it is recorded as a variance, and both numbers are kept', () => {
  const open = listDeposits({ riderId: RIDER, status: 'DECLARED' })[0];
  const { deposit, variancePaise } = confirmDeposit({
    depositId: open.id,
    receivedPaise: toPaise(1500),
    actorUserId: ADMIN,
    varianceNote: 'Rider says one customer paid Rs 500 by UPI directly. Checking the order.'
  });

  assert.equal(deposit.status, 'VARIANCE');
  assert.equal(deposit.declaredPaise, toPaise(2000), 'what the rider said was lost');
  assert.equal(deposit.receivedPaise, toPaise(1500), 'what was counted was lost');
  assert.equal(variancePaise, toPaise(-500));
  assert.ok(deposit.varianceNote);
});

check('and the difference STAYS against the rider', () => {
  // The critical one. Reducing by the declared amount would let a rider write
  // off any sum by claiming they had brought it.
  assert.equal(
    cashInHandPaise(RIDER),
    toPaise(500),
    'the missing Rs 500 was written off rather than left owing'
  );
});

check('so they are still blocked from being paid', () => {
  assert.ok(cashInHandPaise(RIDER) > 0);
});

check('The books still balance after a variance', () => {
  assert.equal(ledger.audit().balanced, true);
});

throws('Receiving more than the rider is carrying is refused, not booked', 'RECEIVED_EXCEEDS_CASH_IN_HAND', () => {
  const open = declareDeposit({
    riderId: RIDER,
    riderUserId: USER,
    riderName: 'Rahul Sharma',
    amountPaise: toPaise(500)
  });
  // A credit is never created by a miscount. Somebody handing over more than
  // the platform thinks they hold is a discrepancy to investigate.
  return confirmDeposit({
    depositId: open.id,
    receivedPaise: toPaise(5000),
    actorUserId: ADMIN,
    varianceNote: 'Counted more than expected'
  });
});

/* ------------------------------------------------------------------ *
 *  THE AGEING REPORT                                                  *
 * ------------------------------------------------------------------ */

check('Riders carrying cash are listed, worst first', () => {
  memoryStore.riders.set('rdr_cash_2', { id: 'rdr_cash_2', fullName: 'Priya Verma', codCashInHand: 4000 });
  memoryStore.riders.set('rdr_cash_3', { id: 'rdr_cash_3', fullName: 'Arun Nair', codCashInHand: 0 });

  const ageing = cashAgeing();
  assert.equal(ageing[0].riderId, 'rdr_cash_2', 'the worst offender is not first');
  assert.equal(ageing[0].overCeiling, true);
  assert.ok(!ageing.some(r => r.riderId === 'rdr_cash_3'), 'a rider carrying nothing is cluttering the list');
});

check('and an open declaration is shown against them', () => {
  const row = cashAgeing().find(r => r.riderId === RIDER);
  assert.ok(row);
  assert.equal(row!.pendingDeclarationPaise, toPaise(500), 'an open declaration is not visible to operations');
});

/* ------------------------------------------------------------------ *
 *  COLLECTING ONLINE AT THE DOOR                                      *
 * ------------------------------------------------------------------ */

const cashOrder = (overrides: Record<string, any> = {}) =>
  ({
    id: 'ord_door_1',
    orderNumber: 'QB-300001',
    status: 'OUT_FOR_DELIVERY',
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH_ON_DELIVERY',
    bill: { totalAmount: 480 },
    ...overrides
  }) as any;

check('A cash order out for delivery can be collected online', () => {
  assertCollectable(cashOrder());
});

throws('An order already paid cannot be collected again', 'ALREADY_PAID', () =>
  assertCollectable(cashOrder({ paymentStatus: 'PAID' }))
);

throws('An order that was not cash on delivery is refused', 'NOT_A_CASH_ORDER', () =>
  assertCollectable(cashOrder({ paymentMethod: 'RAZORPAY_SANDBOX' }))
);

throws('A cancelled order cannot be collected on', 'ORDER_CANCELLED', () =>
  assertCollectable(cashOrder({ status: 'CANCELLED' }))
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
