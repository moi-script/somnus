# 2026-09-27 — Connecting the band to the app

Band: `lacs-79deec` (XIAO ESP32-C3, firmware `lacs_node`)

## Symptoms

1. The band could be added on **Device → Add a band or room unit**, but
   **Connect over Bluetooth** never found it.
2. The app showed no pulse, skin, motion or bpm data, while the Arduino
   Serial Monitor showed live values.
3. Frames on serial were `"v":1` with no `steps` field, although the source
   in `lacs_node` is fw 0.2.1 and emits payload `v: 2`.

## How the pieces connect (why serial data never reached the app)

```
Band ──BLE──> Android app ──HTTPS──> API ──> MongoDB ──> dashboard
  └──USB──> Serial Monitor (PC only, never reaches the server)
```

- Serial output goes only down the USB cable to the PC.
- The app gets data only from the phone over Bluetooth, or from
  `npm run bridge` (the USB serial bridge) during development.
- **Add a band** only registers the id to the account and issues the
  ingest token. It does not connect anything.

## Root causes

### 1. Firmware never started Bluetooth

`BleTransport` was fully implemented in `ble_transport.cpp` and wired into
`LINKS[]` for sending and receiving, but `setup()` in `lacs_node.ino` never
called `bleLink.setDeviceName()` or `bleLink.begin()`. This was true in both
commits (`d9561df`, `db1b7c8`). The band never advertised, so Android's
picker had nothing to show.

### 2. Board was running old firmware

The `"v":1` frames showed the flashed build was older than the source.

### 3. App preferred a stale saved token (latent)

`apps/web/src/app/node/page.tsx` used `deviceToken() ?? token.trim()`: a
token saved from an earlier pairing beat the one just pasted in. An old
token is rejected on upload, and the only symptom is an empty app.

## Fixes

| Where | Change |
|---|---|
| `lacs_node/lacs_node.ino`, `setup()` | Added `bleLink.setDeviceName(deviceId); bleLink.begin();` before `sendStatusFrame()`, so the band advertises under its device id. |
| `apps/web/src/app/node/page.tsx` | Token is now `token.trim() \|\| deviceToken()`: the field (prefilled with the saved token) wins. Type-checks with `tsc --noEmit`. |

Neither change is committed yet.

## Verification so far

- Reflashed: frames are now `"v":2` with `steps` and `spo2` fields, and
  `seq` starts at `4000000071` (boot 4 × 1,000,000,000 — reboot-safe seq
  from fw 0.2.1 working).
- All three sensors report `ok: true`.
- `finger:false`, `bpm:0`, `spo2:-1` are expected: nothing is on the pulse
  sensor.

Still to confirm:

- [ ] Serial shows `[BLE ] advertising as lacs-79deec` after reset.
- [ ] Phone picker lists `lacs-79deec`; serial prints `[BLE ] connected, MTU …`.
- [ ] Health / Device tabs fill within ~5 s (upload interval).
- [ ] APK rebuilt (`npm run apk`) and reinstalled to pick up the token fix.

## Connecting procedure (for reference)

1. Flash `lacs_node` (board **XIAO_ESP32C3**), reset, and read the id from
   `[BOOT] … id=lacs-xxxxxx`.
2. App → **Device → Add a band or room unit** → enter the id → copy the
   ingest token (shown once).
3. App → **Device → Connect over Bluetooth** → paste the token →
   **Find my node** → pick the band → allow Bluetooth permission.
4. Bluetooth pairing works only in the Android app, not in a browser.

## Round 2 — Bluetooth connects, upload fails with 401

After adding the `bleLink.begin()` fix and reflashing, the phone found and
connected to `lacs-79deec`, but the upload status showed
**"Server rejected a batch (401)"**.

### Cause

- `POST /devices/claim` (`apps/api/src/routes/devices.ts:69`) mints a **new
  token on every Add** and overwrites the stored hash, so any earlier token
  for that band stops working.
- The installed APK (built 2026-09-23) predates the token-precedence fix and
  sends the token saved during the earlier, failed Connect attempts instead
  of the one pasted into the field. `requireDevice` rejects it:
  `401 unknown device token`.
- A token minted on a different server (e.g. added via a local dashboard on
  `localhost`) would give the same 401, because the APK talks to
  `https://somnus-api-kx6h.onrender.com`.

### Data loss found along the way

`Bridge.flush()` in `apps/web/src/lib/native/sync.ts` deleted any batch that
got a 4xx. For a 401 the frames are valid; only the key is wrong. Every
rejected batch was deleted from the phone's buffer.

### Fixes

| Where | Change |
|---|---|
| `apps/web/src/lib/native/sync.ts` | 401/403 now keep the batch buffered and show "Server rejected the device key - re-add the band and paste the new key". Other 4xx still drop the batch. |
| APK | Rebuilt with `npm run apk` (JDK 21) against the Render API, including both app fixes. |

### Steps to recover

1. Install the new APK over the old one.
2. In the app, **Device → Add a band** with `lacs-79deec` again; copy the new
   key.
3. **Connect over Bluetooth** → replace whatever is in the key field with the
   new key → **Find my node**.

- [ ] Upload status clears and the uploaded count rises.
- [ ] Health / Device tabs show live values.

## Open issue

The Device tab's message after adding a band says "The phone app keeps it
for you", but `add()` in `apps/web/src/app/device/page.tsx` never calls
`setDeviceToken`. The token has to be pasted into the Connect screen by
hand. It is saved after the first successful connect.
