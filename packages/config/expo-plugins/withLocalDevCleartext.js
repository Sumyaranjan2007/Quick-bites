/**
 * Expo config plugin: let a sideloaded build reach a backend on the developer's
 * own machine, without loosening TLS for anything else.
 *
 * Every Quick Bites app has a "Server settings" field on its sign-in screen so a
 * build can be pointed at a local API. On a release build that field could not
 * work: Android blocks cleartext HTTP by default from API 28 onward, so every
 * request to `http://10.0.2.2:5000/api` failed as "Network request failed" with
 * nothing to say why — the feature looked broken rather than blocked.
 *
 * The fix is a network security config that permits cleartext for exactly three
 * hosts: the Android emulator's alias for the host machine, the Genymotion
 * equivalent, and localhost. Everything else — every real server this app will
 * ever talk to — stays TLS-only, so this does not weaken the shipped app in the
 * way `usesCleartextTraffic="true"` would.
 */
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** 10.0.2.2 is the emulator's route to the host; 10.0.3.2 is Genymotion's. */
const LOOPBACK_HOSTS = ['10.0.2.2', '10.0.3.2', 'localhost', '127.0.0.1'];

const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Cleartext is permitted only for the host machine as seen from an emulator or a
  USB-forwarded device, so the app's "Server settings" field can point at a local
  backend. Every other destination, including production, remains TLS-only.
-->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
${LOOPBACK_HOSTS.map(host => `        <domain includeSubdomains="false">${host}</domain>`).join('\n')}
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

function withLocalDevCleartext(config) {
  // 1. Write the config file into the Android resources.
  config = withDangerousMod(config, [
    'android',
    async cfg => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), CONFIG_XML, 'utf8');
      return cfg;
    }
  ]);

  // 2. Point the application element at it.
  config = withAndroidManifest(config, cfg => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

  return config;
}

module.exports = withLocalDevCleartext;
