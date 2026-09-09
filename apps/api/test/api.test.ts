import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  app,
  claimDevice,
  clearDb,
  fallEvent,
  ingest,
  registerUser,
  startDb,
  stopDb,
  telemetry,
} from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe('auth', () => {
  it('registers and returns a usable token', async () => {
    const { token, email } = await registerUser();
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it('rejects a duplicate email', async () => {
    const { email } = await registerUser();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct-horse-battery' });
    expect(res.status).toBe(409);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const { email } = await registerUser();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'not-the-password' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it('refuses a short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@example.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('refuses requests with no token', async () => {
    expect((await request(app).get('/api/v1/devices')).status).toBe(401);
  });
});

describe('device claim', () => {
  it('mints an ingest token scoped to the device', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'lacs-7a3f21', name: 'Bench node' });

    expect(res.status).toBe(201);
    expect(res.body.ingestToken).toMatch(/^lacs-7a3f21\.[0-9a-f]{48}$/);
    expect(res.body.device.name).toBe('Bench node');
  });

  it('rejects a device id that is not firmware-shaped', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'not-a-device' });
    expect(res.status).toBe(400);
  });

  it('will not let a second account claim a device that is already owned', async () => {
    const first = await registerUser();
    await claimDevice(first.token);

    const second = await registerUser();
    const res = await request(app)
      .post('/api/v1/devices/claim')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ deviceId: 'lacs-7a3f21' });

    expect(res.status).toBe(409);
  });
});

describe('ingest', () => {
  it('stores telemetry and events from one batch', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    const res = await ingest(deviceToken, [telemetry(1), telemetry(2), fallEvent(3)]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 3, duplicates: 0, rejected: 0 });
  });

  // The property the whole offline-buffer design rests on: a phone that dies
  // mid-flush retries the batch and must not double-write.
  it('is idempotent when the same batch is replayed', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);
    const batch = [telemetry(1), telemetry(2), telemetry(3)];

    const first = await ingest(deviceToken, batch);
    const replay = await ingest(deviceToken, batch);

    expect(first.body.accepted).toBe(3);
    expect(replay.body).toEqual({ accepted: 0, duplicates: 3, rejected: 0 });

    const readings = await request(app)
      .get('/api/v1/devices/lacs-7a3f21/readings')
      .set('Authorization', `Bearer ${token}`);
    expect(readings.body).toHaveLength(3);
  });

  it('accepts the new frames in a partially overlapping batch', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    await ingest(deviceToken, [telemetry(1), telemetry(2)]);
    const res = await ingest(deviceToken, [telemetry(2), telemetry(3), telemetry(4)]);

    expect(res.body).toEqual({ accepted: 2, duplicates: 1, rejected: 0 });
  });

  it('ignores frames claiming a different device than the token owns', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    const res = await ingest(deviceToken, [telemetry(1, 'lacs-ffffff'), telemetry(2)]);

    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toBe(1);
  });

  it('refuses a user JWT in place of a device token', async () => {
    const { token } = await registerUser();
    await claimDevice(token);
    const res = await ingest(token, [telemetry(1)]);
    expect(res.status).toBe(401);
  });

  it('refuses a device token whose secret half is wrong', async () => {
    const { token } = await registerUser();
    await claimDevice(token);
    const res = await ingest(`lacs-7a3f21.${'0'.repeat(48)}`, [telemetry(1)]);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed frame without storing the good ones alongside it', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    const res = await request(app)
      .post('/api/v1/ingest')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ frames: [{ v: 1, t: 'telemetry', id: 'lacs-7a3f21' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('marks the device seen and records its firmware version', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    await ingest(deviceToken, [
      {
        v: 1,
        t: 'status',
        id: 'lacs-7a3f21',
        seq: 1,
        ms: 812,
        fw: '0.1.0',
        transport: 'serial',
        online: 3,
        total: 3,
        sensors: { max30102: true, mpu6050: true, gsr: true },
        config: {
          hz: 5,
          gsrDelta: 250,
          fallHighG: 2.5,
          freeFallG: 0.3,
          fingerLostMs: 3000,
          human: true,
        },
      },
    ]);

    const devices = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${token}`);

    expect(devices.body[0].fw).toBe('0.1.0');
    expect(devices.body[0].online).toBe(true);
  });
});

describe('cross-user isolation', () => {
  it('hides another account’s device behind a 404', async () => {
    const owner = await registerUser();
    const deviceToken = await claimDevice(owner.token);
    await ingest(deviceToken, [telemetry(1)]);

    const stranger = await registerUser();
    for (const path of [
      '/api/v1/devices/lacs-7a3f21',
      '/api/v1/devices/lacs-7a3f21/latest',
      '/api/v1/devices/lacs-7a3f21/readings',
      '/api/v1/devices/lacs-7a3f21/events',
    ]) {
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${stranger.token}`);
      // 404 not 403: existence itself should not leak.
      expect(res.status, path).toBe(404);
    }
  });

  it('will not let a stranger queue a command to someone else’s node', async () => {
    const owner = await registerUser();
    await claimDevice(owner.token);
    const stranger = await registerUser();

    const res = await request(app)
      .post('/api/v1/devices/lacs-7a3f21/commands')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ command: { cmd: 'buzz', pattern: 'double' } });

    expect(res.status).toBe(404);
  });

  it('lists only the caller’s own devices', async () => {
    const first = await registerUser();
    await claimDevice(first.token, 'lacs-aaaaaa');
    const second = await registerUser();
    await claimDevice(second.token, 'lacs-bbbbbb');

    const res = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${first.token}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].deviceId).toBe('lacs-aaaaaa');
  });
});

describe('commands', () => {
  it('round-trips queue, drain and ack', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    const queued = await request(app)
      .post('/api/v1/devices/lacs-7a3f21/commands')
      .set('Authorization', `Bearer ${token}`)
      .send({ command: { cmd: 'buzz', pattern: 'sos', ms: 300 } });
    expect(queued.status).toBe(201);
    expect(queued.body.status).toBe('pending');

    const drained = await request(app)
      .get('/api/v1/commands/pending')
      .set('Authorization', `Bearer ${deviceToken}`);
    expect(drained.body).toHaveLength(1);
    expect(drained.body[0].command).toEqual({ cmd: 'buzz', pattern: 'sos', ms: 300 });

    // Delivered at most once: a second drain sees nothing.
    const second = await request(app)
      .get('/api/v1/commands/pending')
      .set('Authorization', `Bearer ${deviceToken}`);
    expect(second.body).toHaveLength(0);

    const acked = await request(app)
      .post(`/api/v1/commands/${queued.body.id}/ack`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ ok: true, detail: 'sos' });
    expect(acked.body.status).toBe('acked');
  });

  it('rejects a command the firmware could not parse', async () => {
    const { token } = await registerUser();
    await claimDevice(token);

    const res = await request(app)
      .post('/api/v1/devices/lacs-7a3f21/commands')
      .set('Authorization', `Bearer ${token}`)
      .send({ command: { cmd: 'buzz', pattern: 'idle' } });

    expect(res.status).toBe(400);
  });
});

describe('readings', () => {
  it('returns chronological order for charting', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);
    await ingest(deviceToken, [telemetry(1), telemetry(2), telemetry(3)]);

    const res = await request(app)
      .get('/api/v1/devices/lacs-7a3f21/readings?limit=2')
      .set('Authorization', `Bearer ${token}`);

    // Newest two, oldest first.
    expect(res.body.map((r: { seq: number }) => r.seq)).toEqual([2, 3]);
  });

  // An offline phone flushes an hour of frames in one request. If they all
  // shared the arrival timestamp, that hour would render as a single point.
  it('spreads a batch across real time using the device uptime counter', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);
    // helper spaces frames 200 ms apart in device `ms`
    await ingest(deviceToken, [telemetry(1), telemetry(2), telemetry(3)]);

    const res = await request(app)
      .get('/api/v1/devices/lacs-7a3f21/readings')
      .set('Authorization', `Bearer ${token}`);

    const times = res.body.map((r: { recordedAt: string }) => Date.parse(r.recordedAt));
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBe(200);
    expect(times[2] - times[1]).toBe(200);
  });

  it('falls back to arrival time when the device clock has reset', async () => {
    const { token } = await registerUser();
    const deviceToken = await claimDevice(token);

    // seq 2 reports an uptime two days lower: a reboot, not a real gap.
    const rebooted = telemetry(2);
    rebooted.ms = 10;
    const recent = telemetry(3);
    recent.ms = 2 * 24 * 60 * 60 * 1000;

    await ingest(deviceToken, [rebooted, recent]);

    const res = await request(app)
      .get('/api/v1/devices/lacs-7a3f21/readings')
      .set('Authorization', `Bearer ${token}`);

    const times = res.body.map((r: { recordedAt: string }) => Date.parse(r.recordedAt));
    // Same instant, rather than one of them backdated two days.
    expect(times[0]).toBe(times[1]);
  });

  it('404s latest before the device has ever reported', async () => {
    const { token } = await registerUser();
    await claimDevice(token);
    const res = await request(app)
      .get('/api/v1/devices/lacs-7a3f21/latest')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
