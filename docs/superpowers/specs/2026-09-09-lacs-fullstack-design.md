# LACS fullstack — design

Date: 2026-09-09
Status: awaiting review
Firmware counterpart: `C:\Users\moises\Documents\Arduino\lacs_node` (payload `v:1`)

## 1. Goal

Get sensor data off a XIAO ESP32-C3 and in front of a person, live and historically, with the node reachable for commands. The node carries a MAX30102 (PPG), an MPU6050 (IMU), a Grove GSR sensor and a vibration motor.

Success for v1: a XIAO on a bench streams to a phone over BLE, the phone persists locally and syncs to MongoDB, a browser shows the values moving in real time, and a button in the browser makes the motor buzz.

## 2. Topology — why the phone is the bridge

A deployed Express server has no Bluetooth radio, so "server connected via Bluetooth to the XIAO" cannot be literal. It resolves as:

```
XIAO ──BLE──> Android app ──HTTPS──> Express ──> MongoDB
  │            (SQLite buffer)          │
  └──WiFi─────────────────────────────> │  (fallback path, no phone)
                                        └──SSE──> Next.js dashboard
```

The phone is the medium. This is what makes the Bluetooth *and* WiFi permissions both necessary, and it is the only arrangement where a subject out of WiFi range still records data — the phone buffers and flushes later.

WiFi-direct from the node is a secondary path for when no phone is nearby. Both terminate at the same ingest endpoint with the same payload, so the server does not care which one delivered a frame.

Commands travel the reverse path: browser → Express queue → phone drains → BLE write → the firmware's existing JSON command parser. No new firmware command format is needed.

## 3. Repository layout

`C:\lacs_thesis`, npm workspaces. npm 11 is already installed; pnpm is not, and workspaces cover everything here, so no extra package manager.

```
lacs_thesis/
├─ package.json                  workspaces + top-level scripts
├─ packages/contracts/           @lacs/contracts
├─ apps/api/                     Express + TS + Mongoose      :4000
├─ apps/web/                     Next.js 15 + TS + Tailwind   :3000
├─ apps/mobile/                  Capacitor shell → APK
└─ tools/serial-bridge/          USB serial → API (dev, no phone needed)
```

### `packages/contracts`

The spine of the repo. The firmware's four frame types — `telemetry`, `status`, `event`, `ack` — are declared once as zod schemas with inferred TS types. API, web and mobile all import them.

This exists so the payload has exactly one definition. When the firmware moves to `v:2`, one file changes and the compiler lists every consumer that breaks. Its tests parse captured real frames from the serial monitor, which means a firmware/backend mismatch fails in CI rather than at 2am on a phone.

## 4. Data model — `mongodb://127.0.0.1:27017/lacs`

| Collection | Purpose | Key indexes |
|---|---|---|
| `users` | email, passwordHash, createdAt | unique `email` |
| `devices` | deviceId, ownerId, name, pairingCode, fw, lastSeenAt | unique `deviceId` |
| `readings` | one telemetry frame | `{deviceId, recordedAt}`, **unique `{deviceId, seq}`** |
| `events` | fall / gsr_spike / no_finger | `{deviceId, recordedAt}` |
| `commands` | queued downlink, status pending→sent→acked | `{deviceId, status}` |

The unique `{deviceId, seq}` is load-bearing. Ingest is a batch upsert that ignores duplicate-key errors, which makes the endpoint idempotent — a phone that dies mid-flush retries the whole batch with no duplicated rows. The firmware already increments `seq` across every frame type, so this works without firmware changes.

`recordedAt` is server-assigned. The firmware's `ms` is uptime, not wall clock, and is kept as `deviceMs` for ordering within a session only.

## 5. API — `/api/v1`

| Method | Route | Notes |
|---|---|---|
| POST | `auth/register`, `auth/login` | bcrypt, returns JWT |
| GET | `me` | |
| GET | `devices` | caller's devices |
| POST | `devices/claim` | binds `lacs-7a3f21` to the account via pairing code |
| POST | `ingest` | batch of frames; idempotent |
| GET | `devices/:id/latest` | newest reading |
| GET | `devices/:id/readings` | `?from&to&limit`, paged |
| GET | `devices/:id/events` | |
| POST | `devices/:id/commands` | queue a command (buzz, config, calibrate) |
| GET | `devices/:id/commands/pending` | phone drains this |
| POST | `commands/:cid/ack` | phone reports the firmware ack |
| GET | `stream/:deviceId` | SSE, live push to the browser |

SSE rather than WebSockets: the dashboard live feed is one-directional, and SSE reconnects on its own. Commands go over ordinary POSTs, so there is no need for a bidirectional socket.

Auth: JWT bearer for users. Devices authenticate by an ingest token issued at claim time, so a compromised device token cannot read another user's history — it can only write frames for its own `deviceId`.

## 6. Web — Next.js

Client-rendered so it can `output: 'export'` and be reused verbatim as the Capacitor webview payload. One UI, two shells: `Capacitor.isNativePlatform()` reveals the BLE scan/pair screens on the phone and hides them in a browser.

Screens: login/register · device list + claim · **live** (BPM, GSR and accel charts fed by SSE, connection state, sensor online/offline badges straight from the `ok` fields in each frame) · history (time range, charts, event timeline) · device settings (telemetry Hz, GSR threshold, buzz test) · `/download` (APK button plus the unknown-sources walkthrough).

Responsive: single-column phone layout, two-column tablet, three-column desktop. The live screen is the one that must work at 360 px, since that is what it looks like inside the APK.

## 7. Mobile — Capacitor

- `@capacitor-community/bluetooth-le` — native BLE central
- `@capacitor-community/sqlite` — the on-phone temporary database
- `@capacitor/network` — decides when to flush

Local schema: `pending_frames(id, deviceId, seq, type, json, createdAt)` and `synced_meta(lastSyncedSeq)`. Frames land in SQLite first, always; the uploader flushes in batches of 200 when the network is up and deletes only what the server acknowledges. Data survives an app kill, a dead server, and a subway ride.

Permissions in the manifest: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (API 31+), `ACCESS_FINE_LOCATION` (API 30 and below still require it to scan), `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`.

Distribution: unsigned-for-dev then a release APK signed with a local keystore, dropped at `apps/web/public/downloads/lacs.apk` and served by the `/download` page. The install flow is the sideload path — the browser warns, the user enables install from unknown sources, it installs.

## 8. Firmware change this requires

`BleTransport` in `transport.h` is currently a compiling stub that reports itself disconnected. The phone bridge cannot exist until it is real, so this work includes implementing it with NimBLE:

- advertise as the device id (`lacs-7a3f21`)
- one service; telemetry on a **notify** characteristic, commands on a **write** characteristic
- reuse `payload.cpp` untouched — same JSON in, same JSON out

Nothing above the `Transport` interface changes; `activeLink` gains a second implementation. Flash headroom is there: the current build uses 26%.

## 9. Configuration

`.env.example` at the root, real `.env` gitignored.

```
MONGODB_URI=mongodb://127.0.0.1:27017/lacs
JWT_SECRET=<generated>
API_PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4000
SERIAL_PORT=COM5          # serial-bridge only
```

MongoDB 8.0 is already running as a Windows service on the default 27017, so local development needs no database setup.

## 10. Testing

- `contracts` — vitest, parsing real captured frames including malformed and partial lines
- `api` — vitest + supertest against `mongodb-memory-server`; ingest idempotency and cross-user access denial are the cases that matter
- `web` — component tests for the chart and state logic
- `serial-bridge` — doubles as the end-to-end harness: real XIAO, real API, real Mongo, no phone required

The serial bridge is what makes this testable at all before BLE works.

## 11. Build order

1. Repo skeleton, workspaces, `.env.example`, contracts + tests
2. API: models, auth, ingest, queries, SSE
3. serial-bridge — first real data into Mongo, end to end
4. Web: auth, device list, live SSE dashboard, history, settings
5. Firmware `BleTransport` (NimBLE)
6. Capacitor: BLE scan/connect/notify, SQLite buffer, uploader, command drain
7. Release keystore, signed APK, `/download` page

Steps 1–4 are provable on this machine today. Step 5 needs the XIAO on USB; step 6 needs an Android phone.

## 12. Risks

- **Android 12+ BLE permissions** are the usual failure: `BLUETOOTH_SCAN` needs a runtime grant and silently returns zero devices when missing. The scan screen surfaces the permission state explicitly rather than just showing an empty list.
- **BLE MTU** defaults to 23 bytes; a telemetry frame is around 300. The mobile side requests a 512-byte MTU on connect. If negotiation fails on a given phone, frames must be chunked — detect at connect time and fail loudly rather than silently truncating JSON.
- **Sustained write throughput.** 5 Hz per device is trivial, but 20 Hz over a long session is 72k documents an hour. Readings get a TTL index option in device settings, defaulted off, so a thesis dataset is never silently deleted.
- **JDK version drift.** Android Studio bundles JBR 25; AGP needs 17 or 21. `org.gradle.java.home` is pinned to the Temurin 21 install so Gradle cannot pick the wrong one.

## 13. Out of scope for v1

CSV export, multi-subject researcher roles, push notifications, iOS, on-device SpO2, OTA firmware update. All are additive; none change the contracts or data model above.
