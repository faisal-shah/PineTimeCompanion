# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Release discipline — artifacts are Release assets, never committed

Every build artifact — the Android APK/AAB, the Windows exe, the macOS dmg, the
Linux AppImage, the feature-guide PDF — is a **GitHub Release asset**, attached by
`.github/workflows/release.yml` on this (public) repo. The web app deploys to
GitHub Pages via **Pages-from-Actions** (`actions/deploy-pages`), which keeps no
`gh-pages` branch to accumulate. This is the correct setup — keep it.

**Never `git add` a build binary.** Committing an artifact per release bloats
history permanently: a sibling repo committed a ~31 MB APK every release and its
history had to be rewritten and force-pushed to recover. `*.apk` / `*.aab` /
`*.exe` / `*.dmg` / `*.AppImage` / `*.msi` are gitignored as a backstop, but the
rule is the point — the artifact belongs on the Release, not in git.

The one committed artifact is `docs/PineTime-Companion-Feature-Guide.pdf`: the
release workflow **copies** it from the repo rather than generating it, so a fresh
~1–2 MB copy lands in history every release (a handful so far). If that
accumulation is worth removing, generate the PDF in CI from `docs/feature-guide.html`
and stop committing it; until then it must stay, because CI reads it.
