import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { nightDateFor, type Frame } from '@lacs/contracts';
import {
  ROOM_ID,
  app,
  claimDevice,
  clearDb,
  ingest,
  light,
  presence,
  registerUser,
  startDb,
  stopDb,
} from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const MIN = 60_000;

async function setup() {
  const { token } = await registerUser();
  const roomToken = await claimDevice(token, ROOM_ID);
  return { token, roomToken };
}

function asUser(token: string) {
  return {
    get: (path: string) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) =>
      request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  };
}

/**
 * A UTC offset that puts "now" at 02:00 local, so a few hours of presence
 * ending now always fall inside one night window, whenever the suite runs.
 */
function tzForTwoAm(now = new Date()): number {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let tz = utcMin - 120;
  if (tz > 720) tz -= 1440;
  if (tz < -720) tz += 1440;
  return tz;
}

/** `minutes` of presence ending now, one heartbeat a minute, newest last. */
function presenceEndingNow(minutes: number): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < minutes; i++) {
    frames.push(presence(i + 1, 1_000_000 + i * MIN, true));
  }
  return frames;
}

describe('room unit', () => {
  it('claims as a room and says so', async () => {
    const { token } = await registerUser();
    const res = await asUser(token).post('/devices/claim', { deviceId: ROOM_ID });
    expect(res.status).toBe(201);
    expect(res.body.device.kind).toBe('room');

    const band = await asUser(token).post('/devices/claim', { deviceId: 'lacs-7a3f21' });
    expect(band.body.device.kind).toBe('band');
  });

  it('stores presence and light frames idempotently', async () => {
    const { roomToken } = await setup();
    const frames = [presence(1, 1000, true), light(2, 1100)];

    const first = await ingest(roomToken, frames);
    expect(first.body).toEqual({ accepted: 2, duplicates: 0, rejected: 0 });

    const replay = await ingest(roomToken, frames);
    expect(replay.body).toEqual({ accepted: 0, duplicates: 2, rejected: 0 });
  });

  it('serves the newest presence and light', async () => {
    const { token, roomToken } = await setup();
    await ingest(roomToken, [
      presence(1, 1000, true),
      light(2, 1100, { on: false }),
      presence(3, 2000, false),
      light(4, 2100, { mode: 'colour', bright: null, temp: null, color: { h: 20, s: 90, v: 30 }, source: 'app' }),
    ]);

    const res = await asUser(token).get(`/devices/${ROOM_ID}/room/latest`);
    expect(res.status).toBe(200);
    expect(res.body.presence.present).toBe(false);
    expect(res.body.light.state.color).toEqual({ h: 20, s: 90, v: 30 });
    expect(res.body.light.source).toBe('app');
  });

  it('answers latest with nulls before the unit has reported', async () => {
    const { token } = await setup();
    const res = await asUser(token).get(`/devices/${ROOM_ID}/room/latest`);
    expect(res.body).toEqual({ presence: null, light: null });
  });
});

describe('room commands', () => {
  it('only queues commands the device understands', async () => {
    const { token, roomToken } = await setup();
    await claimDevice(token, 'lacs-7a3f21');
    const user = asUser(token);

    const buzzRoom = await user.post(`/devices/${ROOM_ID}/commands`, { command: { cmd: 'buzz' } });
    expect(buzzRoom.status).toBe(400);
    expect(buzzRoom.body.error).toBe('wrong_device_kind');

    const lightBand = await user.post('/devices/lacs-7a3f21/commands', {
      command: { cmd: 'light', on: true },
    });
    expect(lightBand.status).toBe(400);

    const ok = await user.post(`/devices/${ROOM_ID}/commands`, {
      command: { cmd: 'light', bright: 30, temp: 0 },
    });
    expect(ok.status).toBe(201);

    const drained = await request(app)
      .get('/api/v1/commands/pending')
      .set('Authorization', `Bearer ${roomToken}`);
    expect(drained.body).toHaveLength(1);
    expect(drained.body[0].command).toEqual({ cmd: 'light', bright: 30, temp: 0 });
  });

  it('refuses a light command that mixes colour and white', async () => {
    const { token } = await setup();
    const res = await asUser(token).post(`/devices/${ROOM_ID}/commands`, {
      command: { cmd: 'light', temp: 0, color: { h: 20, s: 90, v: 30 } },
    });
    expect(res.status).toBe(400);
  });
});

describe('nights', () => {
  it('summarises a night from ingested frames', async () => {
    const { token, roomToken } = await setup();
    const tz = tzForTwoAm();
    await ingest(roomToken, [light(1000, 1_000_000 - 5 * MIN, { on: false }), ...presenceEndingNow(180)]);

    const date = nightDateFor(Date.now(), tz);
    const res = await asUser(token).get(`/devices/${ROOM_ID}/nights/${date}?tz=${tz}`);
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
    expect(Math.abs(res.body.inRoomMs - 180 * MIN)).toBeLessThan(2 * MIN);
    expect(res.body.light.groupMs.off).toBeGreaterThan(170 * MIN);
  });

  it('lists recent nights newest first', async () => {
    const { token, roomToken } = await setup();
    const tz = tzForTwoAm();
    await ingest(roomToken, presenceEndingNow(90));

    const res = await asUser(token).get(`/devices/${ROOM_ID}/nights?limit=3&tz=${tz}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].date).toBe(nightDateFor(Date.now(), tz));
    expect(res.body[0].recorded).toBe(true);
    expect(res.body[1].recorded).toBe(false);
  });

  it('will not summarise nights for a band', async () => {
    const { token } = await setup();
    await claimDevice(token, 'lacs-7a3f21');
    const res = await asUser(token).get('/devices/lacs-7a3f21/nights?tz=0');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_a_room');
  });

  it('rejects a malformed date', async () => {
    const { token } = await setup();
    const res = await asUser(token).get(`/devices/${ROOM_ID}/nights/yesterday?tz=0`);
    expect(res.status).toBe(400);
  });
});
