# 🎮 PSP Video Converter

Converts any video FFmpeg can read (MP4, MKV, MOV, AVI, WebM…) into an MP4
the **PlayStation Portable** actually plays, plus the matching `.THM`
thumbnail that shows up in the PSP's video menu.

Zero npm dependencies — it only needs **Node 18+** and **FFmpeg** on your
PATH ([ffmpeg.org](https://ffmpeg.org/download.html), or
`brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`).

## Why videos need converting

The PSP only decodes:

| | Supported |
|---|---|
| Container | MP4 |
| Video | H.264/AVC **Baseline Profile**, level 3.0, yuv420p, ≤ 720×480, ≤ 30 fps |
| Audio | AAC-LC, 44.1/48 kHz, stereo |

Modern MP4s (High profile, 1080p, 60 fps, 5.1 audio…) show up as
*Unsupported Data* — this tool re-encodes them into the box above.
Works on any PSP with firmware **3.30+** (every PSP-1000/2000/3000/Go
updates to 6.61).

## Single-file edition

Everything below is also bundled into one standalone file,
[`psp-video-converter.mjs`](psp-video-converter.mjs) — copy just that file
anywhere and run it. No args starts the web app; file args convert directly:

```bash
node psp-video-converter.mjs               # → http://localhost:8090
node psp-video-converter.mjs movie.mp4     # terminal conversion
```

## Web app

```bash
npm run psp        # → http://localhost:8090
```

Drop a video on the page, pick a preset, hit **Convert for PSP**, and
download the ready-made ZIP — unzip it onto the Memory Stick root and the
`VIDEO/` folder lands exactly where the PSP looks. Everything runs locally;
nothing is uploaded anywhere.

## CLI

```bash
node psp-converter/cli.mjs movie.mp4                     # → movie.MP4 + movie.THM
node psp-converter/cli.mjs *.mkv -p hq -o /media/stick/VIDEO
node psp-converter/cli.mjs --list                        # show presets
```

| Preset | Resolution | Video / audio bitrate | Use for |
|--------|-----------|----------------------|---------|
| `native` (default) | 480×272 | 768k / 128k | The PSP screen's exact resolution |
| `hq` | 480×272 | 1500k / 160k | Fast-motion video |
| `small` | 368×208 | 384k / 96k | Squeezing the most onto a stick |
| `tv` | 720×480 | 2500k / 160k | PSP-2000/3000 video-out to a TV |

Every preset letterboxes to the exact frame size, so any aspect ratio is
safe, and frame rates above 30 fps are resampled to 29.97.

## Getting videos onto the PSP

1. Connect the PSP over USB (**Settings → USB Connection**) or use a
   Memory Stick reader.
2. Copy `name.MP4` **and** `name.THM` into the **`VIDEO`** folder at the
   root of the Memory Stick (create it if missing) — or just unzip the
   web app's ZIP at the root.
3. On the XMB go to **Video → Memory Stick** and press ✕.

## Files

```
psp-converter/
├── convert.mjs    presets, ffmpeg args, probing, conversion, .THM generation
├── cli.mjs        command-line front-end with progress bar
├── server.mjs     zero-dependency web server (upload → SSE progress → download)
├── zip.mjs        dependency-free ZIP (STORE) writer for the PSP package
└── public/        the web UI (XMB-styled)
```

Tests: `node test/psp.test.mjs` (covered by `npm test`).
