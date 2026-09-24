/**
 * Finds admin data sources whose failure is never shown to anybody.
 *
 * -------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO STOP COMING BACK
 * -------------------------------------------------------------------------
 * `useResource` returns `{ data, loading, error, denied }` and renders nothing
 * itself. There is no toast and no global handler. So a screen that never reads
 * `.error` turns a failed request into `data === null`, which its own code then
 * renders as an EMPTY LIST — "No restaurants yet" for a server that returned 500.
 *
 * That is the exact defect the owner reported about the bank screen, and it was
 * repeated across most of the admin app. A server error shown as an empty list is
 * worse than a crash: it is confidently wrong, it needs no investigation, and the
 * person reading it goes away satisfied.
 *
 * `useResource`'s own header says it exists so that one screen does not end up
 * silently swallowing its error. It cannot enforce that from inside itself, and a
 * rule written in a comment would not survive the first new screen. So it is a
 * check.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS A SHARED HELPER AND NOT A BLOCK IN ONE SUITE
 * -------------------------------------------------------------------------
 * It is used twice: once to assert the admin app has no silent source, and once to
 * prove the scanner itself can still find one. A scanner that quietly stops
 * matching — a renamed hook, a new way of writing the call — reports a clean app,
 * which is the same output as a clean app and the opposite meaning.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SilentSource {
  file: string;
  /** The variable holding the useResource result. */
  name: string;
}

/**
 * Comments removed before anything is matched.
 *
 * The screens' own prose discusses `error` and names the sources it discusses, so
 * a scan that reads comments finds the explanation of a defect and reports that
 * the defect is fixed.
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Escapes a variable name for use inside a regular expression. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every `useResource` result in one file whose `.error` is never referenced.
 *
 * REFERENCING the error is not the same as SHOWING it, and the difference cost me a
 * mutation. A screen that reads `.error` only to suppress its empty state renders a
 * blank area — better than a lie, and still not a message — yet a scanner asking
 * "is `.error` mentioned anywhere" passes it. So what counts is either:
 *
 *   DELEGATED — the whole resource handed to `ResourceState` or `ResourceError`,
 *               which takes responsibility for the four states. That is the outcome
 *               this is pushing towards, so flagging it would push people back to
 *               copying branches around by hand.
 *
 *   RENDERED  — the error appearing somewhere that puts it on screen: inside a JSX
 *               expression, or passed to something that displays it.
 *
 * A bare `!x.error` guard is neither, and is flagged.
 */
export function silentSourcesIn(filePath: string): SilentSource[] {
  const code = stripComments(fs.readFileSync(filePath, 'utf8'));
  const file = path.basename(filePath);

  const names = Array.from(code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*useResource\s*[<(]/g)).map(
    m => m[1]
  );

  const silent: SilentSource[] = [];
  for (const name of new Set(names)) {
    const safe = escapeForRegex(name);
    const delegated = new RegExp(`resource=\\{${safe}\\}`).test(code);

    /*
     * Shapes that put the text in front of somebody. `{x.error}` covers the plain
     * render and `{!!x.error && ...}` alike, because both open with a brace and
     * reach the property; `message=` and its neighbours cover handing it to a
     * component that displays it.
     */
    const rendered =
      new RegExp(`\\{\\s*!*\\s*${safe}\\.error\\b`).test(code) ||
      new RegExp(`(message|title|label|subtitle)=\\{\\s*${safe}\\.error\\b`).test(code);

    if (!delegated && !rendered) silent.push({ file, name });
  }
  return silent;
}

/** Every silent source across a set of directories. */
export function scanForSilentSources(dirs: string[]): SilentSource[] {
  const found: SilentSource[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue;
      found.push(...silentSourcesIn(path.join(dir, entry)));
    }
  }
  return found;
}
