/**
 * Expo config plugin: let react-native-razorpay link under Xcode 26.
 *
 * The bridge (node_modules/react-native-razorpay/ios/RazorpayCheckout.m)
 * conforms to two Swift protocols, ExternalWalletSelectionProtocol and
 * RazorpayPaymentCompletionProtocolWithData, but imports only
 * <Razorpay/Razorpay-Swift.h>, which FORWARD-DECLARES them
 * (`@protocol X;`). Their definitions live in RazorpayCore-Swift.h. The clang
 * in Xcode 26 no longer emits protocol metadata from a forward declaration, so
 * the app fails at the very last step with
 *   Undefined symbols: __OBJC_PROTOCOL_$_ExternalWalletSelectionProtocol
 * after an otherwise complete build.
 *
 * Pre-including RazorpayCore-Swift.h for that one pod target makes the
 * definitions visible, so the bridge emits the metadata itself. Nothing else is
 * compiled differently.
 *
 * Injected at prebuild time because `expo prebuild` regenerates ios/, and
 * node_modules is reinstalled from the lockfile. Remove once react-native-razorpay
 * imports RazorpayCore itself.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARKER = '# --- Quick Bites: Razorpay protocols for Xcode 26 (injected by withRazorpayXcode26 plugin) ---';

const BLOCK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'react-native-razorpay'
      target.build_configurations.each do |build_config|
        flags = build_config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
        build_config.build_settings['OTHER_CFLAGS'] = "#{flags} -include RazorpayCore/RazorpayCore-Swift.h"
      end
    end
`;

module.exports = function withRazorpayXcode26(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      // After react_native_post_install, so nothing it sets can undo this.
      const rnPostInstall = /react_native_post_install\([\s\S]*?\n\s*\)\n/;
      if (!rnPostInstall.test(contents)) {
        throw new Error('withRazorpayXcode26: react_native_post_install not found in Podfile');
      }
      fs.writeFileSync(podfile, contents.replace(rnPostInstall, (m) => m + BLOCK));
      return cfg;
    }
  ]);
};
