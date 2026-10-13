/**
 * Expo config plugin: compile the `fmt` pod as C++17.
 *
 * React Native 0.76 pins fmt 11.0.2. Under C++20, fmt checks format strings
 * with `consteval`, and the clang in Xcode 26 rejects fmt's own uses of it
 * ("call to consteval function ... is not a constant expression"), so every
 * iOS build fails inside Pods/fmt before a line of app code is compiled.
 * fmt is a self-contained library whose C++17 build is identical in behaviour,
 * so only that one target is pinned back.
 *
 * Injected at prebuild time because `expo prebuild` regenerates ios/, so a
 * hand-edit to the Podfile does not survive. Remove once React Native ships a
 * fmt that builds under the current Xcode.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARKER = '# --- Quick Bites: fmt as C++17 (injected by withFmtCxx17 plugin) ---';

const FMT_BLOCK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |build_config|
        build_config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
`;

module.exports = function withFmtCxx17(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      // After react_native_post_install, so nothing it sets can undo this.
      const rnPostInstall = /react_native_post_install\([\s\S]*?\n\s*\)\n/;
      if (!rnPostInstall.test(contents)) {
        throw new Error('withFmtCxx17: react_native_post_install not found in Podfile');
      }
      fs.writeFileSync(podfile, contents.replace(rnPostInstall, (m) => m + FMT_BLOCK));
      return cfg;
    }
  ]);
};
