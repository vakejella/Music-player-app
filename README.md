# 🦙 Winamp Mobile

A loving recreation of the **classic Winamp** player, rebuilt as a mobile-first,
installable **Progressive Web App**. It really whips the llama's ass.

![Winamp Mobile icon](icons/icon-512.png)

## Features

- **🎵 Plays your local audio** — MP3, OGG, WAV, M4A, AAC, FLAC, Opus. Files never
  leave your device; everything plays locally via the Web Audio API.
- **📊 Classic visualizations** — the iconic 19-band spectrum analyzer with
  peak-hold, plus an oscilloscope mode. Tap **VIS** to cycle.
- **🎚️ 10-band graphic equalizer** — real biquad-filter EQ with a preamp and
  9 presets (Rock, Pop, Jazz, Dance, Bass Boost, and more).
- **📃 Playlist editor** — add files, reorder-free tap-to-play, per-track remove,
  shuffle and repeat (none / all / one).
- **🖼️ Cover art** — reads embedded album art straight from the file — MP3
  (ID3v2 `APIC`), M4A/MP4/AAC (`covr` atom) and FLAC (`PICTURE`) — and shows it
  in a dedicated window (skinned to match a loaded `.wsz`). Set your own image
  for any track. Toggle with **ART**.
- **🎛️ Authentic skin** — beveled buttons, green LCD time display, scrolling
  track marquee, volume & balance sliders, seek bar.
- **📱 Installable & offline** — add to your home screen; the app shell is cached
  by a service worker and runs without a network connection.
- **🔔 Media notification** — in the APK, a native foreground `MediaSession`
  service shows the player on the lock screen / notification shade with album
  art and play / pause / next / previous controls, like any music app.
- **⌨️ Keyboard shortcuts** (desktop): `Space`/`x` play-pause, `b`/→ next,
  `z`/← previous, `v` stop.

## Try it without any files

Tap **+ DEMO** in the playlist to load three synthesized chiptune demo tracks —
generated entirely in-browser, no downloads required.

## 🎨 Real Winamp skin support (`.wsz`)

Winamp Mobile reads **actual classic Winamp 2.x skins**. Tap **LOAD .WSZ SKIN**
(or drag a `.wsz` onto the window) and the player repaints itself with that
skin's graphics.

A `.wsz` file is just a ZIP of bitmap sprite sheets. The app parses it entirely
in-browser (`js/wsz.js`, using the native `DecompressionStream` — no
dependencies) and maps each sprite to the classic 275×116 main-window layout
(`js/skin.js`):

| Skin file | Used for |
|-----------|----------|
| `main.bmp` | main window background |
| `titlebar.bmp` | title bar |
| `cbuttons.bmp` | play / pause / stop / prev / next / eject (with pressed states) |
| `shufrep.bmp` | shuffle / repeat / EQ / playlist buttons |
| `numbers.bmp` / `nums_ex.bmp` | the LCD time digits |
| `text.bmp` | the scrolling track-title bitmap font |
| `posbar.bmp`, `volume.bmp`, `balance.bmp` | slider thumbs & tracks |
| `eqmain.bmp` | the equalizer window (background, title bar, band sliders) |
| `pledit.bmp` | the playlist window (tiled title bar, borders, bottom bar) |
| `viscolor.txt` | the spectrum-analyzer color palette |
| `pledit.txt` | playlist text/background colors |

Where to get skins: the [Winamp Skin Museum](https://skins.webamp.org) has
thousands of free `.wsz` files — download one and load it.

> **Coverage:** the **main**, **equalizer**, **playlist**, and **cover-art**
> windows are all rendered from the skin's sprites. Tap **↩ MODERN UI** to
> return to the default look.

### Verifying skins offline

`tools/render-skin.mjs` is a dependency-free Node BMP decoder + compositor that
renders a `.wsz`'s main, EQ, and playlist windows to PNG, so skin coordinates
can be checked without a browser:

```bash
node tools/render-skin.mjs path/to/skin.wsz ./out   # writes preview_*.png
```

## Run as a web app

```bash
npm start          # serves at http://localhost:8080
```

Then open the URL on your phone (same network) or in a mobile-emulated browser,
and **Add to Home Screen** to install it as a standalone app.

> A secure context (`https://` or `localhost`) is required for the service
> worker and audio graph. The bundled dev server uses `localhost`, which counts.

## Android APK

A prebuilt debug APK is committed at
[`releases/winamp-mobile-v1.0.10.apk`](releases/winamp-mobile-v1.0.10.apk) — download
it, enable "Install unknown apps" on your phone, and open it.

To build it yourself: the `android/` directory wraps the web app in a native
WebView shell (`WebViewAssetLoader` serves it over a virtual `https://` origin so
ES modules, the service worker, and Web Audio all work). The web app is the
single source of truth — a Gradle task bundles it into the APK at build time, so
there's nothing to keep in sync.

```bash
cd android
export ANDROID_HOME=/path/to/android-sdk      # needs platform 34 + build-tools 34
./gradlew :app:assembleDebug                   # Gradle wrapper is included
# → app/build/outputs/apk/debug/app-debug.apk
```

Install on a device: `adb install app/build/outputs/apk/debug/app-debug.apk`.

The native shell forwards the in-page file pickers to Android's document
chooser, so **EJECT / + ADD** pick audio files and **LOAD .WSZ SKIN** picks skin
archives straight from device storage.

## 🎮 Bonus: PSP Video Converter

The repo also ships a companion app that converts MP4s (or anything FFmpeg
reads) into videos playable on a **PlayStation Portable** — H.264 Baseline
480×272 + AAC, with a `.THM` menu thumbnail and a ZIP laid out for the
Memory Stick's `/VIDEO` folder.

```bash
npm run psp                            # web UI at http://localhost:8090
node psp-converter/cli.mjs movie.mp4   # or straight from the terminal
```

Requires FFmpeg on your PATH. See [`psp-converter/README.md`](psp-converter/README.md).

## Project structure

```
index.html              App shell & layout
css/winamp.css          The classic Winamp skin
js/app.js               Main controller wiring UI ↔ modules
js/player.js            Web Audio engine (gain, balance, EQ chain, analyser)
js/visualizer.js        Spectrum analyzer & oscilloscope canvas renderer
js/equalizer.js         10-band EQ UI + presets
js/playlist.js          Playlist model, shuffle/repeat, rendering
js/demo.js              In-browser WAV demo-track synthesizer
js/coverart.js          Embedded ID3v2 album-art extractor
js/wsz.js / skin.js     Classic .wsz skin loader + sprite renderer
sw.js                   Service worker (offline app shell)
manifest.webmanifest    PWA manifest
server.mjs              Zero-dependency static dev server
```

## How the audio graph works

```
<audio> ─▶ MediaElementSource ─▶ preamp ─▶ EQ[0..9] (biquad) ─▶ stereo pan
        ─▶ master gain ─▶ analyser ─▶ destination (speakers)
```

The `AnalyserNode` feeds the visualizer; the biquad chain implements the
graphic EQ; balance uses a `StereoPannerNode`.

## License

MIT — for educational / nostalgia purposes. Winamp is a trademark of its
respective owners; this is an independent fan recreation, not affiliated with
or endorsed by them.
