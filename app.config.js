// Dynamic overlay on app.json: CI (and scripts/release.sh) stamp the build via
// env vars; local dev builds fall back to app.json + `git` at config time.
//
//   APP_VERSION   release version without the v (e.g. 0.7.0) — drives
//                 expo.version and the Android versionCode
//   GIT_COMMIT    short commit hash shown in the in-app version footer
//   GIT_TAG       release tag (empty on dev builds -> footer shows "dev")
//   WEB_BASE_URL  subpath for the GitHub Pages export (/PineTimeCompanion);
//                 unset for the Electron/zip bundles, which serve from root

const { execSync } = require('node:child_process');

function gitShort() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// 0.7.0 -> 700, 1.2.13 -> 10213 (monotonic while minor/patch < 100)
function versionCode(version) {
  const [maj = 0, min = 0, pat = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);
  return maj * 10000 + min * 100 + pat;
}

module.exports = ({ config }) => {
  const version = process.env.APP_VERSION || config.version;
  return {
    ...config,
    version,
    android: {
      ...config.android,
      versionCode: versionCode(version),
    },
    extra: {
      ...config.extra,
      gitCommit: process.env.GIT_COMMIT || gitShort(),
      gitTag: process.env.GIT_TAG || '',
    },
    experiments: {
      ...config.experiments,
      ...(process.env.WEB_BASE_URL ? { baseUrl: process.env.WEB_BASE_URL } : {}),
    },
  };
};
