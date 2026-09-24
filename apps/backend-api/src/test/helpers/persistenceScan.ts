/**
 * Finds writes to the store that no save ever follows.
 *
 * -------------------------------------------------------------------------
 * THE FAILURE THIS CATCHES, AND WHY NOTHING ELSE WOULD
 * -------------------------------------------------------------------------
 * `memoryStore` is Maps. A write to a Map is correct in memory and gone on the
 * next restart unless something schedules a write to disk — `triggerAutoSave`, a
 * repository that calls it, or `flushStore`.
 *
 * Nothing fails when that is forgotten. Every check passes, every screen looks
 * right, and the data survives for as long as the process does. It reappears as a
 * setting that resets itself after a deploy, which reads as a bug in the setting
 * rather than a missing save — and on a quiet day it can be weeks before anybody
 * connects the two.
 *
 * It had already happened twice: the digest's sent-slot marker, whose whole purpose
 * is to survive a restart, and the notification switches, which were saved only
 * because the route that set them happened to write an audit row afterwards. That
 * second one is the dangerous shape: it works, for a reason that has nothing to do
 * with the code that needs it.
 *
 * -------------------------------------------------------------------------
 * COARSE ON PURPOSE
 * -------------------------------------------------------------------------
 * This asks "does this file write the store and never mention a save" — not
 * whether the save follows on every path. A precise version needs real control-flow
 * analysis, and the cheap version already catches the whole class that has
 * actually bitten: somebody writing a Map without knowing a save is needed at all.
 */
import fs from 'node:fs';
import path from 'node:path';

const WRITES = /memoryStore\.[A-Za-z]+\.(set|delete|clear)\s*\(/;
const SAVES = /triggerAutoSave\s*\(|flushStore\s*\(|Repository\.save\s*\(/;

/**
 * Files allowed to write without saving, each for a stated reason.
 *
 * An allowlist rather than a looser rule, so adding to it is a decision somebody
 * makes and can be argued with, rather than a pattern that quietly widens.
 */
export const ALLOWED_WITHOUT_SAVE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'db/client.ts',
    why: 'This is where loading and saving live.'
  },
  {
    file: 'db/normaliseStore.ts',
    why: 'Runs while the file is being read IN. Saving from here would write back what was just loaded.'
  },
  {
    file: 'db/seed.ts',
    why: 'Seeding writes the whole store and the caller flushes once at the end.'
  },
  {
    file: 'routes/admin/platformRoutes.ts',
    why: 'The platform reset empties the store and writes it out synchronously in one step.'
  }
];

export interface UnsavedWrite {
  file: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Comments removed first: the prose here names `triggerAutoSave` while discussing it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function scanForUnsavedWrites(srcDir: string): UnsavedWrite[] {
  const allowed = new Set(ALLOWED_WITHOUT_SAVE.map(a => a.file));
  const found: UnsavedWrite[] = [];

  for (const full of walk(srcDir)) {
    const relative = path.relative(srcDir, full).split(path.sep).join('/');
    if (allowed.has(relative)) continue;

    const code = stripComments(fs.readFileSync(full, 'utf8'));
    if (!WRITES.test(code)) continue;
    if (SAVES.test(code)) continue;
    found.push({ file: relative });
  }

  return found;
}
