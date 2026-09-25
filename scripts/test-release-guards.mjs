#!/usr/bin/env node
/**
 * Checks the release guards (scripts/release/releaseGuards.mjs) without building.
 *
 * scripts/build-apks.sh runs this first and stops if it fails, so a guard that
 * has stopped guarding cannot wave a build through.
 *
 * It makes real bad APKs to feed the certificate check: an unsigned one, one
 * re-signed with a throwaway "Android Debug" key, and one with two signers. The
 * throwaway keys are generated here, in the temp directory, and deleted; the
 * real keys in the vault are never read.
 *
 *   node scripts/test-release-guards.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  nextVersionCode,
  claimVersionCode,
  assertAbove,
  setVersion,
  versionNameFor,
  checkSigning,
  parseSigners,
  verifyApk,
  findBuildTools,
  PINNED_PATH
} from './release/releaseGuards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = process.env.QB_RELEASE_ARCHIVE || path.resolve(ROOT, '..', 'quick-bites-release-archive', '2026-09-23');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-release-guards-'));

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.log(`[FAIL] ${name} -- ${err?.message || err}`);
  }
}
function skip(name, why) {
  skipped++;
  console.log(`[SKIP] ${name} -- ${why}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const expectThrow = (fn, pattern) => {
  try {
    fn();
  } catch (err) {
    assert(!pattern || pattern.test(err.message), `threw, but not for the right reason: ${err.message}`);
    return;
  }
  throw new Error('did not refuse');
};

console.log('====================================================');
console.log('  EVERY BUILD INSTALLS AS AN UPDATE, OR NONE DOES   ');
console.log('====================================================\n');

try {
  /* ---------------------------------------------------------------- */
  console.log('-- U-1: the versionCode only goes up');
  const versionPath = path.join(WORK, 'version.json');
  const localPath = path.join(WORK, 'local', 'last-version-code');
  const pinnedPath = path.join(WORK, 'pinned.json');
  fs.writeFileSync(versionPath, JSON.stringify({ lastVersionCode: 7 }));
  fs.writeFileSync(pinnedPath, JSON.stringify({ installedVersionCode: 7, apps: {} }));
  const opts = { versionPath, localPath, pinnedPath };

  check('The next code is one more than the last committed one', () => {
    assert(nextVersionCode(opts).next === 8, `got ${nextVersionCode(opts).next}`);
  });
  check('Claiming it records it in the committed counter AND on this machine', () => {
    const code = claimVersionCode(opts);
    assert(code === 8, `claimed ${code}`);
    assert(JSON.parse(fs.readFileSync(versionPath, 'utf8')).lastVersionCode === 8, 'counter not written');
    assert(fs.readFileSync(localPath, 'utf8').trim() === '8', 'local record not written');
  });
  check('A counter that was never committed back cannot be reused: the machine record wins', () => {
    fs.writeFileSync(versionPath, JSON.stringify({ lastVersionCode: 7 }));
    assert(nextVersionCode(opts).next === 9, `got ${nextVersionCode(opts).next}`);
  });
  check('Nor can a code at or below what is on the phones', () => {
    fs.writeFileSync(versionPath, JSON.stringify({ lastVersionCode: 3 }));
    fs.rmSync(localPath);
    assert(nextVersionCode(opts).next === 8, `got ${nextVersionCode(opts).next}`);
  });
  check('A code not above the last one is refused', () => {
    expectThrow(() => assertAbove(8, 8), /not above/);
    expectThrow(() => assertAbove(7, 8), /not above/);
    assertAbove(9, 8);
  });
  check('With no record at all it refuses to guess', () => {
    const bare = { versionPath: path.join(WORK, 'none.json'), localPath: path.join(WORK, 'none'), pinnedPath: path.join(WORK, 'none2.json') };
    expectThrow(() => nextVersionCode(bare), /No versionCode on record/);
  });

  const appDir = path.join(WORK, 'app');
  fs.mkdirSync(path.join(appDir, 'android', 'app'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'apps', 'customer-mobile', 'app.json'), path.join(appDir, 'app.json'));
  const gradle = 'android {\n    defaultConfig {\n        applicationId "com.quickbite.app"\n        versionCode 7\n        versionName "1.3.0"\n    }\n}\n';
  fs.writeFileSync(path.join(appDir, 'android', 'app', 'build.gradle'), gradle);
  const when = new Date('2026-09-25T10:00:00Z');
  check('It is written into BOTH app.json and build.gradle, with the date in the versionName', () => {
    const result = setVersion(appDir, 12, { date: when });
    const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8'));
    const written = fs.readFileSync(path.join(appDir, 'android', 'app', 'build.gradle'), 'utf8');
    assert(appJson.expo.android.versionCode === 12, 'app.json not written');
    assert(/versionCode 12\n/.test(written), 'build.gradle versionCode not written');
    assert(written.includes(`versionName "${versionNameFor(appJson.expo.version, 12, when)}"`), 'versionName not written');
    assert(result.versionName.endsWith('-20260925.12'), result.versionName);
  });
  check('A build.gradle without exactly one versionCode line is refused, not half-written', () => {
    fs.writeFileSync(path.join(appDir, 'android', 'app', 'build.gradle'), 'android { defaultConfig { } }\n');
    expectThrow(() => setVersion(appDir, 13), /expected exactly one of each/);
  });

  /* ---------------------------------------------------------------- */
  console.log('\n-- U-2: no silent debug signing');
  const unsigned = path.join(WORK, 'unsigned-app');
  fs.mkdirSync(path.join(unsigned, 'android'), { recursive: true });
  check('An app with no release keystore is REFUSED', () => {
    const r = checkSigning(unsigned, { env: {} });
    assert(r.ok === false && /DEBUG KEY/.test(r.reason), JSON.stringify(r));
  });
  check('unless --allow-debug-signing says so, and then it is marked DEBUG', () => {
    const r = checkSigning(unsigned, { allowDebugSigning: true, env: {} });
    assert(r.ok === true && r.debug === true, JSON.stringify(r));
  });
  check('A keystore.properties, or QB_KEYSTORE_PATH, is a release build', () => {
    assert(checkSigning(unsigned, { env: { QB_KEYSTORE_PATH: 'x' } }).debug === false, 'env not honoured');
    fs.writeFileSync(path.join(unsigned, 'android', 'keystore.properties'), 'storeFile=x\n');
    assert(checkSigning(unsigned, { env: {} }).debug === false, 'file not honoured');
  });

  /* ---------------------------------------------------------------- */
  console.log('\n-- U-3: the certificate on the phones');
  check('apksigner output with no signer count is unreadable, and refused', () => {
    expectThrow(() => parseSigners(''), /number of signers/);
    expectThrow(() => parseSigners('Verifies\n'), /number of signers/);
  });
  check('A digest that is not 64 hex characters is not read as one', () => {
    const r = parseSigners('Number of signers: 1\nSigner #1 certificate SHA-256 digest: abc\n');
    assert(r.sha256.length === 0, JSON.stringify(r));
  });
  check('An app with no pinned certificate is refused', () => {
    const problems = verifyApk('no-such-app', path.join(WORK, 'x.apk'));
    assert(problems.length === 1 && /No pinned certificate/.test(problems[0]), JSON.stringify(problems));
  });

  const pinned = JSON.parse(fs.readFileSync(PINNED_PATH, 'utf8'));
  const archived = app => path.join(ARCHIVE, `${app}.apk`);
  if (!fs.existsSync(archived('customer-mobile'))) {
    skip('The pinned certificates are the ones on the 23 Sep APKs', `no archive at ${ARCHIVE}`);
    skip('A bad APK is refused', 'needs an archived APK to alter');
  } else {
    for (const app of Object.keys(pinned.apps)) {
      check(`${app}: the 23 Sep APK passes against its pin (the pin is the phones' certificate)`, () => {
        const problems = verifyApk(app, archived(app), { expectedVersionCode: 7 });
        assert(problems.length === 0, problems.join(' | '));
      });
    }
    check('The customer APK checked as the admin app is refused, on certificate AND package', () => {
      const problems = verifyApk('admin-mobile', archived('customer-mobile'));
      assert(problems.some(p => /would NOT install/.test(p)) && problems.some(p => /package/.test(p)), problems.join(' | '));
    });
    check('An APK whose versionCode is not the one this build claimed is refused', () => {
      const problems = verifyApk('customer-mobile', archived('customer-mobile'), { expectedVersionCode: 8 });
      assert(problems.some(p => /versionCode is 7, not the 8/.test(p)), problems.join(' | '));
    });

    const tools = findBuildTools();
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
    const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
    const apksigner = (...args) => spawnSync(java, ['-jar', path.join(tools, 'lib', 'apksigner.jar'), ...args], { encoding: 'utf8' });
    const makeKey = (name, dn) => {
      const ks = path.join(WORK, `${name}.jks`);
      const r = spawnSync(keytool, ['-genkeypair', '-keystore', ks, '-alias', name, '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '2', '-storepass', 'throwaway-test-only', '-keypass', 'throwaway-test-only', '-dname', dn], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`keytool: ${r.stderr || r.stdout}`);
      return ks;
    };
    const signerArgs = (ks, name) => ['--ks', ks, '--ks-key-alias', name, '--ks-pass', 'pass:throwaway-test-only', '--key-pass', 'pass:throwaway-test-only'];

    check('A DEBUG-signed build (same app, a different key) is refused as not installing over the phones\' app', () => {
      const debugKs = makeKey('debug', 'CN=Android Debug,O=Android,C=US');
      const out = path.join(WORK, 'debug-signed.apk');
      const r = apksigner('sign', ...signerArgs(debugKs, 'debug'), '--out', out, archived('customer-mobile'));
      assert(r.status === 0, `could not make the test APK: ${r.stderr}`);
      const problems = verifyApk('customer-mobile', out);
      assert(problems.some(p => /would NOT install/.test(p)), problems.join(' | ') || 'it passed');
    });
    check('An APK with TWO signers is refused: exactly one is expected', () => {
      const a = makeKey('first', 'CN=First');
      const b = makeKey('second', 'CN=Second');
      const out = path.join(WORK, 'two-signers.apk');
      const r = apksigner('sign', '--v3-signing-enabled', 'false', '--v4-signing-enabled', 'false', ...signerArgs(a, 'first'), '--next-signer', ...signerArgs(b, 'second'), '--out', out, archived('customer-mobile'));
      assert(r.status === 0, `could not make the test APK: ${r.stderr}`);
      const problems = verifyApk('customer-mobile', out);
      assert(problems.some(p => /2 signers/.test(p)), problems.join(' | ') || 'it passed');
    });
    check('An UNSIGNED APK is refused, never read as "no certificate, so fine"', () => {
      const out = path.join(WORK, 'unsigned.apk');
      const manifestDir = path.join(WORK, 'unsigned-src');
      fs.mkdirSync(manifestDir, { recursive: true });
      fs.writeFileSync(path.join(manifestDir, 'AndroidManifest.xml'), '<manifest/>');
      const jar = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'jar') : 'jar';
      const r = spawnSync(jar, ['cfM', out, '-C', manifestDir, '.'], { encoding: 'utf8' });
      assert(r.status === 0 && fs.existsSync(out), `could not make the test APK: ${r.stderr}`);
      const problems = verifyApk('customer-mobile', out);
      assert(problems.some(p => /not validly signed/.test(p)), problems.join(' | ') || 'it passed');
    });
    check('A file that is not there is refused', () => {
      const problems = verifyApk('customer-mobile', path.join(WORK, 'missing.apk'));
      assert(problems.some(p => /No APK at/.test(p)), problems.join(' | '));
    });
  }
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
