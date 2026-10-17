#!/usr/bin/env node
/**
 * Every backend endpoint, and which app's code calls it. Documentation only.
 *
 * Reads the router files as TEXT (no import, so no server starts and no
 * database opens) and writes docs/generated/ROUTES.md. Regenerate after adding
 * or changing a route:
 *
 *   node scripts/docs/route-inventory.mjs
 *
 * How it works: `apiRouter.use('/prefix', ..., someRouter)` gives each router
 * its prefix (admin sub-routers sit under /admin); `someRouter.get('/path',
 * mw1, mw2, handler)` gives the endpoint, its line, and the middleware before
 * the handler (authMiddleware('role'), requirePermission('x'), validate({ body:
 * Schema }), ...). App callers are found by matching the path strings in each
 * app's src/ against the endpoint's pattern, so a path built in pieces at run
 * time can be missed: "no caller found" means "check by hand", not "unused".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES = path.join(ROOT, 'apps/backend-api/src/routes');
const OUT = path.join(ROOT, 'docs/generated/ROUTES.md');
const APPS = {
  customer: 'apps/customer-mobile/src',
  partner: 'apps/restaurant-mobile/src',
  rider: 'apps/delivery-mobile/src',
  admin: 'apps/admin-mobile/src',
};

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 1. Prefixes: which router variable is mounted where.
const prefixOf = {};
const api = stripComments(fs.readFileSync(path.join(ROUTES, 'apiRouter.ts'), 'utf8'));
for (const m of api.matchAll(/apiRouter\.use\(\s*['"]([^'"]+)['"]([\s\S]*?)\);/g)) {
  const ids = [...m[2].matchAll(/\b([a-zA-Z]+Router)\b/g)].map((x) => x[1]);
  if (ids.length) prefixOf[ids[ids.length - 1]] = m[1];
}
const adminRouter = stripComments(fs.readFileSync(path.join(ROUTES, 'adminRouter.ts'), 'utf8'));
for (const m of adminRouter.matchAll(/adminRouter\.use\(\s*([a-zA-Z]+Routes)\s*\)/g)) prefixOf[m[1]] = '/admin';
prefixOf.publicPages = '(site root)';
prefixOf.webApps = '(site root)';
prefixOf.apiRouter = '';

// 2. Endpoints.
const endpoints = [];
const files = [...walk(ROUTES)].sort();
for (const file of files) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  const re = /\b([a-zA-Z]+(?:Router|Routes|Pages|Apps))\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3/g;
  for (const m of text.matchAll(re)) {
    const [, router, method, , p] = m;
    if (!(router in prefixOf)) continue;
    // The middleware: from the path to the handler (first `async (` or `(req`/`(_req`).
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const ends = [after.search(/async\s*\(|\(\s*_?req\b|\bfunction\b/), after.search(/\)\s*;/)].filter((i) => i >= 0);
    const stop = ends.length ? Math.min(...ends) : -1;
    const mw = stop >= 0 ? after.slice(0, stop) : '';
    const guards = [];
    for (const g of mw.matchAll(/authMiddleware\(([^)]*)\)/g)) guards.push(g[1] ? `auth ${g[1].replace(/['"\s]/g, '')}` : 'signed in');
    for (const g of mw.matchAll(/requirePermission\(([^)]*)\)/g)) guards.push(`perm ${g[1].replace(/['"\s]/g, '')}`);
    for (const g of mw.matchAll(/requireFeature\(([^)]*)\)/g)) guards.push(`feature ${g[1].replace(/['"\s]/g, '')}`);
    if (/requireRiderSelf/.test(mw)) guards.push('rider self');
    if (/requireStaff/.test(mw)) guards.push('staff');
    if (/RateLimiter/.test(mw)) guards.push('rate-limited');
    const schemas = [...mw.matchAll(/validate\(\{([^}]*)\}\)/g)].map((v) => v[1].trim().replace(/\s+/g, ' ')).join('; ');
    const prefix = prefixOf[router];
    const full = prefix === '(site root)' ? p : `/api${prefix}${p === '/' ? '' : p}`;
    endpoints.push({ method: method.toUpperCase(), full, file: rel(file), line: lineAt(text, m.index), router, guards, schemas });
  }
}

// 3. Callers in the apps.
const appPaths = {};
for (const [app, dir] of Object.entries(APPS)) {
  appPaths[app] = [];
  for (const file of walk(path.join(ROOT, dir))) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /(?:\$\{[^}]*\}|['"`])(\/(?:[A-Za-z0-9_\-.]|\$\{[^}]*\})+(?:\/(?:[A-Za-z0-9_\-.:]|\$\{[^}]*\})*)*)/g;
    for (const m of text.matchAll(re)) {
      // `${x}` filling a whole segment is a parameter; glued to text (`/orders${qs}`) it is a query suffix.
      const norm = m[1].replace(/\/\$\{[^}]*\}/g, '/:p').replace(/\$\{[^}]*\}/g, '').replace(/\/+$/, '');
      if (norm.length > 1) appPaths[app].push({ norm, where: `${rel(file)}:${lineAt(text, m.index)}` });
    }
  }
}
function callersOf(full) {
  if (!full.startsWith('/api/')) return {};
  const tail = full.slice(4); // keep the leading slash after /api
  const pattern = new RegExp('^' + tail.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$');
  const found = {};
  for (const [app, list] of Object.entries(appPaths)) {
    const hit = list.find((x) => pattern.test(x.norm) || pattern.test(x.norm.replace(/^\/api/, '')));
    if (hit) found[app] = hit.where;
  }
  return found;
}

// 4. Write.
const commit = (() => {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git/HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5) : null;
    return ref ? fs.readFileSync(path.join(ROOT, '.git', ref), 'utf8').trim().slice(0, 7) : head.slice(0, 7);
  } catch { return 'unknown'; }
})();
const byFile = new Map();
for (const e of endpoints) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push(e);
}
const POINTER = '> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).\n\n';
let md = `# Backend endpoints (generated)\n\n${POINTER}`;
md += `Generated by \`node scripts/docs/route-inventory.mjs\` from commit \`${commit}\`. Do not edit by hand: change the routes, then regenerate.\n\n`;
md += `**${endpoints.length} endpoints** in ${byFile.size} router files. Every \`/api/...\` path also answers at \`/api/v1/...\` (\`app.ts\`).\n`;
md += `"Guard" is the middleware before the handler; routers mounted with a guard in \`apiRouter.ts\` add it to every route inside (for example \`/api/admin\` = \`authMiddleware('admin')\` + \`attachAdminAccess\` + \`durable\`; \`/api/riders\` = \`authMiddleware('rider')\`). `;
md += `"Called from" is the first match in each app's \`src/\` (C = Customer, P = Partner, R = Rider, A = Admin/Operations); matched by path only (not by method), and blank means no literal match was found, so check by hand before calling it unused.\n\n`;
const short = { customer: 'C', partner: 'P', rider: 'R', admin: 'A' };
let uncalled = 0;
for (const [file, list] of byFile) {
  md += `## \`${file}\`\n\n| Method | Path | Line | Guard | Body/query schema | Called from |\n|---|---|---|---|---|---|\n`;
  for (const e of list) {
    const c = callersOf(e.full);
    if (e.full.startsWith('/api/') && !Object.keys(c).length) uncalled++;
    const calls = Object.entries(c).map(([a, w]) => `${short[a]} \`${w}\``).join('<br>');
    md += `| ${e.method} | \`${e.full}\` | [${e.line}](../../${e.file}#L${e.line}) | ${e.guards.join(', ')} | ${e.schemas ? '`' + e.schemas.replace(/\|/g, '\\|') + '`' : ''} | ${calls} |\n`;
  }
  md += '\n';
}
md += `---\n\n${uncalled} \`/api\` endpoints have no literal caller in any app (webhooks, tests, scripts, the websites' shared code, or paths built at run time are common reasons).\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
console.log(`Wrote ${rel(OUT)}: ${endpoints.length} endpoints, ${uncalled} without a literal app caller.`);

// 5. The other direction: per app, each file and the API paths it calls.
const apiPatterns = [...new Set(endpoints.filter((e) => e.full.startsWith('/api/')).map((e) => e.full))].map((full) => ({
  full,
  re: new RegExp('^' + full.slice(4).split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$'),
}));
const names = { customer: 'Customer (`apps/customer-mobile`)', partner: 'Partner (`apps/restaurant-mobile`)', rider: 'Rider (`apps/delivery-mobile`)', admin: 'Operations / Admin (`apps/admin-mobile`)' };
let calls = `# What each app calls (generated)\n\n${POINTER}Generated by \`node scripts/docs/route-inventory.mjs\` from commit \`${commit}\`, with \`ROUTES.md\`. Per app file: the backend paths found as literal strings in it (method not shown; see \`ROUTES.md\`). A path built at run time is not seen.\n\n`;
for (const [app, list] of Object.entries(appPaths)) {
  const perFile = new Map();
  for (const x of list) {
    const hit = apiPatterns.find((p) => p.re.test(x.norm) || p.re.test(x.norm.replace(/^\/api/, '')));
    if (!hit) continue;
    const [file, line] = x.where.split(/:(?=\d+$)/);
    if (!perFile.has(file)) perFile.set(file, new Map());
    const m = perFile.get(file);
    if (!m.has(hit.full)) m.set(hit.full, line);
  }
  calls += `## ${names[app]}\n\n| File | Calls (path, first line) |\n|---|---|\n`;
  for (const [file, m] of [...perFile].sort()) {
    calls += `| \`${file.replace(/^apps\/[^/]+\/src\//, 'src/')}\` | ${[...m].map(([p, l]) => `\`${p}\` :${l}`).join('<br>')} |\n`;
  }
  calls += '\n';
}
const CALLS_OUT = path.join(ROOT, 'docs/generated/APP_CALLS.md');
fs.writeFileSync(CALLS_OUT, calls);
console.log(`Wrote ${rel(CALLS_OUT)}.`);
