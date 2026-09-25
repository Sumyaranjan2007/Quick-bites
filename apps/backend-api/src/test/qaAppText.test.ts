/**
 * The owner's QA pass on v8 (26 Sep), app half: #9 to #15.
 *
 * A backend suite cannot see a sentence hard-coded in a screen, so these read
 * the app source — with comments stripped first, because the comment that
 * explains a removal quotes the very string it removed.
 *
 * Each rule is paired with a control proving the file it reads is the right
 * one (the replacement is present), so a renamed file cannot pass silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

console.log('====================================================');
console.log('  WHAT THE FOUR APPS SAY, AND HOW THEIR MENUS WORK  ');
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

const code = (rel: string) =>
  fs
    .readFileSync(path.join(APPS, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------
console.log('-- #9, #10, #13: menus that cannot get stuck or hide a tab');

it('The admin navigation rows do not scroll', () => {
  const ui = code('admin-mobile/src/components/ui.tsx');
  const rail = ui.slice(ui.indexOf('export const SectionRail'), ui.indexOf('export const Card'));
  assert.ok(rail.includes('onSelect(item.key)'), 'control: SectionRail not found');
  assert.equal(/<ScrollView/.test(rail), false, 'SectionRail renders a ScrollView again');
});
it('The admin in-screen tabs wrap instead of scrolling', () => {
  const ui = code('admin-mobile/src/components/ui.tsx');
  const seg = ui.slice(ui.indexOf('export const Segmented'), ui.indexOf('export const Segmented') + 1200);
  assert.ok(seg.includes('onChange(option.key)'), 'control: Segmented not found');
  assert.equal(/<ScrollView/.test(seg), false);
});
it('The partner app shell has no scrolling tab bar, and every page is in a group', () => {
  const app = code('restaurant-mobile/App.tsx');
  assert.equal(/<ScrollView/.test(app), false, 'App.tsx renders a ScrollView again');
  for (const tab of ['dashboard', 'orders', 'history', 'settlements', 'statement', 'bank', 'menu', 'profile', 'documents', 'help']) {
    assert.ok(app.includes(`key: '${tab}'`), `no group offers the "${tab}" page`);
  }
});
it('The partner bottom bar has at most five slots', () => {
  const app = code('restaurant-mobile/App.tsx');
  const groups = app.slice(app.indexOf('const GROUPS'), app.indexOf('const groupOf'));
  const top = groups.match(/key: '[a-z]+',\s*label: '[^']+',\s*icon:/g) || [];
  assert.ok(top.length >= 4 && top.length <= 5, `found ${top.length} bottom slots`);
});

// ---------------------------------------------------------------------
console.log('\n-- #11, #12: the rider is told the truth about money and bonuses');

const riderHome = code('delivery-mobile/src/screens/DashboardScreen.tsx');
it('The rider home no longer offers a "Withdrawable" wallet', () => {
  assert.equal(riderHome.includes('Withdrawable'), false);
  assert.equal(/label="Wallet"/.test(riderHome), false);
  assert.ok(riderHome.includes('label="Earned"'), 'control: the relabelled tile is missing');
});
it('A rider with no bonuses set up is not congratulated', () => {
  assert.ok(riderHome.includes('No bonuses running right now'));
  assert.ok(/incentives\.length === 0/.test(riderHome));
});
it('The admin customer and rider pages show no wallet balance', () => {
  const people = code('admin-mobile/src/screens/PeopleScreen.tsx');
  assert.equal(/label="Wallet"|Wallet balance|Adjust wallet/.test(people), false);
});
it('No admin refund message says "wallet"', () => {
  for (const f of ['admin-mobile/src/components/OrderDetailSheet.tsx', 'admin-mobile/src/screens/RefundsScreen.tsx']) {
    assert.equal(/customer's (Quick Bites )?wallet|Credit the wallet/.test(code(f)), false, f);
  }
});

// ---------------------------------------------------------------------
console.log('\n-- #14, #15: wording and small slips');

it('The customer app does not promise free delivery or a chef who has not started', () => {
  const feed = code('customer-mobile/src/screens/DiscoveryFeedScreen.tsx');
  const detail = code('customer-mobile/src/screens/RestaurantDetailScreen.tsx');
  const checkout = code('customer-mobile/src/screens/CartAndCheckoutScreen.tsx');
  const tracking = code('customer-mobile/src/screens/OrderTrackingScreen.tsx');
  assert.equal(feed.includes('FREE DELIVERY'), false);
  assert.equal(detail.includes('Free delivery above'), false);
  assert.equal(checkout.includes('free delivery above'), false);
  assert.equal(tracking.includes('Chef started'), false);
  assert.ok(tracking.includes("t('tracking.etaWaiting')"), 'the waiting-to-accept caption is missing');
  assert.ok(tracking.includes("'To pay in cash'"), 'an unpaid cash order is still called paid');
});
it('The partner badges no longer use the old dark backgrounds', () => {
  const ui = code('restaurant-mobile/src/components/ui.tsx');
  assert.equal(/#3E2A12|#3A1714|#3A2D12/.test(ui), false);
});
it('Counts are pluralised on the screens the QA pass named', () => {
  const offenders: string[] = [];
  for (const f of [
    'customer-mobile/src/components/ActiveOrderBar.tsx',
    'restaurant-mobile/src/screens/MenuScreen.tsx',
    'restaurant-mobile/src/screens/DashboardScreen.tsx',
    'delivery-mobile/src/screens/TripScreen.tsx',
    'delivery-mobile/src/screens/EarningsScreen.tsx',
    'admin-mobile/src/screens/OrdersScreen.tsx'
  ]) {
    const hits = code(f).match(/[$]?\{[^{}]+\} (items|orders|trips)\b/g) || [];
    if (hits.length) offenders.push(`${f}: ${hits.join(' | ')}`);
  }
  assert.deepEqual(offenders, []);
});
it('The rider cash screen always prints paise as two digits', () => {
  const cash = code('delivery-mobile/src/screens/CashScreen.tsx');
  assert.equal(/minimumFractionDigits: 0, maximumFractionDigits: 2/.test(cash), false);
});
it('The rider cannot be offered "release trip" after pickup', () => {
  const trip = code('delivery-mobile/src/screens/TripScreen.tsx');
  const at = trip.indexOf('onPress={confirmCancel}');
  assert.ok(at > 0, 'control: the release control is missing entirely');
  const before = trip.slice(Math.max(0, at - 200), at);
  assert.ok(/headingToRestaurant \|\| atRestaurant/.test(before), 'release is not gated on the pickup stage');
});
it('A phone-only customer is never asked for a password to delete, nor shown "Change password"', () => {
  const profile = code('customer-mobile/src/screens/ProfileScreen.tsx');
  assert.ok(/passwordless \? \{ code: /.test(profile), 'the delete request never sends a code');
  assert.ok(/!passwordless && \(/.test(profile), 'the Change password row is not hidden');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
