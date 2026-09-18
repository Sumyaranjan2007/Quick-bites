// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Note: do NOT pin config.server.unstable_serverRoot to projectRoot here — with
// watchFolders spanning the monorepo it makes the web bundle be served from a path
// the dev server does not expose, so `expo start --web` 404s on its own bundle.

// Release bundling needs the server root pinned; the dev server must not have it.
//
// Gradle invokes the bundler with a RELATIVE entry file ("--entry-file index.ts")
// from the app directory. Metro resolves that against its server root, and with
// watchFolders spanning the monorepo it infers that root as the repository root
// — so it looks for index.ts beside the top-level package.json, does not find
// it, and the release build dies at :app:createBundleReleaseJsAndAssets with
// "Unable to resolve module ./index.ts".
//
// Pinning unconditionally is what the note above warns against: it breaks
// `expo start --web`, which serves its bundle from a path the dev server does
// not expose. Pinning only while bundling satisfies both — the dev server keeps
// the monorepo-wide root, and the release build gets an entry it can find.
if (process.argv.some(arg => arg === 'export:embed' || arg === 'export')) {
  config.server = { ...config.server, unstable_serverRoot: projectRoot };
}

module.exports = config;
