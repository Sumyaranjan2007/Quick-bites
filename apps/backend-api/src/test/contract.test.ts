/**
 * Do the apps and the server agree about what exists?
 *
 * Nothing else in this repository asks that question. Every backend suite tests
 * the backend against itself, and every app typechecks against itself, and both
 * can be perfectly correct while the app calls an endpoint the server has never
 * heard of.
 *
 * That is not hypothetical here. The customer app was rebuilt to sign in with
 * `POST /api/auth/otp/request`, four APKs were built, signed and launch-tested,
 * and the endpoint answered `404 Route POST /api/auth/otp/request not found` on
 * the deployment they pointed at. Every check in the project was green. The
 * apps could not have signed anyone in.
 *
 * So this suite reads the app source, pulls out every URL it builds, and asks a
 * real server whether there is a handler behind it.
 *
 * What counts as a pass: anything except "no such route". 401, 403, 400, 409,
 * and a resource-level 404 (`ORDER_NOT_FOUND`) all prove the route exists — the
 * request was understood and refused on its merits. Only the router's own
 * "Route ... not found" is a contract failure.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';
import { resetAuthRateLimit, resetRequestRateLimit } from '../middlewares/rateLimiter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

console.log('====================================================');
console.log('          RUNNING CLIENT/SERVER CONTRACT TESTS     ');
console.log('====================================================\n');

const PORT = 5900 + Math.floor(Math.random() * 300);
const API = `http://127.0.0.1:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.log(`[FAIL] ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

/** The apps whose calls are checked, and where their source lives. */
const APPS = [
  { name: 'customer', dir: 'apps/customer-mobile' },
  { name: 'partner', dir: 'apps/restaurant-mobile' },
  { name: 'rider', dir: 'apps/delivery-mobile' },
  { name: 'admin', dir: 'apps/admin-mobile' }
];

/**
 * The variables the apps hold their API base in. A template literal starting
 * with one of these is a call to our own server; anything else (an image CDN, a
 * maps link) is not ours to check.
 */
const BASE_VARS = new Set([
  'apiUrl',
  'API_BASE',
  'base',
  'effectiveBase',
  'apiBase',
  'baseUrl',
  'url',
  'API_URL',
  'DEFAULT_API_URL'
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'android' || entry.name === 'ios') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Pulls the path out of a template literal, expanding it into every concrete
 * path it could produce.
 *
 * `${...}` holes become a placeholder, except where the hole is a ternary
 * between string literals — `${isResend ? 'resend' : 'request'}` is two
 * different endpoints, and checking only one of them would miss the other.
 * A trailing hole that builds a query string is dropped, because a query string
 * is not part of the route.
 */
function expandTemplate(body: string): string[] {
  const results: string[] = [''];
  let i = 0;
  let literal = '';

  const push = (pieces: string[]) => {
    const prefix = literal;
    literal = '';
    const grown: string[] = [];
    for (const existing of results) {
      for (const piece of pieces) grown.push(existing + prefix + piece);
    }
    results.length = 0;
    results.push(...grown);
  };

  while (i < body.length) {
    if (body[i] === '$' && body[i + 1] === '{') {
      // Find the matching brace, so a nested object or call does not end it early.
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        j++;
      }
      const expr = body.slice(i + 2, j - 1);
      i = j;

      const ternary = expr.match(/\?\s*'([^']*)'\s*:\s*'([^']*)'/);
      if (ternary) {
        push([ternary[1], ternary[2]]);
      } else if (/query|Query|params|search/.test(expr)) {
        // A query-string builder. Not part of the path.
        push(['']);
      } else {
        push(['PLACEHOLDER']);
      }
      continue;
    }
    literal += body[i];
    i++;
  }

  if (literal) push(['']);
  return results.map(r => r + literal).map(r => r.trim());
}

/**
 * Every request the given app source makes to our own API.
 *
 * Two shapes, because the apps genuinely use two. The customer app builds the
 * whole URL at the call site; the partner, rider and admin apps pass a bare
 * path to a `request()` wrapper that prepends the base. Reading only the first
 * shape made this suite report a clean contract for three apps it had never
 * looked at — which the per-app guard below caught on its first run, and which
 * is exactly why that guard is there.
 */
interface ClientCall {
  /** Files the call is made from, for the failure message. */
  where: string[];
  /**
   * The verbs the apps were seen using on this path, where the extractor could
   * read one with confidence.
   *
   * Empty means "could not tell", and the path is then only checked for
   * existence under any verb. Guessing a verb and asserting it would turn a
   * limitation of this parser into a failing build.
   */
  methods: Set<string>;
}

function extractCalls(appDir: string): Map<string, ClientCall> {
  const found = new Map<string, ClientCall>();
  const files = walk(path.join(REPO_ROOT, appDir));

  const record = (raw: string, file: string, method?: string) => {
    for (const expanded of expandTemplate(raw)) {
      if (!expanded.startsWith('/')) continue;
      const clean = expanded.split('?')[0].replace(/\/+$/, '') || '/';
      const where = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (!found.has(clean)) found.set(clean, { where: [], methods: new Set() });
      const entry = found.get(clean)!;
      if (!entry.where.includes(where)) entry.where.push(where);
      if (method) entry.methods.add(method.toUpperCase());
    }
  };

  /**
   * The text of one call, from its opening parenthesis to the matching close.
   *
   * A fixed-length window is not good enough. `fetchDashboard` is a one-line GET
   * immediately followed by `setKitchenOpen`, which passes `method: 'POST'`; a
   * 400-character window read that POST and reported that the partner app was
   * calling an endpoint the server does not have. It was not. Balancing the
   * parentheses keeps each call's options inside its own call.
   */
  const callSpan = (source: string, openerIndex: number): string => {
    const open = source.indexOf('(', openerIndex);
    if (open === -1) return '';
    let depth = 0;
    for (let i = open; i < source.length && i < open + 4000; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) return source.slice(openerIndex, i + 1);
      }
    }
    return source.slice(openerIndex, openerIndex + 400);
  };

  /**
   * The same, for a URL found in the MIDDLE of a call rather than at its start.
   *
   * `apiFetch(`${apiUrl}/orders`, { method: 'POST' })` — the template literal is
   * the first argument, so the call's opening parenthesis is behind it. Scans
   * back a short way for the opener, then balances forward from there.
   */
  const callSpanAround = (source: string, insideIndex: number): string => {
    const lookBehind = source.slice(Math.max(0, insideIndex - 120), insideIndex);
    const opener = lookBehind.lastIndexOf('(');
    if (opener === -1) return source.slice(insideIndex, insideIndex + 300);
    return callSpan(source, Math.max(0, insideIndex - 120) + opener);
  };

  /**
   * The verb, read out of one call's own text.
   *
   * `api.post(...)` names it outright. A `fetch`/`request` with options names it
   * as `method: 'PUT'`. Anything else returns undefined, and the caller falls
   * back to checking existence under any verb.
   */
  const methodFrom = (span: string): string | undefined => {
    const verb = span.match(/^api\.(get|post|put|patch|del|delete)\b/);
    if (verb) return verb[1] === 'del' ? 'DELETE' : verb[1];
    const explicit = span.match(/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/i);
    if (explicit) return explicit[1];
    return undefined;
  };

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    // Shape 1: `${apiUrl}/orders/${id}` — the URL built at the call site.
    const inlinePattern = /`\$\{([A-Za-z_][A-Za-z0-9_]*)\}([^`]*)`/g;
    let match: RegExpExecArray | null;
    while ((match = inlinePattern.exec(source)) !== null) {
      if (!BASE_VARS.has(match[1])) continue;
      if (!match[2].startsWith('/')) continue;
      // The options object follows the URL, so look forward from it.
      record(match[2], file, methodFrom(callSpanAround(source, match.index)));
    }

    // Shape 2: a bare path handed to a wrapper that prepends the base. All
    // four apps do this and none of them agree on how:
    //
    //   partner   request<T>('/support/tickets')
    //   rider     request<T>(ctx, '/riders/me', { ... })
    //   admin     api.post(`/admin/orders/${id}/cancel`)
    //
    // So rather than matching each call convention, find the call opener and
    // take the first quoted literal inside it that looks like a path. The
    // leading slash is what makes it unambiguous — no other argument to these
    // functions is a string starting with one.
    const openerPattern = /\b(?:request\s*(?:<[^>]*>)?|api\.(?:get|post|put|patch|del|delete))\s*\(/g;
    while ((match = openerPattern.exec(source)) !== null) {
      const window = callSpan(source, match.index);
      const literal = window.match(/(`\/[^`]*`|'\/[^']*'|"\/[^"]*")/);
      if (!literal) continue;
      record(literal[1].slice(1, -1), file, methodFrom(window));
    }
  }
  return found;
}

/**
 * A concrete request path, with placeholders replaced by ids that are shaped
 * like real ones. The values need not exist — a 404 that names the resource is
 * a pass. They must only survive any id-format validation on the way in.
 */
function concretise(template: string): string {
  let n = 0;
  return template.replace(/PLACEHOLDER/g, () => {
    n += 1;
    return `contract_probe_${n}`;
  });
}

/**
 * The verbs tried when the extractor could not read one from the source.
 *
 * In that case the path passes if ANY of them is handled — a route that exists
 * under some verb is a route that exists, and asserting a guessed verb would
 * fail the build over a limitation of the parser rather than a defect in the
 * product.
 *
 * Where the verb WAS read with confidence, only that verb is tried. That
 * matters: a client sending `PUT /orders/:id/status` to a server that only
 * handles `POST` there is a 404 at the tester's fingertips, and trying all five
 * verbs would have called it a pass because some other verb answered.
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

async function routeExists(
  urlPath: string,
  onlyMethods?: string[]
): Promise<{ exists: boolean; evidence: string }> {
  const attempts: string[] = [];
  for (const method of onlyMethods?.length ? onlyMethods : METHODS) {
    let res: Response;
    try {
      res = await fetch(`${API}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}'
      });
    } catch (err) {
      attempts.push(`${method} threw`);
      continue;
    }

    // A rate-limited request never reached the router, so it says nothing
    // about whether the route exists. Counting 429 as "exists" would turn this
    // suite green the moment it sent enough requests to throttle itself —
    // a whole app's contract could be missing and every check would pass.
    if (res.status === 429) {
      resetRequestRateLimit();
      resetAuthRateLimit();
      res = await fetch(`${API}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}'
      });
      if (res.status === 429) {
        attempts.push(`${method} still throttled`);
        continue;
      }
    }

    if (res.status !== 404) {
      return { exists: true, evidence: `${method} ${res.status}` };
    }

    const body: any = await res.json().catch(() => null);
    const message = String(body?.error?.message || '');
    // The router's own miss says "Route <METHOD> <path> not found". A handler
    // that ran and could not find the record says something else entirely, and
    // that means the route is there.
    if (!/^Route\s/i.test(message)) {
      return { exists: true, evidence: `${method} 404 ${body?.error?.code || ''}` };
    }
    attempts.push(`${method} 404`);
  }
  return { exists: false, evidence: attempts.join(', ') };
}

async function run() {
  await seedDatabase();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));

  resetAuthRateLimit();
  resetRequestRateLimit();

  let totalRoutes = 0;
  const missing: Array<{ app: string; route: string; where: string[] }> = [];

  for (const appInfo of APPS) {
    const calls = extractCalls(appInfo.dir);
    console.log(`\n--- ${appInfo.name} app: ${calls.size} distinct API paths ---`);

    // An app that appears to call nothing means the extractor broke, not that
    // the app is self-contained. Fail loudly rather than reporting success for
    // having checked nothing.
    check(`The ${appInfo.name} app's API calls could be read from source`, calls.size > 0,
      'the extractor found no calls at all, which means it is broken');

    let verbChecked = 0;
    for (const [template, call] of calls) {
      totalRoutes++;
      const probe = concretise(template);
      const verbs = Array.from(call.methods);
      if (verbs.length) verbChecked++;

      const result = await routeExists(probe, verbs);
      if (result.exists) {
        passed++;
      } else {
        failed++;
        missing.push({ app: appInfo.name, route: template, where: call.where });
        const how = verbs.length ? verbs.join('/') : 'any verb';
        console.log(`[FAIL] ${appInfo.name}: ${how} ${template} — the server does not handle it (${result.evidence})`);
        console.log(`       called from: ${call.where.join(', ')}`);
      }
    }
    const appFailures = missing.filter(m => m.app === appInfo.name).length;
    console.log(
      `       ${calls.size} checked, ${calls.size - appFailures} resolved ` +
        `(${verbChecked} against the exact verb the app uses)`
    );
  }

  // ------------------------------------------------------------------
  // The extractor itself has to be shown to work, or a silent failure in it
  // reports a clean contract for an app it never read.
  console.log('\n--- The extractor must be able to fail ---');

  const fake = await routeExists('/definitely/not/a/route');
  check('A path the server does not have is reported missing', !fake.exists, fake.evidence);

  const real = await routeExists('/health');
  check('A path the server does have is reported present', real.exists, real.evidence);

  const otp = await routeExists('/auth/otp/request');
  check('The phone sign-in endpoint the apps depend on exists', otp.exists,
    'this is the exact 404 that made four signed APKs unable to sign anyone in');

  const expansions = expandTemplate("/auth/otp/${isResend ? 'resend' : 'request'}");
  check('A ternary in a URL expands to BOTH endpoints',
    expansions.includes('/auth/otp/resend') && expansions.includes('/auth/otp/request'),
    JSON.stringify(expansions));

  const withQuery = expandTemplate('/restaurants${buildQuery()}');
  check('A query-string builder is not mistaken for part of the path',
    withQuery.includes('/restaurants'), JSON.stringify(withQuery));

  server.close();

  console.log('\n====================================================');
  console.log(`  ${totalRoutes} client API paths checked against the server`);
  if (failed === 0) {
    console.log(`        ALL ${passed} CONTRACT CHECKS PASSED               `);
    console.log('====================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.log(`        ${failed} CONTRACT CHECK(S) FAILED                 `);
    for (const m of missing) {
      console.log(`   ${m.app}: ${m.route}`);
    }
    console.log('====================================================\n');
    setTimeout(() => process.exit(1), 100);
  }
}

run().catch(err => {
  console.error('[FAIL] Contract tests crashed:', err);
  process.exit(1);
});
