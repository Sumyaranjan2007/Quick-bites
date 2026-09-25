/**
 * Does every request BODY the phone apps send match what its route accepts?
 *
 * The route contract (routeContract.ts) proves the paths exist. It could not
 * see that the admin app's "Save these rates" sent `{ changes }` to a route
 * that only accepted `{ rates }`, so every platform-rate save from the app was
 * refused from the day the screen shipped. That is the failure this catches.
 *
 * SERVER SIDE: read from the running app, not re-parsed from source. The
 * `validate()` middleware carries its body schema (`bodySchema`), so `.partial()`,
 * `.omit()`, `.extend()` and `.strict()` are all exactly as enforced. A route with
 * no `validate({ body })` is counted as unvalidated and skipped, never passed.
 *
 * APP SIDE: the TypeScript AST of every file, looking for the three shapes the
 * apps use:
 *   api.post|put|patch(path, { ... })                       (admin-mobile)
 *   request(ctx?, path, { method, body: JSON.stringify({ ... }) })  (partner, rider)
 *   apiFetch(`${apiUrl}/path`, { method, body: JSON.stringify({ ... }) }) (customer)
 * A body that is not an object literal (a variable) is counted as unreadable,
 * never as matching.
 *
 * FINDINGS:
 *   DROPPED   a key the app sends that a non-strict schema silently strips
 *   REFUSED   a key the app sends that a `.strict()` schema rejects (400)
 *   MISSING   a required key the app never sends (400), unless the body has a
 *             spread the scan cannot read
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { normalisePath } from './routeContract.ts';

export interface RouteBody {
  method: string;
  path: string;
  keys: Record<string, { optional: boolean }>;
  strict: boolean;
  aliases: Record<string, string>;
}

export interface AppBody {
  app: string;
  file: string;
  line: number;
  method: string;
  path: string;
  keys: string[];
  /** A spread the scan could not read, so "missing" cannot be judged. */
  opaqueSpread: boolean;
}

export interface BodyFinding {
  kind: 'DROPPED' | 'REFUSED' | 'MISSING';
  key: string;
  call: AppBody;
  route: RouteBody;
}

// --------------------------------------------------------------------------
// Server
// --------------------------------------------------------------------------

function mountPrefix(layer: any): string {
  const re = layer?.regexp;
  if (!re || re.fast_slash) return '';
  const match = String(re.source).match(/^\^\\\/((?:[\w\-.~%]|\\.)*)\\\/\?/);
  return match ? '/' + match[1].replace(/\\(.)/g, '$1') : '';
}

/** Unwraps effects (refine/transform/preprocess) down to an object schema. */
function objectOf(schema: any): any | null {
  let s = schema;
  for (let i = 0; i < 10 && s; i++) {
    const t = s?._def?.typeName;
    if (t === 'ZodObject') return s;
    if (t === 'ZodEffects') s = s._def.schema;
    else if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') s = s._def.innerType;
    else return null;
  }
  return null;
}

export function routeBodies(app: any): { routes: RouteBody[]; unvalidated: number; unmodelled: number; unvalidatedAt: string[] } {
  const routes: RouteBody[] = [];
  const unvalidatedAt: string[] = [];
  let unvalidated = 0;
  let unmodelled = 0;
  const walk = (stack: any[], base: string): void => {
    for (const layer of stack || []) {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {}).filter(m => m !== '_all').map(m => m.toUpperCase());
        if (!methods.some(m => m === 'POST' || m === 'PUT' || m === 'PATCH')) continue;
        const handles = (layer.route.stack || []).map((l: any) => l.handle);
        const withSchema = handles.find((h: any) => h && h.bodySchema);
        const aliases = Object.assign({}, ...handles.filter((h: any) => h && h.bodyAliases).map((h: any) => h.bodyAliases));
        if (!withSchema) {
          unvalidated += 1;
          unvalidatedAt.push(`${methods.join('|')} ${(base + String(layer.route.path)).replace(/\/$/, '')}`);
          continue;
        }
        const obj = objectOf(withSchema.bodySchema);
        if (!obj) {
          unmodelled += 1;
          continue;
        }
        const shape = obj.shape;
        const keys: RouteBody['keys'] = {};
        for (const [k, v] of Object.entries<any>(shape)) keys[k] = { optional: Boolean(v.isOptional?.()) };
        const full = (base + String(layer.route.path)).replace(/\/$/, '') || '/';
        for (const method of methods) {
          // `.passthrough()` hands unknown keys to a handler that refuses them
          // itself (the partner profile does, by name), so they count as refused.
          const unknownKeys = obj._def.unknownKeys;
          routes.push({ method, path: full, keys, strict: unknownKeys === 'strict' || unknownKeys === 'passthrough', aliases });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, base + mountPrefix(layer));
      }
    }
  };
  walk((app._router || app.router)?.stack, '');
  return { routes, unvalidated, unmodelled, unvalidatedAt };
}

// --------------------------------------------------------------------------
// Apps
// --------------------------------------------------------------------------

function walkSources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const BASE_HOLE = /^\$\{(?:apiUrl|API_BASE|effectiveBase|ctx\.apiUrl|baseUrl|base)\}/;

function pathOf(node: ts.Node | undefined, sf: ts.SourceFile): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sf).slice(1, -1).replace(BASE_HOLE, '');
  return null;
}

/**
 * What a body is built from: an object literal, or the keys of a declared type.
 *
 * `body: JSON.stringify(payload)` is resolved to `const payload = { ... }` in
 * an enclosing scope; `body: JSON.stringify(body)` where `body` is a typed
 * parameter is resolved to that type's properties (a type literal, or an
 * interface / type alias in the same file). Anything else — `Record<string,
 * unknown>`, a value from elsewhere — stays unreadable.
 */
type BodySource = { kind: 'object'; obj: ts.ObjectLiteralExpression } | { kind: 'type'; keys: string[] };

function typeKeys(type: ts.TypeNode | undefined, sf: ts.SourceFile): string[] | null {
  if (!type) return null;
  if (ts.isTypeLiteralNode(type)) {
    return type.members.filter(m => m.name).map(m => m.name!.getText(sf).replace(/^['"]|['"]$/g, ''));
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    let found: string[] | null = null;
    sf.forEachChild(n => {
      if (found) return;
      if (ts.isInterfaceDeclaration(n) && n.name.text === name) {
        found = n.members.filter(m => m.name).map(m => m.name!.getText(sf).replace(/^['"]|['"]$/g, ''));
      } else if (ts.isTypeAliasDeclaration(n) && n.name.text === name) {
        found = typeKeys(n.type, sf);
      }
    });
    return found;
  }
  return null;
}

function resolveIdentifier(id: ts.Identifier, sf: ts.SourceFile): BodySource | null {
  const name = id.text;
  let scope: ts.Node | undefined = id.parent;
  while (scope) {
    if (ts.isFunctionLike(scope)) {
      for (const param of (scope as ts.SignatureDeclaration).parameters) {
        if (ts.isIdentifier(param.name) && param.name.text === name) {
          const keys = typeKeys(param.type, sf);
          return keys ? { kind: 'type', keys } : null;
        }
      }
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      let hit: BodySource | null = null;
      const look = (n: ts.Node) => {
        if (hit || ts.isFunctionLike(n)) return;
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
          let init: ts.Expression = n.initializer;
          while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)) init = (init as any).expression;
          if (ts.isObjectLiteralExpression(init)) hit = { kind: 'object', obj: init };
          else {
            const keys = typeKeys(n.type, sf);
            if (keys) hit = { kind: 'type', keys };
          }
          return;
        }
        ts.forEachChild(n, look);
      };
      ts.forEachChild(scope, look);
      if (hit) return hit;
    }
    scope = scope.parent;
  }
  return null;
}

function literalBody(node: ts.Node | undefined, sf: ts.SourceFile): BodySource | null {
  if (!node) return null;
  let target: ts.Node = node;
  if (ts.isCallExpression(node) && node.expression.getText(sf) === 'JSON.stringify' && node.arguments[0]) {
    target = node.arguments[0];
  }
  if (ts.isObjectLiteralExpression(target)) return { kind: 'object', obj: target };
  if (ts.isIdentifier(target)) return resolveIdentifier(target, sf);
  return null;
}

/** Keys of an object literal, reading `...(cond ? { a } : {})` spreads too. */
function keysOf(obj: ts.ObjectLiteralExpression, sf: ts.SourceFile): { keys: string[]; opaqueSpread: boolean } {
  const keys: string[] = [];
  let opaqueSpread = false;
  const readSpread = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    if (ts.isObjectLiteralExpression(x)) {
      const inner = keysOf(x, sf);
      keys.push(...inner.keys);
      if (inner.opaqueSpread) opaqueSpread = true;
      return true;
    }
    if (ts.isConditionalExpression(x)) return readSpread(x.whenTrue) && readSpread(x.whenFalse);
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return readSpread(x.right);
    return false;
  };
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      if (!readSpread(p.expression)) opaqueSpread = true;
    } else if (p.name) {
      keys.push(p.name.getText(sf).replace(/^['"]|['"]$/g, ''));
    }
  }
  return { keys, opaqueSpread };
}

export function appBodies(app: string, srcDir: string): { bodies: AppBody[]; unreadable: number; unreadableAt: string[] } {
  const bodies: AppBody[] = [];
  let unreadable = 0;
  const unreadableAt: string[] = [];
  for (const file of walkSources(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = path.relative(path.dirname(srcDir), file);
    const push = (node: ts.Node, method: string, p: string, source: BodySource | null) => {
      if (!source) {
        unreadable += 1;
        unreadableAt.push(`${method} ${p}  ${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
        return;
      }
      const { keys, opaqueSpread } =
        source.kind === 'object' ? keysOf(source.obj, sf) : { keys: source.keys, opaqueSpread: false };
      bodies.push({
        app,
        file: rel,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        method,
        path: p,
        keys,
        opaqueSpread
      });
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        const args = node.arguments;
        // api.post(path, body)
        const m = callee.match(/(?:^|\.)(post|put|patch)$/);
        if (m && /\bapi\b|Api\b|client\b/.test(callee)) {
          const p = pathOf(args[0], sf);
          if (p && args[1]) push(node, m[1].toUpperCase(), p, literalBody(args[1], sf));
        }
        // request(...path, { method, body: JSON.stringify({...}) }) / apiFetch(url, {...})
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (!ts.isObjectLiteralExpression(a)) continue;
          let method: string | null = null;
          let bodyNode: ts.Expression | null = null;
          for (const prop of a.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const k = prop.name.getText(sf);
            if (k === 'method') method = prop.initializer.getText(sf).replace(/['"`]/g, '');
            if (k === 'body') bodyNode = prop.initializer;
          }
          if (!method || !bodyNode || !['POST', 'PUT', 'PATCH'].includes(method)) continue;
          const p = args.slice(0, i).map(x => pathOf(x, sf)).find(Boolean);
          if (p) push(node, method, p, literalBody(bodyNode, sf));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { bodies, unreadable, unreadableAt };
}

// --------------------------------------------------------------------------
// Compare
// --------------------------------------------------------------------------

function segments(p: string): string[] {
  return normalisePath(p).split('/').filter(Boolean);
}

function sameShape(route: string, call: string): boolean {
  const a = segments(route);
  const b = segments(call);
  return a.length === b.length && a.every((s, i) => s === ':param' || b[i] === ':param' || s === b[i]);
}

export function matchRoute(call: AppBody, routes: RouteBody[]): RouteBody | undefined {
  const target = '/api/' + call.path.replace(/^\//, '');
  return routes.find(r => r.method === call.method && !r.path.startsWith('/api/v1') && sameShape(r.path, target));
}

export function compareBodies(bodies: AppBody[], routes: RouteBody[]): { findings: BodyFinding[]; matched: number } {
  const findings: BodyFinding[] = [];
  let matched = 0;
  for (const call of bodies) {
    const route = matchRoute(call, routes);
    if (!route) continue;
    matched += 1;
    const sent = call.keys.map(k => route.aliases[k] || k);
    for (const k of call.keys) {
      const effective = route.aliases[k] || k;
      if (!(effective in route.keys)) findings.push({ kind: route.strict ? 'REFUSED' : 'DROPPED', key: k, call, route });
    }
    if (!call.opaqueSpread) {
      for (const [k, v] of Object.entries(route.keys)) {
        if (!v.optional && !sent.includes(k)) findings.push({ kind: 'MISSING', key: k, call, route });
      }
    }
  }
  return { findings, matched };
}

/** A stable id for a finding, used by the known-findings list. */
export function findingId(f: BodyFinding): string {
  return `${f.kind} ${f.key} ${f.call.method} ${normalisePath('/api/' + f.call.path.replace(/^\//, ''))} (${f.call.app})`;
}
