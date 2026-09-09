# LACS

Wearable sensor node and the software around it. A Seeed XIAO ESP32-C3 reads a
MAX30102 pulse sensor, an MPU6050 accelerometer and a Grove GSR sensor, and
drives a vibration motor. A phone carries the data to a server; a browser shows
it live.

## How the pieces connect

```
XIAO ──BLE──> Android app ──HTTPS──> Express ──> MongoDB
  │            (SQLite buffer)          │
  └──WiFi─────────────────────────────> │  (planned, no phone needed)
                                        └──SSE──> Next.js dashboard
```

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

The APK lands at
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to
`apps/web/public/downloads/lacs.apk` to serve it from the `/download` page.

`NEXT_PUBLIC_API_URL` is baked in at build time. For a phone it must be your
machine's LAN address or a public URL — `localhost` on a phone is the phone.

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
  `JAVA_HOME` is deliberately left alone.

## Not built yet

WiFi-direct upload from the node, CSV export, researcher roles, push
notifications, iOS, on-device SpO2, OTA firmware update. None of them change
the contracts or the data model.
