#!/usr/bin/env node
/**
 * Are the three languages actually complete?
 *
 * A missing translation does not crash and does not show an error. It falls
 * back to English, in the middle of a Kannada screen, and looks like a design
 * choice. That makes it exactly the kind of defect that survives every test and
 * ships — the app works, it is just not in the language the customer chose.
 *
 * Four things are checked:
 *
 *   1. Every key in `en` exists in `hi` and `kn`.
 *   2. No dictionary has a key the others do not — a stray key is a key that was
 *      renamed in one place and not the others, so it is dead in two languages.
 *   3. Every `t('key')` in the app source resolves to a real key. A typo here
 *      renders the key itself on screen: the customer sees `cart.tipTitle`.
 *   4. Placeholders match. If `en` says "{minutes} min" and `hi` drops the
 *      `{minutes}`, the Hindi screen shows a unit with no number.
 *
 * Exits non-zero on any of them, so `npm run verify` refuses the release.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PLACEHOLDER = /[{]([a-zA-Z0-9_]+)[}]/g;

let problems = 0;

function fail(message) {
  console.log(`[FAIL] ${message}`);
  problems++;
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

/**
 * Reads the dictionaries out of the customer app's i18n module.
 *
 * Parsed from source rather than imported, because the module is TSX with React
 * in it and this script is a plain node script that runs before anything is
 * built. The dictionaries are plain object literals, which is what makes this
 * safe to do by parsing.
 */
function readCustomerDicts() {
  const file = path.join(ROOT, 'apps/customer-mobile/src/lib/i18n.tsx');
  const source = fs.readFileSync(file, 'utf8');
  const dicts = {};

  for (const lang of ['en', 'kn', 'hi']) {
    const start = source.indexOf(`const ${lang}: Dict = {`);
    if (start === -1) {
      fail(`No "${lang}" dictionary found in i18n.tsx`);
      continue;
    }
    const end = source.indexOf('\n};', start);
    const body = source.slice(start, end);

    const entries = {};
    // `'key': 'value'` or `"key": "value"`, quoted either way on either side.
    //
    // Each alternative excludes only its OWN delimiter. An earlier version
    // excluded both quote characters from the body, so `"WHAT'S YOUR"` — a
    // double-quoted value containing an apostrophe — simply did not match, and
    // three real English strings silently vanished from the parsed dictionary.
    // The checker then reported that Hindi and Kannada had keys English did
    // not, which is the opposite of the truth.
    const QUOTED = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"`;
    const pattern = new RegExp(`(?:${QUOTED})\\s*:\\s*(?:${QUOTED})`, 'g');
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const key = match[1] ?? match[2];
      const value = match[3] ?? match[4];
      if (key === undefined || value === undefined) continue;
      entries[key] = value;
    }
    dicts[lang] = entries;
  }
  return dicts;
}

function collectSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'android' || entry.name === 'ios') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function placeholdersIn(text) {
  return new Set(Array.from(text.matchAll(PLACEHOLDER), m => m[1]));
}

console.log('====================================================');
console.log('          CHECKING TRANSLATIONS                    ');
console.log('====================================================\n');

// ---------------------------------------------------------------------------
// The customer app
// ---------------------------------------------------------------------------
const dicts = readCustomerDicts();
const enKeys = Object.keys(dicts.en || {});

if (enKeys.length === 0) {
  fail('The English dictionary parsed as empty — the parser is broken, not the translations');
} else {
  pass(`English dictionary has ${enKeys.length} keys`);
}

for (const lang of ['hi', 'kn']) {
  const langKeys = new Set(Object.keys(dicts[lang] || {}));
  const missing = enKeys.filter(k => !langKeys.has(k));
  const extra = Array.from(langKeys).filter(k => !enKeys.includes(k));

  if (missing.length) {
    fail(`${lang.toUpperCase()} is missing ${missing.length} key(s): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
  } else {
    pass(`${lang.toUpperCase()} translates all ${enKeys.length} keys`);
  }

  if (extra.length) {
    fail(`${lang.toUpperCase()} has ${extra.length} key(s) English does not: ${extra.slice(0, 8).join(', ')}`);
  }

  // An empty string is worse than a missing key: it falls back to nothing.
  const blank = Object.entries(dicts[lang] || {}).filter(([, v]) => !String(v).trim());
  if (blank.length) {
    fail(`${lang.toUpperCase()} has ${blank.length} blank translation(s): ${blank.map(([k]) => k).join(', ')}`);
  }

  // Placeholders must survive translation or the number vanishes from the screen.
  const mismatched = [];
  for (const key of enKeys) {
    const translated = dicts[lang]?.[key];
    if (translated === undefined) continue;
    const expected = placeholdersIn(dicts.en[key]);
    const actual = placeholdersIn(translated);
    if (expected.size === 0 && actual.size === 0) continue;
    const same =
      expected.size === actual.size && Array.from(expected).every(p => actual.has(p));
    if (!same) {
      mismatched.push(`${key} (en: {${Array.from(expected).join(',')}}, ${lang}: {${Array.from(actual).join(',')}})`);
    }
  }
  if (mismatched.length) {
    fail(`${lang.toUpperCase()} loses or invents placeholders in ${mismatched.length}: ${mismatched.join('; ')}`);
  } else {
    pass(`${lang.toUpperCase()} keeps every {placeholder} the English string has`);
  }
}

// ---------------------------------------------------------------------------
// Every key the app asks for must exist
// ---------------------------------------------------------------------------
const files = collectSourceFiles(path.join(ROOT, 'apps/customer-mobile/src')).concat([
  path.join(ROOT, 'apps/customer-mobile/App.tsx')
]);

const used = new Map();
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /\bt\(\s*'([^']+)'/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!used.has(match[1])) used.set(match[1], []);
    used.get(match[1]).push(path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

const unknown = Array.from(used.keys()).filter(k => !enKeys.includes(k));
if (unknown.length) {
  for (const key of unknown) {
    fail(`t('${key}') has no entry — the key itself renders on screen. Used in ${used.get(key)[0]}`);
  }
} else {
  pass(`All ${used.size} keys used in the app source exist in the dictionary`);
}

// A key nobody uses is not a failure — it may be used next week — but it is
// worth naming, because it is usually a rename that half happened.
const unused = enKeys.filter(k => !used.has(k));
if (unused.length) {
  console.log(`[NOTE] ${unused.length} key(s) defined but not used yet: ${unused.slice(0, 6).join(', ')}${unused.length > 6 ? ' …' : ''}`);
}

// ---------------------------------------------------------------------------
// The design system's own locale files
// ---------------------------------------------------------------------------
const localeDir = path.join(ROOT, 'packages/design-system/src/i18n/locales');
if (fs.existsSync(localeDir)) {
  const en = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
  for (const lang of ['hi', 'kn']) {
    const other = JSON.parse(fs.readFileSync(path.join(localeDir, `${lang}.json`), 'utf8'));
    const missing = Object.keys(en).filter(k => !(k in other));
    if (missing.length) {
      fail(`design-system ${lang}.json is missing: ${missing.join(', ')}`);
    } else {
      pass(`design-system ${lang}.json is complete`);
    }
  }
}

console.log('');
console.log('====================================================');
if (problems === 0) {
  console.log('  TRANSLATIONS COMPLETE IN EN, HI AND KN           ');
  console.log('====================================================\n');
  process.exit(0);
}
console.log(`  ${problems} TRANSLATION PROBLEM(S)                       `);
console.log('====================================================\n');
process.exit(1);
