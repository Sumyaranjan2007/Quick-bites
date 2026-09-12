// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Note: do NOT pin config.server.unstable_serverRoot to projectRoot here — with
// watchFolders spanning the monorepo it makes the web bundle be served from a path
// the dev server does not expose, so `expo start --web` 404s on its own bundle.

module.exports = config;
