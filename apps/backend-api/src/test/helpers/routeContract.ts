/**
 * Does every route the apps call actually exist on the server?
 *
 * -------------------------------------------------------------------------
 * THE TWO FAILURES THIS CATCHES, AND THEY POINT OPPOSITE WAYS
 * -------------------------------------------------------------------------
 * The KYC alert was built, correct, and wired to `POST /kyc/submit` — a route no
 * app calls. That is a SERVER feature nothing reaches, and it went unnoticed for
 * as long as the feature existed.
 *
 * The reverse is worse and just as quiet: an app calling a path the server does
 * not have, or having with a different method. Nothing fails at build time. The
 * screen shows an error only if it reads one — and until W7.1, fourteen of them
 * did not, so it showed an empty list instead. A renamed route, a method changed
 * from PUT to PATCH, a typo in a path: every one of those ships green.
 *
 * -------------------------------------------------------------------------
 * WHY IT IS A STRING SCAN AND NOT SOMETHING CLEVERER
 * -------------------------------------------------------------------------
 * A call assembled at runtime from variables cannot be checked without running
 * the app. What CAN be checked is every path written as a literal, which on this
 * platform is almost all of them, and the whole class of mistakes above are
 * literal mistakes.
 *
 * So it is deliberately narrow: paths that are visible in the source, matched
 * structurally against the routes Express actually mounted. A path built from a
 * variable is reported as unreadable rather than as passing, because "we could not
 * check this" and "this is fine" must not look the same.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface MountedRoute {
  method: string;
  path: string;
}

export interface AppCall {
  app: string;
  file: string;
  method: string;
  /** As written, with template holes turned into :param. */
  path: string;
}

/**
 * The prefix a mounted router sits behind.
 *
 * Express keeps only the regexp it compiled from the mount path, so it has to be
 * read back out. Without it every `/me` on the platform collapses to `/me`.
 */
function mountPrefix(layer: any): string {
  const re = layer?.regexp;
  if (!re || re.fast_slash) return '';
  const source = String(re.source);
  const match = source.match(/^\^\\\/((?:[\w\-.~%]|\\.)*)\\\/\?/);
  if (!match) return '';
  return '/' + match[1].replace(/\\(.)/g, '$1');
}

/** Every route the assembled application really has, at its full path. */
export function mountedRoutes(app: any): MountedRoute[] {
  const found: MountedRoute[] = [];
  const walk = (stack: any[], base: string): void => {
    for (const layer of stack || []) {
      if (layer.route && layer.route.path) {
        for (const method of Object.keys(layer.route.methods || {})) {
          if (method === '_all') continue;
          const full = base + String(layer.route.path);
          found.push({ method: method.toUpperCase(), path: full.replace(/\/$/, '') || '/' });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, base + mountPrefix(layer));
      }
    }
  };
  walk((app._router || app.router)?.stack, '');
  return found;
}

/**
 * A path reduced to its shape.
 *
 * Every parameter becomes `:param`, whether the app wrote `${order.id}` or the
 * server wrote `:id`, so the comparison is about STRUCTURE. Matching on parameter
 * names would report `/orders/:id` and `/orders/:orderId` as different routes,
 * which is a difference nothing cares about and would make the check useless.
 *
 * A trailing query string is dropped: `?state=PAID` is not part of the route.
 */
export function normalisePath(value: string): string {
  return (
    '/' +
    value
      .split('?')[0]
      .replace(/\$\{[^}]*\}/g, ':param')
      .split('/')
      .filter(Boolean)
      .map(segment => (segment.startsWith(':') ? ':param' : segment))
      .join('/')
  ).replace(/\/$/, '') || '/';
}

/** True when a path was assembled from something this scan cannot read. */
export function isUnreadable(value: string): boolean {
  // A hole at the very START means the base of the path is a variable, so there
  // is nothing structural left to compare.
  return /^\s*\$\{/.test(value) || value.trim().length === 0;
}

const METHOD_FROM_NAME: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  del: 'DELETE',
  delete: 'DELETE'
};

/**
 * The methods an HTTP route can have.
 *
 * Checked against, rather than trusted, because `method:` is also an ordinary
 * field name in this codebase — a payee account has a `method` of BANK or VPA, and
 * an early version of this scan happily reported a route as `BANK /payee-accounts/me`.
 */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function walkSources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Comments removed first, so a commented-out call is not counted as a call. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Replaces `${...}` holes with `:param`, counting braces.
 *
 * A regex cannot do this. `${query ? '?scope=' + s : ''}` contains a brace-free
 * body but `${a ? {x:1} : y}` does not, and either way `[^}]*` stops at the first
 * `}` and leaves the rest of the expression in the path — which is how an earlier
 * version produced `/earnings/statement${query ?` as a route it expected the server
 * to have.
 */
function fillHoles(value: string): { variants: string[]; wholeSegments: boolean } {
  /*
   * The query string goes first. `?scope=${scope}` is not part of the route, and
   * treating it as path text made six perfectly ordinary calls unreadable.
   *
   * Cut at the first `?` that is OUTSIDE a hole. A plain `split('?')` cuts inside a
   * ternary — `${isResend ? 'resend' : 'request'}` became `${isResend `, which threw
   * away both branch names and reported the login screen as calling a route that
   * does not exist. The one place this had to be careful was the one place it was
   * not.
   */
  let cut = -1;
  for (let k = 0, depth = 0; k < value.length; k += 1) {
    if (value[k] === '$' && value[k + 1] === '{') depth += 1;
    else if (value[k] === '}' && depth > 0) depth -= 1;
    else if (value[k] === '?' && depth === 0) {
      cut = k;
      break;
    }
  }
  const pathOnly = cut === -1 ? value : value.slice(0, cut);

  let variants = [''];
  let wholeSegments = true;
  let i = 0;

  while (i < pathOnly.length) {
    if (pathOnly[i] === '$' && pathOnly[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < pathOnly.length && depth > 0) {
        if (pathOnly[j] === '{') depth += 1;
        else if (pathOnly[j] === '}') depth -= 1;
        j += 1;
      }
      const body = pathOnly.slice(i + 2, j - 1);

      /*
       * A hole is only a parameter when it is a WHOLE path segment. A hole glued to
       * text could expand to anything, including several segments, so its shape is
       * unknown and the call is reported as unreadable rather than matched or failed.
       */
      const last = variants[0].length === 0 ? '/' : variants[0][variants[0].length - 1];
      const after = j < pathOnly.length ? pathOnly[j] : '/';
      if (last !== '/' || (after !== '/' && after !== '')) wholeSegments = false;

      /*
       * A HOLE THAT IS A CHOICE BETWEEN LITERALS IS NOT A PARAMETER.
       *
       * `/auth/otp/${isResend ? 'resend' : 'request'}` names two real routes, and
       * calling it one `:param` matched neither — this scan reported the login screen
       * as calling a route that does not exist, when both of the routes it can
       * actually call are mounted.
       *
       * So a hole whose body is nothing but quoted literals expands into every value
       * it can take, and the call passes only when EVERY one of them is mounted. A
       * hole containing anything else is a genuine parameter.
       */
      const literals = Array.from(body.matchAll(/['"`]([^'"`]*)['"`]/g)).map(m => m[1]);
      const onlyLiterals =
        literals.length >= 2 &&
        literals.length <= 4 &&
        literals.every(l => l.length > 0 && !l.includes('/')) &&
        !/[+.[\]]/.test(body.replace(/['"`][^'"`]*['"`]/g, ''));

      const pieces = onlyLiterals ? literals : [':param'];
      variants = variants.flatMap(prefix => pieces.map(piece => prefix + piece));
      i = j;
    } else {
      variants = variants.map(v => v + pathOnly[i]);
      i += 1;
    }
  }

  return { variants, wholeSegments };
}

/**
 * Every API path an app asks for, as written in its source.
 *
 * -------------------------------------------------------------------------
 * HOW THE METHOD IS DECIDED, AND WHY NOT BY LOOKING NEARBY
 * -------------------------------------------------------------------------
 * A method-named helper says it in the name. A generic `request(path, init)` says
 * it in the init object — and an earlier version of this looked for `method:`
 * within 300 characters of the path, which reached into the NEXT function and
 * reported half the delivery app as POST. The window is now the rest of that call
 * only, balanced on its parentheses.
 *
 * The three client shapes on this platform are covered: a method-named helper
 * (`api.get('/x')`), a generic request taking the path first (`request(ctx, '/x',
 * { method })`), and a raw fetch against the base URL (`apiFetch(`${url}/x`)`).
 * Admin's own `request('GET', path)` — method FIRST — is excluded by requiring the
 * literal to start with a slash, which is also what keeps a method name from being
 * read as a path.
 */
export function appCalls(
  appName: string,
  srcDir: string
): { calls: AppCall[]; unreadable: AppCall[] } {
  const calls: AppCall[] = [];
  const unreadable: AppCall[] = [];

  for (const file of walkSources(srcDir)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const shortName = path.relative(srcDir, file).split(path.sep).join('/');

    const record = (rawPath: string, method: string) => {
      const { variants, wholeSegments } = fillHoles(rawPath);
      /*
       * One entry per value the path can take. A hole that is a choice between
       * literals names several routes, and the call is only correct when every one
       * of them is mounted — so they are checked as separate calls rather than
       * collapsed into whichever happens to exist.
       */
      for (const variant of variants) {
        const entry: AppCall = { app: appName, file: shortName, method, path: variant };
        if (!wholeSegments || isUnreadable(rawPath)) unreadable.push(entry);
        else calls.push(entry);
      }
    };

    /*
     * The rest of the call containing `from`, so a `method:` belongs to THIS call.
     * Balanced on parentheses rather than cut at a fixed length.
     */
    const restOfCall = (from: number): string => {
      let depth = 1;
      let i = from;
      while (i < code.length && depth > 0) {
        if (code[i] === '(') depth += 1;
        else if (code[i] === ')') depth -= 1;
        i += 1;
      }
      return code.slice(from, i);
    };

    const methodIn = (text: string): string => {
      const match = text.match(/method:\s*['"`]([A-Za-z]+)['"`]/);
      const found = match ? match[1].toUpperCase() : 'GET';
      return HTTP_METHODS.has(found) ? found : 'GET';
    };

    /*
     * ONE PASS PER QUOTE CHARACTER, AND NOT ONE PATTERN FOR ALL THREE.
     *
     * A single class excluding every quote — `[^`'"]*` — truncates a TEMPLATE literal
     * at the first inner quote, and inner quotes are exactly where the interesting
     * paths live: `` `/auth/otp/${isResend ? 'resend' : 'request'}` `` came back as
     * `/auth/otp/${isResend ?` and was duly reported as a route the server does not
     * have. The body must exclude only the delimiter that opened it, and a regex
     * cannot parameterise a character class by a backreference, so each delimiter
     * gets its own pass.
     */
    for (const quote of ['`', "'", '"']) {
      const q = quote === '`' ? '`' : quote;
      const body = `[^${quote === '`' ? '`' : quote}]*`;

      // A helper that names the method: api.get('/x'), client.post('/x', body)
      for (const m of code.matchAll(
        new RegExp(`\\.(get|post|put|patch|del|delete)\\s*\\(\\s*${q}(\\/${body})${q}`, 'g')
      )) {
        record(m[2], METHOD_FROM_NAME[m[1]] || 'GET');
      }

      // A generic request taking the path first: request(ctx, '/x', { method })
      for (const m of code.matchAll(
        new RegExp(
          `\\brequest\\s*(?:<[^>]*>)?\\s*\\(\\s*(?:[A-Za-z_$][\\w$]*\\s*,\\s*)?${q}(\\/${body})${q}`,
          'g'
        )
      )) {
        record(m[1], methodIn(restOfCall(m.index! + m[0].length)));
      }
    }

    // A raw fetch against the base URL: apiFetch(`${base}/x`, { method })
    for (const m of code.matchAll(/\bapiFetch\s*\(\s*`\$\{[^}]*\}(\/[^`]*)`/g)) {
      record(m[1], methodIn(restOfCall(m.index! + m[0].length)));
    }
  }

  return { calls, unreadable };
}

/**
 * The calls that match no mounted route.
 *
 * The apps' base URL already ends in `/api`, and the server mounts the same router
 * at `/api` and `/api/v1`, so an app path is compared with that prefix added.
 */
export function unmatchedCalls(calls: AppCall[], mounted: MountedRoute[]): AppCall[] {
  const have = new Set(mounted.map(r => `${r.method} ${normalisePath(r.path)}`));
  return calls.filter(call => !have.has(`${call.method} ${normalisePath('/api/' + call.path)}`));
}
