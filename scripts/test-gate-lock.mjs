#!/usr/bin/env node
/**
 * Checks the machine-wide gate lock with real processes.
 *
 * Not one of the backend suites, and deliberately so: those run INSIDE the gate, which
 * already holds this lock, so a suite trying to take it would wait on itself. The
 * runner runs this first, before it takes the real lock, and stops if it fails. It
 * also runs on its own:
 *
 *   node scripts/test-gate-lock.mjs
 *
 * Every case uses its own lock file in the temp directory, never the real one, so it
 * can run while a real gate is running without disturbing it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGateLock } from './gateLock.mjs';

const SELF = fileURLToPath(import.meta.url);

/* ---------------------------------------------------------------- *
 *  Child mode: take the lock, hold it, let go.                      *
 * ---------------------------------------------------------------- */

if (process.argv[2] === '--child') {
  const [, , , lockPath, holdMs, timeoutMs] = process.argv;
  await acquireGateLock({
    lockPath,
    timeoutMs: Number(timeoutMs),
    pollMs: 50,
    log: line => console.log(`LOG ${line}`)
  });
  console.log(`ACQUIRED ${Date.now()}`);
  await new Promise(r => setTimeout(r, Number(holdMs)));
  console.log(`RELEASED ${Date.now()}`);
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 *  Harness                                                          *
 * ---------------------------------------------------------------- */

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.log(`[FAIL] ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function freshLock(label) {
  const p = path.join(os.tmpdir(), `qb-gate-lock-test-${label}-${process.pid}.lock`);
  fs.rmSync(p, { force: true });
  return p;
}

function child(lockPath, holdMs, timeoutMs = 20_000) {
  const proc = spawn(process.execPath, [SELF, '--child', lockPath, String(holdMs), String(timeoutMs)]);
  let out = '';
  proc.stdout.on('data', d => (out += d));
  proc.stderr.on('data', d => (out += d));
  const done = new Promise(resolve => proc.on('exit', code => resolve({ code, out })));
  return { proc, done, output: () => out };
}

const stamp = (out, word) => Number((out.match(new RegExp(`${word} (\\d+)`)) || [])[1]);
const waitFor = (fn, ms = 10_000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => (fn() ? resolve() : Date.now() - t0 > ms ? reject(new Error('timed out')) : setTimeout(tick, 20));
    tick();
  });

console.log('====================================================');
console.log('  ONE GATE RUN AT A TIME, PER MACHINE               ');
console.log('====================================================\n');

/* 1. Two runs started together take turns. */
{
  const lock = freshLock('together');
  const a = child(lock, 600);
  const b = child(lock, 600);
  const [ra, rb] = await Promise.all([a.done, b.done]);

  const spans = [ra, rb]
    .map(r => ({ from: stamp(r.out, 'ACQUIRED'), to: stamp(r.out, 'RELEASED') }))
    .sort((x, y) => x.from - y.from);

  check('Two runs started together BOTH finish', ra.code === 0 && rb.code === 0, `exit ${ra.code}/${rb.code}`);
  check(
    'and they never hold the ports at the same time',
    spans[1].from >= spans[0].to,
    `second started at +${spans[1].from - spans[0].from}ms, first released at +${spans[0].to - spans[0].from}ms`
  );
  check(
    'and the one that waited SAID it was waiting',
    /waiting/.test(ra.out + rb.out),
    'no waiting message was printed'
  );
  check('and the lock is gone afterwards', !fs.existsSync(lock));
}

/*
 * 1b. A lock that exists but is not written YET belongs to the run writing it.
 *
 * The lock is created, then written. A run that looked in between used to call the
 * empty file stale, delete it, and take the lock alongside its owner. Two runs arriving
 * together hit that gap only sometimes, so case 1 cannot be trusted to catch it; this
 * holds the gap open.
 */
{
  const lock = freshLock('unwritten');
  fs.writeFileSync(lock, '');
  const t0 = Date.now();
  const release = await acquireGateLock({
    lockPath: lock,
    timeoutMs: 20_000,
    pollMs: 50,
    unwrittenGraceMs: 1_000,
    log: () => {}
  });
  const waited = Date.now() - t0;
  check(
    'A lock created a moment ago and not yet written is NOT taken over at once',
    waited >= 800,
    `taken after ${waited}ms`
  );
  check('but one left empty for long is, so it cannot block every run', waited < 5_000, `took ${waited}ms`);
  release();
}

/* 2. A run killed mid-way does not block the next. */
{
  const lock = freshLock('killed');
  const victim = child(lock, 60_000);
  await waitFor(() => /ACQUIRED/.test(victim.output()));
  victim.proc.kill('SIGKILL');
  await victim.done;
  check('A killed run leaves its lock file behind (the case this handles)', fs.existsSync(lock));

  const t0 = Date.now();
  const next = child(lock, 100);
  const r = await next.done;
  check('and the next run still starts', r.code === 0 && /ACQUIRED/.test(r.out), r.out.slice(0, 200));
  check(
    'promptly, by taking over the stale lock — not by waiting out the timeout',
    Date.now() - t0 < 5_000 && /stale/.test(r.out),
    `took ${Date.now() - t0}ms`
  );
}

/* 3. A run that is genuinely stuck fails the next one, loudly, instead of hanging it. */
{
  const lock = freshLock('stuck');
  const holder = child(lock, 5_000);
  await waitFor(() => /ACQUIRED/.test(holder.output()));
  const waiter = child(lock, 100, 700);
  const r = await waiter.done;
  check('A run waiting on a stuck one gives up at the timeout with exit 1', r.code === 1, `exit ${r.code}`);
  check(
    'and names the run it was waiting for',
    /Gave up waiting/.test(r.out) && new RegExp(`PID ${holder.proc.pid}`).test(r.out),
    r.out.slice(0, 240)
  );
  holder.proc.kill('SIGKILL');
  await holder.done;
  fs.rmSync(lock, { force: true });
}

/* 4. A lock too old to be real is stale even if its PID is alive (PID reuse). */
{
  const lock = freshLock('ancient');
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() })
  );
  // In a child, so a lock that is wrongly honoured shows as a failed check rather than
  // as this harness giving up at the timeout.
  const r = await child(lock, 100, 2_000).done;
  check(
    'A two-hour-old lock is taken over even though its PID is running',
    r.code === 0 && /ACQUIRED/.test(r.out),
    r.out.slice(0, 200)
  );
  check('and releasing removes it', !fs.existsSync(lock));
}

/* 5. Releasing never removes somebody else's lock. */
{
  const lock = freshLock('foreign');
  const release = await acquireGateLock({ lockPath: lock, timeoutMs: 2_000, pollMs: 50, log: () => {} });
  // Another run declared this one stale and took the lock over.
  fs.writeFileSync(lock, JSON.stringify({ pid: 999_999_1, startedAt: new Date().toISOString() }));
  release();
  check("Releasing does not delete a lock another run has since taken", fs.existsSync(lock));
  fs.rmSync(lock, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
