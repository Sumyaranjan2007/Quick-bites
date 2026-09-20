/**
 * Expo config plugin: keep Android's back button reaching React Native.
 *
 * The bug this fixes, reported from real phones: pressing back — or swiping
 * from the edge, which is the same event — closed the entire app from any
 * screen, on every one of the four apps, even though all four have a working
 * `useHardwareBack` hook wired to their own navigation.
 *
 * The hook was never the problem. Android 13 introduced the predictive back
 * gesture, and when it is active the system stops calling the legacy
 * `Activity.onBackPressed()` and dispatches to `OnBackPressedDispatcher`
 * callbacks instead. React Native 0.76's `BackHandler` is built on the legacy
 * path and registers no such callback, so the dispatcher finds nothing to run,
 * falls through to the platform default, and finishes the activity.
 *
 * From the user's side the app simply vanishes. From the code's side everything
 * looks correct, which is why this survived a release: nothing is broken in
 * JavaScript, and the failure only appears on a device whose Android version
 * has predictive back switched on.
 *
 * Declaring `android:enableOnBackInvokedCallback="false"` opts this app out, so
 * the system keeps using the legacy path that `BackHandler` listens to. Expo
 * writes this attribute only when `android.predictiveBackGestureEnabled` is set
 * in app.json; leaving it unset omits the attribute entirely and takes whatever
 * default the OS applies, which is the situation that produced the bug.
 *
 * This is the correct fix for as long as these apps target SDK 35 and run on
 * React Native 0.76. When they move to targetSdk 36, Android ignores the flag
 * and the real fix is React Native 0.81 or later, which registers a proper
 * `OnBackPressedCallback`. That upgrade is a separate piece of work and this
 * comment is here so whoever does it knows to remove this plugin.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

function withLegacyBackGesture(config) {
  return withAndroidManifest(config, cfg => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    // Set on the application element so it covers every activity, rather than
    // on MainActivity alone — a second activity added later would otherwise
    // reintroduce the bug on its own screens.
    application.$['android:enableOnBackInvokedCallback'] = 'false';

    return cfg;
  });
}

module.exports = withLegacyBackGesture;
