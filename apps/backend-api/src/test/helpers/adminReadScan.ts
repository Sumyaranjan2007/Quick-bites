/**
 * How the admin app READS what the server sends, found from its source.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO STOP COMING BACK
 * -------------------------------------------------------------------------
 * `createClient` in admin-mobile/src/lib/api.ts already returns `payload.data`.
 * Seventeen loaders then did `.then(r => r.data)` a second time, got
 * `undefined`, and seven money screens (Pay, Cash in, Card & UPI, Inflation,
 * Bank, Settlements, Switches) said "nothing here" from 22 to 26 Sep while
 * people were owed money and bank accounts were waiting.
 *
 * Every check was green. The route contract proved the paths existed, the body
 * contract proved what the app SENDS, and the section checks called the routes
 * directly. Nothing put the app's own read against the real response. This
 * does, in two ways:
 *
 *   1. `doubleUnwraps` finds a second unwrap of a client result anywhere.
 *   2. `typedLoaders` finds every `useResource<T>(() => api.get('/path'))` and
 *      the keys `T` promises, so a suite can call the real route and check the
 *      keys are really there.
 *
 * Shared, like `resourceErrorScan`, so the suite can also prove the scanner
 * still finds a planted defect: a scanner that silently stops matching reports
 * a clean app.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Comments out, line breaks kept, so a reported line is the file's own line. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export interface Finding {
  file: string;
  line: number;
  text: string;
}

export interface TypedLoader {
  file: string;
  line: number;
  path: string;
  /** Keys the screen's type says are always there. Empty for `any`. */
  requiredKeys: string[];
  typeText: string;
}

export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/**
 * A second unwrap of what the client already unwrapped.
 *
 * Two shapes, both seen in the app: `api.get(...).then(r => r.data)`, and
 * `const result = await api.put(...)` followed by `result.data.<key>`.
 */
export function doubleUnwrapsIn(file: string, raw: string): Finding[] {
  const text = stripComments(raw);
  const found: Finding[] = [];

  const chained = /api\.(?:get|post|put|patch|del)\b[\s\S]{0,400}?\)\s*\.then\(\s*\(?\s*(\w+)\s*(?::\s*\w+)?\s*\)?\s*=>\s*\1\??\.data\b/g;
  for (const m of text.matchAll(chained)) {
    found.push({ file, line: lineOf(text, m.index!), text: m[0].replace(/\s+/g, ' ').slice(-80) });
  }

  const assigned = new Set<string>();
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+api\.(?:get|post|put|patch|del)\b/g)) {
    assigned.add(m[1]);
  }
  for (const name of assigned) {
    const read = new RegExp(`(?<![\\w.])${name}\\??\\.data\\b`, 'g');
    for (const m of text.matchAll(read)) {
      found.push({ file, line: lineOf(text, m.index!), text: `${name}.data` });
    }
  }
  return found;
}

export function doubleUnwraps(srcDir: string): Finding[] {
  return sourceFiles(srcDir).flatMap(f =>
    doubleUnwrapsIn(path.relative(srcDir, f), fs.readFileSync(f, 'utf8'))
  );
}

/** Reads a balanced `<...>` starting at `open`, returning the inside and the end index. */
function balancedAngle(text: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<' || ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === '}' || ch === ')' || ch === ']') {
      if (ch === '>' && text[i - 1] === '=') continue; // an arrow inside the type
      depth--;
      if (depth === 0) return ch === '>' ? { inner: text.slice(open + 1, i), end: i } : null;
    }
  }
  return null;
}

/** The top-level keys of an object type body, and whether each is optional. */
export function topLevelKeys(body: string): Array<{ key: string; optional: boolean }> {
  const keys: Array<{ key: string; optional: boolean }> = [];
  let depth = 0;
  let segment = '';
  const flush = () => {
    const m = segment.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:/);
    if (m) keys.push({ key: m[1], optional: Boolean(m[2]) });
    segment = '';
  };
  for (const ch of body) {
    if ('{[(<'.includes(ch)) depth++;
    if ('}])>'.includes(ch)) depth--;
    if (depth === 0 && (ch === ';' || ch === ',' || ch === '\n')) flush();
    else segment += ch;
  }
  flush();
  return keys;
}

function interfaceBody(text: string, name: string): string | null {
  const at = text.search(new RegExp(`interface\\s+${name}\\s*\\{`));
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

export function typedLoadersIn(file: string, raw: string): TypedLoader[] {
  const text = stripComments(raw);
  const out: TypedLoader[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('useResource<', from);
    if (at < 0) break;
    from = at + 1;
    const typed = balancedAngle(text, at + 'useResource'.length);
    if (!typed) continue;
    const rest = text.slice(typed.end + 1, typed.end + 400);
    const call = rest.match(/^\s*\(\s*\(\)\s*=>\s*api\.get(?:<[^>]*>)?\(\s*(['"`])([^'"`$]*)\1\s*\)/);
    if (!call) continue;

    const typeText = typed.inner.trim();
    let body: string | null = null;
    if (typeText.startsWith('{')) body = typeText.slice(1, -1);
    else if (/^[A-Z]\w*$/.test(typeText)) body = interfaceBody(text, typeText);

    out.push({
      file,
      line: lineOf(text, at),
      path: call[2],
      requiredKeys: body ? topLevelKeys(body).filter(k => !k.optional).map(k => k.key) : [],
      typeText: typeText.replace(/\s+/g, ' ').slice(0, 60)
    });
  }
  return out;
}

export function typedLoaders(srcDir: string): TypedLoader[] {
  return sourceFiles(srcDir).flatMap(f =>
    typedLoadersIn(path.relative(srcDir, f), fs.readFileSync(f, 'utf8'))
  );
}
