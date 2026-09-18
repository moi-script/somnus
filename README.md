# Somnus

**[Landing page](https://moi-script.github.io/somnus/)** ·
**[Download the Android app](https://github.com/moi-script/somnus/releases/latest/download/somnus.apk)** ·
[All releases](https://github.com/moi-script/somnus/releases) ·
[Band firmware](https://github.com/moi-script/sleep_monitoring)

Wearable sensor node and the software around it. A Seeed XIAO ESP32-C3 reads a
MAX30102 pulse sensor, an MPU6050 accelerometer and a Grove GSR sensor, and
drives a vibration motor. A phone carries the data to a server; a browser shows
it live.

## How the pieces connect

```
Band (C3) ──BLE──> Android app ──HTTPS──> Express ──> MongoDB
                   (SQLite buffer)          │
Room unit (C6) ──WiFi─────────────────────> │  (no phone needed)
   │  radar + Tuya bulb                     └──SSE──> Next.js dashboard
```

**The room unit** is a second board: a XIAO ESP32-C6 with a SEN0395 presence
radar that switches a Tuya bulb. It posts `presence` and `light` frames
straight to `/ingest` over WiFi and drains its own commands. The Sleep tab
turns each night (18:00–14:00) into time in the room, how often the room
emptied, and what the light was doing. The radar senses the room, not the
bed, so the app never claims to know when you were asleep. Firmware and setup:
`C:\Users\moises\Documents\Arduino\esp_flash_mmwave`.

**The phone is the bridge.** A deployed server has no Bluetooth radio, so it
cannot talk to the node directly. The app connects over BLE, writes every frame
to a local SQLite database first, and uploads when it has a network. Out of
range, it keeps recording and syncs later. That is why the app needs both
Bluetooth and network permission.

Commands run the same path backwards: the dashboard queues one, the phone
drains the queue and writes it to the node over BLE.

## Layout

| Path | What it is |
|---|---|
| `packages/contracts` | The payload format, defined once. zod schemas + TS types shared by everything below. |
| `apps/api` | Express + Mongoose. Auth, ingest, queries, command queue, SSE. |
| `apps/web` | Next.js dashboard. Static export, reused as the Android webview. |
| `apps/mobile` | Capacitor shell that packages `apps/web` as an APK. |
| `tools/serial-bridge` | USB bridge. Stands in for the phone during development. |

The firmware lives separately, at
`C:\Users\moises\Documents\Arduino\lacs_node` — see its own README for the
wiring diagram and payload contract.

`packages/contracts` is the spine. The firmware's four frame types exist in
exactly one place, so a format change breaks the build rather than the device.

## Running it

Needs Node 20+ and MongoDB on 27017 (already installed as a Windows service).

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
npm install
npm run build:contracts
npm run dev          # API on :4000, dashboard on :3000
```

Then open http://localhost:3000, create an account, and add your node by the id
printed on its boot line (`lacs-7a3f21`). Adding it returns an **ingest token**,
shown once.

### Real data without a phone

```bash
npm run list -w @lacs/serial-bridge   # find the COM port
# put SERIAL_PORT and BRIDGE_DEVICE_TOKEN in .env
npm run bridge
```

The bridge reads the node over USB, uploads frames, and delivers queued
commands. Close the Arduino Serial Monitor first — it holds the port open
exclusively.

### The Android app

```bash
npm run apk              # debug build
```

`npm run apk` also publishes it to `apps/web/public/downloads/somnus.apk`, so
the `/download` page serves it. The APK is gitignored - 25 MB of build output
does not belong in the repo.

The build strips that file before packaging and puts it back afterwards.
Capacitor copies all of `public/` into the app's assets, so leaving it there
makes the app ship a copy of the previous APK inside itself, growing by
~25 MB every build.

**The API URL is compiled in**, so an APK only works against the address it
was built for. `NEXT_PUBLIC_API_URL` must be your machine's LAN address
before you build - `localhost` on a phone is the phone. The router can hand
the laptop a new address, so check it against `ipconfig` each time. The build
prints the baked URL so this cannot fail silently:

```
[web] API URL baked into this build: http://192.168.1.33:4000
```

`next.config.mjs` reads the root `.env` to get it. Next only auto-loads a
`.env` from its own directory, so without that the root value is ignored and
the bundle silently keeps its default.

Check what you actually shipped before handing the file to anyone:

```bash
AAPT="$LOCALAPPDATA/Android/Sdk/build-tools/35.0.0/aapt2.exe"
"$AAPT" dump badging apps/web/public/downloads/somnus.apk | grep uses-permission
```

Dependencies inject permissions of their own. The SQLite plugin declared
biometric permissions for an encryption mode this app switches off, and the
BLE plugin declared coarse location uncapped; both are stripped in
`AndroidManifest.xml` with `tools:node`. On a sideloaded app that Android
already warns about, an unexplained fingerprint permission is what makes
someone abandon the install.

If Gradle says `JAVA_HOME is set to an invalid directory`, a Java update moved
the JDK. Point it at the pinned JDK 21 for the one command:

```bash
JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot" npm run apk
```

### Releasing

Each GitHub release attaches the APK as `somnus.apk`. The landing page and the
in-app download link both use `releases/latest/download/somnus.apk`, so they
always serve the newest release without edits.

```bash
npm run apk
gh release create v0.3.0 apps/web/public/downloads/somnus.apk --title "Somnus 0.3.0" --notes-file notes.md
```

The landing page lives in `site/` and deploys to GitHub Pages on every push to
`main` that touches it (`.github/workflows/pages.yml`).

### Android blocks plain HTTP

Apps targeting SDK 28+ refuse cleartext traffic, and this one targets 35. A
LAN API on `http://` is rejected by the platform before the request leaves the
phone, and the app can only report "cannot reach the server" - identical to
the server being down.

`scripts/write-network-config.mjs` generates
`res/xml/network_security_config.xml` from `NEXT_PUBLIC_API_URL` on every
build: cleartext stays blocked by default and is permitted only for that one
host, so the exception cannot drift from the URL in the bundle. An `https`
API produces no exception at all.

`allowMixedContent` in `capacitor.config.ts` does not cover this - it governs
WebView mixed content, not the platform policy.

## Tests

```bash
npm test
```

Contracts tests parse real captured firmware output, including malformed and
chunk-split lines. API tests run against MongoDB in a throwaway `lacs_test`
database and cover the two properties the design rests on: ingest idempotency,
and that one account cannot see another's device.

## Notes worth keeping

- **Ingest is idempotent** via a unique `{deviceId, seq}` index. A phone that
  dies mid-flush retries the whole batch safely. This is what lets the buffer
  delete rows only after the server confirms them.
- **Frames are spread across real time** on ingest, back-dated from the device
  uptime counter. Without it, an hour of buffered frames would all land at the
  flush instant and collapse into one point on every chart.
- **BLE chunks every frame.** Default MTU is 23 bytes and a telemetry frame is
  around 300. Both the firmware and the phone assume a frame arrives in pieces
  and rejoin at the newline.
- **JDK 21 is pinned** in `apps/mobile/android/gradle.properties`. Android
  Studio bundles JBR 25, which the Android Gradle Plugin rejects. The machine's
  `JAVA_HOME` is deliberately left alone. Use forward slashes in that path -
  Java's properties parser eats Windows backslashes.
- **Gradle heap is capped** at 1.5 GB in the same file. An uncapped build
  alongside the dev servers exhausted memory on this machine.

## Not built yet

WiFi-direct upload from the node, CSV export, researcher roles, push
notifications, iOS, on-device SpO2, OTA firmware update. None of them change
the contracts or the data model.
