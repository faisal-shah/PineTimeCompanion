#!/usr/bin/env bash
# Cut a release the safe way: gates -> version bump -> PRERELEASE.
#
#   ./scripts/release.sh 0.7.0            # full flow (needs the sim running)
#   ./scripts/release.sh 0.7.0 --skip-e2e # skip the sim-backed web E2E gate
#
# Publishing the (pre)release triggers .github/workflows/release.yml, which
# builds + attaches all artifacts and deploys the web app to GitHub Pages.
# After spot-checking the assets, promote it:
#
#   gh release edit vX.Y.Z --prerelease=false --latest
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:?usage: release.sh X.Y.Z [--skip-e2e]}"
VERSION="${VERSION#v}"
TAG="v$VERSION"
SKIP_E2E="${2:-}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean"; exit 1; }
[ "$(git branch --show-current)" = "master" ] || { echo "not on master"; exit 1; }
git fetch -q && [ -z "$(git log origin/master..HEAD --oneline)" ] || { echo "unpushed commits — push first"; exit 1; }
! git rev-parse "$TAG" >/dev/null 2>&1 || { echo "tag $TAG already exists"; exit 1; }

echo "== gates =="
npx tsc --noEmit
npm test

if [ "$SKIP_E2E" != "--skip-e2e" ]; then
  echo "== web E2E against the sim (start it with pinetime-dev-tools/simctl.py) =="
  npm run web:export
  npm run web:e2e
else
  echo "== SKIPPING web E2E (--skip-e2e) =="
fi

echo "== bump app.json to $VERSION =="
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('app.json'));
  p.expo.version = '$VERSION';
  fs.writeFileSync('app.json', JSON.stringify(p, null, 2) + '\n');
"
git add app.json
git commit -m "Release $TAG"
git push

echo "== create PRERELEASE $TAG (this kicks off the artifact builds) =="
gh release create "$TAG" --prerelease --title "$TAG" --notes "$(cat <<EOF
## Downloads

- **Android**: \`-android-arm64-v8a.apk\` for modern phones (other ABIs attached too)
- **Windows**: \`-win-setup.exe\` (installer) or \`-win-portable.exe\` (no install)
- **Linux**: \`.AppImage\` — \`chmod +x\`, run
- **macOS** (Apple silicon): \`.dmg\` — unsigned: right-click the app → Open the first time
  (or \`xattr -dr com.apple.quarantine "/Applications/PineTime Companion.app"\`)
- **Web**: https://faisal-shah.github.io/PineTimeCompanion/ (Chrome/Edge; Web Bluetooth)

Desktop/web manage watches and beacon keys; Apple Find My location + map are Android-only.
In plain browsers, reconnecting to a watch re-shows the Bluetooth chooser once per session;
the desktop app reconnects automatically.

## Changes

- (fill in)
EOF
)"

echo
echo "Prerelease $TAG created. CI is building the artifacts now:"
echo "  gh run watch \$(gh run list --workflow release --limit 1 --json databaseId -q '.[0].databaseId')"
echo "Spot-check the assets + https://faisal-shah.github.io/PineTimeCompanion/ then promote:"
echo "  gh release edit $TAG --prerelease=false --latest"
