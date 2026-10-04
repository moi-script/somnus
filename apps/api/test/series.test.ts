import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DeviceModel, ReadingModel } from '../src/models/index.js';
import { app, claimDevice, clearDb, registerUser, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const BAND = 'lacs-7a3f21';
const BUCKET = 5 * 60_000;
// Aligned to a 5-minute boundary so every bucket is predictable.
const T0 = Math.floor(Date.parse('2026-10-04T22:00:00.000Z') / BUCKET) * BUCKET;

let seq = 0;
async function reading(at: number, over: { ppg?: object; gsr?: object; imu?: object } = {}) {
  const device = await DeviceModel.findOne({ deviceId: BAND }).lean();
  await ReadingModel.create({
    deviceId: BAND,
    ownerId: device!.ownerId,
    seq: ++seq,
    deviceMs: seq * 200,
    recordedAt: new Date(at),
    ppg: { ok: true, finger: true, ir: 1, red: 1, bpm: 70, bpmAvg: 70, spo2: 97, spo2Valid: true, ...over.ppg },
    imu: { ok: true, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, mag: 1, tempC: 30, ...over.imu },
    gsr: { ok: true, raw: 1800, volt: 1.4, base: 1800, ...over.gsr },
    motor: { on: false, pattern: 'idle' },
    flags: [],
  });
}

async function setup() {
  const { token } = await registerUser();
  await claimDevice(token, BAND);
  return token;
}

function series(token: string, query: string) {
  return request(app)
    .get(`/api/v1/devices/${BAND}/readings/series?${query}`)
    .set('Authorization', `Bearer ${token}`);
}

const DAY = `from=${new Date(T0).toISOString()}&to=${new Date(T0 + 86_400_000).toISOString()}`;

describe('readings series', () => {
  it('averages each bucket, ignoring readings that are not usable', async () => {
    const token = await setup();
    await reading(T0 + 1_000, { ppg: { bpm: 60, bpmAvg: 60 }, gsr: { raw: 1800 }, imu: { mag: 1.1 } });
    await reading(T0 + 2_000, { ppg: { bpm: 70, bpmAvg: 70, spo2: -1, spo2Valid: false }, gsr: { raw: 1820 }, imu: { mag: 0.9 } });
    await reading(T0 + 3_000, { ppg: { finger: false, bpm: 200, bpmAvg: 200, spo2: 50, spo2Valid: false }, gsr: { ok: false, raw: 5000 }, imu: { ok: false, mag: 3 } });

    const res = await series(token, DAY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { at: new Date(T0).toISOString(), bpm: 65, spo2: 97, gsr: 1810, motion: 0.1 },
    ]);
  });

  it('uses bpm when bpmAvg is still 0', async () => {
    const token = await setup();
    await reading(T0 + 1_000, { ppg: { bpm: 80, bpmAvg: 0 } });
    const res = await series(token, DAY);
    expect(res.body[0].bpm).toBe(80);
  });

  it('leaves out empty buckets and buckets with nothing usable, oldest first', async () => {
    const token = await setup();
    await reading(T0 + 2 * BUCKET + 1_000);
    await reading(T0 + 1_000);
    await reading(T0 + BUCKET + 1_000, {
      ppg: { ok: false, spo2Valid: false },
      gsr: { ok: false },
      imu: { ok: false },
    });
    const res = await series(token, DAY);
    expect(res.body.map((p: { at: string }) => p.at)).toEqual([
      new Date(T0).toISOString(),
      new Date(T0 + 2 * BUCKET).toISOString(),
    ]);
  });

  it('refuses a range over seven days or a missing from', async () => {
    const token = await setup();
    const long = await series(token, `from=${new Date(T0).toISOString()}&to=${new Date(T0 + 8 * 86_400_000).toISOString()}`);
    expect(long.status).toBe(400);
    const missing = await series(token, `to=${new Date(T0).toISOString()}`);
    expect(missing.status).toBe(400);
  });

  it("hides another account's band the way /readings does", async () => {
    await setup();
    const other = await registerUser();
    const res = await series(other.token, DAY);
    const plain = await request(app)
      .get(`/api/v1/devices/${BAND}/readings`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(plain.status);
  });
});
