# Somnus UI redesign (part A) — design

Date: 2026-10-05
Status: approved in chat, awaiting spec review
References: `new_ui_changes/somnus_ui1.png` (five tabs), `new_ui_changes/somnus_ui2.png` (detail screens)
Part of: the v2 work. A = design system, 5-tab layout, every screen on data that exists today, Bed tab. B = sleep analysis. C = wellness. B and C get their own specs.

## 1. Goal

The app looks and navigates like the two mockup images: Home, Sleep, Health, Bed, More, dark navy with soft glow, and every number on screen is real. Success: each screen, at phone width, in dark and in light, matches the mockup layout for the parts whose data exists, and hides the parts whose data arrives with B or C.

## 2. Decisions already made

- **Approach:** extend the existing token-based theming and hand-drawn SVG; no UI or chart library.
- **Theme:** dark (the mockup look) is the default; a matching light theme stays selectable (Dark / Light / Follow phone) in More → App Settings.
- **Unbuilt features are hidden, not faked.** Sleep's Activity / Events / Reports tabs arrive with B; More's Sleep & Wellness rows and Alerts & Notifications arrive with C.
- **Exercise is removed** (page deleted, address forwards to Home).
- **Everything else not in the mockups lives under More.**
- **Hardware limits stated in the UI:** no Breathing (the SEN0395 cannot measure it); Movement comes from the band, labelled "from wristband".

## 3. Theme (`apps/web/src/app/globals.css`, `tailwind.config.ts`)

Token names stay; values change, so existing screens follow.

| Token | Dark (default) | Light |
|---|---|---|
| `canvas` | `#0B1020` | `#F4F6FB` |
| `card` | `#121A2E` | `#FFFFFF` |
| `line` (card border) | `#1E2A4A` | `#E7EBF3` |
| `ink` | `#E9EEF6` | `#17202E` |
| `muted` | `#8A96AB` | `#78849B` |
| `primary` (new) | `#3B82F6` | `#2563EB` |
| `good` (new) | `#2EE6C5` | `#14B8A6` |
| `heart` | `#FF5C8A` | `#E11D63` |
| `oxygen` | `#A78BFA` | `#7C3AED` |
| `stress` (new) | `#34D399` | `#059669` |
| `sleep` | `#6366F1` | `#4F46E5` |
| `skin` | `#F59E0B` | `#D97706` |
| `motion` | `#2DD4BF` | `#0D9488` |
| `alarm` | `#F43F5E` | `#E11D48` |

- Cards: 1 px `line` border; in dark, `box-shadow: 0 0 0 1px rgb(var(--primary) / .08), 0 8px 24px rgb(var(--primary) / .06)` (the glow); in light, the current soft shadow.
- `lib/theme.ts`: themes become `dark | light | system`, default `dark`. A stored old value (`soft`, `night`, `system`) maps to `light`, `dark`, `system` once.
- `layout.tsx` applies the theme before first paint, as it does today.

## 4. Shared components (`apps/web/src/components/ui/`)

| Component | Props (essentials) | Used by |
|---|---|---|
| `StatTile` | `icon, tone, label, value, unit?, status?` | Home tiles, Sleep Start/End, Bed status |
| `Ring` | `value 0–1, tone, label, sublabel, badge?` | Sleep Overview |
| `SegmentedTabs` | `tabs[{id,label}], active, onChange` — mirrors `?tab=` | Sleep, Health, Lighting Control |
| `ListRow` | `icon, tone, title, subtitle?, href? / onClick?, right?` | More, Radar Monitoring |
| `StatusPill` | `tone: good/warn/bad/idle, label` | headers, tiles |
| `SectionCard` | `title, action?, children` | everywhere |
| `TimelineStrip` | `segments[{from,to,kind}], legend, from, to` — `kind` maps to a colour and pattern | Home Sleep Activity, Sleep Timeline, Bed presence |
| `LineChart` | `points[{t,v}], tone, min?, max?, timeLabels` + Avg/Min/Max | Health tabs, Heart Rate detail |
| `SegmentedToggle` | `options, value, onChange` | Manual / Adaptive Radar |
| `ColorWheel` | `hue, sat, onChange` — CSS conic + radial gradient, pointer/touch drag | Lighting Control |

`NightStrips` becomes a thin wrapper over `TimelineStrip`; `Trace` stays for the small traces, `LineChart` builds on it. New icons in `Icons.tsx` (same SVG style): bed, walk, wind, music, bell, bulb, chart, gear, target, home, exit.

## 5. Navigation and routes

Bottom bar (phones) / top tabs (wide): **Home · Sleep · Health · Bed · More**, active in `primary`.

| Route | Content |
|---|---|
| `/home/` | Dashboard (§6.1). `/` and login now land here. |
| `/sleep/?tab=overview` | Sleep Overview (§6.2). Other tabs hidden until B. |
| `/health/?tab=heart\|spo2\|stress\|history` | §6.3 |
| `/health/heart/` | Heart Rate detail, Daily only in A (Weekly/Monthly with B's reports) |
| `/bed/` | §7 |
| `/bed/lighting/` | Lighting Control (§7.4) |
| `/more/` | Settings: Device Management, App Settings |
| `/more/devices/` | Today's Device page content + rows to Pair band and Set up room unit |
| `/more/devices/pair/` | Today's `/node/` (band Bluetooth connect) |
| `/more/devices/room-setup/` | The room-setup wizard |
| `/more/settings/` | Theme, account and log out, app version and update status (today's Me) |
| `/more/history/` | Today's History page |

Forwarding pages (client `router.replace`, so the installed 0.5.0 app and old links work): `/device/` → `/more/devices/`, `/device/room-setup/` → `/more/devices/room-setup/`, `/node/` → `/more/devices/pair/`, `/me/` → `/more/settings/`, `/history/` → `/more/history/` (query string kept), `/exercise/` → `/home/`.

Headers: Home — greeting + date, bell (hidden until C). Bed — room unit `StatusPill`. More — gear → App Settings. Sub-pages — back arrow (`SubPage`). The update banner stays at the top of every tab.

## 6. Screens on existing data

### 6.1 Home
- Greeting: "Good morning" (05–12), "Good afternoon" (12–18), "Good evening" (18–05), and the date.
- Tiles: **Sleeping / Last night** — duration of the current or last in-room stretch (`nights`); **Bed status** — Occupied / Empty (`useRoom`).
- Connection row: Wristband (band session state) and Bed Unit (`useRoom().online`).
- Live Health tiles (band stream): Heart Rate (`hrStatus`), SpO₂ (only `spo2Valid`), Stress (`stressLevel`), Movement (`movementLevel`). Each shows `--` when the band is not streaming.
- Sleep Activity (last 4 h): `TimelineStrip` of room presence (from §7.2's endpoint).
- Quick Controls: Light (toggles on/off with the existing `light` command). Alerts and Sleep Music arrive with C.

### 6.2 Sleep → Overview
- `Ring`: time in room for the latest night against an 8 h goal (editable goal arrives with C); badge Good / Fair / Short.
- Tiles: Sleep Start, Sleep End, Consistency (from the last 7 `nights`), Bed Exits (the night's "emptied" count).
- Sleep Timeline: last night's presence and light strips (today's `NightStrips` data) in `TimelineStrip`.
- The room light card (`RoomNow`) moves to the Bed tab.

### 6.3 Health
- **Heart Rate:** current BPM, `hrStatus` pill, Avg/Min/Max and `LineChart` over today's readings; Quick check and Recent events (today's Health page) below.
- **SpO₂:** same layout, valid readings only.
- **Stress:** GSR level (`stressLevel`) and the GSR `LineChart`, labelled "Skin response (GSR) — an estimate of arousal, not a diagnosis".
- **History:** today's History list.

### 6.4 Display rules (`apps/web/src/lib/levels.ts`, unit-tested)
- `hrStatus(bpm)`: < 50 Low, 50–100 Normal, > 100 High; `null`/0 → none.
- `stressLevel(raw, base)`: rise over base `(raw − base) / base` < 10 % Low, 10–25 % Medium, > 25 % High. Thresholds are starting values to tune on the bench.
- `movementLevel(mags)`: mean of `|mag − 1 g|` over the last 10 s: < 0.05 Low, < 0.20 Medium, else High.
- `greeting(date)`, `sleepGoalProgress(minutes, goal)`, `consistencyLabel(nights)`.
- `wheelToHueSat(x, y, r)` / `hueSatToWheel(h, s, r)` for the colour wheel.

## 7. Bed tab

### 7.1 Status
Tiles: Occupancy (Occupied/Empty), Presence (Detected/Not detected), Bed Exit ("Not detected" or "Left at HH:MM" — the latest occupied → empty change in the current night), Movement (band, "from wristband", only when the band streams). No Breathing tile.

### 7.2 Presence graph
- `SectionCard` "Presence" with **1 h / 6 h / 24 h**; `TimelineStrip` of present / empty / no-data; summary "In bed 42 of the last 60 min · left 3 times".
- Live: new `presence` events from `useRoom` extend the strip; the window advances every 15 s.
- **API:** `GET /api/v1/devices/:deviceId/room/presence?minutes=60|360|1440` (owner only, room devices only, same guards as `/room/latest`) → `{ before: { present, at } | null, frames: [{ present, at }] }`, frames oldest first, `before` = the last presence frame before the window.
- **Contracts:** `presenceSegments({ before, frames, from, to, now })` → `[{ from, to, kind: 'present' | 'empty' | 'none' }]`. A gap of more than 90 s without any presence frame (the unit's heartbeat is 60 s) becomes `none` from 90 s after the last frame until the next one. Segments are clipped to `[from, to]`; time after `now` is not drawn.

### 7.3 Radar Monitoring
`ListRow` Presence / Occupancy with the current state. Bed Exit, Movement / Restlessness and Sleep Walking Support rows arrive with B.

### 7.4 Smart Lighting and Lighting Control
- Card on `/bed/`: current light swatch and brightness, `SegmentedToggle` Manual / Adaptive Radar (sends `{cmd:'auto', on}`), tap → `/bed/lighting/`.
- `/bed/lighting/` — `SegmentedTabs` Manual / Adaptive Radar:
  - Manual: `ColorWheel` (sends `{cmd:'light', on:true, color:{h,s,v}}`), brightness slider (white: `bright`; colour: `v`), swatches Warm night, Reading, Amber, Red, Blue, and Turn Off / Turn On. Sends once the pointer is released or a slider settles (500 ms), as today.
  - Adaptive Radar: toggle and "On when someone comes in, off 30 s after the room empties." Sleep-state adaptive lighting arrives with C.
  - The "Sent… / Done / No answer" line from today's `RoomNow` stays (shared hook `useLightCommand`).

## 8. Removed and moved
- Deleted: `app/exercise/page.tsx` and the Exercise tab.
- Moved (content unchanged except styling): Device → `/more/devices/`, Node → `/more/devices/pair/`, room setup → `/more/devices/room-setup/`, Me → `/more/settings/`, History → `/more/history/`. Internal links (`/device/`, `/sleep/` after room setup, etc.) updated; room setup's success button goes to `/bed/`.

## 9. Testing and checking

- `packages/contracts` (vitest): `presenceSegments` — carry-in from `before`, empty window, gaps → `none`, clipping, `now` inside the window, never-reported unit.
- `apps/web` (vitest added, pure functions only): every function in §6.4.
- `apps/api` (vitest, local MongoDB): `/room/presence` — window and `before`, oldest-first order, other owner → 404/403 as `/room/latest` does, band device refused, invalid `minutes` → 400.
- Typecheck and build list every route in §5, including forwarding pages.
- `scripts/seed-demo.mjs`: registers a demo account on a **localhost** API (refuses any other host), claims a band and a room unit, and ingests a night: presence with two bed exits, light changes, and band frames (HR, SpO₂, GSR, IMU). Used for screenshots and for the defense demo.
- Screenshots of every route at 390 px wide, dark and light, compared side by side with the mockups and shown to the user before A is called done.
- APK on a phone: bottom bar and safe areas, band pairing and room setup from More → Device Management.

## 10. Out of scope (A)

Sleep stages, sleep position, sleep events and reports (B); sleep target, recommendations, stress advice, sleep music, alert settings, sleep-state adaptive lighting (C); breathing (hardware); buzzer (band firmware not in this repo); display names on accounts.
