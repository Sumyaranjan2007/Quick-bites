/**
 * Every admin screen shows its failures, and cannot quietly stop.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT, IN FOURTEEN PLACES
 * -------------------------------------------------------------------------
 * `useResource` returns `{ data, loading, error, denied }` and renders nothing
 * itself. There is no toast and no global handler. A screen that never reads
 * `.error` turns a failed request into `data === null`, and its own code then
 * renders that as an EMPTY LIST.
 *
 * Concretely, and this is the one the owner reported: when
 * `/admin/rates/restaurants` failed, the Inflation screen said "No restaurants
 * yet". A 500 presented as good news. That is worse than a crash — it needs no
 * investigation, it provokes no question, and the person reading it goes away
 * satisfied that there is nothing there.
 *
 * Fourteen sources across eleven screens did it. The worst were the reassuring
 * ones: "nobody is waiting to be paid", "nothing is missing for compliance",
 * "everybody can be paid".
 *
 * -------------------------------------------------------------------------
 * WHY THE CHECK IS THE POINT AND NOT THE FIX
 * -------------------------------------------------------------------------
 * Fixing fourteen screens is an afternoon. The fifteenth screen is the problem:
 * `useResource`'s own header already said it existed so that one screen would not
 * end up silently swallowing its error, and that comment did not stop any of the
 * fourteen. A rule nobody can run is a rule that lasts until the next person is in
 * a hurry.
 *
 * So the rule is a check, and the check is pointed at a planted offender every run
 * — because "the app is clean" and "the scanner stopped matching" are the same
 * output with opposite meanings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanForSilentSources,
  silentSourcesIn,
  stripComments
} from './helpers/resourceErrorScan.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(HERE, '../../../admin-mobile/src');

console.log('====================================================');
console.log('  A FAILED LOAD IS NOT AN EMPTY LIST                ');
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
    console.log(`[FAIL] ${name}: ${(err?.message || String(err)).slice(0, 500)}`);
  }
}

const silent = scanForSilentSources([path.join(ADMIN, 'screens'), path.join(ADMIN, 'components')]);

it('NO ADMIN DATA SOURCE HIDES ITS FAILURE', () => {
  assert.equal(
    silent.length,
    0,
    `these load something and never show that it failed:\n  ${silent
      .map(s => `${s.file}: ${s.name}`)
      .join('\n  ')}`
  );
});

it('and the scan found sources at all, so a clean result is not an empty scan', () => {
  /*
   * The check above passes just as well when the directory moved, the hook was
   * renamed, or the glob stopped matching `.tsx`. Every one of those reads as a
   * clean app.
   */
  const files = fs.readdirSync(path.join(ADMIN, 'screens')).filter(f => f.endsWith('.tsx'));
  assert.ok(files.length >= 15, `only ${files.length} admin screens were found`);

  let sources = 0;
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(ADMIN, 'screens', f), 'utf8'));
    sources += (code.match(/useResource\s*[<(]/g) || []).length;
  }
  assert.ok(sources >= 30, `only ${sources} useResource calls were found across the admin app`);
});

const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-silent-'));

fs.writeFileSync(
  path.join(probeDir, 'Offender.tsx'),
  [
    'export const Offender = () => {',
    '  const rows = useResource<Thing>(() => api.get("/x"), []);',
    '  return <View>{(rows.data?.items || []).length === 0 ? <EmptyState /> : null}</View>;',
    '};'
  ].join('\n')
);

fs.writeFileSync(
  path.join(probeDir, 'ReadsIt.tsx'),
  [
    'export const ReadsIt = () => {',
    '  const rows = useResource<Thing>(() => api.get("/x"), []);',
    '  return <View>{!!rows.error && <Text>{rows.error}</Text>}</View>;',
    '};'
  ].join('\n')
);

fs.writeFileSync(
  path.join(probeDir, 'Delegates.tsx'),
  [
    'export const Delegates = () => {',
    '  const rows = useResource<Thing>(() => api.get("/x"), []);',
    '  return <ResourceState resource={rows}>{d => <Text>{d.n}</Text>}</ResourceState>;',
    '};'
  ].join('\n')
);

fs.writeFileSync(
  path.join(probeDir, 'Commented.tsx'),
  [
    'export const Commented = () => {',
    '  const rows = useResource<Thing>(() => api.get("/x"), []);',
    '  // return <View>{!!rows.error && <Text>{rows.error}</Text>}</View>;',
    '  return <View />;',
    '};'
  ].join('\n')
);

fs.writeFileSync(
  path.join(probeDir, 'GuardOnly.tsx'),
  [
    'export const GuardOnly = () => {',
    '  const rows = useResource<Thing>(() => api.get("/x"), []);',
    '  return <View>{rows.data === null && !rows.error ? <EmptyState /> : null}</View>;',
    '};'
  ].join('\n')
);

const probe = scanForSilentSources([probeDir]);
const probeNames = new Set(probe.map(p => p.file));

it('THE SCANNER STILL CATCHES A SOURCE THAT IGNORES ITS ERROR', () => {
  assert.ok(probeNames.has('Offender.tsx'), 'a planted silent source was not found');
});

it('and does NOT flag one that reads it', () => {
  assert.equal(probeNames.has('ReadsIt.tsx'), false, 'a screen that shows its error was flagged');
});

it('and does NOT flag one that hands the whole resource to ResourceState', () => {
  /*
   * Delegating is not ignoring. A screen that hands the source to the shared
   * component has stopped writing four branches by hand, which is the outcome this
   * whole exercise is pushing towards — flagging it would push people back to
   * copying branches around.
   */
  assert.equal(probeNames.has('Delegates.tsx'), false, 'a screen using ResourceState was flagged');
});

it('and COMMENTED-OUT code showing the error does not count as showing it', () => {
  /*
   * The failure mode that has bitten twice on this project, in its sharpest form:
   * somebody comments the error display OUT, and the commented line still contains
   * exactly the shape the check looks for. So the check finds the disabled code and
   * reports that the screen is fine.
   *
   * Commented-out code rather than prose, deliberately. Prose is caught by the
   * rendered-or-delegated rule anyway — it has no JSX braces — so a probe using
   * prose would pass even with the stripper removed, and would prove nothing.
   */
  assert.ok(
    probeNames.has('Commented.tsx'),
    'a comment mentioning .error was accepted as reading it'
  );
});

it('and a GUARD on the error is not the same as showing it', () => {
  /*
   * The distinction a mutation caught me on. Suppressing the empty state when the
   * request failed leaves a blank area — better than a confident lie, and still not
   * a message anybody can act on. A scanner asking only "is `.error` mentioned"
   * passes this, so it asks whether the error is rendered or delegated.
   */
  assert.ok(
    probeNames.has('GuardOnly.tsx'),
    'a screen that only suppresses its empty state was accepted as showing the error'
  );
});

it('and it reports WHICH source, not just that something is wrong', () => {
  // A check that says "something is silent" leaves somebody grepping eleven
  // screens. The names are what make it actionable at 9am.
  const one = silentSourcesIn(path.join(probeDir, 'Offender.tsx'));
  assert.equal(one.length, 1);
  assert.equal(one[0].name, 'rows', `it named "${one[0].name}"`);
});

fs.rmSync(probeDir, { recursive: true, force: true });

it('THE SHARED COMPONENTS EXIST AND KEEP FAILED APART FROM EMPTY', () => {
  /*
   * The two states that were collapsed. "We could not reach the server" and
   * "there is nothing here" look identical on screen and mean opposite things, so
   * the component that replaces them must say so in as many words — and a check on
   * the words is the only way to stop the distinction being edited away by somebody
   * tidying copy.
   */
  const ui = stripComments(fs.readFileSync(path.join(ADMIN, 'components/ui.tsx'), 'utf8'));
  assert.match(ui, /export const ResourceState/, 'ResourceState is gone');
  assert.match(ui, /export const ResourceError/, 'ResourceError is gone');

  /*
   * COUNTED, not merely present. Both components carry the sentence and the retry,
   * so asserting "the file contains it once" passes while one of the two is
   * stripped — which a mutation proved: removing it from ResourceError left
   * ResourceState's copy satisfying the check.
   */
  const sentences = (ui.match(/not the same as there being nothing here/g) || []).length;
  assert.equal(
    sentences,
    2,
    `${sentences} of the two components tell the reader this is not an empty result`
  );
  const retries = (ui.match(/Try again/g) || []).length;
  assert.equal(retries, 2, `${retries} of the two components offer a retry`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
