/**
 * NO ROUTE MAY BE SHADOWED BY ANOTHER.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * `POST /api/admin/payouts` was registered twice, in two different files, by
 * two different payout systems. Express takes the first match, so the one
 * registered in the router mounted earlier answered every request and the
 * other was unreachable code that nothing could call.
 *
 * The two did not even agree on their input. The winner required `riderId`;
 * the loser — the ledger-backed system with maker-checker, the payout cap and
 * the payout rails — expected `ownerType` and `ownerId`, which is what both
 * the admin app's Payouts screen and the web console actually send. So
 * drafting a payout failed validation every time, on both, while the code that
 * would have worked sat one line further down the stack.
 *
 * Nothing caught it, and it is worth being precise about why, because every
 * check that should have was passing:
 *
 *   - The route tests called the payout MODULE directly, so they exercised the
 *     shadowed implementation and proved it correct. It was correct. It was
 *     also unreachable.
 *   - The contract test resolves each app's API calls against the route table
 *     and found `POST /admin/payouts` present. It was present. Twice.
 *   - Every suite was green, on a defect that made the platform unable to pay
 *     anybody from its main payouts screen.
 *
 * A duplicate registration cannot be seen by reading either file, because
 * neither file is wrong on its own. It is only visible in the assembled table,
 * which is exactly what this asserts.
 *
 * Run through the real app, not a hand-maintained list of routes, so a route
 * added tomorrow is covered without anybody remembering to add it here.
 */
import assert from 'node:assert';
import { createApp } from '../app.ts';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    const result: any = fn();
    /*
     * An async body handed to this synchronous runner would return a promise
     * nothing awaits, print PASS immediately, and its assertions could never
     * fail. That happened once on this project -- a check verifying our markup
     * never reaches a partner passed, and went on passing when the leak was
     * deliberately introduced.
     *
     * Detected rather than documented: a note saying "do not write these async"
     * is advisory, and this is enforceable.
     */
    if (result && typeof result.then === 'function') {
      failed++;
      console.log(
        `[FAIL] ${name}: this check is async and this runner does not await, so its ` +
          'assertions could never fail. Await outside and assert synchronously.'
      );
      return;
    }
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed++;
    console.log(`[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Registration {
  method: string;
  path: string;
}

/**
 * The prefix a mounted router sits behind.
 *
 * Express does not keep the mount path on the layer, only the regexp it
 * compiled from it, so it has to be read back out. Without this every `/me` in
 * the application looks like the same route — `/api/auth/me`, `/api/cash/me`
 * and `/api/payee-accounts/me` would all collapse to `/me` and report as
 * shadowing each other.
 *
 * That matters more than it sounds. A detector that flags twelve innocent
 * routes is one somebody switches off, and then it is not protecting the one
 * real duplicate either.
 */
function mountPrefix(layer: any): string {
  const re = layer?.regexp;
  if (!re || re.fast_slash) return '';
  const source = String(re.source);
  const match = source.match(/^\^\\\/((?:[\w\-.~%]|\\.)*)\\\/\?/);
  if (!match) return '';
  return '/' + match[1].replace(/\\(.)/g, '$1');
}

/** Every registered route in the assembled application, at its full path. */
function collect(app: any): Registration[] {
  const found: Registration[] = [];
  const walk = (stack: any[], base: string): void => {
    for (const layer of stack || []) {
      if (layer.route && layer.route.path) {
        for (const method of Object.keys(layer.route.methods || {})) {
          if (method === '_all') continue;
          const path = base + String(layer.route.path);
          found.push({ method: method.toUpperCase(), path: path.replace(/\/$/, '') || '/' });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, base + mountPrefix(layer));
      }
    }
  };
  walk((app._router || app.router)?.stack, '');
  return found;
}

async function run(): Promise<void> {
  console.log('\n=== ROUTE TABLE ===\n');

  const app: any = await createApp();
  const registrations = collect(app);

  const counts = new Map<string, number>();
  for (const r of registrations) {
    const key = `${r.method} ${r.path}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  check('The application has routes at all', () => {
    // Guards the walker itself. An empty table would make every other check
    // in this file pass while proving nothing — the shape of failure this
    // whole suite exists to catch.
    assert.ok(registrations.length > 50, `only ${registrations.length} routes found`);
  });

  check('No method and path is handled by two different registrations', () => {
    const shadowed = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key, n]) => `${key} registered ${n} times`);

    assert.deepEqual(
      shadowed,
      [],
      'These routes have more than one handler. Express runs the FIRST and the ' +
        'rest are unreachable, whatever they contain:\n  ' + shadowed.join('\n  ')
    );
  });

  check('The payouts draft has exactly one handler', () => {
    // Named explicitly because this is the one that was broken, and a
    // regression here stops the platform paying anybody.
    const n = counts.get('POST /api/admin/payouts') || 0;
    assert.equal(n, 1, `POST /api/admin/payouts has ${n} handlers`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Route tests crashed:', err);
  process.exit(1);
});
