# Room unit Wi-Fi setup over Bluetooth — design

Date: 2026-10-05
Status: approved in chat, awaiting spec review
Firmware counterpart: `C:\Users\moises\Documents\Arduino\esp_flash_mmwave`
Builds on: `2026-09-18-room-unit-design.md`
Part of: the v2 release (item 1 of 6; all six ship together as one app version and one firmware flash)

## 1. Goal

Set up the room unit entirely from the Somnus app. The user finds the unit over Bluetooth, picks a Wi-Fi network from the list the unit itself can hear, types the password, and the app sends the network, the password, a fresh device key and the server address in one step. No editing `secrets.h`, no reflashing per network or per key, no copying keys.

Success: a wiped unit goes from power-on to "Room unit is online" in the app, and its presence frames reach the Sleep card, with no computer involved. A wrong password, an unreachable network, a rejected key and a sleeping server each produce a distinct message and a way to retry.

Also in scope: switching the XIAO to the external U.FL antenna that is already attached but not selected in code.

## 2. Constraints

- **One 2.4 GHz radio.** The ESP32-C6 shares one radio and one antenna path between Wi-Fi and Bluetooth. Both run together during setup; nothing may block `loop()`, because the radar keeps switching the light during setup.
- **Flash budget.** The sketch already carries Wi-Fi, HTTPS, WiFiManager and ArduinoJson. Bluetooth uses NimBLE-Arduino 2.x (smaller than the core's Bluedroid library). If the build is still too big, the partition scheme moves to *Huge APP (3MB No OTA)*; this is decided from the real build size and written in the README.
- **Android only.** Bluetooth setup runs in the Capacitor app. In a plain browser the wizard explains this and points to the hotspot.
- **Render free tier sleeps.** The first request after idle can take ~60 s; the server check waits that long and the app says so.

## 3. Setup window (option A)

Bluetooth setup is open only when the hotspot would be: first boot with no saved network, offline for 60 s, BOOT held 3 s, or the new `setup` Serial command. Every place that calls `startPortal()` today calls `startSetup()`, which opens both the hotspot and Bluetooth setup. The hotspot stays as the backup method.

It closes:
- right after a successful setup;
- when Wi-Fi is working and no phone has connected for 5 minutes (an accidental BOOT hold).

With no Wi-Fi it stays open, since the unit is otherwise unreachable.

## 4. Bluetooth link

- Advertised name: `Somnus-room-xxxxxx` (same as the hotspot).
- Setup service `f2c2717f-fa64-4ba7-ba20-32fe2257d551`, separate from the band's Nordic UART service so neither scan shows the other device.
  - `62b01999-0497-4557-b649-fbd965a30353` — app → unit, write, **encrypted write required**.
  - `be53eb28-bb81-410f-99e6-4cbe6e0ff788` — unit → app, notify.
- One phone at a time; advertising stops while connected and resumes on disconnect if the window is still open.
- Messages are one JSON object per line (`\n`), the same framing as band frames, so a line split across notifications is reassembled.

### Encryption

LE Secure Connections, "Just Works" pairing with bonding (NimBLE `setSecurityAuth(true, false, true)`). The write characteristic requires an encrypted link, so no message (including the password) is accepted in plain text. The app calls `BleClient.createBond()` after connecting; Android shows one "Pair with Somnus-room-xxxxxx?" prompt the first time. This stops passive eavesdropping. It does not stop an active man-in-the-middle during pairing (Just Works has no PIN); accepted, since the attack needs someone within ~10 m with active tools during the setup minute, and the unit has no display to show a PIN.

## 5. Messages (`packages/contracts/src/setup.ts`)

Zod schemas, shared by the app and documented for the firmware.

| App sends | Unit answers |
|---|---|
| `{"op":"hello"}` | `{"op":"hello","id":"room-7c1a02","fw":"0.4.0","wifi":"PLDT-xxx"\|null}` |
| `{"op":"scan"}` | one `{"op":"net","ssid","rssi","secure"}` per network, then `{"op":"scan_done"}` |
| `{"op":"join","ssid","password","server","key"}` | `{"op":"joining"}`, `{"op":"checking"}` once Wi-Fi is up, then `{"op":"result","wifi":W,"server":S}` |

- `W`: `"ok" | "wrong_password" | "not_found" | "timeout"`.
- `S`: `"ok" | "unauthorized" | "unreachable" | null` (`null` when Wi-Fi failed and no check ran).
- Errors the unit cannot attribute: `{"op":"error","reason":"busy"|"bad_message"}`.
- Validation (both ends): `ssid` 1–32 bytes; `password` empty (open network) or 8–63 characters; `server` starts with `http://` or `https://`, trailing slashes trimmed; `key` non-empty.
- The scan list is merged by SSID (strongest kept), sorted strongest first, capped at 20, hidden (empty) SSIDs dropped. One line per network keeps every notification small.
- The unit never sends the password or key back, in any message.

Pure helpers in the same file, unit-tested: line reassembly, scan list merging, and `describeResult(result)` → `{ title, detail, backTo: 'wifi' | 'password' | 'retry' | null }` used by the wizard.

## 6. Firmware (`esp_flash_mmwave`)

- New `ble_setup.h` / `ble_setup.cpp` in the sketch folder, exposing `bleSetupStart()`, `bleSetupStop()`, `bleSetupActive()`, `bleSetupLoop()`, with the main sketch supplying "scan" and "join" hooks.
- NimBLE callbacks only enqueue the incoming line; `loop()` (via `bleSetupLoop()`) parses it, does the Wi-Fi work and sends replies. No Wi-Fi or HTTP calls on the Bluetooth task.
- Scan: `WiFi.scanNetworks(true)` (async), results streamed as `net` lines.
- Join:
  1. Save `server` and `key` to `roomcfg` (`url`, `token`) at once — the app has just claimed the unit, so the old key is already dead.
  2. Stop the hotspot if open, `WiFi.begin(ssid, password)`, poll status from `loop()` for up to 20 s. Map `WL_CONNECT_FAILED` → `wrong_password`, `WL_NO_SSID_AVAIL` → `not_found`, no connection in 20 s → `timeout`.
  3. On Wi-Fi success, post a `status` frame through `apiRequest` (10 s per attempt, retried from `loop()` for up to 60 s so the radar is never blocked longer than one request): 2xx → `ok`, 401/403 → `unauthorized`, still failing after 60 s → `unreachable`.
  4. Send `result`; on full success close Bluetooth setup a few seconds later (after the app has read it).
- A failed attempt leaves the previous network saved. `WiFi.begin()` writes credentials to the ESP's Wi-Fi storage immediately (where WiFiManager and the reconnect path read from), so before joining the unit reads the saved network (`esp_wifi_get_config`), and on failure calls `WiFi.begin(previousSsid, previousPassword)`, which restores it and reconnects. With no previous network, it disconnects and stays in setup.
- Boot order: saved network first; `WIFI_SSID` from `secrets.h` becomes the fallback.
- Antenna: at the top of `setup()`, `WIFI_ENABLE` LOW and `WIFI_ANT_CONFIG` HIGH (GPIO3 / GPIO14 if the board package lacks the names).
- Serial: new `setup` command; password printed as `****`, key as its first 4 characters.
- `ROOM_FW_VERSION` → `0.4.0`. README: NimBLE-Arduino in the library list, the app setup steps, the partition note, and the bench checklist (section 9).

## 7. App (`apps/web`)

- `lib/native/ble.ts`: new `ensureEnabled()` — if Bluetooth is off, `BleClient.requestEnable()` (Android's "turn on Bluetooth?" prompt); on denial, a plain message. Band pairing in `session.ts` switches to it too (this is v2 item 2, done in the same change since it touches the same function).
- `lib/native/roomSetup.ts`: the setup connection — connect, bond, send/receive typed messages, timeouts (hello 5 s, scan 15 s, join 90 s).
- `app/device/room-setup/page.tsx` plus one small component per step:
  1. **Find** — instructions (hold BOOT 3 s, or a new unit), Search → `ensureEnabled()` → Android picker filtered to the setup service.
  2. **Wi-Fi** — "Connected to room-7c1a02 · currently on …", networks appear as they arrive with signal bars and a lock, Rescan, "Other network…".
  3. **Password** — with show/hide; skipped for open networks.
  4. **Connecting** — live steps: adding to your account (`POST /devices/claim` with the id from `hello`), sending, joining, checking the server; "Waking the server…" after 5 s on the last step.
  5. **Done / Failed** — from `describeResult`. Claim `409` shows "This room unit belongs to another account."
- The server address sent is the app's own API base URL.
- Device tab: the "put it in `secrets.h` and flash again" text for room units becomes a "Set up over Bluetooth" button; the hotspot is mentioned as the backup. After the v2 redesign (item 3) the same route opens from Bed and More → Device management.

## 8. API

No changes. `POST /devices/claim` already mints a fresh key, refuses another owner with `409`, and has tests.

## 9. Testing

- `packages/contracts` (vitest): schema accept/reject cases, line reassembly across chunk boundaries, scan merge/sort/cap, every `describeResult` branch.
- Bench checklist (README, run with the hardware):
  1. Erase flash, set up from the app end to end.
  2. Wrong password → "Wrong password", retry succeeds.
  3. Nonexistent or 5 GHz-only network → "not found".
  4. While online, hold BOOT → setup opens; with no phone it closes after 5 minutes.
  5. Radar keeps switching the bulb throughout setup.
  6. Reboot → reconnects alone; the previous key is rejected by the server.
  7. Encryption: a write before pairing is refused; after the Pair prompt it works.
  8. `scan` dBm for the home network before and after the antenna change.
  9. Record the build size and whether the partition change was needed.
- Before release: build the APK and run the wizard once on a real phone.

## 10. Out of scope

Changing Wi-Fi from the app while the unit is online without pressing BOOT (option B); removing the hotspot (option C); PIN-based pairing; the presence graph and the rest of v2 (separate designs).
