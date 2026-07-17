#!/usr/bin/env python3
"""Build the self-contained PineTime + Companion feature guide (HTML -> PDF)."""
import base64, pathlib, html

HERE = pathlib.Path(__file__).resolve().parent
IMG = HERE / "assets"

def data_uri(name):
    b = (IMG / name).read_bytes()
    return "data:image/png;base64," + base64.b64encode(b).decode()

def watch(name, cap=""):
    c = f'<div class="cap">{html.escape(cap)}</div>' if cap else ""
    return f'<figure class="wframe"><div class="wbezel"><img src="{data_uri(name)}"></div>{c}</figure>'

def phone(name, cap=""):
    c = f'<div class="cap">{html.escape(cap)}</div>' if cap else ""
    return f'<figure class="pframe"><div class="pbezel"><img src="{data_uri(name)}"></div>{c}</figure>'

def plain(name, cap=""):
    c = f'<div class="cap">{html.escape(cap)}</div>' if cap else ""
    return f'<figure class="plainfig"><img src="{data_uri(name)}">{c}</figure>'

# ---- flagship features: (title, subtitle, watch_img, phone_img, bullets) ----
FLAG = [
    ("Schedule &amp; reminders", "Recurring reminders that live on the watch",
     ("watch-schedule.png", "On-watch schedule list"),
     ("companion-event-complex.png", "Companion → a complex recurring event"),
     ["Build complex recurrences: every N days, weekly on chosen weekdays (e.g. Mon/Wed/Fri), or a day of the month — with a live preview of the next occurrences.",
      "Reminders sync to the watch and fire on-wrist even when the phone is away; the watch shows them in a scrollable list.",
      "Multi-phone-safe sync: edits from a second phone merge instead of clobbering."]),
    ("Alarms", "Up to five daily or one-shot alarms",
     ("watch-multialarm.png", "Multi-alarm app on the watch"),
     ("companion-alarms.png", "Companion → Alarms"),
     ["Manage up to five alarms, each daily or one-shot, from the phone — or on the watch itself.",
      "Changes sync both ways with conflict-safe versioning, so on-watch edits are preserved.",
      "A custom InfiniTime service replaces the stock single-alarm app."]),
    ("Prayer times", "Five daily prayers, computed on-device",
     ("watch-prayer.png", "Prayer-times app on the watch"),
     ("companion-prayer.png", "Companion → Prayer times"),
     ["Pick a calculation method (Muslim World League, ISNA, Egyptian, Umm al-Qura, Karachi…) and Asr madhab.",
      "Set the location from the phone's GPS or enter coordinates; the watch computes the five daily times itself and shows them in its own app.",
      "Optional vibration at each prayer time."]),
    ("Find My (locator beacon)", "Turn the watch into an Apple Find My tag",
     ("watch-findmy.png", "Find My toggle on the watch"),
     ("companion-findmy-map.png", "Companion → location history on a map"),
     ["Generate a key pair, provision it to the watch, and turn beaconing on (Settings → Find My); nearby iPhones then report its location to Apple's Find My network.",
      "The app pulls the crowd-sourced fixes and plots the watch's location — with its recent trail and accuracy — on a live map.",
      "Export the keys to also look the watch up in your own macless-haystack server."]),
    ("Firmware &amp; resources update (OTA)", "Update InfiniTime straight from the app",
     ("watch-ota.png", "“Firmware &amp; files” must be enabled"),
     ("companion-update.png", "Companion → Update watch"),
     ["Lists releases from a configurable GitHub repo, reads the installed version, and flashes firmware over Nordic Legacy DFU — no nRF Connect needed.",
      "Pushes the matching external-resources pack (fonts/images) over the BLE filesystem.",
      "After a flash it reminds you to tap Validate on the watch, then re-checks the version to confirm it stuck."]),
]

# ---- built-in watch apps: (img, name, desc) ----
APPS = [
    ("watch-stopwatch.png", "Stopwatch", "Start / lap / reset timing."),
    ("watch-timer.png", "Timer", "Countdown with vibration alert."),
    ("watch-steps.png", "Steps", "Daily step count vs. goal."),
    ("watch-heartrate.png", "Heart rate", "On-demand optical HR reading."),
    ("watch-music.png", "Music", "Remote control for phone playback."),
    ("watch-navigation.png", "Navigation", "Turn-by-turn arrows from the phone."),
    ("watch-calculator.png", "Calculator", "Basic on-wrist calculator."),
    ("watch-metronome.png", "Metronome", "Adjustable tempo with haptic beat."),
]

# ---- assemble ----
parts = []

# COVER
parts.append(f"""
<section class="cover">
  <div class="cover-kicker">FEATURE GUIDE</div>
  <h1 class="cover-title">PineTime <span class="amp">+</span> Companion</h1>
  <div class="cover-sub">Everything the watch and its companion app can do &mdash; feature by feature, on both screens.</div>
  <div class="cover-strip">
    {watch("watch-face.png")}
    {phone("companion-hub.png")}
    {watch("watch-multialarm.png")}
  </div>
  <div class="cover-foot">InfiniTime firmware (fork) &middot; PineTime Companion app &middot; generated from live device &amp; simulator screenshots</div>
</section>
""")

# OVERVIEW
parts.append(f"""
<section class="page">
  <h2>The watch at a glance</h2>
  <p class="lead">A clean digital watch face, with every app one swipe away. The launcher holds sixteen apps across three pages &mdash; fitness, tools, games, and the custom additions below.</p>
  <div class="row center gap">
    {watch("watch-face.png", "Watch face")}
    {watch("watch-quicksettings.png", "Quick settings (swipe right)")}
  </div>
  <h3 class="mt">App launcher &mdash; all sixteen apps</h3>
  <div class="row center gap">
    {watch("watch-launcher1.png", "Page 1")}
    {watch("watch-launcher2.png", "Page 2")}
    {watch("watch-launcher3.png", "Page 3")}
  </div>
</section>
""")

# FLAGSHIP
def feature_card(title, sub, wi, wc, pi, pc, bullets):
    lis = "".join(f"<li>{b}</li>" for b in bullets)
    return f"""
    <div class="feature">
      <div class="feature-head"><h3>{title}</h3><div class="feature-sub">{sub}</div></div>
      <div class="feature-body">
        <div class="devs">{watch(wi, wc)}{phone(pi, pc)}</div>
        <ul class="bul">{lis}</ul>
      </div>
    </div>"""

# First four features: two per page (Schedule+Alarms, Prayer+Find My).
parts.append('<section class="page"><div class="section-tag">Flagship features</div><h2>What makes this build special</h2>')
parts.append('<p class="lead">Capabilities the companion drives end-to-end &mdash; shown on the watch and in the app.</p>')
for i, (title, sub, (wi, wc), (pi, pc), bullets) in enumerate(FLAG[:4]):
    parts.append(feature_card(title, sub, wi, wc, pi, pc, bullets))
    if i == 1:
        parts.append('</section><section class="page">')
parts.append('</section>')

# Fifth feature (OTA) gets its own deep-dive page.
t, s, (wi, wc), (pi, pc), bullets = FLAG[4]
parts.append(f"""
<section class="page">
  <div class="section-tag">Flagship features</div>
  <h2>Firmware &amp; resources over the air</h2>
  {feature_card(t, s, wi, wc, pi, pc, bullets)}
  <div class="note">
    <b>How an update runs.</b> Pick a release &rarr; the app downloads it &rarr; streams the firmware to the watch in the mandatory 20-byte DFU packets &rarr; the watch reboots into the new image <b>unvalidated</b>. You then tap <b>Settings &rarr; Firmware &rarr; Validate</b> on the watch to keep it &mdash; skip that and the next reboot rolls back. Finally the app pushes the matching resources over the BLE filesystem.
  </div>
  <div class="note" style="border-color:#c99a2b;background:#fdf7e9;">
    <b>Where it works.</b> Firmware DFU runs on <b>Android</b> and against the simulator; a plain web browser can&rsquo;t reach the DFU service (it&rsquo;s on Chromium&rsquo;s Bluetooth blocklist), so the app hides firmware there. Resource uploads work everywhere. Both require <b>&ldquo;Firmware &amp; files&rdquo;</b> enabled on the watch.
  </div>
</section>""")

# NOTIFICATIONS
parts.append(f"""
<section class="page">
  <div class="section-tag">Notifications &amp; alerts</div>
  <h2>Notifications that don&rsquo;t get lost</h2>
  <p class="lead">Two kinds reach the watch: phone notifications forwarded from your phone, and watch-originated alerts (alarm, reminder, prayer) that fire on-wrist.</p>
  <div class="row center gap">
    {watch("watch-notification.png", "A forwarded phone notification")}
    {watch("watch-pendingalerts.png", "The pending-alerts queue (1 of 2)")}
  </div>
  <div class="note">
    <b>The pending-alerts queue.</b> Every watch-originated alert &mdash; a multi-alarm going off, a schedule reminder, a prayer-time alert &mdash; lands in one shared queue instead of each app owning a screen that the next alert would trample. Miss one while another is ringing and it still waits for you: the queue holds the most recent alerts (newest first), shows a <b>1 / N</b> counter so you can page through them, and you clear each with <b>OK</b>. Phone notifications (messages, calls) stack separately in the swipe-down notifications list.
  </div>
</section>
""")

# BUILT-IN APPS
app_cells = "".join(
    f'<div class="appcard">{watch(img)}<div class="appname">{name}</div><div class="appdesc">{desc}</div></div>'
    for img, name, desc in APPS)
parts.append(f"""
<section class="page">
  <div class="section-tag">Built-in apps</div>
  <h2>Everyday apps on the watch</h2>
  <p class="lead">Standard InfiniTime apps, all running on-wrist. Four more &mdash; Paint, Paddle, 2048 and Dice &mdash; round out the games (see launcher page&nbsp;2).</p>
  <div class="appgrid">{app_cells}</div>
</section>
""")

# SETTINGS & CONNECTIVITY
parts.append(f"""
<section class="page">
  <div class="section-tag">Settings &amp; connectivity</div>
  <h2>Settings and Bluetooth</h2>
  <p class="lead">The on-watch settings cover the display, watch face, sensors, and connectivity. Two settings gate everything the companion does.</p>
  <div class="row center"><figure class="plainfig"><img class="wide" src="{data_uri('watch-settings-overview.png')}"><div class="cap">The full settings list (five pages)</div></figure></div>
  <div class="row center gap mt">
    {watch("watch-bluetooth.png", "Bluetooth: radio on/off")}
    {watch("watch-ota.png", "“Firmware &amp; files”: OTA gate")}
  </div>
  <div class="note">
    <b>How they relate.</b> <b>Bluetooth</b> is the master radio switch &mdash; turning it off stops all connections (and force-stops the Find My beacon). <b>Firmware &amp; files</b> must be enabled for firmware DFU and resource uploads; if it's off the watch refuses them and the app tells you to turn it on. The Find My beacon needs Bluetooth on and a provisioned key, and while it broadcasts it takes over advertising, so the watch isn't pairable at the same time.
  </div>
</section>
""")

# COMPANION ESSENTIALS
parts.append(f"""
<section class="page">
  <div class="section-tag">Companion app</div>
  <h2>Managing watches from the app</h2>
  <p class="lead">The app runs on Android, and on web/desktop for everything except firmware DFU. Add a watch, pair it, and each watch gets its own hub of features.</p>
  <div class="devs3">
    {phone("companion-watchlist.png", "Your watches")}
    {phone("companion-pair.png", "Pair — real watch or simulator")}
    {phone("companion-hub.png", "The watch hub")}
  </div>
  <div class="note">
    <b>From the hub</b> you reach every feature (Schedule, Alarms, Prayer times, Find My, Update) and the quick actions: <b>Set time</b>, read <b>Battery</b>, and send a <b>Message</b> to the watch. Pairing works against a real watch over Bluetooth or against the InfiniTime simulator during development.
  </div>
</section>
""")

body = "\n".join(parts)

CSS = """
:root{
  --ink:#1b2026; --dim:#5b6b78; --green:#2a7a33; --green2:#39a845;
  --line:#e2e8ee; --bg:#ffffff; --panel:#f5f8fa; --bezel:#12161b;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--ink);font-size:13.5pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:Letter;margin:14mm 15mm 15mm 15mm;}
h1,h2,h3{margin:0;line-height:1.15;}
p{margin:0 0 10px;}
.lead{font-size:14pt;color:var(--dim);margin:6px 0 16px;max-width:46em;}
.mt{margin-top:20px;}

/* pages */
.page{break-before:page;padding-top:2mm;}
.cover{break-after:page;}

/* cover */
.cover{height:247mm;border-radius:18px;background:linear-gradient(160deg,#0e1a12 0%,#12241a 45%,#0e332044 100%),#0d1512;
  color:#eef4ef;padding:26mm 20mm;display:flex;flex-direction:column;}
.cover-kicker{letter-spacing:.42em;font-size:12pt;color:var(--green2);font-weight:700;}
.cover-title{font-size:41pt;font-weight:800;margin-top:10mm;letter-spacing:-.5pt;}
.cover-title .amp{color:var(--green2);}
.cover-sub{font-size:16pt;color:#b9c9bf;margin-top:8mm;max-width:24em;}
.cover-strip{margin-top:auto;display:flex;align-items:flex-end;gap:22px;}
.cover-foot{margin-top:12mm;color:#7f9488;font-size:10.5pt;border-top:1px solid #ffffff22;padding-top:5mm;}

/* headings */
.section-tag{color:var(--green);font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:10.5pt;margin-bottom:4px;}
h2{font-size:23pt;font-weight:800;letter-spacing:-.3pt;}
h3{font-size:15pt;font-weight:700;}
h2{border-bottom:3px solid var(--green2);padding-bottom:8px;display:inline-block;}

/* layout helpers */
.row{display:flex;}
.center{justify-content:center;align-items:flex-start;}
.gap{gap:26px;}

/* device frames */
figure{margin:0;text-align:center;}
.cap{font-size:10.5pt;color:var(--dim);margin-top:7px;font-weight:600;}
.wbezel{background:var(--bezel);border-radius:22px;padding:12px;display:inline-block;box-shadow:0 4px 14px #0000001f;}
.wbezel img{width:150px;height:150px;display:block;border-radius:8px;}
.pbezel{background:var(--bezel);border-radius:24px;padding:8px;display:inline-block;box-shadow:0 5px 18px #00000024;}
.pbezel img{width:150px;display:block;border-radius:16px;}

/* feature cards */
.feature{border:1px solid var(--line);border-radius:13px;padding:11px 15px;margin:10px 0;background:var(--panel);break-inside:avoid;}
.feature-head h3{color:var(--ink);font-size:14pt;}
.feature-sub{color:var(--green);font-weight:700;font-size:11pt;margin-top:1px;}
.feature-body{display:flex;gap:18px;align-items:center;margin-top:8px;}
.devs{display:flex;gap:14px;align-items:center;flex:0 0 auto;}
.devs .pbezel img{width:122px;}
.devs .wbezel img{width:122px;height:122px;}
ul.bul{margin:0;padding-left:19px;flex:1;}
ul.bul li{margin-bottom:7px;font-size:12pt;line-height:1.42;}

/* app grid */
.appgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:14px;}
.appcard{border:1px solid var(--line);border-radius:12px;padding:12px 10px;text-align:center;background:var(--panel);break-inside:avoid;}
.appcard .wbezel{padding:8px;}
.appcard .wbezel img{width:120px;height:120px;}
.appname{font-weight:800;margin-top:8px;font-size:12.5pt;}
.appdesc{color:var(--dim);font-size:10.5pt;line-height:1.35;margin-top:2px;}

/* three phones */
.devs3{display:flex;justify-content:center;gap:26px;margin-top:6px;}
.devs3 .pbezel img{width:150px;}

/* plain / wide figure */
.plainfig img{max-width:100%;border-radius:8px;border:1px solid var(--line);}
.plainfig img.wide{width:520px;max-width:100%;}

/* note box */
.note{border-left:4px solid var(--green2);background:#f2f8f3;border-radius:0 10px 10px 0;padding:12px 16px;margin-top:18px;font-size:12.5pt;line-height:1.5;break-inside:avoid;}
"""

DOC = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>PineTime + Companion — Feature Guide</title>
<style>{CSS}</style></head><body>{body}</body></html>"""

out = HERE.parent / "feature-guide.html"
out.write_text(DOC, encoding="utf-8")
print("wrote", out, f"({len(DOC)//1024} KB)")
