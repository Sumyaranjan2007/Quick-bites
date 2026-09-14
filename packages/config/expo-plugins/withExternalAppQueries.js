/**
 * Expo config plugin: let the app see that a maps app, a dialler and a browser
 * exist on the device.
 *
 * From Android 11 (API 30) an app can no longer enumerate other installed
 * packages. `Linking.canOpenURL` answers that question, so on a modern phone it
 * returns **false for every scheme the manifest has not declared** — even when
 * the target app is plainly installed.
 *
 * The rider app gates navigation on `canOpenURL`, tries `google.navigation:`,
 * then `geo:`, then an `https://` maps link, and gives up with "No maps app —
 * Could not open a maps app for …" when all three are refused. That alert was
 * reported from a device with Google Maps installed and working: nothing was
 * wrong with the device or the URL, the app had simply been told it could not
 * see anything. The same invisibility applies to `tel:` for the Call button.
 *
 * Declaring these intents restores the ability to ask. It grants no new
 * capability beyond seeing that a handler exists — an app that wants to open a
 * map could always do so — and it is narrower than the alternative of removing
 * the `canOpenURL` check and firing URLs blindly.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/** One `<intent>` block per capability the app needs to detect. */
const QUERY_INTENTS = [
  // Turn-by-turn navigation and map pins: `geo:` covers both, and every maps
  // app that can navigate also handles a plain view of a coordinate.
  { action: 'android.intent.action.VIEW', dataScheme: 'geo' },
  // Placing a call to a customer or a restaurant.
  { action: 'android.intent.action.DIAL', dataScheme: 'tel' },
  // The web fallback when no dedicated maps app answers.
  { action: 'android.intent.action.VIEW', dataScheme: 'https' },
  { action: 'android.intent.action.VIEW', dataScheme: 'http' }
];

function intentNode({ action, dataScheme }) {
  return {
    action: [{ $: { 'android:name': action } }],
    data: [{ $: { 'android:scheme': dataScheme } }]
  };
}

module.exports = function withExternalAppQueries(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;

    // `queries` is a sibling of `application`, not a child of it.
    if (!Array.isArray(manifest.queries)) manifest.queries = [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const queries = manifest.queries[0];

    if (!Array.isArray(queries.intent)) queries.intent = [];

    for (const spec of QUERY_INTENTS) {
      const already = queries.intent.some(
        entry =>
          entry?.action?.[0]?.$?.['android:name'] === spec.action &&
          entry?.data?.[0]?.$?.['android:scheme'] === spec.dataScheme
      );
      if (!already) queries.intent.push(intentNode(spec));
    }

    return mod;
  });
};
