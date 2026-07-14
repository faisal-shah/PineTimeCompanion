// Expo config plugin: per-architecture APKs instead of one universal APK.
// The universal APK bundles native libs for all four ABIs (including x86 /
// x86_64, which only emulators use) and weighs ~80 MB; each split is ~20 MB.
// Same approach as tajweed-bytes. Applied at `expo prebuild`, so it survives
// android/ being regenerated.

const { withAppBuildGradle } = require('expo/config-plugins');

const SPLITS = `
    splits {
        abi {
            enable true
            reset()
            include 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
            universalApk false
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('splits {')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /android \{/,
        `android {${SPLITS}`
      );
    }
    return mod;
  });
};
