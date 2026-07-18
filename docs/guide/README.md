# Feature guide — source

`../feature-guide.html` and `../PineTime-Companion-Feature-Guide.pdf` are generated
from this directory.

- `assets/` — the source screenshots. `watch-*.png` are 240×240 InfiniSim captures
  (via `pinetime-dev-tools/simctl.py shot`). `companion-*.png` are captured from the
  **real Android app by default** — build a self-contained release APK
  (`cd android && ./gradlew :app:assembleRelease`, which is debug-signed), install
  it, seed state (adb + the app's AsyncStorage `RKStorage` sqlite, or drive the UI),
  point it at the simulator (`deviceId` `10.0.2.2:18632`), and `adb exec-out
  screencap`. Crop the empty bottom / nav pill. The headless web export is only a
  fallback for screens with no Android-specific behaviour; anything gated to
  Android (e.g. Notifications/forwarding) must come from the app.
- `build-feature-guide.py` — embeds every asset as a base64 data URI and writes the
  self-contained `docs/feature-guide.html` (no external files, safe to open anywhere).

## Regenerate

```bash
python3 docs/guide/build-feature-guide.py          # -> docs/feature-guide.html
google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=docs/PineTime-Companion-Feature-Guide.pdf \
  --print-to-pdf-no-header docs/feature-guide.html  # -> the PDF
```

To refresh a screenshot, replace the file in `assets/` (keep the name) and rerun.
