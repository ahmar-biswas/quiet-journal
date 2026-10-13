# Quiet — Offline Voice Journal PWA

A minimalist, local-first voice journal designed for Android browsers.

## Included
- Installable PWA shell with a service worker to cache the app files.
- Microphone recording through `getUserMedia` + `MediaRecorder`.
- Audio and transcript saved together in IndexedDB on the current browser/device.
- Search, playback, edit transcript, delete entries.
- No account, analytics, remote database, or application backend.

## Important capability limits
- **The journal UI and previously cached app shell:** designed to work offline after the app has been loaded once online and its service worker has installed successfully.
- **Audio recording:** depends on browser support for `MediaRecorder`, microphone permission, and a secure context (normally HTTPS or localhost). Test on the intended Android browser.
- **Speech-to-text:** uses the browser's `SpeechRecognition` / `webkitSpeechRecognition` API if present. Browser support varies, and recognition may send audio to a vendor service or require internet. This project does **not** claim guaranteed offline transcription. When unavailable, the user can save audio and manually edit/type the transcript.
- **Local data:** audio blobs and text are kept in IndexedDB for this browser origin. They do not sync to another browser or phone. Clearing site data, uninstalling, or storage eviction can erase entries. Export/backup is not implemented in this first version.
- The app uses no cloud API for entries. Browser speech recognition, if used, is controlled by the browser/platform and may not be local.

## Run locally for development
PWA service workers generally require HTTPS or localhost, not opening `index.html` as a `file://` URL.

From this folder, run a local static server, e.g. with Python installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` on the same device/computer. For installing on an Android phone, host the folder on an HTTPS static host (for example, a static hosting service you control), then visit the HTTPS URL in Chrome and choose **Install app** or **Add to Home screen**. Do not publish private journal entries; the host only serves the app files.

## Suggested Android test
1. Open the hosted HTTPS URL in Chrome.
2. Wait for the app to load, then reload once so the service worker can take control.
3. Grant microphone permission and record a short test.
4. Save, reload, then check that the entry and playback still exist.
5. With internet disabled, reopen the installed app and test browsing/playback and a new recording.
6. Separately test speech-to-text with internet on and off. Treat it as supported offline only if it demonstrably works without a network on your exact device/browser.
