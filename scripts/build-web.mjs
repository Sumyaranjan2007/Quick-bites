/**
 * Builds the Partner and Admin apps for the web, into apps/backend-api/web/,
 * where the API serves them at /partner and /admin (routes/webApps.ts).
 *
 * The Dockerfile runs this on every deploy, so the websites always match the
 * app code that was pushed. Run it locally to try the built sites:
 *   node scripts/build-web.mjs
 * then start the backend and open http://localhost:<port>/admin
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/backend-api/web');

for (const [app, name] of [
  ['admin-mobile', 'admin'],
  ['restaurant-mobile', 'partner']
]) {
  console.log(`\n== ${app} -> /${name}`);
  const result = spawnSync(
    'npx',
    // Relative: on Windows the shell would split an absolute path at its spaces.
    ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', `../backend-api/web/${name}`],
    { cwd: path.join(ROOT, 'apps', app), stdio: 'inherit', shell: process.platform === 'win32' }
  );
  if (result.status !== 0) {
    console.error(`\nThe ${name} website did not build.`);
    process.exit(result.status || 1);
  }
}
console.log(`\nBuilt into ${OUT}`);
