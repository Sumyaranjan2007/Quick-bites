/**
 * Expo config plugin: stop the resource shrinker deleting the alert sound.
 *
 * `expo-notifications` copies the files listed in its `sounds` option into
 * android/app/src/main/res/raw/, and the app asks for one of them by name when
 * it creates the notification channel:
 *
 *     Notifications.setNotificationChannelAsync('new-orders', { sound: 'new_order.wav', ... })
 *
 * Nothing in the compiled code or the resource table references `@raw/new_order`,
 * so with `enableShrinkResourcesInReleaseBuilds` on — which this project wants,
 * it takes several megabytes off the download — AAPT2 concludes the file is dead
 * and strips it. The release APK then ships a notification channel pointing at a
 * sound that is not in the package, which is exactly the case the sound exists
 * for: an offer arriving while the rider is not looking at the screen.
 *
 * A `keep.xml` is the shrinker's own escape hatch for resources resolved by name
 * at runtime. It is written here rather than by hand because `expo prebuild`
 * regenerates android/ and would discard it.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Written by the withKeptNotificationSound config plugin. These raw resources are
  looked up by name at runtime, so the resource shrinker cannot see that they are
  used and removes them unless they are named here.
-->
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@raw/*" />
`;

function withKeptNotificationSound(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(path.join(rawDir, 'keep.xml'), KEEP_XML, 'utf8');
      return cfg;
    }
  ]);
}

module.exports = withKeptNotificationSound;
