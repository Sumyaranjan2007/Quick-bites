/**
 * One backend gate run at a time, per MACHINE.
 *
 * -------------------------------------------------------------------------
 * WHY THIS EXISTS
 * -------------------------------------------------------------------------
 * The backend suites bind fixed ports. Two gate runs at once on the same computer
 * collide, and the suites that lose the race crash on exit rather than failing a
 * check — so the gate reports "3 SUITES FAILED" with no failing check anywhere in the
 * output. It happened on 25 Sep: identity, kitchenPush and admin all "failed", all
 * three passed alone, and a re-run with no code change was green. Another session was
 * running its own gate at the same moment.
 *
 * That kind of red is worse than useless. It is a failure nobody introduced, and the
 * reasonable response to one is to re-run until it goes green — which is exactly the
 * habit that lets a real failure through.
 *
 * -------------------------------------------------------------------------
 * WHY THE LOCK LIVES IN THE TEMP DIRECTORY, NOT THE REPOSITORY
 * -------------------------------------------------------------------------
 * The collision was not only two sessions sharing one checkout. A second checkout of
 * the same repository — a git worktree in another directory, used to verify a branch —
 * shares the same ports, and a lock file inside the repository is invisible to it.
 * `os.tmpdir()` is shared by every checkout on the machine, which is the scope the
 * ports have.
 *
 * -------------------------------------------------------------------------
 * WAIT, DON'T FAIL — BUT NOT FOR EVER
 * -------------------------------------------------------------------------
 * A second run waits for the first and says so. A lock whose process has gone is
 * taken over, so a run that was killed does not block the next one. And the wait has
 * a limit: a run stuck for fifteen minutes fails the next one with a message naming
 * it, rather than hanging it silently.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GATE_LOCK_PATH = path.join(os.tmpdir(), 'quick-bites-backend-gate.lock');

/** Whether a process with this id is running. */
function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to somebody else — still running.
    return err && err.code === 'EPERM';
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    // Unreadable or half-written. Treated as stale below once it has stayed that way for
    // a few seconds, because a lock nobody can read cannot be honoured and would
    // otherwise block every run until the timeout.
    return null;
  }
}

/**
 * Whether a lock nobody can read has been that way long enough to be abandoned.
 *
 * The lock is created and then written, so for a moment every lock is empty. An empty
 * lock only a few seconds old is being written, not abandoned.
 */
function unreadableForLong(lockPath, graceMs) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > graceMs;
  } catch {
    // Gone since we looked; the next attempt will simply take it.
    return false;
  }
}

function clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'an unknown time'
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Takes the machine-wide gate lock, waiting if another run holds it.
 *
 * Returns a release function. Also releases on exit and on SIGINT/SIGTERM, so a run
 * stopped with Ctrl+C does not leave the next one waiting.
 *
 * @param {object} [options]
 * @param {string} [options.lockPath]    where the lock lives (tests pass their own)
 * @param {number} [options.timeoutMs]   how long to wait before giving up
 * @param {number} [options.pollMs]      how often to look again
 * @param {number} [options.staleAfterMs] a lock older than this is stale whatever its
 *   PID says — a gate run takes about a minute, and a recycled PID can make a dead run
 *   look alive
 * @param {number} [options.unwrittenGraceMs] how long an empty lock is presumed to be
 *   still being written by the run that created it
 * @param {(line: string) => void} [options.log]
 */
export async function acquireGateLock(options = {}) {
  const lockPath = options.lockPath || GATE_LOCK_PATH;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const staleAfterMs = options.staleAfterMs ?? 45 * 60_000;
  const unwrittenGraceMs = options.unwrittenGraceMs ?? 5_000;
  const log = options.log || (line => console.log(line));

  const started = Date.now();
  let announced = null;

  for (;;) {
    try {
      // 'wx' creates the file only if it does not exist — atomic, so two runs that
      // arrive together cannot both believe they won.
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(
        fd,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd: process.cwd() })
      );
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }

    const held = readLock(lockPath);
    if (!held && !unreadableForLong(lockPath, unwrittenGraceMs)) {
      // Created an instant ago and not yet written: the run that made it is filling it
      // in. Treating this as stale let two runs arriving together BOTH take the lock.
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, 100)));
      continue;
    }
    const age = held ? Date.now() - new Date(held.startedAt).getTime() : Infinity;
    const stale = !held || !isRunning(held.pid) || !(age < staleAfterMs);

    if (stale) {
      log(
        held
          ? `Taking over a stale gate lock left by PID ${held.pid} (started ${clock(held.startedAt)}), which is no longer running.`
          : 'Taking over an unreadable gate lock.'
      );
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Somebody else took it over first; the next loop will see their lock.
      }
      continue;
    }

    if (Date.now() - started >= timeoutMs) {
      log(
        `Gave up waiting after ${Math.round(timeoutMs / 60_000)} minutes: another gate run ` +
          `(PID ${held.pid}, started ${clock(held.startedAt)}${held.cwd ? `, in ${held.cwd}` : ''}) ` +
          'still holds the test ports. If that run is stuck, stop it and run the gate again.'
      );
      process.exit(1);
    }

    if (announced !== held.pid) {
      log(
        `Another gate run (PID ${held.pid}, started ${clock(held.startedAt)}) is using the test ports, waiting…`
      );
      announced = held.pid;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Only our own lock. A run that was declared stale and whose lock another run has
    // since taken must not delete the new owner's file on its way out.
    const held = readLock(lockPath);
    if (held && held.pid === process.pid) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  };

  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      release();
      process.exit(130);
    });
  }

  return release;
}
