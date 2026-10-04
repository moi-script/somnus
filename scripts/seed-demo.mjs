#!/usr/bin/env node
/**
 * Fills a LOCAL Somnus API with a demo account and a night of data, for
 * screenshots and the thesis demo. Refuses any other host, so it can never
 * write invented data to the real server.
 *
 *   node scripts/seed-demo.mjs [--api http://localhost:4000]
 */
const arg = process.argv.indexOf('--api');
const API = arg > 0 ? process.argv[arg + 1] : 'http://localhost:4000';
const host = new URL(API).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`[seed] refusing ${API}: demo data only goes to localhost`);
  process.exit(1);
}
const BASE = `${API}/api/v1`;

async function call(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const MIN = 60_000;
const HOURS = 8;
const NEWEST = 50_000_000; // device ms of the newest frame; ingest anchors it at arrival

const email = `demo-${Date.now()}@example.com`;
const password = 'demo-password-123';
const { token } = await call('/auth/register', { body: { email, password } });
const band = await call('/devices/claim', { token, body: { deviceId: 'lacs-dec0de', name: 'Demo band' } });
const room = await call('/devices/claim', { token, body: { deviceId: 'room-dec0de', name: 'Demo bed unit' } });

// Room: a heartbeat a minute for 8 hours, with two trips out of bed.
const out = (m) => (m >= 180 && m < 186) || (m >= 390 && m < 394);
const roomFrames = [];
let seq = 1;
for (let m = HOURS * 60; m >= 0; m--) {
  roomFrames.push({ v: 2, t: 'presence', id: 'room-dec0de', seq: seq++, ms: NEWEST - m * MIN, present: !out(HOURS * 60 - m) });
}
const lightAt = (minutesAgo, state, source) => ({
  v: 2, t: 'light', id: 'room-dec0de', seq: seq++, ms: NEWEST - minutesAgo * MIN,
  on: state.on, mode: state.mode, bright: state.bright ?? null, temp: state.temp ?? null, color: state.color ?? null, source,
});
roomFrames.push(lightAt(HOURS * 60, { on: true, mode: 'white', bright: 40, temp: 10 }, 'auto'));
roomFrames.push(lightAt(HOURS * 60 - 20, { on: true, mode: 'colour', color: { h: 20, s: 90, v: 15 } }, 'app'));
roomFrames.push(lightAt(HOURS * 60 - 60, { on: false, mode: 'white', bright: 15, temp: 0 }, 'auto'));
await call('/ingest', { token: room.ingestToken, body: { frames: roomFrames } });

// Band: one reading a minute for 8 hours - heart rate drifting down, a rise
// at each trip out of bed.
const bandFrames = [];
for (let m = HOURS * 60; m >= 0; m--) {
  const t = HOURS * 60 - m;
  const up = out(t) ? 25 : 0;
  const bpm = Math.round(66 - 8 * Math.sin((t / (HOURS * 60)) * Math.PI) + up + (Math.random() * 4 - 2));
  const mag = out(t) ? 1.35 : 1 + (Math.random() * 0.06 - 0.03);
  bandFrames.push({
    v: 2, t: 'telemetry', id: 'lacs-dec0de', seq: t + 1, ms: NEWEST - m * MIN,
    ppg: { ok: true, finger: true, ir: 98000, red: 87000, bpm, bpmAvg: bpm, spo2: 95 + Math.round(Math.random() * 3), spo2Valid: true },
    imu: { ok: true, ax: 0, ay: 0, az: mag, gx: 0, gy: 0, gz: 0, mag, tempC: 31 },
    gsr: { ok: true, raw: 1800 + (out(t) ? 400 : Math.round(Math.random() * 60)), volt: 1.45, base: 1800 },
    steps: { count: 0, cadence: 0 },
    motor: { on: false, pattern: 'idle' },
    flags: [],
  });
}
await call('/ingest', { token: band.ingestToken, body: { frames: bandFrames } });

console.log(`[seed] demo account ready on ${API}`);
console.log(`[seed]   email:    ${email}`);
console.log(`[seed]   password: ${password}`);
