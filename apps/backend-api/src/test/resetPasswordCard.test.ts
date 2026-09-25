/**
 * The admin app shows the reset-password card only to people the route lets use it.
 *
 * The restaurant sheet showed the card to anybody holding
 * `catalog.restaurants.approve`, while POST /admin/staff/:userId/reset-password
 * resets a restaurant owner only for `users.restaurants.manage`. A catalogue
 * approver saw a button the server then refused. A custom role is exactly where
 * the two drift, so the two are tied together here, from source: for every place
 * the card is rendered, the permissions that decide it must be exactly the ones
 * the route requires for that kind of account.
 *
 * Run: node --experimental-strip-types src/test/resetPasswordCard.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

console.log('====================================================');
console.log('  NO BUTTON THE SERVER WILL REFUSE                  ');
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

const read = (relative: string) =>
  fs
    .readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const route = read('../routes/admin/peopleRoutes.ts');
const screen = read('../../../admin-mobile/src/screens/PeopleScreen.tsx');

/* What the route requires, per kind of account. Read, not assumed. */
const REQUIRED: Record<string, { role: string; permission: string }> = {
  DriverSheet: { role: 'rider', permission: 'users.drivers.manage' },
  RestaurantSheet: { role: 'restaurant_owner', permission: 'users.restaurants.manage' }
};
it('The route resets a rider only with users.drivers.manage, an owner only with users.restaurants.manage', () => {
  for (const { role, permission } of Object.values(REQUIRED)) {
    assert.match(
      route,
      new RegExp(`roles\\.includes\\('${role}'\\)\\s*&&\\s*access\\.permissions\\.includes\\('${permission}'`),
      `the reset route no longer ties ${role} to ${permission}; update this check with it`
    );
  }
});

/* Where the app renders the card, and what decides it. */
const cards: Array<{ sheet: string; gate: string; permissions: string[] }> = [];
for (const match of screen.matchAll(/\{\s*(\w+)\s*&&[^{}]*?\?\s*\(?\s*<PasswordResetCard/g)) {
  const at = match.index ?? 0;
  const gate = match[1];
  const sheets = [...screen.slice(0, at).matchAll(/const (\w+Sheet)\s*:\s*React\.FC/g)];
  const sheet = sheets[sheets.length - 1]?.[1] ?? '?';
  const use = screen.match(new RegExp(`<${sheet}\\b[\\s\\S]*?/>`))?.[0] ?? '';
  const given = use.match(new RegExp(`${gate}=\\{can\\(([^)]*)\\)\\}`))?.[1] ?? '';
  const permissions = [...given.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  cards.push({ sheet, gate, permissions });
}

it('Both places the card is rendered were found (so the checks below are not empty)', () => {
  assert.deepEqual(cards.map(c => c.sheet).sort(), ['DriverSheet', 'RestaurantSheet'], JSON.stringify(cards));
});

for (const card of cards) {
  it(`${card.sheet} shows the card only for ${REQUIRED[card.sheet]?.permission}`, () => {
    assert.ok(REQUIRED[card.sheet], `a card in ${card.sheet}, which this check does not know`);
    assert.deepEqual(
      card.permissions,
      [REQUIRED[card.sheet].permission],
      `${card.sheet} decides the card with ${card.gate} = can(${card.permissions.join(', ') || 'nothing found'})`
    );
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
