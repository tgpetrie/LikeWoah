# LikeWoah · VideoEdit

> Forensic video inspection in a single tap — bookmark anomalies, detect motion irregularities and hidden pulses, export PDF reports. Runs entirely on-device.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
![No backend](https://img.shields.io/badge/backend-none-green)
![Single file](https://img.shields.io/badge/source-1%20HTML%20file-green)

**VideoEdit** turns any modern browser into a forensic video workstation. Step through any video frame-by-frame, bookmark anomalies, run live overlays (clipping, false color, frame diff, edges, ELA), and let the Motion Analyzer pre-pass the footage to flag spikes, irregular motion, and hidden periodic signals — including remote heart-rate detection (rPPG) inside a lassoed skin region. Annotated PDF reports export at the touch of a button. Everything runs on-device — no upload, no telemetry, no account.

---

## ✨ Features

### Playback & navigation
- Frame-accurate stepping (`,` / `.`) with auto-detected fps via `requestVideoFrameCallback`
- Playback speed 0.1×–80×, scrub timeline, SMPTE timecode (HH:MM:SS:FF)
- Figma-style zoom: `Cmd`+scroll to zoom on cursor, `Cmd`+`0`/`1`/`=`/`−`, plain scroll to pan, middle-click drag to pan

### Inspect tab — forensic tooling
| Tool | What it does |
|---|---|
| **Metadata** | File / resolution / aspect / duration / detected fps / frame count |
| **Frame step** | One-frame back/forward (`,` / `.`) |
| **Loupe** | 2×–16× pixel-level magnifier that follows the cursor |
| **Color picker** | Hover for live RGB/HSL/Hex, click to pin to history |
| **Live RGB histogram** | Per-channel + luminance, with mean values |
| **Clipping overlay** | Blown highlights in red, crushed blacks in blue (>250 / <5) |
| **False color** | Broadcast spectrum mapped to luminance (purple → red → white) |
| **Frame diff** | Pixels that changed vs previous frame, amplified green |
| **Grid overlays** | Rule of thirds · Crosshair · Broadcast safe areas |
| **Sobel edges** | One-shot luminance gradient overlay |
| **ELA (Error Level Analysis)** | JPEG re-encode diff amplified — flags tampered regions |
| **Blur detection** | Laplacian-variance heat map for redactions / motion blur |
| **Motion Analyzer** | Pre-pass over N evenly-spaced frames → spikes (z-score on rolling median), irregularity (HF/total variance), periodicity (autocorrelation), jerk, and pulse BPM (FFT of rPPG green channel in 0.7–3 Hz, SNR ≥4× median) |

### Draw tab — selection & annotation
- **Highlighter / Pencil / Eraser** with size, opacity, 8-color palette, undo
- **Lasso** — polygonal click-to-add-vertex (close near start) OR drag for freehand; `Enter` closes, `Esc` cancels
- **Magic Wand** — color flood-fill from clicked pixel; `Shift` = wider, `Alt` = tighter
- **Selection Library** — save / recall / rename / delete named regions (normalized 0..1 coords, survive resizing)
- **Track Object (2s)** — template-match (SSD on luminance) follows the lasso centroid during playback for 2 s, then restores to anchor
- **Analyze Selection** — jumps to Motion Analyzer with restrict-to-selection enabled

### Bookmarks & reporting
- Press `B` (or button) to pin the current frame — green pin appears on the timeline
- Editable labels (notes) per bookmark, click to seek, delete inline
- **Export Report (PDF)** — title page + one page per bookmark with frame snapshot, SMPTE timecode, frame number, your notes, and any saved lasso baked into the image

### Export
- WebM via `Canvas` + `MediaRecorder` (VP9 if supported) — bakes Adjust sliders, crop, and annotation strokes at full video resolution
- PDF report (jsPDF, loaded on demand from CDN)

### In-app help
- 40+ feature cards in a searchable, tabbed modal — opens with `?` or the header button
- "Try it" buttons that close the modal, switch to the relevant tab, and spotlight the actual UI control
- Guided 10-step tour through every major feature
- Interactive **Key Tutor** — press any key while help is open to see what it does

---

## 🚀 Quick start

### Desktop (the original experience)
1. Clone the repo, then either:
   - Open `editor.html` directly in Chrome/Firefox/Safari, or
   - Serve it locally: `python3 -m http.server 3000` and visit `http://localhost:3000/editor.html`
2. Click **Open File** or drag a video in
3. Press `?` to see everything you can do

### Android / iPad / phone (PWA — no install needed)
1. Open the served URL in mobile Chrome / Safari
2. Browser menu → **Add to Home Screen**
3. Launches fullscreen, works offline (service-worker cached)
4. Pinch to zoom, one-finger drag to pan, tap to play/pause, drag the timeline to scrub

### Android APK (Capacitor)
See [`ANDROID.md`](./ANDROID.md) for the full Capacitor + Android Studio path. Short version:
```bash
npm run android:init   # one-time
npm run android:build  # builds debug APK
```

---

## 🏗️ Architecture

Single HTML file (`editor.html`, ~3700 LOC) — no build step, no dependencies in the repo. Only one runtime CDN fetch: **jsPDF** is loaded on demand when you first export a report (~50 KB, cached). No telemetry, no analytics, no account, no upload.

Layered canvases inside `.vwrap`:
- `#fxCanvas` (z-index 1) — clipping / false color / frame diff / edges / ELA overlays
- `#lassoCanvas` (z-index 1) — selection marching-ants
- `#drawCanvas` (z-index 2) — annotation strokes
- `.grid-ol`, `.grid-cross`, `.safe-ol` — CSS-only grid overlays
- `.crop-ol` (z-index 3) — crop box

`.vwrap` is absolutely positioned with `transform-origin: 0 0`, so a single `translate(panX, panY) scale(zoom)` transforms everything together. Coordinate math throughout uses the inverse: `(clientX - preview.left - panX) / zoom`.

---

## 🛡️ License & attribution

This project is licensed under **GNU AGPL-3.0**.

**Plain English:** You can use this, modify it, run it on your own server, and share it — but if you do, you must:

1. **Keep the copyright notice** and AGPL license intact
2. **Share your modified source code** under AGPL too (including if you only run it as a hosted service — that's the "A" in AGPL closing the SaaS loophole)
3. **Credit the original author** — Tom Petrie · [tgpetrie](https://github.com/tgpetrie)
4. **Display a source-code link** in your version of the app (AGPL §13)

**What this means in practice:**
- ✅ A researcher can study, modify, and use it for their own forensic work
- ✅ A non-profit can fork it and adapt it
- ✅ A company can use it internally
- ⚠️ A surveillance vendor cannot take this code, modify it, host it as a closed-source SaaS, and not share their changes
- ⚠️ Any product built on this code must itself be AGPL

If you want different terms (commercial license, proprietary fork, etc.), [open an issue](https://github.com/tgpetrie/LikeWoah/issues) — happy to discuss dual licensing for legitimate use cases.

See [`LICENSE`](./LICENSE) for the full text.

---

## 🙏 Acknowledgments

- **rPPG / Eulerian Video Magnification** — the underlying research that makes pulse-from-video possible
- **jsPDF** — the only runtime dependency
- **Capacitor** (Ionic) — the optional Android wrapping path

Built with [Claude Code](https://claude.com/claude-code).

---

**Copyright © 2026 Tom Petrie. Licensed under AGPL-3.0.**
