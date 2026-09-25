#!/usr/bin/env node
/**
 * The checks that make every APK install as an UPDATE over the one on the phone.
 *
 * Android installs a new build over an old one only when the package name is
 * the same, the signing certificate is the same, and the versionCode is not
 * lower. Get any of the three wrong and the owner's phone refuses the update,
 * or worse, a debug-signed build goes out that nobody can ever update.
 *
 *   U-1  versionCode: strictly increasing, one more than the higher of the
 *        committed counter (release/version.json) and this machine's own record,
 *        written into app.json AND android/app/build.gradle.
 *   U-2  a release build with no release keystore is refused, not warned about.
 *        withReleaseSigning falls back to Android's debug key silently.
 *   U-3  every built APK is read with apksigner and must carry EXACTLY ONE
 *        signer whose certificate matches the one pinned from the APKs on the
 *        phones (release/signing-certificates.json), with the right package and
 *        the versionCode this build claimed. Anything unreadable FAILS.
 *
 * Called by scripts/build-apks.sh; tested by scripts/test-release-guards.mjs
 * without building anything.
 *
 *   node scripts/release/releaseGuards.mjs next-version-code
 *   node scripts/release/releaseGuards.mjs claim-version-code
 *   node scripts/release/releaseGuards.mjs set-version <appDir> <versionCode>
 *   node scripts/release/releaseGuards.mjs check-signing <appDir> [--allow-debug-signing]
 *   node scripts/release/releaseGuards.mjs verify-apk <app> <apkPath> <versionCode>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PINNED_PATH = path.join(ROOT, 'release', 'signing-certificates.json');
export const VERSION_PATH = path.join(ROOT, 'release', 'version.json');
/** This machine's own record, so a counter that was never committed cannot be reused. */
export const LOCAL_VERSION_PATH = path.join(os.homedir(), '.quick-bites-release', 'last-version-code');

/* ------------------------------------------------------------------ *
 *  U-1  VERSION CODE                                                  *
 * ------------------------------------------------------------------ */

function readInt(file, pick) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const value = pick ? pick(JSON.parse(raw)) : Number(raw.trim());
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** The versionCode the next build would get, without taking it. */
export function nextVersionCode({ versionPath = VERSION_PATH, localPath = LOCAL_VERSION_PATH, pinnedPath = PINNED_PATH } = {}) {
  const committed = readInt(versionPath, j => j.lastVersionCode);
  const local = readInt(localPath);
  const installed = readInt(pinnedPath, j => j.installedVersionCode);
  const floor = Math.max(committed, local, installed);
  if (floor <= 0) throw new Error(`No versionCode on record in ${versionPath}; refusing to guess one.`);
  return { next: floor + 1, floor, committed, local, installed };
}

/** Takes the next versionCode: records it in the committed counter AND locally. */
export function claimVersionCode(opts = {}) {
  const { versionPath = VERSION_PATH, localPath = LOCAL_VERSION_PATH } = opts;
  const { next, floor } = nextVersionCode(opts);
  assertAbove(next, floor);
  const record = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  record.lastVersionCode = next;
  record.lastBuiltAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(versionPath, JSON.stringify(record, null, 2) + '\n');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, `${next}\n`);
  return next;
}

export function assertAbove(code, floor) {
  if (!Number.isInteger(code) || code <= floor) {
    throw new Error(`versionCode ${code} is not above ${floor}. A phone would refuse it as an update, or it would hide which build is installed.`);
  }
}

/** "1.3.0" + 8 on 25 Sep 2026 → "1.3.0-20260925.8": the date and the build are readable on the phone. */
export function versionNameFor(baseVersion, code, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${baseVersion}-${stamp}.${code}`;
}

/**
 * Writes the versionCode into app.json (the committed source prebuild reads) and,
 * when it exists, android/app/build.gradle (so a --no-prebuild build gets it too).
 * Fails closed if either file does not have exactly the field it expects.
 */
export function setVersion(appDir, code, { date = new Date() } = {}) {
  const appJsonPath = path.join(appDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  if (!appJson.expo?.android) throw new Error(`${appJsonPath} has no expo.android section.`);
  appJson.expo.android.versionCode = code;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
  const versionName = versionNameFor(appJson.expo.version || '0.0.0', code, date);

  const gradlePath = path.join(appDir, 'android', 'app', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    const codes = gradle.match(/^\s*versionCode\s+\d+\s*$/gm) || [];
    const names = gradle.match(/^\s*versionName\s+"[^"]*"\s*$/gm) || [];
    if (codes.length !== 1 || names.length !== 1) {
      throw new Error(`${gradlePath} has ${codes.length} versionCode and ${names.length} versionName lines; expected exactly one of each.`);
    }
    gradle = gradle
      .replace(/^(\s*versionCode\s+)\d+(\s*)$/m, `$1${code}$2`)
      .replace(/^(\s*versionName\s+)"[^"]*"(\s*)$/m, `$1"${versionName}"$2`);
    fs.writeFileSync(gradlePath, gradle);
  }
  return { versionCode: code, versionName, gradle: fs.existsSync(gradlePath) };
}

/* ------------------------------------------------------------------ *
 *  U-2  NO SILENT DEBUG SIGNING                                       *
 * ------------------------------------------------------------------ */

export function checkSigning(appDir, { allowDebugSigning = false, env = process.env } = {}) {
  const configured = fs.existsSync(path.join(appDir, 'android', 'keystore.properties')) || Boolean(env.QB_KEYSTORE_PATH);
  if (configured) return { ok: true, debug: false };
  if (allowDebugSigning) return { ok: true, debug: true };
  return {
    ok: false,
    debug: true,
    reason:
      `${path.basename(appDir)} has no release keystore (android/keystore.properties or QB_KEYSTORE_PATH). ` +
      'It would be signed with the ANDROID DEBUG KEY: it could not update the app on any phone and could never be updated itself. ' +
      'Restore the signing config from the vault (see SIGNING_KEYS.md), or pass --allow-debug-signing for a build that will never be handed out.'
  };
}

/* ------------------------------------------------------------------ *
 *  U-3  THE CERTIFICATE ON THE PHONES                                 *
 * ------------------------------------------------------------------ */

function androidHome(env = process.env) {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk')
  ].filter(Boolean);
  return candidates.find(c => fs.existsSync(path.join(c, 'build-tools')));
}

const versionOrder = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};

/** The newest build-tools that has apksigner. Throws rather than falling back to anything weaker. */
export function findBuildTools(env = process.env) {
  const sdk = androidHome(env);
  if (!sdk) throw new Error('No Android SDK found (ANDROID_HOME). apksigner is required to check a build; refusing to skip the check.');
  const dirs = fs
    .readdirSync(path.join(sdk, 'build-tools'))
    .filter(d => /^\d+(\.\d+)*$/.test(d) && fs.existsSync(path.join(sdk, 'build-tools', d, 'lib', 'apksigner.jar')))
    .sort(versionOrder);
  if (dirs.length === 0) throw new Error(`No build-tools under ${sdk} has apksigner. Refusing to skip the check.`);
  return path.join(sdk, 'build-tools', dirs[dirs.length - 1]);
}

function javaBinary(env = process.env) {
  const home = env.JAVA_HOME;
  if (home) {
    for (const name of ['java', 'java.exe']) {
      const candidate = path.join(home, 'bin', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'java';
}

/**
 * Reads what apksigner says about the signers. apksigner, not keytool: these
 * APKs are signed with APK Signature Scheme v2 only, and `keytool -printcert
 * -jarfile` prints NOTHING for them, which a careless check would read as a pass.
 */
export function parseSigners(text) {
  const count = text.match(/^Number of signers:\s*(\d+)\s*$/m);
  const digests = [...text.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$/gm)].map(m => m[2]);
  if (!count) throw new Error('apksigner did not report a number of signers; cannot tell who signed this.');
  return { signers: Number(count[1]), sha256: digests };
}

export function readSigners(apkPath, env = process.env) {
  if (!fs.existsSync(apkPath)) throw new Error(`No APK at ${apkPath}.`);
  const jar = path.join(findBuildTools(env), 'lib', 'apksigner.jar');
  const result = spawnSync(javaBinary(env), ['-jar', jar, 'verify', '--print-certs', '-v', apkPath], { encoding: 'utf8' });
  if (result.error) throw new Error(`apksigner could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`apksigner says this APK is not validly signed: ${(result.stderr || result.stdout || '').trim().split('\n')[0]}`);
  }
  return parseSigners(result.stdout);
}

export function readPackage(apkPath, env = process.env) {
  const tools = findBuildTools(env);
  const aapt2 = ['aapt2.exe', 'aapt2'].map(n => path.join(tools, n)).find(p => fs.existsSync(p));
  if (!aapt2) throw new Error(`No aapt2 in ${tools}; cannot read the package and versionCode.`);
  const result = spawnSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8' });
  const line = (result.stdout || '').split('\n').find(l => l.startsWith('package:')) || '';
  const name = line.match(/name='([^']+)'/)?.[1];
  const versionCode = Number(line.match(/versionCode='(\d+)'/)?.[1]);
  const versionName = line.match(/versionName='([^']*)'/)?.[1];
  if (!name || !Number.isInteger(versionCode)) throw new Error(`Could not read the package of ${apkPath}.`);
  return { name, versionCode, versionName };
}

/**
 * Everything that must hold for this APK to install as an update on the phones.
 * Returns the problems; an empty list is the only pass.
 */
export function verifyApk(app, apkPath, { expectedVersionCode, pinnedPath = PINNED_PATH, env = process.env } = {}) {
  const problems = [];
  let pinned;
  try {
    pinned = JSON.parse(fs.readFileSync(pinnedPath, 'utf8')).apps?.[app];
  } catch (err) {
    return [`The pinned certificates could not be read (${pinnedPath}): ${err.message}`];
  }
  if (!pinned || !/^[0-9a-f]{64}$/.test(pinned.certificateSha256 || '')) {
    return [`No pinned certificate for "${app}" in ${pinnedPath}.`];
  }

  try {
    const { signers, sha256 } = readSigners(apkPath, env);
    if (signers !== 1) problems.push(`It has ${signers} signers; exactly one is expected.`);
    if (sha256.length !== signers || sha256.length === 0) {
      problems.push('apksigner reported no readable certificate digest.');
    } else if (sha256[0] !== pinned.certificateSha256) {
      problems.push(
        `It is signed with certificate ${sha256[0]}, not ${pinned.certificateSha256} (the one on the phones). ` +
          'It would NOT install as an update.'
      );
    }
  } catch (err) {
    problems.push(err.message);
  }

  try {
    const pkg = readPackage(apkPath, env);
    if (pkg.name !== pinned.package) problems.push(`Its package is ${pkg.name}, not ${pinned.package}.`);
    if (expectedVersionCode !== undefined && pkg.versionCode !== Number(expectedVersionCode)) {
      problems.push(`Its versionCode is ${pkg.versionCode}, not the ${expectedVersionCode} this build claimed.`);
    }
  } catch (err) {
    problems.push(err.message);
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 *  COMMAND LINE                                                       *
 * ------------------------------------------------------------------ */

function main(argv) {
  const [command, ...args] = argv;
  const fail = message => {
    console.error(`FATAL: ${message}`);
    process.exit(1);
  };
  try {
    switch (command) {
      case 'next-version-code': {
        const v = nextVersionCode();
        console.log(v.next);
        return;
      }
      case 'claim-version-code':
        console.log(claimVersionCode());
        return;
      case 'set-version': {
        const [appDir, code] = args;
        const result = setVersion(appDir, Number(code));
        console.log(`  versionCode ${result.versionCode}, versionName ${result.versionName}${result.gradle ? ' (app.json and build.gradle)' : ' (app.json)'}`);
        return;
      }
      case 'check-signing': {
        const result = checkSigning(args[0], { allowDebugSigning: args.includes('--allow-debug-signing') });
        if (!result.ok) fail(result.reason);
        console.log(result.debug ? 'DEBUG' : 'RELEASE');
        return;
      }
      case 'verify-apk': {
        const [app, apk, code] = args;
        const problems = verifyApk(app, apk, { expectedVersionCode: code === undefined ? undefined : Number(code) });
        if (problems.length) fail(`${app}: ${apk} will not install as an update.\n  - ${problems.join('\n  - ')}`);
        console.log(`  ${app}: one signer, the certificate on the phones, package and versionCode as expected.`);
        return;
      }
      default:
        fail(`Unknown command "${command}".`);
    }
  } catch (err) {
    fail(err.message);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
