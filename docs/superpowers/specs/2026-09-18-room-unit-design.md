# Room unit (radar + bulb) — design

Date: 2026-09-18
Status: approved in chat, awaiting spec review
Firmware counterpart: `C:\Users\moises\Documents\Arduino\esp_flash_mmwave`
Builds on: `2026-09-09-lacs-fullstack-design.md`

## 1. Goal

Bring the second microcontroller — a XIAO ESP32-C6 with a DFRobot SEN0395 24 GHz presence radar driving a Tuya Wi-Fi bulb — into Somnus as a first-class device, so the app can show what happened in the room overnight and what the light was doing, and can control the light.

Success: the C6 reports presence and light state to the API over WiFi with no phone involved; the Sleep tab shows last night's time in the room, the light's colour timeline and consistency; a button in the app changes the bulb.

## 2. Constraints that shape everything

- **The SEN0395 senses presence only.** No breathing, heart rate, movement intensity or distance. Every derived stat comes from a presence boolean over time.
- **It senses the room, not the bed.** The UI says "in the room", never "in bed" or "asleep".
- **It can briefly lose a very still sleeper.** Absences shorter than 2 minutes are treated as noise.
- **Light effects are stated as facts, not scored.** Evening cool/blue light is broadly associated with worse sleep, but this setup cannot establish that for one person.

## 3. Topology

```
Band (C3) ──BLE──> phone ──HTTP──┐
                                 ├──> Express /ingest ──> MongoDB
Room unit (C6) ──WiFi HTTP───────┘          │
      │  └──HTTPS──> Tuya Cloud ──> bulb    └──SSE──> Sleep tab
      └── radar (D1 presence pin)
```

The room unit is its own device: claimed like the band, authenticated with its own device token, posting to the same `/ingest`. Commands reach it through the existing queue; it polls the existing device-token routes (`GET /commands/...` pending, `POST` ack in `apps/api/src/routes/commands.ts`). Radar auto mode stays on the C6, so the light keeps working if the API is down.

Rejected: server-side Tuya control (light would depend on the API host, currently a laptop); relaying through the phone over BLE (unit goes silent when the phone leaves the room).

## 4. Contracts (`packages/contracts`)

### Identity

Device ids: `lacs-xxxxxx` (band) and `room-xxxxxx` (room unit), both from the eFuse MAC. `claimDeviceSchema`'s regex widens to `^(lacs|room)-[0-9a-f]{6}$`. The device record gains `kind: 'band' | 'room'`, set at claim from the prefix.

### New frames

Same envelope as the band (`v`, `t`, `id`, `seq`, `ms`), `v: 2`.

```json
{"v":2,"t":"presence","id":"room-7c1a02","seq":88,"ms":912345,"present":true}
```
Sent on every debounced change, and as a heartbeat every 60 s. Heartbeats let the app distinguish "nobody there" from "unit offline".

```json
{"v":2,"t":"light","id":"room-7c1a02","seq":89,"ms":912400,
 "on":true,"mode":"white","bright":20,"temp":10,"color":null,"source":"auto"}
```

| Field | Meaning |
|---|---|
| `on` | bulb switched on |
| `mode` | `white` or `colour` |
| `bright` | 1–100, white-mode brightness (null in colour mode) |
| `temp` | 0 warm – 100 cool (null in colour mode) |
| `color` | `{h:0–360, s:0–100, v:1–100}` in colour mode, else null |
| `source` | `auto` (radar), `app`, `serial`, `external` (changed outside the C6, e.g. Smart Life) |

Sent after every successful bulb command. The C6 also reads the bulb's real state from Tuya (`GET /v1.0/iot-03/devices/{id}/status`) every 30 s; if it differs from the last reported state, it emits a `light` frame with `source: "external"`.

### `status` for the room unit

`statusFrameSchema.sensors` and `.config` become unions of the band shape and a room shape:

```json
"sensors": {"sen0395": true, "bulb": true},
"config":  {"auto": true, "offDelayMs": 30000}
```
`transport` is `"wifi"`. `ack` is reused unchanged.

### New commands

```json
{"cmd":"light","on":true}
{"cmd":"light","on":true,"bright":30,"temp":0}
{"cmd":"light","color":{"h":20,"s":90,"v":30}}
{"cmd":"auto","on":false}
{"cmd":"status"}
```
`light` needs at least one of `on`, `bright`/`temp`, `color`; `bright`/`temp` and `color` are mutually exclusive. The API rejects band commands sent to a room device and room commands sent to a band (400 `wrong_device_kind`).

## 5. Firmware (`esp_flash_mmwave.ino`)

- Secrets move to a gitignored `secrets.h` (WiFi, Tuya client id/secret/device id, API URL, device token). A `secrets.example.h` is committed. The current `.ino` has the Tuya id and secret inline; they should be rotated if that file was ever shared.
- Device id from the eFuse MAC, printed on the boot line like the band.
- Frames go into a 64-entry RAM ring buffer. Flush to `POST /ingest` every 5 s, and immediately on a presence change. On failure, keep the buffer and retry; oldest frames drop when full. The server's `ms` back-dating places late frames correctly.
- Poll pending commands every 5 s; execute; post the ack.
- Poll Tuya status every 30 s for external changes.
- A `status` frame on boot, on `{"cmd":"status"}`, and when the radar or bulb goes unreachable/returns.
- Existing behaviour stays: radar auto on/off with 30 s off-delay, Serial Monitor commands (which now report `source: "serial"`).
- No blocking waits beyond the existing short HTTP calls; the WiFi reconnect loop becomes non-blocking so the radar keeps being read.

## 6. Server (`apps/api`)

- `devices`: add `kind`.
- New collection `roomframes`: `{deviceId, ownerId, seq, deviceMs, recordedAt, t: 'presence'|'light', ...payload}`. Indexes: unique `{deviceId, seq}`, `{deviceId, recordedAt}`.
- `/ingest` handles `presence` and `light` exactly like telemetry: timestamped by the batch timestamper, inserted ignoring duplicates, fanned out on the SSE bus.
- `POST /commands` validates command kind against device kind.
- `GET /devices/:id/nights/:date` → one `NightSummary`.
- `GET /devices/:id/nights?limit=14` → most recent nights, newest first.

## 7. Night analysis — `summarizeNight()` in `packages/contracts`

A pure function, `summarizeNight(presence[], light[], window) → NightSummary`, shared by API and tests.

### Window and main stretch

- A night runs 18:00 → 14:00 next day, local time, labelled by the evening's date.
- Absences < 2 min are **noise**: bridged, never counted.
- Absences from 2 min up to 60 min are **the room emptying**: they stay inside a stretch and are counted.
- Absences ≥ 60 min split stretches.
- A stretch starts at the first presence run ≥ 20 min, so short visits before bed don't open one.
- The **main stretch** is the longest such stretch in the window.
- Less than 60 min of presence in the window → `{ recorded: false }`.

### Room stats

| Stat | Rule |
|---|---|
| `inRoomMs` | length of the main stretch |
| `emptiedCount` | absences ≥ 2 min inside the stretch |
| `longestStretchMs` | longest presence run between those absences |
| `coverage` | fraction of the stretch with a heartbeat or change within 90 s; < 0.9 → UI notes the unit was offline, nothing is interpolated |

### Light stats

Light frames are replayed as a step function over the stretch; the state before the first frame in the window is taken from the last frame before it (or `unknown`).

Colour groups:

| Group | Rule |
|---|---|
| Off | `on: false` |
| Warm white | white, `temp` ≤ 30 |
| Neutral white | white, 30 < `temp` < 70 |
| Cool white | white, `temp` ≥ 70 |
| Red / amber | colour, hue 0–45 or 330–360 |
| Green | colour, hue 75–165 |
| Blue / violet | colour, hue 180–300 |
| Other colour | any other hue |
| Unknown | no light data |

| Stat | Rule |
|---|---|
| `timeline` | `[{from, to, group, css}]` where `css` is the actual bulb colour for drawing |
| `groupMs` | time per group |
| `changes` | count of state changes, split by `source` |
| `consistency` | share of the stretch in the dominant group, plus which group |
| `onWhilePresentMs` / `avgBrightness` | bulb on during presence; brightness-weighted mean |
| `coolOrBlueMs` | time in Cool white or Blue / violet during the stretch |

### Tests

Captured-style fixtures: an ordinary night; a still sleeper dropping out for 40 s (bridged, not counted as emptied); the unit offline for an hour (coverage < 0.9); a Smart Life change mid-night (`external` counted); an evening at the desk before bed (excluded from the stretch); no presence at all (`recorded: false`).

## 8. UI (`apps/web`)

Uses the existing soft design: `HeroMetric`, `MetricTile`, `PendingTile`, the `sleep` colour token and the existing honest empty states.

### Navigation

Tabs become Health · **Sleep** · Exercise · Device · Me.

### Sleep tab (`/sleep/`)

1. **Room right now** — live over SSE: "Someone's here" / "Room is empty" / "Last heard 14 min ago"; a swatch in the bulb's real colour with brightness; On/Off and Auto toggles. Tapping opens a sheet with brightness and warm↔cool sliders and presets (Warm night, Amber, Red, Off). Commands show "Sent, waiting for the room unit…" until the ack arrives.
2. **Last night** — night picker (‹ date ›). Hero: time in the room, start → end, times the room emptied. Two aligned strips across the stretch: presence band, and light band painted in actual bulb colours, with an hour axis.
3. **Tiles** — Longest stretch · Light changes (with source split) · Consistency ("84% off") · Cool & blue light minutes · Light on while in the room + average brightness. Coverage note when < 0.9.
4. **Time per colour** — one stacked bar with legend.
5. **Last 14 nights** — one bar per night: height = time in room, fill = light mix.

Wording is factual throughout: "22 min of cool light after 23:00", no scores.

### Empty states

- No room unit claimed: explains what the radar and bulb add, links to Device.
- Unit claimed, no night recorded: "No night recorded — the room unit saw less than an hour of presence."

### Other tabs

- **Health**: the Sleep `PendingTile` becomes a real tile ("7 h 42 m in the room last night") when a room unit exists; otherwise unchanged.
- **Device**: lists both kinds; claim accepts `room-…`; each device card shows its own controls (Buzz for the band, Light for the room unit). `useDevice` exposes both the active band and the room unit.

## 9. Out of scope

- Breathing, heart rate, sleep stages from radar (needs a different radar module).
- Timed light scenes (wind-down, wake-up ramp).
- Server-side Tuya access.
- Correlating band vitals with room data (natural next step once both exist).
