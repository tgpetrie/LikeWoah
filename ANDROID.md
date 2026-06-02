# Android build (Capacitor)

VideoEdit ships as a single HTML file. To turn it into a real Android APK without rewriting anything, we use Capacitor — it wraps the existing `editor.html` in a native WebView and produces a normal Android Studio project.

## What works on touch (no install required)

`editor.html` is already touch-optimized:

- **Pinch to zoom** the video preview (two-finger)
- **One-finger pan** the video preview
- **Tap to play / pause** (short tap, no drag)
- **Drag the timeline** to scrub
- **Lasso & Wand** work with single-finger touch
- **Stacked sidebar** layout under 760px wide (sidebar becomes top section, video fills the rest)
- **Larger touch targets** (44px+) for buttons on small screens
- **Safe-area insets** respected on notched devices
- **PWA installable**: Chrome on Android → menu → "Add to Home Screen" → standalone app, fullscreen, offline-capable

For most field use the PWA install is all you need — no Play Store required.

## Building a real APK (Play Store distribution)

You'll need:

- Node.js ≥ 18
- Android Studio with Android SDK 33+
- Java 17 (Capacitor 6 requirement)

### One-time setup

```bash
cd /Users/cdmxx/Documents/VideoEdit
npm run android:init
```

This installs `@capacitor/core`, `@capacitor/cli`, and `@capacitor/android`, then creates an `android/` directory with a Gradle project.

### Open in Android Studio

```bash
npm run android:open
```

Then in Android Studio: **Build → Generate Signed Bundle / APK → APK → debug** to test locally, or **release** for Play Store.

### CLI build (no Studio)

```bash
npm run android:build
```

APK will land at `android/app/build/outputs/apk/debug/app-debug.apk`. Copy to your phone, allow unknown sources, install.

## File-picker on Android

On Android the `<input type="file" accept="video/*,.mp4,...">` opens the system file picker which can pull from Files, Downloads, Photos, Drive, etc. Tested filename extensions: `.mp4 .mov .m4v .webm .mkv .avi .3gp`. Most camera-captured videos work directly.

## What about the file system / external storage?

The PWA / Capacitor app can read any video the user picks. To **write** the exported PDF or WebM, the browser/WebView triggers a normal "Save to Downloads" flow.

For more aggressive integration (auto-save to a specific folder, share-sheet receiver, picture-in-picture, hardware-accelerated decoding) you'd add Capacitor plugins:

- `@capacitor/filesystem` — direct file access
- `@capacitor/share` — receive videos shared from other apps
- `@capacitor-community/in-app-browser`

These are additive — the existing `editor.html` keeps working unchanged.

## Versioning + Play Store

In `android/app/build.gradle` after `npm run android:init`:

```gradle
defaultConfig {
  applicationId "com.tgpetrie.videoedit"
  minSdkVersion 24       // Android 7.0+, ~99% of devices
  targetSdkVersion 34    // required by Play Store
  versionCode 1
  versionName "1.0.0"
}
```

Bump `versionCode` (integer, must increase) and `versionName` (display) for each release.

## Privacy

VideoEdit runs entirely on-device. The only network calls are:

1. jsPDF loaded from jsdelivr.net **on demand** when you click Export Report (~50 KB, cached after first use)
2. The optional HuggingFace AI enhancement (only if you paste an HF token AND click "AI (HF)")

No telemetry, no analytics, no upload of your video. Disclose this in the Play Store data-safety form.
