import request from 'supertest';
import mongoose from 'mongoose';
import type { Express } from 'express';
import type { Frame, TelemetryFrame } from '@lacs/contracts';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/db.js';

export const app: Express = createApp();

export async function startDb(): Promise<void> {
  await connectDb();
}

export async function stopDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}

export async function clearDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

let userCounter = 0;

export async function registerUser(): Promise<{ token: string; email: string }> {
  const email = `user${++userCounter}-${Date.now()}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { token: res.body.token, email };
}

export async function claimDevice(
  userToken: string,
  deviceId = 'lacs-7a3f21',
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/devices/claim')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ deviceId, name: 'Bench node' });
  if (res.status >= 400) throw new Error(`claim failed: ${res.status} ${res.text}`);
  return res.body.ingestToken;
}

/** A telemetry frame shaped exactly like the firmware's serialiser output. */
export function telemetry(seq: number, deviceId = 'lacs-7a3f21'): TelemetryFrame {
  return {
    v: 1,
    t: 'telemetry',
    id: deviceId,
    seq,
    ms: 1000 + seq * 200,
    ppg: { ok: true, finger: true, ir: 98421, red: 87233, bpm: 72.4, bpmAvg: 71 },
    imu: {
      ok: true,
      ax: 0.01,
      ay: -0.02,
      az: 1,
      gx: 0.4,
      gy: -1.2,
      gz: 0.1,
      mag: 1.01,
      tempC: 31.2,
    },
    gsr: { ok: true, raw: 1820, volt: 1.47, base: 1800 },
    motor: { on: false, pattern: 'idle' },
    flags: [],
  };
}

export function fallEvent(seq: number, deviceId = 'lacs-7a3f21'): Frame {
  return {
    v: 1,
    t: 'event',
    id: deviceId,
    seq,
    ms: 5000,
    kind: 'fall',
    value: 3.12,
  };
}

export function ingest(deviceToken: string, frames: Frame[]) {
  return request(app)
    .post('/api/v1/ingest')
    .set('Authorization', `Bearer ${deviceToken}`)
    .send({ frames });
}
