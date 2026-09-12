/**
 * Expo config plugin: wire the Android release build to a real upload keystore.
 *
 * Expo regenerates android/ on every `prebuild`, so hand-editing app/build.gradle
 * does not survive. This injects the release signingConfig at prebuild time instead.
 *
 * Credentials are never stored in the repo. Gradle reads them from, in order:
 *   1. keystore.properties in the android/ directory (gitignored), or
 *   2. environment variables QB_KEYSTORE_PATH / QB_KEYSTORE_PASSWORD /
 *      QB_KEY_ALIAS / QB_KEY_PASSWORD
 *
 * If neither is present the release build falls back to the debug key, so local
 * development still works — but such a build is NOT publishable to Play.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const SIGNING_BLOCK = `
    // --- Quick Bites upload signing (injected by withReleaseSigning plugin) ---
    // Reads credentials from android/keystore.properties or QB_* env vars.
    def qbKeystoreProps = new Properties()
    def qbKeystorePropsFile = rootProject.file("keystore.properties")
    if (qbKeystorePropsFile.exists()) {
        qbKeystoreProps.load(new FileInputStream(qbKeystorePropsFile))
    }
    def qbStoreFile = qbKeystoreProps['storeFile'] ?: System.getenv('QB_KEYSTORE_PATH')
    def qbStorePassword = qbKeystoreProps['storePassword'] ?: System.getenv('QB_KEYSTORE_PASSWORD')
    def qbKeyAlias = qbKeystoreProps['keyAlias'] ?: System.getenv('QB_KEY_ALIAS')
    def qbKeyPassword = qbKeystoreProps['keyPassword'] ?: System.getenv('QB_KEY_PASSWORD')
    def qbHasUploadKey = qbStoreFile != null && file(qbStoreFile).exists()
`;

const RELEASE_SIGNING_CONFIG = `
        upload {
            if (qbHasUploadKey) {
                storeFile file(qbStoreFile)
                storePassword qbStorePassword
                keyAlias qbKeyAlias
                keyPassword qbKeyPassword
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    let gradle = cfg.modResults.contents;

    if (gradle.includes('withReleaseSigning plugin')) {
      return cfg;
    }

    // 1. Declare the credential lookup just inside `android {`.
    gradle = gradle.replace(/android\s*\{/, match => `${match}\n${SIGNING_BLOCK}`);

    // 2. Add an `upload` signing config alongside the existing debug one.
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      match => `${match}${RELEASE_SIGNING_CONFIG}`
    );

    // 3. Point the release build at the upload key when one is configured.
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      (_m, head) =>
        `${head}signingConfig qbHasUploadKey ? signingConfigs.upload : signingConfigs.debug`
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

module.exports = withReleaseSigning;
